"""قائمة الفواتير (POS-09) ومراجعة التكرار التجاري (POS-12؛ §٧.٣): منع تكرار `operation_id` لا
يمنع جهازين من تسجيل الواقعة نفسها بهويتين. الاشتباه يُكشف مركزياً (نفس الصنف والكمية والدقائق من
جهازين — ACC-16) ويُراجع بقرار ممن يملك أثره: «سجّل عكساً» مستنداً مستقلاً لا «احذف».
جودة التاريخ (ACC-77): ساعة الجهاز لا تثبت وحدها تاريخ بيع وصل متأخراً؛ المشكوك فيه يُعلَن دون
تعديل الأصل."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from core.models import User
from core.tenancy import require_tenant
from inventory.models import StockMovement
from sales.models import DuplicateDecision, DuplicateReport, Sale, SaleLine, SaleReversal
from sync.reference import log_reference

#: زوج مشتبه به: نفس الفرع والإجمالي والسطور من جهازين خلال هذه النافذة («خلال دقيقة»)
DUPLICATE_WINDOW = timedelta(seconds=60)
#: بلاغ الكاشير يُقرَن بأقرب فاتورة بنفس الإجمالي في فرعه خلال هذا المدى
REPORT_PAIR_WINDOW = timedelta(minutes=15)
#: مدى القائمتين (كما SHIFT-05)
REVIEW_WINDOW = timedelta(days=7)
#: فاتورة وقتها بعد وصولها الخادم بأكثر من ساعة = ساعة جهاز في المستقبل
FUTURE_SLACK = timedelta(hours=1)


class DecisionRejected(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------- جودة التاريخ (ACC-77)


def date_suspect(sale: Sale) -> bool:
    """ساعة الجهاز في يوم غير يوم الأعمال المثبت من الوردية، أو بعد وصول الخادم — «تاريخ مشكوك
    فيه» يُعلَم ولا يُعدَّل الأصل."""
    local_day: date = timezone.localtime(sale.occurred_at).date()
    if abs((local_day - sale.business_date).days) > 1:
        return True
    return sale.occurred_at > sale.received_at + FUTURE_SLACK


def sync_state(sale: Sale) -> str:
    """على الخادم كل فاتورة مؤكدة؛ الملغاة بمستند عكسي تُسمّى."""
    return "reversed" if _reversed_ids([sale.id]) else "synced"


def _reversed_ids(ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    return set(SaleReversal.objects.filter(sale_id__in=list(ids)).values_list("sale_id", flat=True))


# ---------------------------------------------------------------- تمثيل الفاتورة


def line_payload(line: SaleLine) -> dict[str, Any]:
    return {
        "id": str(line.id),
        "item_id": str(line.item_id),
        "item_name": line.item_name,
        "unit_code": line.unit_code,
        "factor_milli": str(line.factor_milli),
        "qty_milli": str(line.qty_milli),
        "unit_price_minor": str(line.unit_price_minor),
        "line_total_minor": str(line.line_total_minor),
        "manual_price": line.manual_price,
    }


def sale_row(
    sale: Sale, *, reversed_ids: set[uuid.UUID], device_names: dict[uuid.UUID, str]
) -> dict[str, Any]:
    """صف القائمة: الرقم والوقت والعميل والإجمالي ونقداً وآجل ووضع المزامنة وجودة التاريخ."""
    from parties.models import Party

    party_name = ""
    if sale.party_id is not None:
        p = Party.objects.filter(id=sale.party_id).first()
        party_name = p.name if p else ""
    return {
        "id": str(sale.id),
        "invoice_number": sale.invoice_number,
        "branch_id": str(sale.branch_id),
        "device_id": str(sale.device_id),
        "device_name": device_names.get(sale.device_id, ""),
        "shift_id": str(sale.shift_id) if sale.shift_id else "",
        "user_name": sale.user_name,
        "party_id": str(sale.party_id) if sale.party_id else "",
        "party_name": party_name,
        "subtotal_minor": str(sale.subtotal_minor),
        "discount_minor": str(sale.discount_minor),
        "total_minor": str(sale.total_minor),
        "cash_minor": str(sale.cash_minor),
        "bank_minor": str(sale.bank_minor),
        "credit_minor": str(sale.credit_minor),
        "business_date": sale.business_date.isoformat(),
        "occurred_at": sale.occurred_at.isoformat(),
        "received_at": sale.received_at.isoformat(),
        "date_suspect": date_suspect(sale),
        "sync_state": "reversed" if sale.id in reversed_ids else "synced",
    }


def sale_detail(sale: Sale) -> dict[str, Any]:
    from core.models import Device

    names = {d.id: d.name for d in Device.objects.filter(id=sale.device_id)}
    row = sale_row(sale, reversed_ids=_reversed_ids([sale.id]), device_names=names)
    row["lines"] = [line_payload(ln) for ln in sale.lines.order_by("sort_order", "id")]
    row["payments"] = [
        {
            "method": p.method,
            "amount_minor": str(p.amount_minor),
            "reference": p.reference,
            "received_minor": str(p.received_minor) if p.received_minor is not None else "",
            "change_minor": str(p.change_minor) if p.change_minor is not None else "",
        }
        for p in sale.payments.order_by("id")
    ]
    rev = sale.reversals.first()
    row["reversal"] = reversal_payload(rev) if rev else None
    row["kept_of"] = [str(r.sale_id) for r in SaleReversal.objects.filter(kept_sale_id=sale.id)]
    return row


def reversal_payload(rev: SaleReversal) -> dict[str, Any]:
    return {
        "id": str(rev.id),
        "sale_id": str(rev.sale_id),
        "branch_id": str(rev.branch_id),
        "kind": rev.kind,
        "kept_sale_id": str(rev.kept_sale_id) if rev.kept_sale_id else "",
        "reason": rev.reason,
        "decided_by_name": rev.decided_by_name,
        "occurred_at": rev.occurred_at.isoformat(),
    }


# ---------------------------------------------------------------- القائمة (POS-09)


@dataclass(frozen=True)
class ListScope:
    """نطاق القائمة: المالك كل الفروع أو فرعه؛ مدير الفرع فرعه؛ الكاشير جهازه («يرى نطاقه»)."""

    branch_ids: list[uuid.UUID] | None
    device_id: uuid.UUID | None


def list_sales(
    scope: ListScope, *, since: datetime, until: datetime | None = None
) -> list[dict[str, Any]]:
    from core.models import Device

    qs = Sale.objects.filter(occurred_at__gte=since)
    if until is not None:
        qs = qs.filter(occurred_at__lt=until)
    if scope.branch_ids is not None:
        qs = qs.filter(branch_id__in=scope.branch_ids)
    if scope.device_id is not None:
        qs = qs.filter(device_id=scope.device_id)
    sales = list(qs.order_by("-occurred_at")[:500])
    reversed_ids = _reversed_ids(s.id for s in sales)
    names = {d.id: d.name for d in Device.objects.filter(id__in={s.device_id for s in sales})}
    return [sale_row(s, reversed_ids=reversed_ids, device_names=names) for s in sales]


def last_sale_at(scope: ListScope) -> datetime | None:
    qs = Sale.objects.all()
    if scope.branch_ids is not None:
        qs = qs.filter(branch_id__in=scope.branch_ids)
    if scope.device_id is not None:
        qs = qs.filter(device_id=scope.device_id)
    last = qs.order_by("-occurred_at").first()
    return last.occurred_at if last else None


# ---------------------------------------------------------------- الاشتباه (POS-12)


def _signature(lines: Iterable[SaleLine]) -> tuple[tuple[str, int, int], ...]:
    return tuple(sorted((str(ln.item_id), ln.qty_milli, ln.unit_price_minor) for ln in lines))


def _decided_pairs() -> set[frozenset[uuid.UUID]]:
    return {frozenset((d.first_sale_id, d.second_sale_id)) for d in DuplicateDecision.objects.all()}


def suspected_pairs(branch_ids: list[uuid.UUID] | None) -> list[dict[str, Any]]:
    """الأزواج المشتبه بها في المدى: تلقائية (جهازان، نفس الفرع والإجمالي والسطور، خلال دقيقة) ثم
    بلاغات الكاشير المفتوحة مقرونةً بأقرب فاتورة بنفس الإجمالي. الأصل هو الأسبق وقتاً."""
    from core.models import Device

    since = timezone.now() - REVIEW_WINDOW
    qs = Sale.objects.filter(occurred_at__gte=since)
    if branch_ids is not None:
        qs = qs.filter(branch_id__in=branch_ids)
    sales = list(qs.order_by("occurred_at"))
    reversed_ids = _reversed_ids(s.id for s in sales)
    decided = _decided_pairs()
    lines_by_sale: dict[uuid.UUID, list[SaleLine]] = {}
    for ln in SaleLine.objects.filter(sale_id__in=[s.id for s in sales]):
        lines_by_sale.setdefault(ln.sale_id, []).append(ln)
    names = {d.id: d.name for d in Device.objects.filter(id__in={s.device_id for s in sales})}

    def row(s: Sale) -> dict[str, Any]:
        r = sale_row(s, reversed_ids=reversed_ids, device_names=names)
        r["lines"] = [line_payload(ln) for ln in lines_by_sale.get(s.id, [])]
        return r

    out: list[dict[str, Any]] = []
    seen: set[frozenset[uuid.UUID]] = set()
    live = [s for s in sales if s.id not in reversed_ids]
    by_key: dict[tuple[uuid.UUID, int], list[Sale]] = {}
    for s in live:
        by_key.setdefault((s.branch_id, s.total_minor), []).append(s)
    for group in by_key.values():
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                if b.occurred_at - a.occurred_at > DUPLICATE_WINDOW:
                    break
                if a.device_id == b.device_id:
                    continue
                if _signature(lines_by_sale.get(a.id, [])) != _signature(
                    lines_by_sale.get(b.id, [])
                ):
                    continue
                key = frozenset((a.id, b.id))
                if key in decided or key in seen:
                    continue
                seen.add(key)
                out.append(
                    {
                        "source": "auto",
                        "seconds_apart": int((b.occurred_at - a.occurred_at).total_seconds()),
                        "first": row(a),
                        "second": row(b),
                        "note": "",
                        "reported_by_name": "",
                    }
                )
    # بلاغات الكاشير المفتوحة
    reports = DuplicateReport.objects.filter(resolved_at__isnull=True).select_related("sale")
    if branch_ids is not None:
        reports = reports.filter(sale__branch_id__in=branch_ids)
    for rep in reports.order_by("occurred_at"):
        s = rep.sale
        mate: Sale | None = None
        best: timedelta | None = None
        for c in live:
            if c.id == s.id or c.branch_id != s.branch_id or c.total_minor != s.total_minor:
                continue
            gap = abs(c.occurred_at - s.occurred_at)
            if gap <= REPORT_PAIR_WINDOW and (best is None or gap < best):
                mate, best = c, gap
        if mate is None:
            continue
        a, b = (mate, s) if mate.occurred_at <= s.occurred_at else (s, mate)
        key = frozenset((a.id, b.id))
        if key in decided or key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "source": "report",
                "seconds_apart": int((b.occurred_at - a.occurred_at).total_seconds()),
                "first": row(a),
                "second": row(b),
                "note": rep.note,
                "reported_by_name": rep.reported_by_name,
            }
        )
    return out


def report_suspicion(sale: Sale, *, reporter: User, note: str) -> DuplicateReport:
    report: DuplicateReport = DuplicateReport.objects.create(
        tenant_id=require_tenant(),
        sale=sale,
        reported_by_user_id=reporter.id,
        reported_by_name=reporter.display_name,
        note=note.strip(),
    )
    return report


def decide(
    first: Sale, second: Sale, *, decision: str, reason: str, actor: User
) -> DuplicateDecision:
    """قرار المراجعة: «الاثنان بيعان حقيقيان» يُغلق الاشتباه؛ «إلغاء المستند الثاني بسبب» يُنشئ
    مستند عكس مستقلاً بآثاره (المخزون يعود؛ النقد والذمّة يُخصمان عبر المزوّدين) ويُسجَّل مرجعاً
    ليصل الأجهزة — الأصل لا يُمسّ."""
    if decision not in ("both_real", "reverse"):
        raise DecisionRejected("decision")
    if decision == "reverse" and not reason.strip():
        raise DecisionRejected("reason")
    if first.id == second.id:
        raise DecisionRejected("same_sale")
    tenant_id = require_tenant()
    with transaction.atomic():
        if decision == "reverse":
            if SaleReversal.objects.filter(sale=second).exists():
                raise DecisionRejected("already_reversed")
            rev: SaleReversal = SaleReversal.objects.create(
                tenant_id=tenant_id,
                sale=second,
                branch_id=second.branch_id,
                kind="duplicate",
                kept_sale_id=first.id,
                reason=reason.strip(),
                decided_by_user_id=actor.id,
                decided_by_name=actor.display_name,
            )
            for ln in second.lines.all():
                StockMovement.objects.create(
                    tenant_id=tenant_id,
                    branch_id=second.branch_id,
                    item_id=ln.item_id,
                    delta_base_qty_milli=ln.qty_milli * ln.factor_milli // 1000,
                    reason="reversal",
                    source_entity="sales.SaleReversal",
                    source_id=rev.id,
                    occurred_at=rev.occurred_at,
                )
            log_reference(tenant_id, "sales.SaleReversal", rev.id)
        d: DuplicateDecision = DuplicateDecision.objects.create(
            tenant_id=tenant_id,
            first_sale_id=first.id,
            second_sale_id=second.id,
            decision=decision,
            reason=reason.strip(),
            decided_by_user_id=actor.id,
            decided_by_name=actor.display_name,
        )
        DuplicateReport.objects.filter(
            sale_id__in=[first.id, second.id], resolved_at__isnull=True
        ).update(resolved_at=timezone.now())
    return d
