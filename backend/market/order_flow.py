"""ORD-05/ORD-06 — تفاصيل الطلب وسجلّ الإصدارات، وإعداد عرض سعر من المورد (§٧.٨؛ ACC-125،
ACC-127، ACC-144، ACC-145).

كل تعديل إصدار مرقَّم؛ الاتفاق هو الإصدار المشار إليه في القبول لا الأحدث؛ إصداران متوازيان يُعرضان
معاً بفرقهما (`conflict`). سلّم الكميات: مطلوب/مؤكَّد/مشحون/مستلم/فارق — والذمّة تنشأ من المستلم
وحده. منشأة ثالثة تفتح الرابط = 404 نفسه (لا «هذا الطلب موجود»).
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import User
from core.tenancy import platform_context, require_tenant
from market.models import MarketOffer, MarketOrder, MarketOrderEvent, MarketOrderVersion
from market.offers import can_publish
from market.services import MarketRejected

LADDER_RULE = (
    "الذمّة تنشأ من المستلم وحده. الطلب التزامُ شراء لا دين، والمؤكَّد وعدُ توريد، والمشحون دعوى "
    "المورد — ولا واحد منها يُقيَّد على الحساب (ACC-127). والفارق يُحجَز حتى يُغلق بتسوية أو يُلغى بقرار."
)


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _dm(d: Any) -> str:
    return f"{d.day:02d}/{d.month:02d}" if d else ""


# ------------------------------------------------------------------ الوصول: كلٌّ طرفه


def load_order(order_id: uuid.UUID) -> tuple[MarketOrder, str] | None:
    """(الطلب، جهتي): المشتري في نطاقه؛ المورد بـ`platform_context` — وغيرهما لا شيء (ACC-121)."""
    me = require_tenant()
    with platform_context():
        o = MarketOrder.unscoped.filter(id=order_id).first()
    if o is None:
        return None
    if o.tenant_id == me:
        return o, "buyer"
    if o.supplier_tenant_id == me:
        return o, "supplier"
    return None


def _versions(o: MarketOrder, side: str) -> list[MarketOrderVersion]:
    with platform_context():
        qs = MarketOrderVersion.unscoped.filter(order=o).order_by("number")
        if side == "buyer":
            qs = qs.filter(sent_at__isnull=False)
        return list(qs)


def _events(o: MarketOrder) -> list[MarketOrderEvent]:
    with platform_context():
        return list(MarketOrderEvent.unscoped.filter(order=o).order_by("at", "id"))


def record_event(
    o: MarketOrder, *, kind: str, side: str, title: str, detail: str = "", ref_label: str = ""
) -> MarketOrderEvent:
    with platform_context():
        ev: MarketOrderEvent = MarketOrderEvent.unscoped.create(
            tenant_id=o.tenant_id,
            order=o,
            kind=kind,
            side=side,
            title=title,
            detail=detail,
            ref_label=ref_label,
        )
    return ev


def open_request_version(o: MarketOrder, *, actor_name: str) -> MarketOrderVersion:
    """الإصدار 1 = طلب المشتري كما أُرسل (يُستدعى من ORD-02)."""
    with platform_context():
        v: MarketOrderVersion = MarketOrderVersion.unscoped.create(
            tenant_id=o.tenant_id,
            order=o,
            number=1,
            kind=MarketOrderVersion.Kind.REQUEST,
            author_side="buyer",
            lines=[
                {
                    "offer_id": ln.get("offer_id", ""),
                    "public_name": ln.get("public_name", ""),
                    "pack_label": ln.get("pack_label", ""),
                    "unit_name": ln.get("unit_name", ""),
                    "qty_requested": int(ln.get("qty") or 0),
                    "qty_confirmed": None,
                    "price_minor": ln.get("price_minor", ""),
                    "increase_reason": "",
                }
                for ln in o.lines
            ],
            summary=f"{_lines_word(len(o.lines))} · "
            + ("بأسعار مؤكَّدة" if o.kind == MarketOrder.Kind.ORDER else "بلا أسعار مؤكَّدة"),
            sent_at=o.sent_at,
            created_by_name=actor_name,
        )
    record_event(
        o,
        kind="sent",
        side="buyer",
        title="أُرسل الطلب",
        detail=f"{_lines_word(len(o.lines))} · بانتظار رد المورد.",
        ref_label=f"PO-{o.number} · النسخة 1",
    )
    return v


def _lines_word(n: int) -> str:
    return "بند واحد" if n == 1 else "بندان" if n == 2 else f"{n} بنود"


# ------------------------------------------------------------------ الحمولة (ORD-05)


def version_payload(v: MarketOrderVersion, agreed: int | None) -> dict[str, Any]:
    kind_label = (
        "العرض المعدَّل — مقبول"
        if v.accepted_at and v.kind != MarketOrderVersion.Kind.REQUEST
        else MarketOrderVersion.Kind(v.kind).label
        + (" — غير مقبول" if v.kind == MarketOrderVersion.Kind.REVISION else "")
    )
    return {
        "id": str(v.id),
        "number": v.number,
        "kind": v.kind,
        "kind_label": kind_label,
        "author_side": v.author_side,
        "lines": list(v.lines),
        "delivery_fee_minor": str(v.delivery_fee_minor) if v.delivery_fee_minor is not None else "",
        "valid_until": v.valid_until.isoformat() if v.valid_until else "",
        "note": v.note,
        "summary": v.summary,
        "draft": v.sent_at is None,
        "sent_at": _iso(v.sent_at),
        "accepted_at": _iso(v.accepted_at),
        "is_agreement": agreed is not None and v.number == agreed,
        "created_at": _iso(v.created_at),
    }


def ladder(o: MarketOrder, versions: list[MarketOrderVersion]) -> list[dict[str, Any]]:
    """سلّم الكميات لكل سطر من الإصدار المتفق عليه (أو الأحدث المرسل) وحقول الشحن/الاستلام."""
    agreed = next((v for v in versions if o.agreed_version and v.number == o.agreed_version), None)
    base = agreed or next((v for v in reversed(versions) if v.sent_at), None)
    by_offer = {str(ln.get("offer_id")): ln for ln in (base.lines if base else [])}
    out: list[dict[str, Any]] = []
    for ln in o.lines:
        vline = by_offer.get(str(ln.get("offer_id")), {})
        requested = int(vline.get("qty_requested") or ln.get("qty") or 0)
        confirmed = vline.get("qty_confirmed")
        confirmed_n = int(confirmed) if confirmed is not None else None
        shipped = int(ln.get("qty_shipped") or 0)
        received = int(ln.get("qty_received") or 0)
        gap = max(0, shipped - received)
        price = int(vline.get("price_minor") or ln.get("price_minor") or 0)
        if confirmed_n is None:
            status = "بانتظار تأكيد المورد — خارج الاتفاق حتى يؤكَّد"
        elif confirmed_n == 0:
            status = "المورد لم يؤكّده — خارج الاتفاق، ولا أثر مالي له"
        elif gap:
            status = f"فارق {gap} — محجوز بقيمته {gap * price / 100:,.2f} وبابه خلاف (ORD-12)"
        elif received and received >= confirmed_n:
            status = "مُغلق — استُلم كاملاً وقُيّد"
        elif shipped:
            status = "مشحون — بانتظار استلامك وعدّك"
        else:
            status = "مؤكَّد — لم يُشحن بعد"
        out.append(
            {
                "offer_id": ln.get("offer_id", ""),
                "public_name": ln.get("public_name", ""),
                "pack_label": ln.get("pack_label", ""),
                "unit_name": ln.get("unit_name", ""),
                "requested": requested,
                "confirmed": confirmed_n,
                "shipped": shipped,
                "received": received,
                "gap": gap,
                "price_minor": str(price),
                "status": status,
            }
        )
    return out


def detail_payload(o: MarketOrder, side: str) -> dict[str, Any]:
    from market.orders import order_payload

    versions = _versions(o, side)
    events = _events(o)
    sent = [v for v in versions if v.sent_at]
    latest = sent[-1].number if sent else 1
    agreed = o.agreed_version
    conflict = agreed is not None and latest > agreed
    rows = ladder(o, versions)
    received_value = sum(r["received"] * int(r["price_minor"]) for r in rows)
    gap_value = sum(r["gap"] * int(r["price_minor"]) for r in rows)
    partial = any(r["received"] and r["confirmed"] and r["received"] < r["confirmed"] for r in rows)
    return {
        "order": order_payload(o),
        "side": side,
        "versions": [version_payload(v, agreed) for v in versions],
        "events": [
            {
                "id": str(e.id),
                "kind": e.kind,
                "side": e.side,
                "title": e.title,
                "detail": e.detail,
                "ref_label": e.ref_label,
                "at": _iso(e.at),
            }
            for e in events
        ],
        "agreed_version": agreed,
        "latest_version": latest,
        "conflict": conflict,
        "partial": partial,
        "ladder": rows,
        "received_value_minor": str(received_value),
        "gap_value_minor": str(gap_value),
        "ladder_rule": LADDER_RULE,
    }


# ------------------------------------------------------------------ عرض المورد (ORD-06)


def _supplier_order(order_id: uuid.UUID) -> MarketOrder:
    found = load_order(order_id)
    if found is None or found[1] != "supplier":
        raise MarketRejected("not_found")
    return found[0]


def quote_payload(o: MarketOrder) -> dict[str, Any]:
    """ما يحرّره المورد: طلب المشتري سطراً سطراً، ومسودته إن وُجدت، وصلاحية الكتالوج لكل بند."""
    versions = _versions(o, "supplier")
    request = versions[0] if versions else None
    draft = next((v for v in reversed(versions) if v.sent_at is None), None)
    today = timezone.localdate()
    catalog_expired: list[str] = []
    with platform_context():
        for ln in o.lines:
            off = MarketOffer.unscoped.filter(id=ln.get("offer_id")).first()
            if (
                off is None
                or off.status != MarketOffer.Status.PUBLISHED
                or (off.valid_until is not None and off.valid_until < today)
            ):
                catalog_expired.append(str(ln.get("offer_id")))
    return {
        "order": _order_brief(o),
        "request": version_payload(request, o.agreed_version) if request else None,
        "draft": version_payload(draft, o.agreed_version) if draft else None,
        "catalog_expired": catalog_expired,
        "default_valid_until": (today + timedelta(days=3)).isoformat(),
        "can_quote": True,
    }


def _order_brief(o: MarketOrder) -> dict[str, Any]:
    from market.orders import order_payload

    return order_payload(o)


def _normalize_quote_lines(o: MarketOrder, raw: list[Any]) -> list[dict[str, Any]]:
    by_offer = {str(ln.get("offer_id")): ln for ln in o.lines}
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        oid = str(item.get("offer_id", ""))
        base = by_offer.get(oid)
        if base is None:
            raise MarketRejected("line_unknown", "lines", {"offer_id": oid})
        requested = int(base.get("qty") or 0)
        raw_conf = item.get("qty_confirmed")
        confirmed = int(raw_conf) if raw_conf not in (None, "") else 0
        if confirmed < 0:
            raise MarketRejected("qty_invalid", "lines", {"offer_id": oid})
        reason = str(item.get("increase_reason") or "").strip()
        if confirmed > requested and not reason:
            raise MarketRejected(
                "increase_reason_required",
                "lines",
                {"offer_id": oid, "requested": requested, "confirmed": confirmed},
            )
        price = str(item.get("price_minor") or "").strip()
        if confirmed and not price.isdigit():
            raise MarketRejected("price_required", "lines", {"offer_id": oid})
        out.append(
            {
                "offer_id": oid,
                "public_name": base.get("public_name", ""),
                "pack_label": base.get("pack_label", ""),
                "unit_name": base.get("unit_name", ""),
                "qty_requested": requested,
                "qty_confirmed": confirmed,
                "price_minor": price if confirmed else "",
                "increase_reason": reason,
            }
        )
    if not out:
        raise MarketRejected("lines_required", "lines")
    return out


def _summary(lines: list[dict[str, Any]], fee: int | None) -> str:
    parts: list[str] = []
    for ln in lines:
        req, conf = int(ln["qty_requested"]), int(ln["qty_confirmed"])
        name = str(ln["public_name"])
        if conf == 0:
            parts.append(f"{name} غير متوفر")
        elif conf != req:
            parts.append(f"{name} {conf} لا {req}")
    if fee:
        parts.append(f"رسم نقل {fee // 100}")
    return " · ".join(parts) if parts else "كما طُلب"


def save_quote(
    *, actor: User, viewer: home.Viewer, order_id: uuid.UUID, body: dict[str, Any], send: bool
) -> MarketOrderVersion:
    """مسودة تُحفظ عند المورد؛ الإرسال إصدار مرقَّم بصلاحية معلنة يغيّر الحالة إلى «عرض سعر»."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    o = _supplier_order(order_id)
    quotable = {MarketOrder.Status.SENT, MarketOrder.Status.QUOTED, MarketOrder.Status.ACCEPTED}
    if o.status not in quotable:
        raise MarketRejected("not_quotable", "status")
    raw = body.get("lines")
    lines = _normalize_quote_lines(o, list(raw) if isinstance(raw, list) else [])
    fee_raw = body.get("delivery_fee_minor")
    fee = int(fee_raw) if fee_raw not in (None, "") else None
    valid_raw = str(body.get("valid_until") or "")
    valid: date | None = date.fromisoformat(valid_raw) if valid_raw else None
    if send and valid is None:
        raise MarketRejected("validity_required", "valid_until")
    if valid is not None and valid < timezone.localdate():
        raise MarketRejected("validity_past", "valid_until")
    with platform_context():
        draft = (
            MarketOrderVersion.unscoped.filter(order=o, sent_at__isnull=True)
            .order_by("-number")
            .first()
        )
        last = MarketOrderVersion.unscoped.filter(order=o).order_by("-number").first()
        number = draft.number if draft else (last.number + 1 if last else 2)
        kind = (
            MarketOrderVersion.Kind.REVISION
            if o.agreed_version is not None
            else MarketOrderVersion.Kind.QUOTE
        )
        v: MarketOrderVersion
        if draft is None:
            v = MarketOrderVersion.unscoped.create(
                tenant_id=o.tenant_id,
                order=o,
                number=number,
                kind=kind,
                author_side="supplier",
                created_by_name=actor.display_name,
            )
        else:
            v = draft
        v.lines = lines
        v.delivery_fee_minor = fee
        v.valid_until = valid
        v.note = str(body.get("note") or "")[:600]
        v.summary = _summary(lines, fee)
        if send:
            v.sent_at = timezone.now()
        v.save()
        if send:
            o.version = v.number
            if o.agreed_version is None:
                o.status = MarketOrder.Status.QUOTED
            o.save(update_fields=["version", "status", "updated_at"])
    if send:
        record_event(
            o,
            kind="quoted",
            side="supplier",
            title="عرض سعر من المورد"
            if kind == MarketOrderVersion.Kind.QUOTE
            else "تعديل لاحق من المورد",
            detail=v.summary + (f" · صالح حتى {_dm(valid)}" if valid else ""),
            ref_label=f"Q-{o.number} · النسخة {v.number}",
        )
        audit.record(
            kind="market.quote_sent",
            title=f"عرض سعر على PO-{o.number} — النسخة {v.number}",
            actor=actor,
            detail="المشتري يقبل إصداراً بعينه لا «العرض» (ACC-125).",
            ref_entity="market.MarketOrderVersion",
            ref_id=v.id,
        )
    return v


def decline(*, actor: User, viewer: home.Viewer, order_id: uuid.UUID, reason: str) -> MarketOrder:
    """اعتذار بسبب — يظهر للمشتري؛ لا يُحوَّل «لم يُرد عليه» إلى رفض بلا هذا الفعل."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    o = _supplier_order(order_id)
    if not reason.strip():
        raise MarketRejected("reason_required", "reason")
    if o.status not in {MarketOrder.Status.SENT, MarketOrder.Status.QUOTED}:
        raise MarketRejected("not_declinable", "status")
    with platform_context():
        o.status = MarketOrder.Status.REJECTED
        o.note = reason.strip()[:600]
        o.save(update_fields=["status", "note", "updated_at"])
    record_event(o, kind="declined", side="supplier", title="اعتذر المورد", detail=reason[:400])
    audit.record(
        kind="market.order_declined",
        title=f"اعتذار عن PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketOrder",
        ref_id=o.id,
    )
    return o


def accept_version(*, actor: User, order_id: uuid.UUID, number: int) -> MarketOrder:
    """قبول المشتري إصداراً بعينه — يصير نسخة الاتفاق المثبَّتة (ACC-125)."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    with platform_context():
        v = MarketOrderVersion.unscoped.filter(
            order=o, number=number, sent_at__isnull=False
        ).first()
        if v is None or v.kind == MarketOrderVersion.Kind.REQUEST:
            raise MarketRejected("version_unknown", "version")
        if v.valid_until is not None and v.valid_until < timezone.localdate():
            raise MarketRejected("version_expired", "version")
        v.accepted_at = timezone.now()
        v.save(update_fields=["accepted_at", "updated_at"])
        o.agreed_version = v.number
        o.status = MarketOrder.Status.ACCEPTED
        o.save(update_fields=["agreed_version", "status", "updated_at"])
    record_event(
        o,
        kind="accepted",
        side="buyer",
        title="قُبل الإصدار",
        detail=f"قُبلت النسخة {v.number} بعد عرض الفرق. هذه نسخة الاتفاق الملزمة.",
        ref_label=f"Q-{o.number} · النسخة {v.number} — مقبولة",
    )
    audit.record(
        kind="market.version_accepted",
        title=f"قبول النسخة {v.number} من PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketOrderVersion",
        ref_id=v.id,
    )
    return o
