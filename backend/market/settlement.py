"""ORD-13/ORD-14/ORD-15 — إثبات الدفع ومطابقته، تعارض النسخة أو الردّ المفقود، واستعادة طلب بعد
فقد خادمي (§١٣.٨؛ ACC-15، ACC-124، ACC-133، ACC-137).

الإيصال ليس تحصيلاً: الذمّة تنقص عند مطابقة المورد لا عند الرفع، ومرجع التحويل يُطابَق مرة واحدة،
والدفعة على طلبين بتوزيع صريح. الاستعلام بالمعرّف لا ينشئ شيئاً، وحمولة مختلفة بنفس المعرّف تعارض
يوقف الإرسال. الاستعادة تعلن الجهل، توقف التنفيذ، ولا تُنشئ قيداً ولا تُلغيه.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from django.db import IntegrityError
from django.utils import timezone

from core import audit, home
from core.models import User
from core.tenancy import platform_context
from market.models import MarketOrder, MarketOrderEvent, MarketPayment
from market.offers import can_publish
from market.order_flow import ladder, load_order, record_event
from market.services import MarketRejected

STALE_HOURS = 24


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------ الذمّة والمستحقّ


def due_minor(o: MarketOrder) -> int:
    """المستحقّ = قيمة المستلَم (الذمّة من المستلم وحده) − ما طُوبق من دفعات."""
    from market.order_flow import _versions

    rows = ladder(o, _versions(o, "buyer"))
    received_value = sum(int(r["received"]) * int(r["price_minor"]) for r in rows)
    return max(0, received_value - int(o.paid_minor or 0))


# ------------------------------------------------------------------ الدفع (ORD-13)


def payment_payload(p: MarketPayment) -> dict[str, Any]:
    hours = int((timezone.now() - p.uploaded_at).total_seconds() // 3600)
    return {
        "id": str(p.id),
        "number": p.number,
        "ref_label": f"PAY-{p.number}",
        "order_id": str(p.order_id),
        "amount_minor": str(p.amount_minor),
        "transfer_ref": p.transfer_ref,
        "transferred_on": p.transferred_on.isoformat(),
        "allocations": list(p.allocations),
        "evidence_name": p.evidence_name,
        "note": p.note,
        "status": p.status,
        "status_label": MarketPayment.Status(p.status).label,
        "uploaded_at": _iso(p.uploaded_at),
        "matched_at": _iso(p.matched_at),
        "matched_by_name": p.matched_by_name,
        "decision_note": p.decision_note,
        "reminded_at": _iso(p.reminded_at),
        "hours_since_upload": hours,
        "stale": p.status == MarketPayment.Status.RECORDED and hours >= STALE_HOURS,
    }


def payments_payload(o: MarketOrder, side: str) -> dict[str, Any]:
    from market.orders import order_payload

    with platform_context():
        rows = list(MarketPayment.unscoped.filter(order=o).order_by("number"))
        others = [
            {"id": str(x.id), "number_label": f"PO-{x.number}", "due_minor": str(due_minor(x))}
            for x in MarketOrder.unscoped.filter(
                tenant_id=o.tenant_id, supplier_tenant_id=o.supplier_tenant_id
            ).exclude(id=o.id)
            if due_minor(x) > 0
        ]
    return {
        "order": order_payload(o),
        "side": side,
        "payments": [payment_payload(p) for p in rows],
        "due_minor": str(due_minor(o)),
        "paid_minor": str(o.paid_minor or 0),
        "open_orders": others,
        "stale_hours": STALE_HOURS,
    }


def record_payment(*, actor: User, order_id: uuid.UUID, body: dict[str, Any]) -> MarketPayment:
    """الرفع لا يُسدّد؛ المرجع مرة واحدة؛ الفرق عن المستحقّ يُقبل بتوزيع صريح لا بالسكوت."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    try:
        amount = int(str(body.get("amount_minor") or "0"))
    except ValueError:
        raise MarketRejected("amount_invalid", "amount_minor") from None
    if amount <= 0:
        raise MarketRejected("amount_invalid", "amount_minor")
    ref = str(body.get("transfer_ref") or "").strip()
    if not ref:
        raise MarketRejected("transfer_ref_required", "transfer_ref")
    on_raw = str(body.get("transferred_on") or "")
    try:
        on = date.fromisoformat(on_raw) if on_raw else timezone.localdate()
    except ValueError:
        raise MarketRejected("date_invalid", "transferred_on") from None
    with platform_context():
        used = MarketPayment.unscoped.filter(
            tenant_id=o.tenant_id, supplier_tenant_id=o.supplier_tenant_id, transfer_ref=ref
        ).first()
    if used is not None:
        raise MarketRejected(
            "reference_used",
            "transfer_ref",
            {"order_number_label": f"PO-{used.order.number}", "payment": f"PAY-{used.number}"},
        )
    due = due_minor(o)
    raw_alloc = body.get("allocations")
    allocations: list[dict[str, Any]] = []
    if isinstance(raw_alloc, list) and raw_alloc:
        total = 0
        with platform_context():
            for item in raw_alloc:
                if not isinstance(item, dict):
                    continue
                oid = str(item.get("order_id") or "")
                amt = int(str(item.get("amount_minor") or "0") or 0)
                target = MarketOrder.unscoped.filter(
                    id=oid, tenant_id=o.tenant_id, supplier_tenant_id=o.supplier_tenant_id
                ).first()
                if target is None or amt <= 0:
                    raise MarketRejected("allocation_invalid", "allocations", {"order_id": oid})
                allocations.append(
                    {
                        "order_id": oid,
                        "number_label": f"PO-{target.number}",
                        "amount_minor": str(amt),
                    }
                )
                total += amt
        if total != amount:
            raise MarketRejected(
                "allocation_mismatch",
                "allocations",
                {"amount_minor": str(amount), "allocated_minor": str(total)},
            )
    elif amount != due:
        raise MarketRejected(
            "amount_mismatch", "amount_minor", {"due_minor": str(due), "amount_minor": str(amount)}
        )
    with platform_context():
        count = MarketPayment.unscoped.filter(tenant_id=o.tenant_id).count()
        try:
            pay: MarketPayment = MarketPayment.unscoped.create(
                tenant_id=o.tenant_id,
                order=o,
                supplier_tenant_id=o.supplier_tenant_id,
                number=count + 1,
                amount_minor=amount,
                transfer_ref=ref,
                transferred_on=on,
                allocations=allocations,
                evidence_name=str(body.get("evidence_name") or "")[:200],
                evidence_data_url=str(body.get("evidence_data_url") or ""),
                note=str(body.get("note") or "")[:300],
                uploaded_by_name=actor.display_name,
            )
        except IntegrityError:
            raise MarketRejected("reference_used", "transfer_ref") from None
    record_event(
        o,
        kind="payment_recorded",
        side="buyer",
        title=f"رُفع إيصال PAY-{pay.number}",
        detail=f"مرجع {ref} · مسجَّل كإثبات لا كسداد — الذمّة لم تتغيّر بالرفع.",
        ref_label=f"PAY-{pay.number}",
    )
    audit.record(
        kind="market.payment_recorded",
        title=f"إيصال PAY-{pay.number} على PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketPayment",
        ref_id=pay.id,
    )
    return pay


def match_payment(
    *,
    actor: User,
    viewer: home.Viewer,
    order_id: uuid.UUID,
    payment_id: uuid.UUID,
    accept: bool,
    note: str,
) -> MarketPayment:
    """المورد وحده يرى بنكه: المطابقة تخفض الذمّة بتاريخين — تاريخ التحويل وتاريخ المطابقة."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    found = load_order(order_id)
    if found is None or found[1] != "supplier":
        raise MarketRejected("not_found")
    o = found[0]
    with platform_context():
        pay: MarketPayment | None = MarketPayment.unscoped.filter(order=o, id=payment_id).first()
    if pay is None:
        raise MarketRejected("payment_unknown")
    if pay.status != MarketPayment.Status.RECORDED:
        raise MarketRejected("already_decided", "status")
    with platform_context():
        pay.status = MarketPayment.Status.MATCHED if accept else MarketPayment.Status.REJECTED
        pay.matched_at = timezone.now()
        pay.matched_by_name = actor.display_name
        pay.decision_note = note[:300]
        pay.save(update_fields=["status", "matched_at", "matched_by_name", "decision_note"])
        if accept:
            targets = pay.allocations or [
                {"order_id": str(o.id), "amount_minor": str(pay.amount_minor)}
            ]
            for t in targets:
                tgt = MarketOrder.unscoped.filter(id=t["order_id"]).first()
                if tgt is None:
                    continue
                tgt.paid_minor = int(tgt.paid_minor or 0) + int(t["amount_minor"])
                tgt.save(update_fields=["paid_minor", "updated_at"])
    record_event(
        o,
        kind="payment_matched" if accept else "payment_rejected",
        side="supplier",
        title=f"طابَق المورد PAY-{pay.number}" if accept else f"رفض المورد PAY-{pay.number}",
        detail=(
            f"تاريخ التحويل {pay.transferred_on:%d/%m} · "
            f"تاريخ المطابقة {timezone.localdate():%d/%m}"
            if accept
            else note[:300]
        ),
        ref_label=f"PAY-{pay.number}",
    )
    audit.record(
        kind="market.payment_matched" if accept else "market.payment_rejected",
        title=f"{'مطابقة' if accept else 'رفض'} PAY-{pay.number} على PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketPayment",
        ref_id=pay.id,
    )
    return pay


def remind_payment(*, actor: User, order_id: uuid.UUID, payment_id: uuid.UUID) -> MarketPayment:
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    with platform_context():
        pay: MarketPayment | None = MarketPayment.unscoped.filter(order=o, id=payment_id).first()
        if pay is None:
            raise MarketRejected("payment_unknown")
        pay.reminded_at = timezone.now()
        pay.save(update_fields=["reminded_at"])
    record_event(
        o,
        kind="payment_reminder",
        side="buyer",
        title=f"تذكير المورد بمطابقة PAY-{pay.number}",
        detail="الإيصال محفوظ ومؤرَّخ — الذمّة لا تنقص من طرف واحد.",
        ref_label=f"PAY-{pay.number}",
    )
    audit.record(
        kind="market.payment_reminded",
        title=f"تذكير بمطابقة PAY-{pay.number}",
        actor=actor,
        ref_entity="market.MarketPayment",
        ref_id=pay.id,
    )
    return pay


# ------------------------------------------------------------------ الردّ المفقود (ORD-14)


def _norm_lines(raw: Any) -> list[dict[str, Any]]:
    out = []
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict):
            continue
        out.append(
            {
                "offer_id": str(x.get("offer_id") or ""),
                "qty": int(x.get("qty") or 0),
                "price_minor": str(x.get("price_minor") or ""),
            }
        )
    return sorted(out, key=lambda x: x["offer_id"])


def probe(*, op_id: uuid.UUID, lines: Any) -> dict[str, Any]:
    """استعلام بمفتاح العملية — لا ينشئ شيئاً: لم يصل / وصل بنفس الحمولة / وصل بحمولة مختلفة."""
    from market.orders import order_payload

    o: MarketOrder | None = MarketOrder.objects.filter(op_id=op_id).first()
    if o is None:
        return {"found": False, "order": None, "same_payload": None, "diff": []}
    server = _norm_lines(
        [
            {
                "offer_id": ln.get("offer_id"),
                "qty": ln.get("qty"),
                "price_minor": ln.get("price_minor"),
            }
            for ln in o.lines
        ]
    )
    local = _norm_lines(lines)
    diff: list[dict[str, Any]] = []
    names = {str(ln.get("offer_id")): str(ln.get("public_name") or "") for ln in o.lines}
    for oid in sorted({x["offer_id"] for x in server} | {x["offer_id"] for x in local}):
        s_ = next((x for x in server if x["offer_id"] == oid), None)
        l_ = next((x for x in local if x["offer_id"] == oid), None)
        if s_ != l_:
            diff.append(
                {
                    "offer_id": oid,
                    "public_name": names.get(oid, ""),
                    "server_qty": s_["qty"] if s_ else None,
                    "server_price_minor": s_["price_minor"] if s_ else "",
                    "local_qty": l_["qty"] if l_ else None,
                    "local_price_minor": l_["price_minor"] if l_ else "",
                }
            )
    return {
        "found": True,
        "order": order_payload(o),
        "same_payload": not diff if local else None,
        "diff": diff,
    }


# ------------------------------------------------------------------ الاستعادة (ORD-15)


def restore_payload(o: MarketOrder, side: str, viewer: home.Viewer) -> dict[str, Any]:
    from market.orders import order_payload

    with platform_context():
        events = list(MarketOrderEvent.unscoped.filter(order=o).order_by("at", "id"))
    after = [e for e in events if o.restore_point and e.at > o.restore_point]
    pending = [e for e in after if e.needs_decision and not e.decision]
    decided = [e for e in after if e.decision]
    before = [e for e in events if not o.restore_point or e.at <= o.restore_point]

    def ev(e: MarketOrderEvent) -> dict[str, Any]:
        return {
            "id": str(e.id),
            "kind": e.kind,
            "side": e.side,
            "title": e.title,
            "detail": e.detail,
            "ref_label": e.ref_label,
            "at": _iso(e.at),
            "needs_decision": e.needs_decision,
            "decision": e.decision,
            "decision_reason": e.decision_reason,
        }

    return {
        "order": order_payload(o),
        "side": side,
        "restore_point": _iso(o.restore_point),
        "reconciling": o.reconciling,
        "can_review": side == "buyer" and viewer.is_owner,
        "pending": [ev(e) for e in pending],
        "decided": [ev(e) for e in decided],
        "confirmed": [ev(e) for e in before],
        "blocked_transfers": (
            [
                {
                    "title": "تحويل الاستلام إلى مستند مخزني",
                    "ref": "LINK-03",
                    "detail": (
                        "معلَّق حتى تحسم الأحداث، حتى لا يُنشأ مستند على أساس طلب قد يتغيّر بعد دقيقة."
                    ),
                }
            ]
            if o.reconciling
            else []
        ),
    }


def restore(
    *, actor: User, viewer: home.Viewer, order_id: uuid.UUID, restored_to: str
) -> MarketOrder:
    """الخادم استُعيد إلى نسخة أقدم: نُعلن الجهل، نوقف التنفيذ، ونعلّم ما بعد النسخة للمراجعة."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    if not viewer.is_owner:
        raise MarketRejected("owner_required")
    o = found[0]
    from datetime import datetime

    try:
        point = datetime.fromisoformat(restored_to.replace("Z", "+00:00"))
    except ValueError:
        raise MarketRejected("restore_point_invalid", "restored_to") from None
    if timezone.is_naive(point):
        point = timezone.make_aware(point)
    with platform_context():
        o.restore_point = point
        o.reconciling = True
        o.save(update_fields=["restore_point", "reconciling", "updated_at"])
        MarketOrderEvent.unscoped.filter(order=o, at__gt=point).exclude(
            kind__in={"restored", "rebuilt"}
        ).update(needs_decision=True, decision="", decision_reason="")
    record_event(
        o,
        kind="restored",
        side="buyer",
        title=f"استُعيد الطلب PO-{o.number} إلى نسخة {timezone.localtime(point):%d/%m %H:%M}",
        detail="ما بعدها غير معروف — قيد المصالحة. لا شحن ولا استلام حتى تنتهي.",
    )
    audit.record(
        kind="market.order_restored",
        title=f"استعادة PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketOrder",
        ref_id=o.id,
    )
    return o


def decide_event(
    *,
    actor: User,
    viewer: home.Viewer,
    order_id: uuid.UUID,
    event_id: uuid.UUID,
    decision: str,
    reason: str,
) -> MarketOrder:
    """قرار واحد لكل حدث: إعادة تطبيقه أو تركه ملغى مع سبب — المراجعة للمالك؛ لا قيد صامت."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    if not viewer.is_owner:
        raise MarketRejected("owner_required")
    o = found[0]
    if decision not in {"reapply", "void"}:
        raise MarketRejected("decision_invalid", "decision")
    if decision == "void" and not reason.strip():
        raise MarketRejected("reason_required", "reason")
    with platform_context():
        e = MarketOrderEvent.unscoped.filter(order=o, id=event_id, needs_decision=True).first()
        if e is None:
            raise MarketRejected("event_unknown", "event")
        if e.decision:
            raise MarketRejected("already_decided", "event")
        e.decision = decision
        e.decision_reason = reason.strip()[:300]
        e.save(update_fields=["decision", "decision_reason"])
        remaining = MarketOrderEvent.unscoped.filter(
            order=o, needs_decision=True, decision=""
        ).count()
        if remaining == 0:
            o.reconciling = False
            o.save(update_fields=["reconciling", "updated_at"])
    if remaining == 0:
        record_event(
            o,
            kind="rebuilt",
            side="buyer",
            title="أُعيد بناء الطلب",
            detail=(
                "من أحداث الطرفين بهوياتها الأصلية: ما اتفق عليه الدفتران أُثبت، وما لا يُسنَد "
                "إلى حدث بقي محجوزاً."
            ),
        )
    audit.record(
        kind="market.restore_decision",
        title=f"قرار مصالحة على PO-{o.number}: {decision}",
        actor=actor,
        ref_entity="market.MarketOrderEvent",
        ref_id=e.id,
    )
    return o


def assert_not_reconciling(o: MarketOrder) -> None:
    """التنفيذ يتوقف أثناء المصالحة."""
    if o.reconciling:
        raise MarketRejected("reconciling", "status")
