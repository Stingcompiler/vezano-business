"""REP-01 — تقرير المبيعات: «الرقم ومعه وقته» (§٧.٦، §١٤.١؛ ACC-79). الأرقام تُحسب من الفواتير
المؤكَّدة خادمياً في المدى بنطاق المشاهد، ويُعلَن في رأس التقرير ما لم يدخل بعد: الأجهزة التي لم
تُزامن وعدد المعلّق المبلَّغ عنها — «تقرير فيه 9 عمليات لم تصل بعد ليس خاطئاً، لكنه خاطئ إن لم يقل
ذلك». لا عمود تكلفة ولا هامش (G-03 — `phase_locked` حتى تُعتمد سياسة التكلفة)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from core import home
from core.models import Branch
from core.org_branches import _device_rows
from sales.models import Sale, SaleReturn

#: بعد ساعة بلا ظهور يُعدّ الجهاز «لم يُزامن» في سطر الاكتمال (0005 §٣٧: مطابقة متقادمة بعد ساعة)
NOT_SYNCED_AFTER = timedelta(hours=1)

RANGE_LABELS = {"today": "اليوم", "yesterday": "أمس", "7d": "آخر 7 أيام", "30d": "آخر 30 يوماً"}


@dataclass(frozen=True)
class Range:
    key: str
    start: date
    end: date  # شامل

    @property
    def label(self) -> str:
        if self.key in RANGE_LABELS:
            return RANGE_LABELS[self.key]
        if self.start == self.end:
            return self.start.isoformat()
        return f"{self.start.isoformat()} – {self.end.isoformat()}"


def parse_range(key: str, *, start: str | None, end: str | None) -> Range:
    today = timezone.localdate()
    if key == "yesterday":
        d = today - timedelta(days=1)
        return Range("yesterday", d, d)
    if key == "7d":
        return Range("7d", today - timedelta(days=6), today)
    if key == "30d":
        return Range("30d", today - timedelta(days=29), today)
    if key == "custom" and start:
        try:
            s = date.fromisoformat(start)
            e = date.fromisoformat(end) if end else s
        except ValueError:
            return Range("today", today, today)
        if e < s:
            s, e = e, s
        return Range("custom", s, e)
    return Range("today", today, today)


def _iso(dt: datetime | None) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _scope_branch_ids(viewer: home.Viewer, branch_id: Any) -> tuple[list[uuid.UUID] | None, str]:
    """المالك: كل الفروع أو فرع بعينه؛ مدير الفرع: فرعه فقط («تُعرض أرقام فرع السوق — المقارنة
    بين الفروع للمالك»)."""
    if viewer.is_owner:
        if branch_id:
            try:
                return [uuid.UUID(str(branch_id))], "branch"
            except ValueError:
                return None, "all"
        return None, "all"
    return ([viewer.branch.id] if viewer.branch else []), "branch"


def _completeness(branch_ids: list[uuid.UUID] | None) -> dict[str, Any]:
    now = timezone.now()
    rows = _device_rows(None)
    if branch_ids is not None:
        keep = {str(b) for b in branch_ids}
        rows = [r for r in rows if r["branch_id"] in keep]
    rows = [r for r in rows if r["status"] == "active"]
    not_synced: list[dict[str, Any]] = []
    pending_ops = 0
    for r in rows:
        seen = datetime.fromisoformat(r["last_seen_at"]) if r["last_seen_at"] else None
        late = seen is None or (now - seen) > NOT_SYNCED_AFTER
        if int(r["pending"]) > 0 or late:
            pending_ops += int(r["pending"])
            not_synced.append(
                {
                    "device_name": r["name"],
                    "branch_id": r["branch_id"],
                    "branch_name": r["branch_name"],
                    "last_seen_at": r["last_seen_at"],
                    "pending": int(r["pending"]),
                }
            )
    return {
        "devices_total": len(rows),
        "devices_synced": len(rows) - len(not_synced),
        "pending_ops": pending_ops,
        "not_synced": not_synced,
        "complete": not not_synced,
    }


def sales_report(
    *, viewer: home.Viewer, rng: Range, branch_id: Any = None, method: str = "all"
) -> dict[str, Any]:
    branch_ids, scope = _scope_branch_ids(viewer, branch_id)
    sales = Sale.objects.filter(business_date__gte=rng.start, business_date__lte=rng.end)
    returns = SaleReturn.objects.filter(business_date__gte=rng.start, business_date__lte=rng.end)
    if branch_ids is not None:
        sales = sales.filter(branch_id__in=branch_ids)
        returns = returns.filter(branch_id__in=branch_ids)
    if method == "cash":
        sales = sales.filter(cash_minor__gt=0)
    elif method == "credit":
        sales = sales.filter(credit_minor__gt=0)
    elif method == "bank":
        sales = sales.filter(bank_minor__gt=0)
    # المستند العكسي لتكرار (POS-12) يُسقط الفاتورة من الإيراد
    sales = sales.filter(reversals__isnull=True)

    agg = sales.aggregate(
        revenue=Sum("total_minor"),
        cash=Sum("cash_minor"),
        credit=Sum("credit_minor"),
        bank=Sum("bank_minor"),
        n=Count("id"),
    )
    ragg = returns.aggregate(total=Sum("total_minor"), n=Count("id"))
    revenue = int(agg["revenue"] or 0)
    ret = int(ragg["total"] or 0)
    n = int(agg["n"] or 0)

    branches = {
        str(b.id): b
        for b in (
            Branch.objects.filter(id__in=branch_ids) if branch_ids is not None else Branch.objects
        ).order_by("name")
    }
    by_branch: dict[str, dict[str, Any]] = {
        bid: {
            "id": bid,
            "name": b.name,
            "revenue_minor": 0,
            "returns_minor": 0,
            "invoices": 0,
            "last_sync_at": "",
            "pending": 0,
            "complete": True,
        }
        for bid, b in branches.items()
    }
    for row in sales.values("branch_id").annotate(r=Sum("total_minor"), n=Count("id")):
        b = by_branch.setdefault(
            str(row["branch_id"]),
            {
                "id": str(row["branch_id"]),
                "name": "",
                "revenue_minor": 0,
                "returns_minor": 0,
                "invoices": 0,
                "last_sync_at": "",
                "pending": 0,
                "complete": True,
            },
        )
        b["revenue_minor"] = int(row["r"] or 0)
        b["invoices"] = int(row["n"] or 0)
    for row in returns.values("branch_id").annotate(r=Sum("total_minor")):
        if str(row["branch_id"]) in by_branch:
            by_branch[str(row["branch_id"])]["returns_minor"] = int(row["r"] or 0)

    completeness = _completeness(branch_ids)
    for r in _device_rows(None):
        br = by_branch.get(r["branch_id"])
        if br is None or r["status"] != "active":
            continue
        if r["last_seen_at"] and r["last_seen_at"] > br["last_sync_at"]:
            br["last_sync_at"] = r["last_seen_at"]
    for ns in completeness["not_synced"]:
        br = by_branch.get(ns["branch_id"])
        if br is not None:
            br["pending"] += int(ns["pending"])
            br["complete"] = False

    by_day = [
        {
            "date": row["d"].isoformat(),
            "invoices": int(row["n"] or 0),
            "cash_minor": str(int(row["cash"] or 0)),
            "credit_minor": str(int(row["credit"] or 0)),
            "bank_minor": str(int(row["bank"] or 0)),
            "revenue_minor": str(int(row["r"] or 0)),
        }
        for row in sales.annotate(d=TruncDate("business_date"))
        .values("d")
        .annotate(
            r=Sum("total_minor"),
            cash=Sum("cash_minor"),
            credit=Sum("credit_minor"),
            bank=Sum("bank_minor"),
            n=Count("id"),
        )
        .order_by("-d")
    ]
    ret_by_day = {
        row["d"].isoformat(): int(row["r"] or 0)
        for row in returns.annotate(d=TruncDate("business_date"))
        .values("d")
        .annotate(r=Sum("total_minor"))
    }
    for d in by_day:
        rr = ret_by_day.get(d["date"], 0)
        d["returns_minor"] = str(rr)
        d["net_minor"] = str(int(d["revenue_minor"]) - rr)

    last_sale = (
        (Sale.objects.filter(branch_id__in=branch_ids) if branch_ids is not None else Sale.objects)
        .order_by("-business_date", "-occurred_at")
        .first()
    )
    return {
        "scope": scope,
        "branch_name": viewer.branch.name if viewer.branch else "",
        "can_all_branches": viewer.is_owner,
        "range": {
            "key": rng.key,
            "start": rng.start.isoformat(),
            "end": rng.end.isoformat(),
            "label": rng.label,
        },
        "method": method if method in {"cash", "credit", "bank"} else "all",
        "totals": {
            "revenue_minor": str(revenue),
            "returns_minor": str(ret),
            "net_minor": str(revenue - ret),
            "invoices": n,
            "returns_count": int(ragg["n"] or 0),
            "cash_minor": str(int(agg["cash"] or 0)),
            "credit_minor": str(int(agg["credit"] or 0)),
            "bank_minor": str(int(agg["bank"] or 0)),
            # متوسط الفاتورة: أقرب هللة (نصف لأعلى) — عرض لا قيد
            "average_minor": str((revenue * 2 + n) // (2 * n)) if n else "0",
        },
        "by_branch": [
            {
                **b,
                "revenue_minor": str(b["revenue_minor"]),
                "returns_minor": str(b["returns_minor"]),
            }
            for b in by_branch.values()
        ],
        "by_day": by_day,
        "completeness": completeness,
        "branches": [{"id": bid, "name": b.name} for bid, b in branches.items()]
        if viewer.is_owner
        else [],
        "computed_at": _iso(timezone.now()),
        "last_sale_date": last_sale.business_date.isoformat() if last_sale else "",
        # لا عمود تكلفة ولا هامش — قرار G-03: تظهر في REP-05 بحالة phase_locked حتى تُعتمد
        "cost_columns": "phase_locked",
    }


def export_csv(payload: dict[str, Any]) -> str:
    """الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من الشاشة."""
    c = payload["completeness"]
    head = (
        f"# تقرير المبيعات · {payload['range']['label']} · حُسب في {payload['computed_at']} · "
        + (
            "مكتمل"
            if c["complete"]
            else f"ناقص {c['pending_ops']} عمليات معلّقة من {len(c['not_synced'])} أجهزة"
        )
    )
    lines = [head, "date,invoices,cash_minor,credit_minor,bank_minor,returns_minor,net_minor"]
    for d in payload["by_day"]:
        lines.append(
            ",".join(
                str(d[k])
                for k in (
                    "date",
                    "invoices",
                    "cash_minor",
                    "credit_minor",
                    "bank_minor",
                    "returns_minor",
                    "net_minor",
                )
            )
        )
    return "\n".join(lines) + "\n"
