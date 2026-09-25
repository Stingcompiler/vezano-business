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
from market.models import (
    MarketOffer,
    MarketOrder,
    MarketOrderEvent,
    MarketOrderVersion,
    MarketShipment,
)
from market.offers import can_publish
from market.services import MarketRejected

LADDER_RULE = (
    "الذمّة تنشأ من المستلم وحده. الطلب التزامُ شراء لا دين، والمؤكَّد وعدُ توريد، والمشحون دعوى "
    "المورد — ولا واحد منها يُقيَّد على الحساب. والفارق يُحجَز حتى يُغلق بتسوية أو يُلغى بقرار."
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
        "delivery_days": v.delivery_days,
        "valid_until": v.valid_until.isoformat() if v.valid_until else "",
        "rejected_at": _iso(v.rejected_at),
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
            status = f"فارق {gap} — محجوز بقيمته {gap * price / 100:,.2f} وبابه خلاف"
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
    from market.models import MarketDispute
    from market.orders import order_payload

    with platform_context():
        open_disputes = [
            f"DSP-{d.number}"
            for d in MarketDispute.unscoped.filter(order=o, status="open").order_by("number")
        ]
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
        "open_disputes": open_disputes,
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
        days_raw = body.get("delivery_days")
        v.delivery_days = int(days_raw) if days_raw not in (None, "") else None
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
            detail="المشتري يقبل إصداراً بعينه لا «العرض».",
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
    """قبول المشتري إصداراً بعينه — يصير نسخة الاتفاق المثبَّتة."""
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
        newer = (
            MarketOrderVersion.unscoped.filter(order=o, sent_at__isnull=False, number__gt=number)
            .order_by("-number")
            .first()
        )
        if newer is not None:
            # لا نُحوّل القبول إلى الأحدث ضمناً: النسخة القديمة لم تعد قابلة للقبول
            raise MarketRejected("version_superseded", "version", {"latest": newer.number})
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


# ------------------------------------------------------------------ المقارنة والقبول (ORD-07)


def _diff_label(req_qty: int, off_qty: int | None, req_price: str, off_price: str) -> str:
    parts: list[str] = []
    if off_qty is not None and off_qty < req_qty:
        parts.append("كميةٌ أقل")
    if off_qty is not None and off_qty > req_qty:
        parts.append("كميةٌ أكثر")
    if req_price and off_price and int(off_price) > int(req_price):
        parts.append("سعرٌ أعلى")
    if req_price and off_price and int(off_price) < int(req_price):
        parts.append("سعرٌ أقل")
    if not req_price and off_price:
        parts.append("سعرٌ مقترح")
    return " · ".join(parts) if parts else "بلا تغيير"


def _version_total(v: MarketOrderVersion) -> int:
    total = 0
    for ln in v.lines:
        qty = ln.get("qty_confirmed")
        qty_n = int(qty) if qty is not None else int(ln.get("qty_requested") or 0)
        total += qty_n * int(ln.get("price_minor") or 0)
    return total + int(v.delivery_fee_minor or 0)


def compare_payload(o: MarketOrder, *, opened: int | None) -> dict[str, Any]:
    """طلبك · عرض المورد · الفرق — ثلاثة أعمدة بالوحدة الأساسية والفرق مسمّى؛ القبول يخص النسخة
    المعروضة وحدها، والأحدث يُعرض بفرقه ولا يُقبل ضمناً."""
    versions = [v for v in _versions(o, "buyer") if v.sent_at]
    request = versions[0] if versions else None
    offers = [v for v in versions if v.kind != MarketOrderVersion.Kind.REQUEST]
    latest = offers[-1] if offers else None
    shown = next((v for v in offers if v.number == opened), None) if opened else latest
    if shown is None:
        shown = latest
    conflict = bool(shown and latest and shown.number != latest.number)
    today = timezone.localdate()
    expired = bool(shown and shown.valid_until and shown.valid_until < today)
    rows: list[dict[str, Any]] = []
    req_lines = {str(ln.get("offer_id")): ln for ln in (request.lines if request else [])}
    base_lines = {str(ln.get("offer_id")): ln for ln in (shown.lines if shown else [])}
    cur_lines = {str(ln.get("offer_id")): ln for ln in (latest.lines if latest else [])}
    for oid, r in req_lines.items():
        b = base_lines.get(oid, {})
        c = cur_lines.get(oid, {})
        req_qty = int(r.get("qty_requested") or 0)
        req_price = str(r.get("price_minor") or "")
        b_qty = b.get("qty_confirmed")
        c_qty = c.get("qty_confirmed")
        rows.append(
            {
                "offer_id": oid,
                "public_name": r.get("public_name", ""),
                "pack_label": r.get("pack_label", ""),
                "unit_name": r.get("unit_name", ""),
                "requested_qty": req_qty,
                "requested_price_minor": req_price,
                "shown_qty": int(b_qty) if b_qty is not None else None,
                "shown_price_minor": str(b.get("price_minor") or ""),
                "current_qty": int(c_qty) if c_qty is not None else None,
                "current_price_minor": str(c.get("price_minor") or ""),
                "diff_label": _diff_label(
                    req_qty,
                    int(b_qty) if b_qty is not None else None,
                    req_price,
                    str(b.get("price_minor") or ""),
                ),
                "increase_reason": str(b.get("increase_reason") or ""),
                "version_diff_label": (
                    _diff_label(
                        int(b_qty) if b_qty is not None else req_qty,
                        int(c_qty) if c_qty is not None else None,
                        str(b.get("price_minor") or req_price),
                        str(c.get("price_minor") or ""),
                    )
                    if conflict
                    else ""
                ),
            }
        )
    from datetime import datetime, time

    seconds_left = 0
    if shown and shown.valid_until and not expired:
        end = timezone.make_aware(datetime.combine(shown.valid_until, time(23, 59, 59)))
        seconds_left = max(0, int((end - timezone.now()).total_seconds()))
    return {
        "order": _order_brief(o),
        "request": version_payload(request, o.agreed_version) if request else None,
        "shown": version_payload(shown, o.agreed_version) if shown else None,
        "latest": version_payload(latest, o.agreed_version) if latest else None,
        "rows": rows,
        "conflict": conflict,
        "expired": expired,
        "seconds_left": seconds_left,
        "shown_total_minor": str(_version_total(shown)) if shown else "",
        "latest_total_minor": str(_version_total(latest)) if latest else "",
        "request_total_minor": str(_version_total(request)) if request else "",
        "accepted": o.agreed_version,
    }


def reject_version(*, actor: User, order_id: uuid.UUID, number: int, reason: str) -> MarketOrder:
    """رفض صريح وطلب تعديل — الطلب يعود إلى «بانتظار رد المورد» بسبب يظهر له."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    if not reason.strip():
        raise MarketRejected("reason_required", "reason")
    with platform_context():
        v = MarketOrderVersion.unscoped.filter(
            order=o, number=number, sent_at__isnull=False
        ).first()
        if v is None or v.kind == MarketOrderVersion.Kind.REQUEST:
            raise MarketRejected("version_unknown", "version")
        v.rejected_at = timezone.now()
        v.save(update_fields=["rejected_at", "updated_at"])
        if o.agreed_version is None:
            o.status = MarketOrder.Status.SENT
            o.sent_at = timezone.now()
            o.save(update_fields=["status", "sent_at", "updated_at"])
    record_event(
        o,
        kind="rejected",
        side="buyer",
        title=f"رُفضت النسخة {v.number} وطُلب تعديل",
        detail=reason[:400],
        ref_label=f"Q-{o.number} · النسخة {v.number}",
    )
    audit.record(
        kind="market.version_rejected",
        title=f"رفض النسخة {v.number} من PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketOrderVersion",
        ref_id=v.id,
    )
    return o


def requote(*, actor: User, order_id: uuid.UUID) -> MarketOrder:
    """انتهت صلاحية العرض أثناء المراجعة: «اطلب تأكيداً جديداً» لا «تابع» (ACC-143)."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    with platform_context():
        if o.agreed_version is None:
            o.status = MarketOrder.Status.SENT
            o.sent_at = timezone.now()
            o.save(update_fields=["status", "sent_at", "updated_at"])
    record_event(
        o,
        kind="requote",
        side="buyer",
        title="طُلب تأكيد جديد",
        detail="انتهت صلاحية العرض أثناء المراجعة — لا قبول صامت.",
    )
    audit.record(
        kind="market.requote_requested",
        title=f"طلب تأكيد جديد على PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketOrder",
        ref_id=o.id,
    )
    return o


# ------------------------------------------------------------------ الشحن (ORD-08)


def _confirmed_total(agreed: dict[str, dict[str, Any]], lines: list[dict[str, Any]]) -> int:
    return sum(
        int((agreed.get(str(ln.get("offer_id"))) or {}).get("qty_confirmed") or 0) for ln in lines
    )


def _agreed_lines(o: MarketOrder) -> dict[str, dict[str, Any]]:
    with platform_context():
        v = (
            MarketOrderVersion.unscoped.filter(order=o, number=o.agreed_version).first()
            if o.agreed_version
            else None
        )
    return {str(ln.get("offer_id")): ln for ln in (v.lines if v else [])}


def shipments_payload(o: MarketOrder) -> dict[str, Any]:
    """المؤكَّد وشُحن سابقاً والمتبقّي لكل صنف، والشحنات بمراجعها، ومرجع الشحنة التالية."""
    agreed = _agreed_lines(o)
    with platform_context():
        ships = list(MarketShipment.unscoped.filter(order=o).order_by("number"))
    rows: list[dict[str, Any]] = []
    for ln in o.lines:
        oid = str(ln.get("offer_id"))
        a = agreed.get(oid, {})
        confirmed = int(a.get("qty_confirmed") or 0) if a else 0
        shipped = int(ln.get("qty_shipped") or 0)
        rows.append(
            {
                "offer_id": oid,
                "public_name": ln.get("public_name", ""),
                "pack_label": ln.get("pack_label", ""),
                "unit_name": ln.get("unit_name", ""),
                "confirmed": confirmed,
                "shipped": shipped,
                "remaining": max(0, confirmed - shipped),
            }
        )
    total_confirmed = sum(r["confirmed"] for r in rows)
    total_shipped = sum(r["shipped"] for r in rows)
    return {
        "order": _order_brief(o),
        "lines": rows,
        "shipments": [
            {
                "id": str(sh.id),
                "number": sh.number,
                "ref_label": f"SH-{sh.number:02d}",
                "lines": list(sh.lines),
                "carrier_ref": sh.carrier_ref,
                "eta_note": sh.eta_note,
                "note": sh.note,
                "shipped_at": _iso(sh.shipped_at),
                "received_at": _iso(sh.received_at),
            }
            for sh in ships
        ],
        "next_ref": f"SH-{len(ships) + 1:02d}",
        "percent": int(total_shipped * 100 / total_confirmed) if total_confirmed else 0,
        "can_ship": o.agreed_version is not None
        and o.status in {MarketOrder.Status.ACCEPTED, MarketOrder.Status.PREPARING},
    }


def ship(
    *, actor: User, viewer: home.Viewer, order_id: uuid.UUID, body: dict[str, Any]
) -> MarketShipment:
    """شحنة بمرجع مستقل؛ الحدّ الصلب: مجموع المشحون ≤ المؤكَّد لكل صنف — لا اقتطاع صامت."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    o = _supplier_order(order_id)
    if o.reconciling:
        raise MarketRejected("reconciling", "status")
    if o.agreed_version is None or o.status not in {
        MarketOrder.Status.ACCEPTED,
        MarketOrder.Status.PREPARING,
    }:
        raise MarketRejected("not_shippable", "status")
    agreed = _agreed_lines(o)
    raw = body.get("lines")
    items = [x for x in (raw if isinstance(raw, list) else []) if isinstance(x, dict)]
    by_offer = {str(ln.get("offer_id")): ln for ln in o.lines}
    ship_lines: list[dict[str, Any]] = []
    for item in items:
        oid = str(item.get("offer_id", ""))
        base = by_offer.get(oid)
        if base is None:
            raise MarketRejected("line_unknown", "lines", {"offer_id": oid})
        qty = int(item.get("qty") or 0)
        if qty <= 0:
            continue
        confirmed = int((agreed.get(oid) or {}).get("qty_confirmed") or 0)
        shipped = int(base.get("qty_shipped") or 0)
        remaining = max(0, confirmed - shipped)
        if qty > remaining:
            raise MarketRejected(
                "exceeds_confirmed",
                "lines",
                {"offer_id": oid, "max": remaining, "over": qty - remaining},
            )
        ship_lines.append(
            {
                "offer_id": oid,
                "public_name": base.get("public_name", ""),
                "pack_label": base.get("pack_label", ""),
                "unit_name": base.get("unit_name", ""),
                "qty": qty,
            }
        )
    if not ship_lines:
        raise MarketRejected("lines_required", "lines")
    with platform_context():
        last = MarketShipment.unscoped.filter(order=o).order_by("-number").first()
        sh: MarketShipment = MarketShipment.unscoped.create(
            tenant_id=o.tenant_id,
            order=o,
            number=(last.number + 1) if last else 1,
            lines=ship_lines,
            carrier_ref=str(body.get("carrier_ref") or "")[:120],
            eta_note=str(body.get("eta_note") or "")[:120],
            note=str(body.get("note") or "")[:400],
            created_by_name=actor.display_name,
        )
        new_lines = []
        for ln in o.lines:
            add = next(
                (x["qty"] for x in ship_lines if x["offer_id"] == str(ln.get("offer_id"))), 0
            )
            new_lines.append({**ln, "qty_shipped": int(ln.get("qty_shipped") or 0) + add})
        o.lines = new_lines
        total_conf = sum(
            int((agreed.get(str(ln.get("offer_id"))) or {}).get("qty_confirmed") or 0)
            for ln in new_lines
        )
        total_ship = sum(int(ln.get("qty_shipped") or 0) for ln in new_lines)
        o.status = (
            MarketOrder.Status.DELIVERED
            if total_conf and total_ship >= total_conf
            else MarketOrder.Status.PREPARING
        )
        o.save(update_fields=["lines", "status", "updated_at"])
    pct = int(total_ship * 100 / total_conf) if total_conf else 0
    record_event(
        o,
        kind="shipped",
        side="supplier",
        title=f"شُحنت SH-{sh.number:02d}",
        detail=(
            "اكتمل المشحون — بانتظار الاستلام والعدّ."
            if o.status == MarketOrder.Status.DELIVERED
            else f"مشحون جزئياً — {pct}%. المتبقّي معلَن للطرفين."
        ),
        ref_label=f"SH-{sh.number:02d}",
    )
    audit.record(
        kind="market.shipment_sent",
        title=f"شحنة SH-{sh.number:02d} على PO-{o.number}",
        actor=actor,
        ref_entity="market.MarketShipment",
        ref_id=sh.id,
    )
    return sh


# ------------------------------------------------------------------ الاستلام (ORD-09)


def receive_payload(o: MarketOrder, shipment_id: uuid.UUID | None) -> dict[str, Any]:
    """أربعة أعمدة وعمود تعدّه: مطلوب/مؤكَّد/مشحون (دعوى المورد)/مستلم سابقاً — والخامس عدّك."""
    from market.orders import order_payload

    agreed = _agreed_lines(o)
    with platform_context():
        ships = list(MarketShipment.unscoped.filter(order=o).order_by("number"))
    sh = next((x for x in ships if shipment_id and x.id == shipment_id), None)
    if sh is None:
        sh = next((x for x in ships if x.received_at is None), None)
    req = {str(ln.get("offer_id")): ln for ln in o.lines}
    rows: list[dict[str, Any]] = []
    for ln in sh.lines if sh else []:
        oid = str(ln.get("offer_id"))
        base = req.get(oid, {})
        rows.append(
            {
                "offer_id": oid,
                "public_name": ln.get("public_name", ""),
                "pack_label": ln.get("pack_label", ""),
                "unit_name": ln.get("unit_name", ""),
                "requested": int(base.get("qty") or 0),
                "confirmed": int((agreed.get(oid) or {}).get("qty_confirmed") or 0),
                "shipped_in_this": int(ln.get("qty") or 0),
                "received_before": int(base.get("qty_received") or 0),
                "shipped_total": int(base.get("qty_shipped") or 0),
                "price_minor": str(
                    (agreed.get(oid) or {}).get("price_minor") or base.get("price_minor") or "0"
                ),
            }
        )
    return {
        "order": order_payload(o),
        "shipment": (
            {
                "id": str(sh.id),
                "number": sh.number,
                "ref_label": f"SH-{sh.number:02d}",
                "shipped_at": _iso(sh.shipped_at),
                "received_at": _iso(sh.received_at),
                "received_lines": list(sh.received_lines),
                "dispute_opened": sh.dispute_opened,
            }
            if sh
            else None
        ),
        "pending_shipments": [f"SH-{x.number:02d}" for x in ships if x.received_at is None],
        "lines": rows,
    }


def receive(
    *, actor: User, viewer: home.Viewer, order_id: uuid.UUID, body: dict[str, Any]
) -> tuple[MarketOrder, MarketShipment, int]:
    """(الطلب، الشحنة، الفارق): الاستلام التراكمي لا يتجاوز المشحون (ACC-128) — الزيادة بسبب مكتوب
    تُحال إلى مراجعة الفرق؛ المرفوض لا يُقيَّد ولا يُحذف؛ دفتران مستقلان والفارق خلافٌ لا تسوية
    (ACC-132)؛ لا حركة مخزون هنا (LINK-03 مقفل M3)."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    if o.reconciling:
        raise MarketRejected("reconciling", "status")
    try:
        sid = uuid.UUID(str(body.get("shipment_id", "")))
    except ValueError:
        raise MarketRejected("shipment_required", "shipment_id") from None
    with platform_context():
        sh = MarketShipment.unscoped.filter(order=o, id=sid).first()
    if sh is None:
        raise MarketRejected("shipment_unknown", "shipment_id")
    if sh.received_at is not None:
        raise MarketRejected("already_received", "shipment_id")
    raw = body.get("lines")
    items = [x for x in (raw if isinstance(raw, list) else []) if isinstance(x, dict)]
    by_offer = {str(ln.get("offer_id")): ln for ln in o.lines}
    ship_qty = {str(ln.get("offer_id")): int(ln.get("qty") or 0) for ln in sh.lines}
    received_lines: list[dict[str, Any]] = []
    gap_total = 0
    for item in items:
        oid = str(item.get("offer_id", ""))
        if oid not in ship_qty:
            raise MarketRejected("line_unknown", "lines", {"offer_id": oid})
        qty = int(item.get("qty_received") or 0)
        rejected = int(item.get("qty_rejected") or 0)
        reason = str(item.get("reason") or "").strip()
        if qty < 0 or rejected < 0:
            raise MarketRejected("qty_invalid", "lines", {"offer_id": oid})
        shipped = ship_qty[oid]
        over = max(0, qty + rejected - shipped)
        if over and not reason:
            # رفض خادمي لا تحذير: الاستلام لا يتجاوز المشحون؛ الزيادة تحتاج سبباً مكتوباً
            raise MarketRejected(
                "exceeds_shipped", "lines", {"offer_id": oid, "max": shipped, "over": over}
            )
        if rejected and not reason:
            raise MarketRejected("reject_reason_required", "lines", {"offer_id": oid})
        accepted = min(qty, shipped)
        gap = max(0, shipped - accepted)
        gap_total += gap
        received_lines.append(
            {
                "offer_id": oid,
                "public_name": by_offer.get(oid, {}).get("public_name", ""),
                "shipped": shipped,
                "received": accepted,
                "rejected": min(rejected, max(0, shipped - accepted)),
                "over_reported": over,
                "gap": gap,
                "reason": reason,
                "disposition": str(item.get("disposition") or ("return" if rejected else "")),
            }
        )
    if not received_lines:
        raise MarketRejected("lines_required", "lines")
    open_dispute = bool(body.get("open_dispute")) and gap_total > 0
    agreed = _agreed_lines(o)
    with platform_context():
        sh.received_at = timezone.now()
        sh.received_lines = received_lines
        sh.received_by_name = actor.display_name
        sh.dispute_opened = open_dispute
        sh.save(
            update_fields=["received_at", "received_lines", "received_by_name", "dispute_opened"]
        )
        new_lines = []
        for ln in o.lines:
            oid_ = str(ln.get("offer_id"))
            rl = next((x for x in received_lines if x["offer_id"] == oid_), None)
            if rl is None:
                new_lines.append(ln)
                continue
            new_lines.append(
                {
                    **ln,
                    "qty_received": int(ln.get("qty_received") or 0) + int(rl["received"]),
                    "qty_rejected": int(ln.get("qty_rejected") or 0) + int(rl["rejected"]),
                }
            )
        o.lines = new_lines
        total_conf = _confirmed_total(agreed, new_lines)
        total_recv = sum(int(ln.get("qty_received") or 0) for ln in new_lines)
        if open_dispute:
            o.status = MarketOrder.Status.DISPUTED
        elif total_conf and total_recv >= total_conf:
            o.status = MarketOrder.Status.RECEIVED
        o.save(update_fields=["lines", "status", "updated_at"])
    detail_parts = [
        f"{x['public_name']}: مشحون {x['shipped']} ومستلم {x['received']}"
        + (f" ومرفوض {x['rejected']}" if x["rejected"] else "")
        for x in received_lines
    ]
    record_event(
        o,
        kind="received",
        side="buyer",
        title=(
            f"الشحنة {sh.number} مستلمة كاملة" if gap_total == 0 else f"الشحنة {sh.number} جزئية"
        ),
        detail=" · ".join(detail_parts)
        + (" فُتح خلاف الفارق." if open_dispute else (" الفارق محجوز." if gap_total else "")),
        ref_label=f"SH-{sh.number:02d} · " + ("مطابقة" if gap_total == 0 else "فارق"),
    )
    if open_dispute:
        from market.disputes import open_dispute as _open

        gap_lines = [
            {**x, "unit_name": by_offer.get(x["offer_id"], {}).get("unit_name", "")}
            for x in received_lines
            if int(x.get("gap") or 0) > 0
        ]
        d = _open(o=o, sh=sh, lines=gap_lines, actor_name=actor.display_name)
        record_event(
            o,
            kind="dispute_opened",
            side="buyer",
            title=f"فُتح خلاف الفارق DSP-{d.number}",
            detail="دفتران مستقلان — الفارق يُحسم في مسار الخلاف لا بتصحيح رقم.",
            ref_label=f"DSP-{d.number} · SH-{sh.number:02d}",
        )
    audit.record(
        kind="market.shipment_received",
        title=f"استلام SH-{sh.number:02d} على PO-{o.number}",
        actor=actor,
        detail="الذمّة من المستلم وحده؛ المرفوض بند مطالبة؛ لا حركة مخزون حتى تحويل الاستلام.",
        ref_entity="market.MarketShipment",
        ref_id=sh.id,
    )
    return o, sh, gap_total


# ------------------------------------------------------------------ إلغاء المتبقّي (ORD-10)


def cancel_breakdown(o: MarketOrder) -> dict[str, Any]:
    """ما يُلغى وما لا يُلغى: المؤكَّد غير المشحون يُلغى؛ المستلم يبقى؛ المشحون غير المستلم قرار آخر."""
    agreed = _agreed_lines(o)
    rows: list[dict[str, Any]] = []
    for ln in o.lines:
        oid = str(ln.get("offer_id"))
        a = agreed.get(oid) or {}
        confirmed = int(a.get("qty_confirmed") or 0)
        shipped = int(ln.get("qty_shipped") or 0)
        received = int(ln.get("qty_received") or 0)
        price = int(a.get("price_minor") or ln.get("price_minor") or 0)
        rows.append(
            {
                "offer_id": oid,
                "public_name": ln.get("public_name", ""),
                "pack_label": ln.get("pack_label", ""),
                "unit_name": ln.get("unit_name", ""),
                "confirmed": confirmed,
                "shipped": shipped,
                "received": received,
                "in_transit": max(0, shipped - received),
                "cancellable": max(0, confirmed - shipped),
                "already_cancelled": int(ln.get("qty_cancelled") or 0),
                "price_minor": str(price),
            }
        )
    with platform_context():
        refs = [
            f"SH-{x.number:02d}" for x in MarketShipment.unscoped.filter(order=o).order_by("number")
        ]
    return {
        "lines": rows,
        "cancellable_total": sum(r["cancellable"] for r in rows),
        "received_total": sum(r["received"] for r in rows),
        "in_transit_total": sum(r["in_transit"] for r in rows),
        "received_value_minor": str(sum(r["received"] * int(r["price_minor"]) for r in rows)),
        "shipment_refs": refs,
        "full_cancel_available": not any(r["shipped"] or r["received"] for r in rows),
        "already_cancelled": o.remaining_cancelled_at is not None,
        "cancel_reason": o.cancel_reason,
    }


def cancel_remaining(
    *, actor: User, viewer: home.Viewer, order_id: uuid.UUID, reason: str
) -> MarketOrder:
    """يُقفل غير المشحون فقط بسبب يظهر للطرفين؛ المستلم والمشحون لا يُمسّان؛ صلاحية من
    يملك حدّاً مالياً (`purchase_approve`) لا من يستلم البضاعة."""
    from market.orders import order_limit

    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    if order_limit(viewer) == 0:
        raise MarketRejected("permission_denied")
    if not reason.strip():
        raise MarketRejected("reason_required", "reason")
    if o.agreed_version is None:
        raise MarketRejected("not_cancellable", "status")
    if o.remaining_cancelled_at is not None:
        raise MarketRejected("already_cancelled", "status")
    bd = cancel_breakdown(o)
    if bd["cancellable_total"] <= 0:
        raise MarketRejected("nothing_to_cancel", "status")
    with platform_context():
        new_lines = []
        for ln in o.lines:
            oid_ = str(ln.get("offer_id"))
            row = next(r for r in bd["lines"] if r["offer_id"] == oid_)
            new_lines.append({**ln, "qty_cancelled": int(row["cancellable"])})
        o.lines = new_lines
        o.remaining_cancelled_at = timezone.now()
        o.cancel_reason = reason.strip()[:400]
        if bd["received_total"] == 0 and bd["in_transit_total"] == 0:
            o.status = MarketOrder.Status.CANCELLED
        o.save(
            update_fields=[
                "lines",
                "remaining_cancelled_at",
                "cancel_reason",
                "status",
                "updated_at",
            ]
        )
    record_event(
        o,
        kind="remaining_cancelled",
        side="buyer",
        title=f"أُلغي المتبقّي — {bd['cancellable_total']}",
        detail=reason.strip()[:400],
        ref_label=f"PO-{o.number}",
    )
    audit.record(
        kind="market.remaining_cancelled",
        title=f"إلغاء متبقّي PO-{o.number}",
        actor=actor,
        detail="المسلَّم والمسجَّل مالياً لا يُمسّ.",
        ref_entity="market.MarketOrder",
        ref_id=o.id,
    )
    return o


def request_cancel(*, actor: User, order_id: uuid.UUID) -> MarketOrder:
    """أمين المخزن لا يلغي — يطلب من المالك؛ حدث في الخط الزمني لا زرّ معطَّل بلا تفسير."""
    found = load_order(order_id)
    if found is None or found[1] != "buyer":
        raise MarketRejected("not_found")
    o = found[0]
    record_event(
        o,
        kind="cancel_requested",
        side="buyer",
        title="طُلب إلغاء المتبقّي من المالك",
        detail=f"طلبه {actor.display_name} — الإلغاء التزام تجاري بصلاحية من يملك حدّاً مالياً.",
    )
    return o
