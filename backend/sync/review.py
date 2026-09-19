"""مراجعة المالك للمحجور والمتعارض (SYS-03؛ §٨.٣ `conflicted`، §٩.٣، ACC-16/32/49/63).

- النسختان معروضتان: ما أكّده الخادم (العملية المخزّنة بالمعرّف نفسه) وما حجزه من الجهاز (`original`).
- القبول مخوَّل للمالك وبسبب؛ لا يُكتب فوق الأصل: سداد بمبلغ مختلف → مستند تصحيح مبلغ (PTY-09)
  يشير إلى الأصل، والنسختان تبقيان مقروءتين. غير ذلك من التعارضات يحتاج دمجاً يدوياً (غير مبني).
- الرفض يُسجَّل بسبب ويبقي المؤكد. القرار نهائي — التصحيح بقرار جديد لا بتراجع.
- الترتيب بالأثر المالي لا بالتاريخ؛ الحجز على البند وحده — البيع يستمر.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from django.db import transaction
from django.utils import timezone

from core.models import Device, User
from core.tenancy import require_tenant
from parties.models import Party, PaymentReceipt
from parties.services import balance_minor, correct_receipt, effective_receipt
from sync.models import Member, Operation, QuarantinedOperation


class ReviewRejected(Exception):
    def __init__(self, code: str, field: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.field = field


def _members(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, Mapping):
        return []
    out: list[dict[str, Any]] = []
    for m in raw.get("members") or []:
        if isinstance(m, Mapping):
            out.append(
                {
                    "entity": str(m.get("entity", "")),
                    "id": str(m.get("id", "")),
                    "payload": dict(m.get("payload") or {}),
                }
            )
    return out


def _int(v: Any) -> int:
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return 0


def _head(members: list[dict[str, Any]], entity: str) -> dict[str, Any]:
    for m in members:
        if m["entity"] == entity:
            return dict(m["payload"])
    return {}


def financial_effect_minor(kind: str, members: list[dict[str, Any]]) -> int:
    """الأثر المالي المطلق للنسخة المحجوزة — للترتيب («تعارضٌ على ٤٠٠ قبل تعارضٍ على هجاء اسم»)."""
    if kind in ("payment_receipt", "refund"):
        return abs(_int(_head(members, "parties.PaymentReceipt").get("amount_minor")))
    if kind == "sale":
        return abs(_int(_head(members, "sales.Sale").get("total_minor")))
    if kind == "sale_return":
        return abs(_int(_head(members, "sales.SaleReturn").get("total_minor")))
    if kind == "cash_movement":
        return abs(_int(_head(members, "shifts.CashMovement").get("signed_amount_minor")))
    return 0


def _device_name(device_id: uuid.UUID) -> str:
    d = Device.objects.filter(id=device_id).only("name").first()
    return d.name if d else ""


def _user_name(user_id: uuid.UUID | None) -> str:
    if user_id is None:
        return ""
    u = User.objects.filter(id=user_id).only("display_name").first()
    return u.display_name if u else ""


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def item_payload(q: QuarantinedOperation) -> dict[str, Any]:
    members = _members(q.original)
    kind = str(q.original.get("kind", "")) if isinstance(q.original, Mapping) else ""
    return {
        "id": str(q.id),
        "operation_id": str(q.operation_id),
        "kind": kind,
        "reason": q.reason,
        "code": q.code,
        "detail": q.detail,
        "device_id": str(q.device),
        "device_name": _device_name(q.device),
        "received_at": _iso(q.received_at),
        "effect_minor": str(financial_effect_minor(kind, members)),
        "members": members,
        "reviewed_at": _iso(q.reviewed_at),
        "decision": q.decision,
        "decision_reason": q.decision_reason,
        "decided_by_name": q.decided_by_name,
    }


def visible_items(viewer: User, device_id: uuid.UUID | None) -> list[QuarantinedOperation]:
    """المالك يرى كل ما ينتظر قراراً؛ غيره ما حُجز من جهازه فقط (يراه ويُبلّغ ولا يحسم)."""
    qs = QuarantinedOperation.objects.filter(reviewed_at__isnull=True)
    if not viewer.is_owner:
        if device_id is None:
            return []
        qs = qs.filter(device=device_id)
    items = list(qs)
    items.sort(
        key=lambda q: (
            -financial_effect_minor(
                str(q.original.get("kind", "")) if isinstance(q.original, Mapping) else "",
                _members(q.original),
            ),
            q.received_at,
        )
    )
    return items


def _confirmed(q: QuarantinedOperation) -> dict[str, Any] | None:
    op = Operation.objects.filter(operation_id=q.operation_id).first()
    if op is None:
        return None
    members = [
        {"entity": m.entity, "id": str(m.entity_id), "payload": m.payload}
        for m in Member.objects.filter(operation=op).order_by("server_seq")
    ]
    return {
        "kind": op.kind,
        "device_id": str(op.device),
        "device_name": _device_name(op.device),
        "actor_name": _user_name(op.actor_user),
        "received_at": _iso(op.received_at),
        "members": members,
    }


def _receipt_effect(q: QuarantinedOperation, confirmed: dict[str, Any] | None) -> dict[str, Any]:
    """«بالقبول يصبح رصيد أحمد X، وبالرفض يبقى Y»: السداد يخفّض الذمة والردّ يرفعها."""
    members = _members(q.original)
    head = _head(members, "parties.PaymentReceipt")
    party = Party.objects.filter(id=head.get("party_id") or uuid.UUID(int=0)).first()
    if party is None:
        return {}
    now = balance_minor(party)
    device_amount = _int(head.get("amount_minor"))
    sign = -1 if head.get("kind", "receipt") == "receipt" else 1
    confirmed_amount = 0
    if confirmed:
        chead = _head(confirmed["members"], "parties.PaymentReceipt")
        r = PaymentReceipt.objects.filter(
            id=chead.get("receipt_id") or chead.get("id") or uuid.UUID(int=0)
        ).first()
        if r is None:
            r = PaymentReceipt.objects.filter(
                receipt_number=str(chead.get("receipt_number", ""))
            ).first()
        confirmed_amount = (
            effective_receipt(r).amount_minor if r else _int(chead.get("amount_minor"))
        )
    delta = sign * (device_amount - confirmed_amount)
    return {
        "party_id": str(party.id),
        "party_name": party.name,
        "balance_now_minor": str(now),
        "balance_if_accept_minor": str(now + delta),
        "balance_if_reject_minor": str(now),
        "device_amount_minor": str(device_amount),
        "confirmed_amount_minor": str(confirmed_amount),
    }


def detail_payload(q: QuarantinedOperation) -> dict[str, Any]:
    confirmed = _confirmed(q)
    kind = str(q.original.get("kind", "")) if isinstance(q.original, Mapping) else ""
    effect = _receipt_effect(q, confirmed) if kind in ("payment_receipt", "refund") else {}
    acceptable = (
        kind in ("payment_receipt", "refund")
        and confirmed is not None
        and q.reason == QuarantinedOperation.Reason.CONFLICTED
    )
    return {
        "item": item_payload(q),
        "confirmed": confirmed,
        "effect": effect,
        # القبول المبني: تعارض مبلغ/طريقة على سداد مؤكد → تصحيح؛ غيره دمج يدوي (غير مبني)
        "acceptable": acceptable,
    }


def decide(q: QuarantinedOperation, *, decision: str, reason: str, actor: User) -> dict[str, Any]:
    if not actor.is_owner:
        raise ReviewRejected("owner_required")
    if decision not in ("accept", "reject"):
        raise ReviewRejected("invalid", "decision")
    if not reason.strip():
        raise ReviewRejected("required", "reason")
    if q.reviewed_at is not None:
        raise ReviewRejected("already_decided")
    with transaction.atomic():
        applied: dict[str, Any] = {}
        if decision == "accept":
            applied = _accept(q, reason=reason, actor=actor)
        q.reviewed_at = timezone.now()
        q.reviewed_by = actor.id
        q.decision = decision
        q.decision_reason = reason.strip()
        q.decided_by_name = actor.display_name
        q.save(
            update_fields=[
                "reviewed_at",
                "reviewed_by",
                "decision",
                "decision_reason",
                "decided_by_name",
            ]
        )
        from core import audit

        audit.record(
            kind="quarantine.decided",
            title=("قبول بند محجوز" if decision == "accept" else "رفض بند محجوز") + " (SYS-03)",
            actor=actor,
            reason=reason.strip(),
            ref_entity="sync.QuarantinedOperation",
            ref_id=q.id,
        )
    return {"item": item_payload(q), "applied": applied}


def _accept(q: QuarantinedOperation, *, reason: str, actor: User) -> dict[str, Any]:
    """قبول نسخة الجهاز دون إعادة كتابة الأصل: سداد مؤكد بمبلغ آخر → تصحيح مبلغ يشير إليه."""
    detail = detail_payload(q)
    if not detail["acceptable"]:
        raise ReviewRejected("manual_merge_required")
    head = _head(_members(q.original), "parties.PaymentReceipt")
    chead = _head(detail["confirmed"]["members"], "parties.PaymentReceipt")
    r = PaymentReceipt.objects.filter(
        id=chead.get("receipt_id") or chead.get("id") or uuid.UUID(int=0)
    ).first()
    if r is None:
        r = PaymentReceipt.objects.filter(
            receipt_number=str(chead.get("receipt_number", ""))
        ).first()
    if r is None:
        raise ReviewRejected("manual_merge_required")
    e = effective_receipt(r)
    device_amount = _int(head.get("amount_minor"))
    device_method = str(head.get("method", e.method))
    out: dict[str, Any] = {"receipt_id": str(r.id)}
    if device_amount > 0 and device_amount != e.amount_minor:
        c = correct_receipt(
            r, kind="amount", reason=reason, actor=actor, new_amount_minor=device_amount
        )
        out["correction_id"] = str(c.id)
    elif device_method in ("cash", "bank") and device_method != e.method:
        c = correct_receipt(
            r,
            kind="method",
            reason=reason,
            actor=actor,
            new_method=device_method,
            new_reference=str(head.get("reference", "")),
        )
        out["correction_id"] = str(c.id)
    else:
        raise ReviewRejected("manual_merge_required")
    party = Party.objects.filter(id=r.party_id).first()
    out["balance_after_minor"] = str(balance_minor(party)) if party else "0"
    require_tenant()
    return out
