"""ORD-11/ORD-12 — المرتجع التجاري والخلاف بأدلته (§٧.٨، §١٣.٨؛ ACC-132، ACC-141، ACC-148).

المرتجع ثلاث خطوات لا خطوة: طلب (سجل لا حركة)، موافقة مورد (قد تكون جزئية)، ثم تنفيذ بمستند عكسي
(LINK/M3). الخلاف: دفتران مستقلان، رقم المورد يُعرض كما هو، من عليه الدور معلَن بمهلة، والإغلاق لا
يحرّك دفتراً — ما يُسوّى يُسوّى بمستند مستقل بصلاحية صاحبه.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import User
from core.tenancy import platform_context
from market.models import MarketDispute, MarketOrder, MarketReturn, MarketShipment
from market.offers import can_publish
from market.order_flow import _agreed_lines, load_order, record_event
from market.services import MarketRejected

TURN_HOURS = 72
STEPS = [
    {
        "title": "طلب مرتجع — مستند طلب",
        "detail": "كميات وأسباب وصور. يُنشئ سجلاً لا حركة مخزون ولا حركة ذمّة.",
    },
    {
        "title": "موافقة المورد — قرار مستقلّ",
        "detail": (
            "قد يوافق جزئياً: 12 من 12 للسكر، ويرفض الزيت. الموافقة الجزئية حالة معلَنة (partial)."
        ),
    },
    {
        "title": "التنفيذ — مستند عكسي",
        "detail": "هنا فقط يخرج المخزون وتتعدّل الذمّة، بمستند مرتبط بمرجع الشحنة الأصلية.",
    },
]


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------ المرتجع (ORD-11)


def _returned_so_far(o: MarketOrder) -> dict[str, int]:
    out: dict[str, int] = {}
    with platform_context():
        rows = MarketReturn.unscoped.filter(order=o).exclude(status=MarketReturn.Status.REJECTED)
        for r in rows:
            for ln in r.lines:
                qty = int(
                    ln.get("approved_qty")
                    if ln.get("approved_qty") is not None
                    else ln.get("qty") or 0
                )
                out[str(ln.get("offer_id"))] = out.get(str(ln.get("offer_id")), 0) + qty
    return out


def return_payload(r: MarketReturn) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "number": r.number,
        "ref_label": f"RT-{r.number:02d}",
        "lines": list(r.lines),
        "status": r.status,
        "status_label": MarketReturn.Status(r.status).label,
        "decision_note": r.decision_note,
        "requested_at": _iso(r.requested_at),
        "decided_at": _iso(r.decided_at),
        "executed_at": _iso(r.executed_at),
    }


def returns_payload(o: MarketOrder, side: str) -> dict[str, Any]:
    """الكميات القابلة للإرجاع لكل صنف = المستلَم − ما أُرجع سابقاً (طلبات غير مرفوضة)."""
    from market.orders import order_payload

    returned = _returned_so_far(o)
    with platform_context():
        rows = list(MarketReturn.unscoped.filter(order=o).order_by("number"))
    lines: list[dict[str, Any]] = []
    for ln in o.lines:
        oid = str(ln.get("offer_id"))
        received = int(ln.get("qty_received") or 0)
        prev = returned.get(oid, 0)
        lines.append(
            {
                "offer_id": oid,
                "public_name": ln.get("public_name", ""),
                "pack_label": ln.get("pack_label", ""),
                "unit_name": ln.get("unit_name", ""),
                "received": received,
                "returned_before": prev,
                "returnable": max(0, received - prev),
                "rejected_at_receipt": int(ln.get("qty_rejected") or 0),
            }
        )
    return {
        "order": order_payload(o),
        "side": side,
        "lines": lines,
        "returns": [return_payload(r) for r in rows],
        "steps": STEPS,
        "next_ref": f"RT-{len(rows) + 1:02d}",
    }


def request_return(*, actor: User, order_id: uuid.UUID, body: dict[str, Any]) -> MarketReturn:
    """طلب المرتجع سجلٌ لا حركة؛ المجموع لا يتجاوز المستلَم غير المُعاد — الفحص على الخادم."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    returned = _returned_so_far(o)
    by_offer = {str(ln.get("offer_id")): ln for ln in o.lines}
    raw = body.get("lines")
    items = [x for x in (raw if isinstance(raw, list) else []) if isinstance(x, dict)]
    lines: list[dict[str, Any]] = []
    for item in items:
        oid = str(item.get("offer_id", ""))
        base = by_offer.get(oid)
        if base is None:
            raise MarketRejected("line_unknown", "lines", {"offer_id": oid})
        qty = int(item.get("qty") or 0)
        if qty <= 0:
            continue
        received = int(base.get("qty_received") or 0)
        returnable = max(0, received - returned.get(oid, 0))
        if qty > returnable:
            raise MarketRejected(
                "exceeds_returnable",
                "lines",
                {"offer_id": oid, "max": returnable, "returned_before": returned.get(oid, 0)},
            )
        reason = str(item.get("reason") or "").strip()
        if not reason:
            raise MarketRejected("reason_required", "lines", {"offer_id": oid})
        lines.append(
            {
                "offer_id": oid,
                "public_name": base.get("public_name", ""),
                "pack_label": base.get("pack_label", ""),
                "unit_name": base.get("unit_name", ""),
                "qty": qty,
                "approved_qty": None,
                "reason": reason,
                "evidence_name": str(item.get("evidence_name") or "")[:200],
            }
        )
    if not lines:
        raise MarketRejected("lines_required", "lines")
    with platform_context():
        last = MarketReturn.unscoped.filter(order=o).order_by("-number").first()
        r: MarketReturn = MarketReturn.unscoped.create(
            tenant_id=o.tenant_id,
            order=o,
            number=(last.number + 1) if last else 1,
            lines=lines,
            requested_by_name=actor.display_name,
        )
    record_event(
        o,
        kind="return_requested",
        side="buyer",
        title=f"طلب مرتجع RT-{r.number:02d}",
        detail=" · ".join(f"{x['public_name']} ×{x['qty']}" for x in lines)
        + " — بانتظار موافقة المورد؛ لا خصم من الذمّة قبل التنفيذ.",
        ref_label=f"RT-{r.number:02d}",
    )
    audit.record(
        kind="market.return_requested",
        title=f"طلب مرتجع RT-{r.number:02d} على PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketReturn",
        ref_id=r.id,
    )
    return r


def decide_return(
    *,
    actor: User,
    viewer: home.Viewer,
    order_id: uuid.UUID,
    return_id: uuid.UUID,
    body: dict[str, Any],
) -> MarketReturn:
    """قرار المورد سطراً سطراً — الموافقة الجزئية حالة معلَنة؛ الرفض يفتح باب الخلاف."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    found = load_order(order_id)
    if found is None or found[1] != "supplier":
        raise MarketRejected("not_found")
    o = found[0]
    with platform_context():
        r: MarketReturn | None = MarketReturn.unscoped.filter(order=o, id=return_id).first()
    if r is None:
        raise MarketRejected("return_unknown")
    if r.status != MarketReturn.Status.REQUESTED:
        raise MarketRejected("already_decided", "status")
    raw = body.get("lines")
    items = {
        str(x.get("offer_id")): x
        for x in (raw if isinstance(raw, list) else [])
        if isinstance(x, dict)
    }
    new_lines = []
    total_req = total_ok = 0
    for ln in r.lines:
        oid = str(ln.get("offer_id"))
        req = int(ln.get("qty") or 0)
        ok = int((items.get(oid) or {}).get("approved_qty") or 0)
        if ok < 0 or ok > req:
            raise MarketRejected("approved_qty_invalid", "lines", {"offer_id": oid, "max": req})
        total_req += req
        total_ok += ok
        new_lines.append({**ln, "approved_qty": ok})
    status = (
        MarketReturn.Status.APPROVED
        if total_ok == total_req
        else MarketReturn.Status.REJECTED
        if total_ok == 0
        else MarketReturn.Status.PARTIAL
    )
    with platform_context():
        r.lines = new_lines
        r.status = status
        r.decision_note = str(body.get("note") or "")[:400]
        r.decided_at = timezone.now()
        r.save(update_fields=["lines", "status", "decision_note", "decided_at"])
    record_event(
        o,
        kind="return_decided",
        side="supplier",
        title=f"قرار المورد في RT-{r.number:02d}: {MarketReturn.Status(status).label}",
        detail=" · ".join(
            f"{x['public_name']} {x['approved_qty']} من {x['qty']}" for x in new_lines
        ),
        ref_label=f"RT-{r.number:02d}",
    )
    audit.record(
        kind="market.return_decided",
        title=f"قرار مرتجع RT-{r.number:02d} على PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketReturn",
        ref_id=r.id,
    )
    return r


# ------------------------------------------------------------------ الخلاف (ORD-12)


def open_dispute(
    *, o: MarketOrder, sh: MarketShipment | None, lines: list[dict[str, Any]], actor_name: str
) -> MarketDispute:
    """يُفتح من الاستلام (ORD-09) بالفارق؛ الدور على المورد بمهلة 72 ساعة."""
    gap = sum(int(x.get("gap") or 0) for x in lines)
    unit = str(lines[0].get("unit_name") or "وحدة") if lines else "وحدة"
    title = (
        f"فارق {unit} واحدة"
        if gap == 1
        else f"فارق {unit.replace('ة', 'ت')}ين"
        if gap == 2
        else f"فارق {gap} {unit}"
    )
    with platform_context():
        count = MarketDispute.unscoped.filter(tenant_id=o.tenant_id).count()
        d: MarketDispute = MarketDispute.unscoped.create(
            tenant_id=o.tenant_id,
            order=o,
            shipment=sh,
            number=count + 1,
            title=title,
            lines=lines,
            turn="supplier",
            turn_deadline=timezone.now() + timedelta(hours=TURN_HOURS),
            evidence=[
                {
                    "side": "buyer",
                    "title": (
                        f"عدّ الاستلام — {int(x.get('received') or 0)} {x.get('unit_name') or ''}"
                    ).strip(),
                    "at": _iso(timezone.now()),
                    "note": str(x.get("reason") or ""),
                    "kind": "count",
                }
                for x in lines
            ],
            opened_by_name=actor_name,
        )
    return d


def _turn_label(d: MarketDispute, side: str) -> str:
    if d.status == MarketDispute.Status.CLOSED:
        return "مُغلق"
    if d.turn == side:
        return "بانتظارك"
    return "بانتظار رد المورد" if d.turn == "supplier" else "بانتظار رد المشتري"


def dispute_payload(d: MarketDispute, side: str) -> dict[str, Any]:
    agreed = _agreed_lines(d.order)
    rows = []
    for ln in d.lines:
        oid = str(ln.get("offer_id"))
        price = int((agreed.get(oid) or {}).get("price_minor") or 0)
        shipped = int(ln.get("shipped") or 0)
        received = int(ln.get("received") or 0)
        rows.append(
            {
                **ln,
                "price_minor": str(price),
                "buyer_value_minor": str(received * price),
                "supplier_value_minor": str(shipped * price),
                "gap_value_minor": str(max(0, shipped - received) * price),
            }
        )
    days_open = max(0, (timezone.now() - d.opened_at).days)
    return {
        "id": str(d.id),
        "number": d.number,
        "ref_label": f"DSP-{d.number}",
        "title": d.title,
        "shipment_ref": f"SH-{d.shipment.number:02d}" if d.shipment else "",
        "status": d.status,
        "status_label": MarketDispute.Status(d.status).label,
        "turn": d.turn,
        "turn_label": _turn_label(d, side),
        "turn_deadline": _iso(d.turn_deadline),
        "days_open": days_open,
        "lines": rows,
        "evidence": list(d.evidence),
        "outcome": d.outcome,
        "outcome_label": MarketDispute.Outcome(d.outcome).label if d.outcome else "",
        "outcome_ref": d.outcome_ref,
        "mediator_requested_at": _iso(d.mediator_requested_at),
        "opened_at": _iso(d.opened_at),
        "closed_at": _iso(d.closed_at),
        "buyer_name": d.order.buyer_name,
        "supplier_name": d.order.supplier_name,
        "order_number_label": f"PO-{d.order.number}",
        "order_id": str(d.order_id),
    }


def disputes_payload(o: MarketOrder, side: str, viewer: home.Viewer) -> dict[str, Any]:
    from market.orders import order_limit, order_payload

    with platform_context():
        rows = list(
            MarketDispute.unscoped.filter(order=o)
            .select_related("order", "shipment")
            .order_by("number")
        )
    can_settle = (side == "supplier" and can_publish(viewer)) or (
        side == "buyer" and order_limit(viewer) != 0
    )
    return {
        "order": order_payload(o),
        "side": side,
        "disputes": [dispute_payload(d, side) for d in rows],
        "can_settle": can_settle,
        "turn_hours": TURN_HOURS,
    }


def _dispute(order_id: uuid.UUID, dispute_id: uuid.UUID) -> tuple[MarketOrder, str, MarketDispute]:
    found = load_order(order_id)
    if found is None:
        raise MarketRejected("not_found")
    o, side = found
    with platform_context():
        d = (
            MarketDispute.unscoped.filter(order=o, id=dispute_id)
            .select_related("order", "shipment")
            .first()
        )
    if d is None:
        raise MarketRejected("not_found")
    return o, side, d


def add_evidence(
    *, actor: User, order_id: uuid.UUID, dispute_id: uuid.UUID, body: dict[str, Any]
) -> MarketDispute:
    """أي موظف من الطرفين يرفع الدليل ويكتب الواقعة — الرفع ليس تسوية؛ يقلب الدور إلى الطرف
    الآخر."""
    o, side, d = _dispute(order_id, dispute_id)
    if d.status == MarketDispute.Status.CLOSED:
        raise MarketRejected("dispute_closed", "status")
    title = str(body.get("title") or "").strip()
    if not title:
        raise MarketRejected("title_required", "title")
    item = {
        "side": side,
        "title": title[:200],
        "note": str(body.get("note") or "")[:400],
        "at": _iso(timezone.now()),
        "kind": "evidence" if body.get("data_url") else "comment",
        "evidence_name": str(body.get("evidence_name") or "")[:200],
        "data_url": str(body.get("data_url") or ""),
        "by": actor.display_name,
    }
    with platform_context():
        d.evidence = [*d.evidence, item]
        d.turn = "buyer" if side == "supplier" else "supplier"
        d.turn_deadline = timezone.now() + timedelta(hours=TURN_HOURS)
        d.save(update_fields=["evidence", "turn", "turn_deadline", "updated_at"])
    record_event(
        o,
        kind="dispute_evidence",
        side=side,
        title=f"دليل جديد في DSP-{d.number}",
        detail=title[:200],
        ref_label=f"DSP-{d.number}",
    )
    return d


def accept_supplier_figure(
    *, actor: User, viewer: home.Viewer, order_id: uuid.UUID, dispute_id: uuid.UUID
) -> MarketDispute:
    """المشتري يقبل رقم المورد ويعدّل دفتره — إقرار مالي بحدّ ORG-02؛ يكتب الفارق مستلماً ويغلق."""
    from market.orders import order_limit

    o, side, d = _dispute(order_id, dispute_id)
    if side != "buyer":
        raise MarketRejected("not_found")
    if order_limit(viewer) == 0:
        raise MarketRejected("permission_denied")
    if d.status == MarketDispute.Status.CLOSED:
        raise MarketRejected("dispute_closed", "status")
    with platform_context():
        new_lines = []
        for ln in o.lines:
            oid = str(ln.get("offer_id"))
            dl = next((x for x in d.lines if str(x.get("offer_id")) == oid), None)
            if dl is None:
                new_lines.append(ln)
                continue
            gap = max(0, int(dl.get("shipped") or 0) - int(dl.get("received") or 0))
            new_lines.append({**ln, "qty_received": int(ln.get("qty_received") or 0) + gap})
        o.lines = new_lines
        o.status = MarketOrder.Status.RECEIVED
        o.save(update_fields=["lines", "status", "updated_at"])
        d.status = MarketDispute.Status.CLOSED
        d.outcome = MarketDispute.Outcome.ACCEPT
        d.outcome_ref = "قبول رقم المورد — تعديل دفتري بصلاحية"
        d.closed_at = timezone.now()
        d.save(update_fields=["status", "outcome", "outcome_ref", "closed_at", "updated_at"])
    record_event(
        o,
        kind="dispute_closed",
        side="buyer",
        title=f"أُغلق DSP-{d.number} — قبول بالحالة",
        detail="قبل المشتري رقم المورد وعدّل دفتره بصلاحيته. الإغلاق لا يحرّك دفتر المورد (ACC-148).",
        ref_label=f"DSP-{d.number}",
    )
    audit.record(
        kind="market.dispute_closed",
        title=f"إغلاق DSP-{d.number} بقبول رقم المورد",
        actor=actor,
        detail="إقرار مالي بحدّ ORG-02.",
        ref_entity="market.MarketDispute",
        ref_id=d.id,
    )
    return d


def close_dispute(
    *,
    actor: User,
    viewer: home.Viewer,
    order_id: uuid.UUID,
    dispute_id: uuid.UUID,
    outcome: str,
    ref: str,
) -> MarketDispute:
    """الإغلاق بالنتيجة المتفَق عليها ومرجعها — لا يحرّك دفتراً (ACC-148)."""
    from market.orders import order_limit

    o, side, d = _dispute(order_id, dispute_id)
    if (side == "buyer" and order_limit(viewer) == 0) or (
        side == "supplier" and not can_publish(viewer)
    ):
        raise MarketRejected("permission_denied")
    if d.status == MarketDispute.Status.CLOSED:
        raise MarketRejected("dispute_closed", "status")
    if outcome not in {"return", "credit", "accept"}:
        raise MarketRejected("outcome_required", "outcome")
    if not ref.strip():
        raise MarketRejected("ref_required", "ref")
    with platform_context():
        d.status = MarketDispute.Status.CLOSED
        d.outcome = MarketDispute.Outcome(outcome)
        d.outcome_ref = ref.strip()[:120]
        d.closed_at = timezone.now()
        d.save(update_fields=["status", "outcome", "outcome_ref", "closed_at", "updated_at"])
        if o.status == MarketOrder.Status.DISPUTED:
            o.status = MarketOrder.Status.RECEIVED
            o.save(update_fields=["status", "updated_at"])
    record_event(
        o,
        kind="dispute_closed",
        side=side,
        title=f"أُغلق DSP-{d.number} — {MarketDispute.Outcome(outcome).label}",
        detail=f"المرجع: {ref.strip()[:120]} — ما يُسوّى يُسوّى بمستند مستقل (ACC-148).",
        ref_label=f"DSP-{d.number}",
    )
    audit.record(
        kind="market.dispute_closed",
        title=f"إغلاق DSP-{d.number}",
        actor=actor,
        ref_entity="market.MarketDispute",
        ref_id=d.id,
    )
    return d


def request_mediator(*, actor: User, order_id: uuid.UUID, dispute_id: uuid.UUID) -> MarketDispute:
    """طلب وسيط من Sting — يصل PLT-08؛ لا حكم هنا."""
    o, side, d = _dispute(order_id, dispute_id)
    if d.status == MarketDispute.Status.CLOSED:
        raise MarketRejected("dispute_closed", "status")
    with platform_context():
        if d.mediator_requested_at is None:
            d.mediator_requested_at = timezone.now()
            d.save(update_fields=["mediator_requested_at", "updated_at"])
    record_event(
        o,
        kind="mediator_requested",
        side=side,
        title=f"طُلب وسيط من Sting في DSP-{d.number}",
        detail="يصل مشرف السوق (PLT-08) — الوساطة لا تكتب في دفتر أحد.",
        ref_label=f"DSP-{d.number}",
    )
    audit.record(
        kind="market.mediator_requested",
        title=f"طلب وسيط في DSP-{d.number}",
        actor=actor,
        ref_entity="market.MarketDispute",
        ref_id=d.id,
    )
    return d
