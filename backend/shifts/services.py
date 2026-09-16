"""خدمات الورديات: تطبيق الأحداث على الإسقاط، الوردية الحالية للفرع، المتوقَّع في الدرج، ومراجعة
الفروق والعمليات المتأخرة (SHIFT-05)."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import Branch, Device, User
from core.shift import CashTotals, expected_cash_minor, variance_minor
from core.tenancy import require_tenant
from shifts.models import CashAdjustment, CashMovementRequest, Shift, ShiftCashMovement

#: آثار نقدية من وحدات أخرى (POS/PTY): shift → {cash_sales, cash_debt_receipts, cash_refunds}
CASH_EFFECT_PROVIDERS: list[Callable[[Shift], Mapping[str, int]]] = []


@dataclass(frozen=True)
class LateItem:
    """مستند وصل الخادم بعد إقفال ورديته — «وصلت بعد الإغلاق — خارج اللقطة» (ACC-68)."""

    id: str
    number: str
    kind: str
    signed_amount_minor: int
    occurred_at: datetime
    received_at: datetime


#: مستندات متأخرة من وحدات أخرى (POS بيع نقدي على جهاز غير متصل…): shift → [LateItem]
LATE_DOCUMENT_PROVIDERS: list[Callable[[Shift], list[LateItem]]] = []

#: الوردية المفتوحة أطول من هذا «مهجورة» (15-D10: «مفتوحة 3 أيام»؛ العتبة من عندي — 0005 §١٦)
ABANDONED_AFTER = timedelta(hours=24)
#: مدى شاشة المراجعة (38-D30 empty: «7 ورديات في الأسبوع · كلها مطابقة»)
REVIEW_WINDOW = timedelta(days=7)


def _iso(dt: datetime | None) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _dt(value: Any, default: datetime | None = None) -> datetime:
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return default or timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def _date(value: Any) -> date:
    return parse_date(str(value)) or timezone.localdate()


def apply_shift_opened(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """ShiftOpened → وردية مفتوحة في الإسقاط (متكرّر الأثر). لا يمنع وردية ثانية للفرع نفسه —
    تُكشف عند القراءة وتُحال إلى SYS-03."""
    if Shift.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    branch = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_id"]).first()
    if branch is None:
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    device = Device.unscoped.filter(id=payload["device_id"]).first()
    Shift.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch=branch,
        device_id=uuid.UUID(str(payload["device_id"])),
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        device_name=device.name if device else "",
        opening_float_minor=int(payload["opening_float_minor"]),
        business_date=_date(payload.get("business_date")),
        opened_at=_dt(payload.get("occurred_at")),
    )


def apply_cash_movement(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    if ShiftCashMovement.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    shift = Shift.unscoped.filter(tenant_id=tenant_id, id=payload["shift_id"]).first()
    if shift is None:
        return
    actor = User.unscoped.filter(id=payload["actor_user_id"]).first()
    authorized_id = payload.get("authorized_by_user_id") or None
    authorized = User.unscoped.filter(id=authorized_id).first() if authorized_id else None
    reverses_id = payload.get("reverses_movement_id") or None
    reverses = (
        ShiftCashMovement.unscoped.filter(tenant_id=tenant_id, id=reverses_id).first()
        if reverses_id
        else None
    )
    ShiftCashMovement.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        shift=shift,
        kind=str(payload["kind"]),
        signed_amount_minor=int(payload["signed_amount_minor"]),
        reason=str(payload.get("reason", "")),
        actor_user_id=uuid.UUID(str(payload["actor_user_id"])),
        actor_name=actor.display_name if actor else "",
        authorized_by_user_id=uuid.UUID(str(authorized_id)) if authorized_id else None,
        authorized_by_name=authorized.display_name if authorized else "",
        reverses=reverses,
        number=str(payload.get("number", "")),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def apply_cash_counted(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """شهادة العدّ: المعدود والفئات باسم من عدّ (ومن شهد) — وقائع لا تحتاج شبكة."""
    shift = Shift.unscoped.filter(tenant_id=tenant_id, id=payload["shift_id"]).first()
    if shift is None:
        return
    actor = User.unscoped.filter(id=payload["actor_user_id"]).first()
    witness_id = payload.get("witness_user_id") or None
    witness = User.unscoped.filter(id=witness_id).first() if witness_id else None
    shift.counted_cash_minor = int(payload["counted_cash_minor"])
    shift.count_status = "counted"
    shift.counted_by_user_id = uuid.UUID(str(payload["actor_user_id"]))
    shift.counted_by_name = actor.display_name if actor else ""
    shift.witness_user_id = uuid.UUID(str(witness_id)) if witness_id else None
    shift.witness_name = witness.display_name if witness else ""
    shift.denominations = list(payload.get("denominations", []))
    shift.save(
        update_fields=[
            "counted_cash_minor",
            "count_status",
            "counted_by_user_id",
            "counted_by_name",
            "witness_user_id",
            "witness_name",
            "denominations",
        ]
    )


def apply_shift_closed(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """الإقفال: `expected_cash_at_close` لقطة ثابتة في الحدث لا يعدّلها وصول حركة متأخرة (§١٠.٣)."""
    shift = Shift.unscoped.filter(tenant_id=tenant_id, id=payload["shift_id"]).first()
    if shift is None or shift.state == "closed":
        return
    shift.state = "closed"
    shift.closed_at = _dt(payload.get("occurred_at"))
    shift.expected_cash_at_close_minor = int(payload["expected_cash_at_close_minor"])
    shift.expected_source = str(payload.get("expected_source", "device"))
    if payload["count_status"] == "not_counted":
        shift.count_status = "not_counted"
    shift.save(
        update_fields=[
            "state",
            "closed_at",
            "expected_cash_at_close_minor",
            "expected_source",
            "count_status",
        ]
    )


def apply_cash_adjustment(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """التسوية حدث مراجعة ظاهر: لا تعدّل اللقطة ولا العدّ — تُقرّ الفارق باسم من اعتمده وسببه."""
    if CashAdjustment.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    shift = Shift.unscoped.filter(tenant_id=tenant_id, id=payload["shift_id"]).first()
    if shift is None:
        return
    approver = User.unscoped.filter(id=payload["approved_by_user_id"]).first()
    CashAdjustment.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        shift=shift,
        signed_amount_minor=int(payload["signed_amount_minor"]),
        approved_by_user_id=uuid.UUID(str(payload["approved_by_user_id"])),
        approved_by_name=approver.display_name if approver else "",
        reason=str(payload.get("reason", "")).strip(),
        late_item_ids=[str(x) for x in payload.get("late_item_ids", [])],
        occurred_at=_dt(payload.get("occurred_at")),
    )


def cash_totals(shift: Shift) -> CashTotals:
    deposits = withdrawals = 0
    for m in shift.movements.all():
        # الإشارة تحكم: الإيداع موجب والسحب/المصروف سالب، والعكس بالإشارة المضادّة
        if m.signed_amount_minor > 0:
            deposits += m.signed_amount_minor
        else:
            withdrawals += -m.signed_amount_minor
    sales = receipts = refunds = 0
    for p in CASH_EFFECT_PROVIDERS:
        e = p(shift)
        sales += int(e.get("cash_sales", 0))
        receipts += int(e.get("cash_debt_receipts", 0))
        refunds += int(e.get("cash_refunds", 0))
    return CashTotals(
        opening_float_minor=shift.opening_float_minor,
        cash_sales_minor=sales,
        cash_debt_receipts_minor=receipts,
        cash_deposits_minor=deposits,
        cash_refunds_minor=refunds,
        cash_withdrawals_minor=withdrawals,
    )


def shift_payload(shift: Shift) -> dict[str, Any]:
    t = cash_totals(shift)
    return {
        "id": str(shift.id),
        "branch_id": str(shift.branch_id),
        "branch_name": shift.branch.name,
        "device_id": str(shift.device_id),
        "device_name": shift.device_name,
        "user_id": str(shift.user_id),
        "user_name": shift.user_name,
        "opening_float_minor": str(shift.opening_float_minor),
        "business_date": shift.business_date.isoformat(),
        "opened_at": _iso(shift.opened_at),
        "state": shift.state,
        "closed_at": _iso(shift.closed_at),
        "expected_cash_minor": str(expected_cash_minor(t)),
        "totals": {
            "opening_float_minor": str(t.opening_float_minor),
            "cash_sales_minor": str(t.cash_sales_minor),
            "cash_debt_receipts_minor": str(t.cash_debt_receipts_minor),
            "cash_deposits_minor": str(t.cash_deposits_minor),
            "cash_refunds_minor": str(t.cash_refunds_minor),
            "cash_withdrawals_minor": str(t.cash_withdrawals_minor),
        },
        "expected_cash_at_close_minor": str(shift.expected_cash_at_close_minor)
        if shift.expected_cash_at_close_minor is not None
        else "",
        "counted_cash_minor": str(shift.counted_cash_minor)
        if shift.counted_cash_minor is not None
        else "",
        "count_status": shift.count_status,
        "expected_source": shift.expected_source,
        "variance_minor": str(variance)
        if (
            variance := (
                variance_minor(shift.counted_cash_minor, shift.expected_cash_at_close_minor)
                if shift.expected_cash_at_close_minor is not None
                else None
            )
        )
        is not None
        else "",
        "counted_by_name": shift.counted_by_name,
        "witness_name": shift.witness_name,
        "denominations": shift.denominations,
        "movements": [
            {
                "id": str(m.id),
                "number": m.number,
                "kind": m.kind,
                "signed_amount_minor": str(m.signed_amount_minor),
                "reason": m.reason,
                "actor_name": m.actor_name,
                "authorized_by_name": m.authorized_by_name,
                "reverses_id": str(m.reverses_id) if m.reverses_id else "",
                "occurred_at": _iso(m.occurred_at),
            }
            for m in shift.movements.order_by("occurred_at", "id")
        ],
        "pending_requests": [
            {
                "id": str(r.id),
                "kind": r.kind,
                "amount_minor": str(r.amount_minor),
                "reason": r.reason,
                "requested_by_name": r.requested_by_name,
                "requested_at": _iso(r.requested_at),
            }
            for r in shift.requests.filter(status="pending").order_by("requested_at")
        ],
    }


def request_movement(
    shift: Shift, *, kind: str, amount_minor: int, reason: str, requested_by: User
) -> CashMovementRequest:
    """«اطلب من المالك»: طلب سحب بالمبلغ والسبب باسم الطالب؛ الحركة تُنسب لمن أذن بها حين تُسجَّل."""
    req: CashMovementRequest = CashMovementRequest.objects.create(
        tenant_id=require_tenant(),
        shift=shift,
        kind=kind,
        amount_minor=amount_minor,
        reason=reason.strip(),
        requested_by_user_id=requested_by.id,
        requested_by_name=requested_by.display_name,
    )
    return req


def owner_name() -> str:
    """اسم المالك الأول للمنشأة — «اطلب من ندى»."""
    owner = User.objects.filter(is_owner=True, is_active=True).order_by("created_at").first()
    return owner.display_name if owner else ""


def current_for_branch(branch_id: uuid.UUID) -> dict[str, Any]:
    """الوردية المفتوحة للفرع (الأقدم فتحاً)، وأي وردية مفتوحة أخرى للفرع نفسه (تعارض يُحال إلى
    SYS-03)، وآخر وردية مقفلة («الوردية السابقة أُقفلت · ما تركته في الدرج»)."""
    require_tenant()
    opens = list(
        Shift.objects.filter(branch_id=branch_id, state="open")
        .select_related("branch")
        .order_by("opened_at", "server_seq")
    )
    previous = (
        Shift.objects.filter(branch_id=branch_id, state="closed")
        .select_related("branch")
        .order_by("-closed_at")
        .first()
    )
    return {
        "current": shift_payload(opens[0]) if opens else None,
        "others_open": [shift_payload(s) for s in opens[1:]],
        "previous": shift_payload(previous) if previous else None,
    }


# ---------------------------------------------------------------- SHIFT-05 مراجعة الفروق


def late_items(shift: Shift) -> list[LateItem]:
    """ما وصل الخادم بعد الإقفال: حركات الصندوق (received_at بعد closed_at) ومستندات المزوّدين."""
    if shift.closed_at is None:
        return []
    items = [
        LateItem(
            id=str(m.id),
            number=m.number,
            kind=m.kind,
            signed_amount_minor=m.signed_amount_minor,
            occurred_at=m.occurred_at,
            received_at=m.received_at,
        )
        for m in shift.movements.filter(received_at__gt=shift.closed_at).order_by("received_at")
    ]
    for p in LATE_DOCUMENT_PROVIDERS:
        items.extend(p(shift))
    return items


def _variance(shift: Shift) -> int | None:
    if shift.expected_cash_at_close_minor is None or shift.counted_cash_minor is None:
        return None
    return variance_minor(shift.counted_cash_minor, shift.expected_cash_at_close_minor)


def review_row(shift: Shift, *, now: datetime | None = None) -> dict[str, Any]:
    """صف سجل الورديات (15-D10): اللقطة والمعدود والفارق، التسوية إن وُجدت، والمتأخر منفصلاً."""
    now = now or timezone.now()
    adjustments = list(shift.adjustments.order_by("occurred_at", "id"))
    reviewed_ids = {x for a in adjustments for x in a.late_item_ids}
    latest = adjustments[-1] if adjustments else None
    late = late_items(shift)
    variance = _variance(shift)
    open_for = (now - shift.opened_at) if shift.state == "open" else None
    return {
        "id": str(shift.id),
        "branch_id": str(shift.branch_id),
        "branch_name": shift.branch.name,
        "device_name": shift.device_name,
        "user_name": shift.user_name,
        "opened_at": _iso(shift.opened_at),
        "closed_at": _iso(shift.closed_at),
        "state": shift.state,
        "count_status": shift.count_status,
        "expected_source": shift.expected_source,
        "expected_cash_at_close_minor": str(shift.expected_cash_at_close_minor)
        if shift.expected_cash_at_close_minor is not None
        else "",
        "expected_cash_minor": str(expected_cash_minor(cash_totals(shift))),
        "counted_cash_minor": str(shift.counted_cash_minor)
        if shift.counted_cash_minor is not None
        else "",
        "counted_by_name": shift.counted_by_name,
        "variance_minor": str(variance) if variance is not None else "",
        "open_hours": int(open_for.total_seconds() // 3600) if open_for is not None else 0,
        "abandoned": open_for is not None and open_for >= ABANDONED_AFTER,
        "review": {
            "signed_amount_minor": str(latest.signed_amount_minor),
            "approved_by_name": latest.approved_by_name,
            "reason": latest.reason,
            "occurred_at": _iso(latest.occurred_at),
        }
        if latest
        else None,
        "late_items": [
            {
                "id": i.id,
                "number": i.number,
                "kind": i.kind,
                "signed_amount_minor": str(i.signed_amount_minor),
                "occurred_at": _iso(i.occurred_at),
                "received_at": _iso(i.received_at),
                "reviewed": i.id in reviewed_ids,
            }
            for i in late
        ],
    }


def _review_rank(row: Mapping[str, Any]) -> tuple[int, int]:
    """الترتيب بالقيمة لا بالتاريخ (38-D30): المهجورة، ثم المتأخر غير المُقَرّ، ثم «بلا عدّ» (فارق غير
    معروف)، ثم الفارق الأكبر، والمطابِقة آخراً."""
    unreviewed_late = any(not i["reviewed"] for i in row["late_items"])
    if row["state"] == "open":
        bucket = 0
    elif unreviewed_late:
        bucket = 1
    elif row["count_status"] == "not_counted":
        bucket = 2
    elif row["variance_minor"] not in ("", "0"):
        bucket = 3
    else:
        bucket = 4
    magnitude = -abs(int(row["variance_minor"])) if row["variance_minor"] else 0
    return (bucket, magnitude)


def review_rows(
    branch_id: uuid.UUID | None, *, now: datetime | None = None
) -> list[dict[str, Any]]:
    """ورديات الأسبوع المقفلة + المفتوحة المهجورة؛ `branch_id` يحصر مدير الفرع في فرعه."""
    require_tenant()
    now = now or timezone.now()
    since = now - REVIEW_WINDOW
    qs = (
        Shift.objects.filter(Q(state="closed", closed_at__gte=since) | Q(state="open"))
        .select_related("branch")
        .prefetch_related("movements", "adjustments")
    )
    if branch_id is not None:
        qs = qs.filter(branch_id=branch_id)
    rows = [review_row(s, now=now) for s in qs]
    rows = [r for r in rows if r["state"] == "closed" or r["abandoned"]]
    # الأحدث أولاً عند تساوي الدلو والقيمة (الترتيب مستقر)
    rows.sort(key=lambda r: r["closed_at"] or r["opened_at"], reverse=True)
    rows.sort(key=_review_rank)
    return rows


class ReviewRejected(Exception):
    """التسوية بفارق تحتاج سبباً مكتوباً (15-D10: «عجز معتمد … مع سبب مكتوب»)."""


def record_review(shift: Shift, *, approver: User, reason: str) -> CashAdjustment:
    """«إقرار المراجعة» من المالك: تسوية بقيمة الفارق (أو صفر حين لا فارق) تُقرّ معها الحركات
    المتأخرة الحاضرة. اللقطة والعدّ لا يُمسّان."""
    variance = _variance(shift) or 0
    if variance != 0 and not reason.strip():
        raise ReviewRejected("reason")
    adj: CashAdjustment = CashAdjustment.objects.create(
        tenant_id=require_tenant(),
        shift=shift,
        signed_amount_minor=variance,
        approved_by_user_id=approver.id,
        approved_by_name=approver.display_name,
        reason=reason.strip(),
        late_item_ids=[i.id for i in late_items(shift)],
    )
    return adj
