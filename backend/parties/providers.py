"""مساهمات الأطراف: محلّل المراجع وقائمة النسخة المادية، ومُطبِّق حدث الإنشاء السريع."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from parties.models import OpeningBalance, Party, PaymentReceipt
from parties.services import (
    apply_party_created,
    apply_payment_receipt,
    opening_payload,
    party_payload,
)
from shifts import services as shift_services
from shifts.models import Shift
from sync.appliers import register_applier
from sync.reference import register_lister, register_resolver


def _resolve(_tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    return {p.id: party_payload(p) for p in Party.objects.filter(id__in=list(ids))}


def _list(_tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    return [
        {"entity": "parties.Party", "id": str(p.id), "payload": party_payload(p)}
        for p in Party.objects.order_by("name_normalized")
    ]


register_resolver("parties.Party", _resolve)
register_lister("parties", _list)
register_applier("parties.PartyCreated", apply_party_created)
register_applier("parties.PaymentReceipt", apply_payment_receipt)


def _shift_receipts(shift: Shift) -> dict[str, int]:
    """السداد النقدي يدخل درج الوردية فوراً والردّ النقدي يخرج منه (§١٠.٣) — التحويل لا."""
    from parties.services import effective_receipt

    received = refunded = 0
    for r in PaymentReceipt.objects.filter(shift_id=shift.id):
        e = effective_receipt(r)
        # التصحيح (PTY-09) يغيّر الأثر لا الأصل: عكس أو وسيلة أو مبلغ
        if e.reversed or e.method != "cash":
            continue
        if r.kind == "receipt":
            received += e.amount_minor
        else:
            refunded += e.amount_minor
    return {"cash_debt_receipts": int(received), "cash_refunds": int(refunded)}


def _late_receipts(shift: Shift) -> list[shift_services.LateItem]:
    if shift.closed_at is None:
        return []
    return [
        shift_services.LateItem(
            id=str(r.id),
            number=r.receipt_number,
            kind="receipt" if r.kind == "receipt" else "refund",
            signed_amount_minor=r.amount_minor if r.kind == "receipt" else -r.amount_minor,
            occurred_at=r.occurred_at,
            received_at=r.received_at,
        )
        for r in PaymentReceipt.objects.filter(
            shift_id=shift.id, method="cash", received_at__gt=shift.closed_at
        ).order_by("received_at")
    ]


shift_services.CASH_EFFECT_PROVIDERS.append(_shift_receipts)
shift_services.LATE_DOCUMENT_PROVIDERS.append(_late_receipts)


def _resolve_openings(
    _tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    return {ob.id: opening_payload(ob) for ob in OpeningBalance.objects.filter(id__in=list(ids))}


register_resolver("parties.OpeningBalance", _resolve_openings)
