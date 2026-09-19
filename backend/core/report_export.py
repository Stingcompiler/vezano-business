"""REP-06 — تصدير تقرير ومعاينته (36-D28 ready/loading/success/server_error · 19-D14
validation_error؛ §٧.٧، §١٤.١): معاينةٌ للصفحة الأولى كما ستُطبع بالضبط قبل التصدير؛ التوليد مع
عدد الصفحات المتوقَّع؛ الملف باسمٍ يحمل مداه («تقرير.pdf» ضائع بعد أسبوع)؛ حدّ المدى 12 شهراً من
الباقة لا من النظام — نقول الحدّ ونعرض البدائل الثلاثة بدل «فشل التصدير»؛ التصدير يُحصى ويُحدّ.
لا توليد PDF خادمياً (كما PTY-08 §٣٠): المستند HTML يُطبع أو يُحفظ PDF من المتصفح، أو CSV أخفّ."""

from __future__ import annotations

import html
import math
import secrets
import uuid
from datetime import date
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import ReportExport, Tenant, User
from core.subscription import ensure_subscription, plan_of
from core.tenancy import require_tenant
from sales.reports import Range

#: صفحة A4 تقريباً — كما PTY-08 (0005 §٣٠)
ROWS_PER_PAGE = 40
#: حدّ المدى بالأشهر من الباقة لا من النظام (19-D14: «يُرفع بطلب») — 12 لكل الباقات الآن
MONTHS_LIMIT = 12
#: حصة التصدير الشهرية بالباقة (§١٤.١ «يُحصى ويُحدّ») — افتراض حتى يُحسم العرض
EXPORTS_PER_MONTH = {"trial": 10, "single": 30, "dual": 100}

REPORT_LABELS = dict(ReportExport.REPORTS)


class ExportRejected(Exception):
    def __init__(self, code: str, extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.extra = extra or {}


def months_between(start: date, end: date) -> int:
    """عدد الأشهر التي يمسّها المدى (سبتمبر–أكتوبر = 2)."""
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def _fmt(v: str) -> str:
    n = int(v or "0")
    sign = "−" if n < 0 else ""
    n = abs(n)
    return f"{sign}{n // 100:,}.{n % 100:02d}"


def _qty(v: str) -> str:
    n = int(v or "0")
    sign = "−" if n < 0 else ""
    n = abs(n)
    whole, frac = divmod(n, 1000)
    return f"{sign}{whole:,}" + (f".{frac:03d}".rstrip("0") if frac else "")


def _payload(report: str, viewer: home.Viewer, rng: Range, branch_id: Any) -> dict[str, Any]:
    from inventory import reports as stock_reports
    from parties import reports as party_reports
    from sales import reports as sales_reports
    from shifts import reports as cash_reports

    if report == "sales":
        return sales_reports.sales_report(viewer=viewer, rng=rng, branch_id=branch_id)
    if report == "receivables":
        return party_reports.receivables_report(viewer=viewer)
    if report == "stock":
        return stock_reports.stock_report(viewer=viewer, rng=rng, branch_id=branch_id)
    if report == "cash":
        return cash_reports.cash_report(viewer=viewer, rng=rng, branch_id=branch_id)
    raise ExportRejected("report_unknown")


def _csv(report: str, payload: dict[str, Any]) -> str:
    from inventory import reports as stock_reports
    from parties import reports as party_reports
    from sales import reports as sales_reports
    from shifts import reports as cash_reports

    fn = {
        "sales": sales_reports.export_csv,
        "receivables": party_reports.export_csv,
        "stock": stock_reports.export_csv,
        "cash": cash_reports.export_csv,
    }[report]
    return fn(payload)


def _monthly(by_day: list[dict[str, Any]]) -> list[list[str]]:
    """الملخص الشهري بدل التفصيل: سطر لكل شهر — مناسب للبنك والمراجع الخارجي (19-D14)."""
    acc: dict[str, dict[str, int]] = {}
    for d in by_day:
        m = acc.setdefault(d["date"][:7], {"n": 0, "cash": 0, "credit": 0, "ret": 0, "net": 0})
        m["n"] += int(d["invoices"])
        m["cash"] += int(d["cash_minor"])
        m["credit"] += int(d["credit_minor"])
        m["ret"] += int(d["returns_minor"])
        m["net"] += int(d["net_minor"])
    return [
        [
            k,
            str(v["n"]),
            _fmt(str(v["cash"])),
            _fmt(str(v["credit"])),
            _fmt(str(v["ret"])),
            _fmt(str(v["net"])),
        ]
        for k, v in sorted(acc.items())
    ]


def _table(
    report: str, payload: dict[str, Any], *, monthly: bool = False
) -> tuple[list[str], list[list[str]], str]:
    """رؤوس وصفوف الجدول وسطر الاكتمال/التنويه لكل تقرير — الترويسة تقول أي مدى يغطيه ومتى حُسب."""
    if report == "sales":
        c = payload["completeness"]
        note = (
            "مكتمل"
            if c["complete"]
            else f"ناقص {c['pending_ops']} عمليات معلّقة من {len(c['not_synced'])} أجهزة"
        )
        if monthly:
            return (
                ["الشهر", "فواتير", "نقد", "آجل", "مرتجعات", "الصافي"],
                _monthly(payload["by_day"]),
                note + " · ملخص شهري",
            )
        rows = [
            [
                d["date"],
                str(d["invoices"]),
                _fmt(d["cash_minor"]),
                _fmt(d["credit_minor"]),
                _fmt(d["returns_minor"]),
                _fmt(d["net_minor"]),
            ]
            for d in payload["by_day"]
        ]
        return ["اليوم", "فواتير", "نقد", "آجل", "مرتجعات", "الصافي"], rows, note
    if report == "receivables":
        rows = [
            [
                r["name"],
                _fmt(r["balance_minor"]),
                r["last_payment_date"] or "لا سداد بعد",
                r["oldest_unpaid_date"] or "—",
                r["source"],
            ]
            for r in payload["rows"]
        ]
        return (
            ["الطرف", "الرصيد", "آخر سداد", "أقدم حركة غير مسددة", "المصدر"],
            rows,
            "بلا جدول أعمار (G-15)",
        )
    if report == "stock":
        c = payload["completeness"]
        note = "مكتمل" if c["complete"] else f"ناقص {c['pending_ops']} حركات معلّقة"
        rows = [
            [
                r["name"],
                r["unit"]["name"],
                _qty(r["opening_milli"]),
                _qty(r["in_milli"]),
                _qty(r["out_milli"]),
                _qty(r["closing_milli"]),
                r["doc"],
            ]
            for r in payload["rows"]
        ]
        return (
            ["الصنف", "الوحدة", "أول المدة", "وارد", "صادر", "الرصيد", "المستند المفسِّر"],
            rows,
            note,
        )
    t = payload["totals"]
    note = f"الفارق {_fmt(t['variance_minor'])} · خارج المجموع {t['excluded_conflicts']}"
    rows = [
        [
            r["closed_at"][:16].replace("T", " "),
            r["branch_name"],
            r["user_name"],
            _fmt(r["expected_cash_at_close_minor"]) if r["expected_cash_at_close_minor"] else "—",
            _fmt(r["counted_cash_minor"]) if r["counted_cash_minor"] else "—",
            (
                "خارج المجموع"
                if r["conflict"]
                else (_fmt(r["variance_minor"]) if r["variance_minor"] else "بلا عدّ")
            ),
            r["counted_by_name"],
        ]
        for r in payload["rows"]
    ]
    return ["الإقفال", "الفرع", "المستخدم", "المتوقَّع", "المعدود", "الفارق", "من عدّ"], rows, note


def _html(
    *,
    report: str,
    rng: Range,
    payload: dict[str, Any],
    page: int | None,
    tenant_name: str,
    generated_at: Any,
    monthly: bool = False,
) -> tuple[str, int, int]:
    head, rows, note = _table(report, payload, monthly=monthly)
    pages = max(1, math.ceil(len(rows) / ROWS_PER_PAGE))
    shown = rows if page is None else rows[(page - 1) * ROWS_PER_PAGE : page * ROWS_PER_PAGE]
    esc = html.escape
    gen = timezone.localtime(generated_at)
    scope = ""
    if report == "stock" and payload.get("branch"):
        scope = f" · {payload['branch']['name']}"
    elif payload.get("scope") == "branch" and payload.get("branch_name"):
        scope = f" · {payload['branch_name']}"
    text_cols = {
        "الوحدة",
        "المستند المفسِّر",
        "المصدر",
        "الفرع",
        "المستخدم",
        "من عدّ",
        "آخر سداد",
        "أقدم حركة غير مسددة",
    }

    def cell(i: int, h: str, c: str) -> str:
        cls = " class=m" if i > 0 and h not in text_cols else ""
        return f"<td{cls}>{esc(str(c))}</td>"

    body_rows = "".join(
        "<tr>"
        + "".join(cell(i, h, c) for i, (h, c) in enumerate(zip(head, r, strict=True)))
        + "</tr>"
        for r in shown
    )
    label = REPORT_LABELS[report]
    span = f"{rng.start.isoformat()} – {rng.end.isoformat()}"
    pages_note = f"صفحة {page} من {pages}" if page else f"{pages} صفحات"
    doc = f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>{esc(label)} {esc(rng.start.isoformat())} – {esc(rng.end.isoformat())}</title>
<style>
body{{font-family:system-ui,sans-serif;margin:24px;color:#0f172a}}
h1{{font-size:18px;margin:0}} .sub{{color:#475569;font-size:13px}}
table{{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}}
th,td{{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:start}}
.m{{font-family:ui-monospace,Menlo,monospace;direction:ltr;text-align:end;unicode-bidi:isolate}}
.note{{color:#475569;font-size:12px;margin-top:10px}}
@page{{size:A4;margin:16mm}}
</style></head><body><main>
<h1>{esc(tenant_name)}</h1>
<p class=sub>{esc(label)}{esc(scope)} · المدى <span class=m>{span}</span>
 · حُسب <span class=m>{gen:%Y-%m-%d %H:%M}</span> · {esc(note)} · {pages_note}</p>
<table><thead><tr>{"".join(f"<th>{esc(h)}</th>" for h in head)}</tr></thead>
<tbody>{body_rows}</tbody></table>
<p class=note>الترويسة تقول أي مدى يغطيه ومتى حُسب — لا تفقده الورقة حين تخرج من الشاشة.</p>
</main></body></html>"""
    return doc, pages, len(rows)


def check_range(rng: Range, *, monthly: bool = False) -> None:
    months = months_between(rng.start, rng.end)
    if monthly:
        return  # الملخص الشهري يغطي المدى كله بسطر لكل شهر
    if months > MONTHS_LIMIT:
        # 19-D14: نقول الحدّ ونعرض البدائل بدل «فشل التصدير»
        split_end = date(
            rng.start.year + (rng.start.month + MONTHS_LIMIT - 2) // 12,
            (rng.start.month + MONTHS_LIMIT - 2) % 12 + 1,
            1,
        )
        raise ExportRejected(
            "range_too_wide",
            {
                "months": months,
                "limit": MONTHS_LIMIT,
                "alternatives": [
                    {
                        "key": "split",
                        "first_end": split_end.isoformat(),
                        "rest_months": months - MONTHS_LIMIT,
                    },
                    {"key": "monthly_summary", "months": months},
                    {"key": "request_wider", "limit": MONTHS_LIMIT},
                ],
            },
        )


def quota() -> dict[str, int]:
    sub = ensure_subscription()
    limit = EXPORTS_PER_MONTH.get(plan_of(sub).code, 30)
    now = timezone.localtime(timezone.now())
    used = ReportExport.objects.filter(
        generated_at__gte=now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    ).count()
    return {"used": used, "limit": limit}


def preview(
    *,
    viewer: home.Viewer,
    report: str,
    rng: Range,
    fmt: str,
    branch_id: Any,
    monthly: bool = False,
) -> dict[str, Any]:
    monthly = monthly and report == "sales"
    check_range(rng, monthly=monthly)
    payload = _payload(report, viewer, rng, branch_id)
    tenant = Tenant.unscoped.get(id=require_tenant())
    now = timezone.now()
    doc, pages, rows = _html(
        report=report,
        rng=rng,
        payload=payload,
        page=1,
        tenant_name=tenant.name,
        generated_at=now,
        monthly=monthly,
    )
    ext = "csv" if fmt == "csv" else "html"
    return {
        "report": report,
        "label": REPORT_LABELS[report],
        "format": ext,
        "file_name": _file_name(report, rng, ext, monthly),
        "monthly": monthly,
        "expected_pages": pages if ext == "html" else 1,
        "row_count": rows,
        "first_page_html": doc,
        "range": {
            "start": rng.start.isoformat(),
            "end": rng.end.isoformat(),
            "label": rng.label,
            "months": months_between(rng.start, rng.end),
        },
        "quota": quota(),
        "months_limit": MONTHS_LIMIT,
    }


def _file_name(report: str, rng: Range, ext: str, monthly: bool) -> str:
    tag = "-monthly" if monthly else ""
    return f"{report}{tag}-{rng.start.isoformat()}_{rng.end.isoformat()}.{ext}"


def generate(
    *,
    actor: User,
    viewer: home.Viewer,
    report: str,
    rng: Range,
    fmt: str,
    branch_id: Any,
    monthly: bool = False,
) -> ReportExport:
    monthly = monthly and report == "sales"
    check_range(rng, monthly=monthly)
    q = quota()
    if q["used"] >= q["limit"]:
        raise ExportRejected("export_quota", q)
    payload = _payload(report, viewer, rng, branch_id)
    tenant = Tenant.unscoped.get(id=require_tenant())
    now = timezone.now()
    ext = "csv" if fmt == "csv" else "html"
    if ext == "csv" and not monthly:
        body = _csv(report, payload)
        pages, rows = 1, max(0, body.count("\n") - 2)
    elif ext == "csv":
        head, table_rows, note = _table(report, payload, monthly=True)
        body = (
            "\n".join(
                [f"# {REPORT_LABELS[report]} · ملخص شهري · {rng.start} – {rng.end} · {note}"]
                + [",".join(head)]
                + [",".join(r) for r in table_rows]
            )
            + "\n"
        )
        pages, rows = 1, len(table_rows)
    else:
        body, pages, rows = _html(
            report=report,
            rng=rng,
            payload=payload,
            page=None,
            tenant_name=tenant.name,
            generated_at=now,
            monthly=monthly,
        )
    e: ReportExport = ReportExport.objects.create(
        tenant_id=tenant.id,
        report=report,
        fmt=ext,
        range_start=rng.start,
        range_end=rng.end,
        branch_id=uuid.UUID(str(branch_id)) if branch_id else None,
        file_name=_file_name(report, rng, ext, monthly),
        byte_size=len(body.encode("utf-8")),
        page_count=pages,
        row_count=rows,
        token=secrets.token_urlsafe(24),
        body=body,
        generated_by_user_id=actor.id,
        generated_by_name=actor.display_name,
    )
    audit.record(
        kind="report.exported",
        title=f"تصدير {REPORT_LABELS[report]} {rng.start.isoformat()} – {rng.end.isoformat()}",
        actor=actor,
        detail=f"{e.file_name} · {pages} صفحات · {e.byte_size:,} بايت",
        ref_entity="core.ReportExport",
        ref_id=e.id,
    )
    return e


def export_payload(e: ReportExport) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "report": e.report,
        "label": REPORT_LABELS.get(e.report, e.report),
        "format": e.fmt,
        "range": {"start": e.range_start.isoformat(), "end": e.range_end.isoformat()},
        "file_name": e.file_name,
        "byte_size": e.byte_size,
        "page_count": e.page_count,
        "row_count": e.row_count,
        "url": f"/api/reports/exports/{e.token}",
        "generated_at": e.generated_at.isoformat().replace("+00:00", "Z"),
        "generated_by_name": e.generated_by_name,
        "open_count": e.open_count,
    }


def open_export(token: str) -> ReportExport | None:
    e: ReportExport | None = ReportExport.unscoped.filter(token=token).first()
    if e is None:
        return None
    e.open_count += 1
    e.save(update_fields=["open_count"])
    return e


def request_wider_limit(*, actor: User, months: int) -> dict[str, Any]:
    """«اطلب مدى أوسع»: حدّ الـ12 شهراً من الباقة لا من النظام — يُرفع بطلب ويُذكر تأثيره على حجم
    الملف. الطلب يُسجَّل في التدقيق (لا رفع تلقائي — قرار المنصة)."""
    audit.record(
        kind="report.limit_requested",
        title=f"طلب رفع حدّ التصدير إلى {months} شهراً",
        actor=actor,
        detail=(
            f"الحدّ الحالي {MONTHS_LIMIT} شهراً من الباقة؛ "
            f"الملف الأوسع أكبر بنحو {months / MONTHS_LIMIT:.1f}×."
        ),
    )
    return {"requested_months": months, "limit": MONTHS_LIMIT, "status": "requested"}
