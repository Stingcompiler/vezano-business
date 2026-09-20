"""GROW-03 (M4 — T3.27): طلب عرض ممول ومعاينته — طلب داخلي بلا رقم ولا واجهة دفع: وسم وجمهور
ومدة، وحالة «التسعير غير معتمد — يتواصل الفريق» (G-04). قفلان لا واحد: M4 والتسعير — نقولهما."""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import User
from core.tenancy import platform_context, require_tenant
from inventory.grow import m4_enabled
from market.models import MarketOffer, MarketPromotionRequest
from market.offers import can_edit
from market.services import MarketRejected

PRICING_LOCK = "التسعير غير معتمد — يتواصل الفريق"


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def request_payload(r: MarketPromotionRequest) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "offer_id": str(r.offer_id),
        "offer_name": r.offer_name,
        "audience": r.audience,
        "audience_label": MarketPromotionRequest.Audience(r.audience).label,
        "area": r.area,
        "duration_days": r.duration_days,
        "status": r.status,
        "status_label": MarketPromotionRequest.Status(r.status).label,
        "prepared_by_name": r.prepared_by_name,
        "requested_by_name": r.requested_by_name,
        "requested_at": _iso(r.requested_at),
        "created_at": _iso(r.created_at),
    }


def _preview_neighbors(offer: MarketOffer) -> list[dict[str, Any]]:
    """النتيجة الممولة تظهر بجوار الأقرب والأرخص لا مكانها — عيّنة من العروض العامة المنشورة."""
    with platform_context():
        rows = list(
            MarketOffer.unscoped.filter(
                status=MarketOffer.Status.PUBLISHED,
                audience=MarketOffer.Audience.PUBLIC,
                suspended_at__isnull=True,
            )
            .exclude(id=offer.id)
            .order_by("price_minor")[:2]
        )
    return [
        {
            "public_name": o.public_name,
            "pack_label": o.pack_label,
            "price_minor": str(o.price_minor) if o.price_minor is not None else "",
        }
        for o in rows
    ]


def promote_payload(viewer: home.Viewer) -> dict[str, Any]:
    offers = list(
        MarketOffer.objects.filter(status=MarketOffer.Status.PUBLISHED).order_by("public_name")
    )
    reqs = list(MarketPromotionRequest.objects.exclude(status="cancelled").order_by("-created_at"))
    return {
        "state": "ready" if m4_enabled() else "phase_locked",
        "pricing_locked": True,
        "pricing_lock_label": PRICING_LOCK,
        "can_request": viewer.is_owner,
        "can_prepare": can_edit(viewer),
        "offers": [
            {"offer_id": str(o.id), "public_name": o.public_name, "pack_label": o.pack_label}
            for o in offers
        ],
        "audiences": [{"code": a.value, "label": a.label} for a in MarketPromotionRequest.Audience],
        "requests": [request_payload(r) for r in reqs],
    }


def preview(*, offer_id: uuid.UUID) -> dict[str, Any]:
    offer = MarketOffer.objects.filter(id=offer_id).first()
    if offer is None:
        raise MarketRejected("offer_not_found", "offer_id")
    return {
        "promoted": {
            "public_name": offer.public_name,
            "pack_label": offer.pack_label,
            "price_minor": str(offer.price_minor) if offer.price_minor is not None else "",
            "tag": "عرض ممول",
        },
        "neighbors": _preview_neighbors(offer),
    }


def save_request(
    *, actor: User, viewer: home.Viewer, body: dict[str, Any]
) -> MarketPromotionRequest:
    """`action=save` يُعدّه ويحفظه (ناشر الكتالوج)؛ `action=request` للمالك وحده — التزام مالي.
    بلا جمهور أو مدة: لا افتراض («كل المشترين» ليس افتراضياً)."""
    if not m4_enabled():
        raise MarketRejected("phase_locked", "", {"phase": "M4"})
    action = str(body.get("action") or "save")
    if action not in {"save", "request"}:
        raise MarketRejected("action_invalid", "action")
    if action == "request" and not viewer.is_owner:
        raise MarketRejected("permission_denied", "", {"owner_required": True})
    if not can_edit(viewer):
        raise MarketRejected("permission_denied")
    try:
        offer_id = uuid.UUID(str(body.get("offer_id") or ""))
    except ValueError as e:
        raise MarketRejected("offer_not_found", "offer_id") from e
    offer = MarketOffer.objects.filter(id=offer_id).first()
    if offer is None:
        raise MarketRejected("offer_not_found", "offer_id")
    audience = str(body.get("audience") or "").strip()
    try:
        duration = int(str(body.get("duration_days") or "0"))
    except ValueError:
        duration = 0
    missing = []
    if audience not in MarketPromotionRequest.Audience.values:
        missing.append("audience")
    if duration <= 0:
        missing.append("duration_days")
    if missing:
        raise MarketRejected("audience_or_duration_required", "", {"missing": missing})
    area = str(body.get("area") or "").strip()[:120]
    if audience == MarketPromotionRequest.Audience.AREA and not area:
        raise MarketRejected("area_required", "area")
    rid = str(body.get("id") or "").strip()
    r = MarketPromotionRequest.objects.filter(id=rid).first() if rid else None
    if r is None:
        r = MarketPromotionRequest(tenant_id=require_tenant(), prepared_by_name=actor.display_name)
    if r.status == MarketPromotionRequest.Status.PRICING_PENDING:
        raise MarketRejected("already_requested", "status")
    r.offer_id = offer.id
    r.offer_name = offer.public_name
    r.audience = audience
    r.area = area
    r.duration_days = duration
    if action == "request":
        r.status = MarketPromotionRequest.Status.PRICING_PENDING
        r.requested_by_name = actor.display_name
        r.requested_at = timezone.now()
    r.save()
    audit.record(
        kind="market.promotion_requested" if action == "request" else "market.promotion_prepared",
        title=f"{'طلب' if action == 'request' else 'إعداد'} عرض ممول: {offer.public_name}",
        actor=actor,
        detail=(
            f"{MarketPromotionRequest.Audience(audience).label} · {duration} يوماً · {PRICING_LOCK}"
        ),
        ref_entity="market.MarketPromotionRequest",
        ref_id=r.id,
    )
    return r
