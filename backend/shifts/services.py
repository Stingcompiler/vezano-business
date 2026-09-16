"""خدمات الورديات: تطبيق الأحداث على الإسقاط، الوردية الحالية للفرع، المتوقَّع في الدرج."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from datetime import date, datetime
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import Branch, Device, User
from core.shift import CashTotals, expected_cash_minor
from core.tenancy import require_tenant
from shifts.models import Shift, ShiftCashMovement

#: آثار نقدية من وحدات أخرى (POS/PTY): shift → {cash_sales, cash_debt_receipts, cash_refunds}
CASH_EFFECT_PROVIDERS: list[Callable[[Shift], Mapping[str, int]]] = []


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
    ShiftCashMovement.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        shift=shift,
        kind=str(payload["kind"]),
        signed_amount_minor=int(payload["signed_amount_minor"]),
        reason=str(payload.get("reason", "")),
        actor_user_id=uuid.UUID(str(payload["actor_user_id"])),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def cash_totals(shift: Shift) -> CashTotals:
    deposits = withdrawals = 0
    for m in shift.movements.all():
        if m.kind == "deposit":
            deposits += m.signed_amount_minor
        elif m.kind == "withdrawal":
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
        "movements": [
            {
                "id": str(m.id),
                "kind": m.kind,
                "signed_amount_minor": str(m.signed_amount_minor),
                "reason": m.reason,
                "occurred_at": _iso(m.occurred_at),
            }
            for m in shift.movements.order_by("occurred_at", "id")
        ],
    }


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
