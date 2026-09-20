"""MP-05/MP-06 — تفاصيل العرض للمشتري ومتابعة المورد (§١١.١٠؛ ACC-134، ACC-140، ACC-143).

المتابعة اشتراك تسويقي مستقلّ باسم المنشأة (قرار مالكها) يُلغى وحده: يوقف رسائل المورد التسويقية
ولا يمسّ أحداث الطلبات المخوَّلة ولا الدفتر؛ المورد يرى عدد متابعيه لا أسماءهم. تفاصيل العرض
بشروطه كاملة وتاريخ آخر تأكيد؛ العرض الخاص لغير جمهوره = «لم يعد صالحاً» نفسه (ACC-121)؛ العملة
لا تُحوَّل ضمناً (ACC-140).
"""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import Tenant, User
from core.tenancy import platform_context, require_tenant
from market.models import MarketFollow, MarketOffer, MarketPriceList, MarketPriceListMember
from market.public import _base_factor, _fees, offer_card
from market.services import MarketRejected, badge_of

WHAT_STOPS = ["عروضه الجديدة وتخفيضاته ورسائله التسويقية."]
WHAT_STAYS = [
    "تأكيد طلباتك معه وإشعارات الشحنات والمرتجعات — هذه أحداث طلب مخوَّلة لا تسويق.",
    "تاريخ تعاملك ومستنداتك وذمّتك. الإلغاء لا يمسّ دفتراً.",
    "قدرتك على الشراء منه في أي وقت — المتابعة ليست شرطاً للطلب.",
]


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------ MP-06 المتابعة


def can_follow(viewer: home.Viewer) -> bool:
    """المتابعة باسم المنشأة بصلاحية — قرارها لمن يملك ملفها لا لكل مستخدم."""
    return viewer.is_owner


def follow_payload(f: MarketFollow) -> dict[str, Any]:
    with platform_context():
        from market.models import MarketAccount

        acc = MarketAccount.unscoped.filter(tenant_id=f.supplier_tenant_id).first()
    badge, _label = badge_of(acc)
    if f.status == MarketFollow.Status.CANCELLED:
        hint = "لا رسائل تسويقية بعد الآن"
    elif badge == "suspended":
        hint = "متابَع · نشره معلَّق حالياً فلا يصلك جديد منه"
    else:
        hint = "تتلقّى جديد عروضه وتنبيهات تخفيضه"
    return {
        "id": str(f.id),
        "supplier_tenant_id": str(f.supplier_tenant_id),
        "supplier_name": f.supplier_name,
        "status": f.status,
        "status_label": MarketFollow.Status(f.status).label,
        "hint": hint,
        "suspended": badge == "suspended",
        "followed_at": _iso(f.followed_at),
        "cancelled_at": _iso(f.cancelled_at),
    }


def following_payload(viewer: home.Viewer) -> dict[str, Any]:
    rows = list(MarketFollow.objects.order_by("-followed_at"))
    return {
        "follows": [follow_payload(f) for f in rows],
        "active_count": sum(1 for f in rows if f.status == MarketFollow.Status.ACTIVE),
        "can_follow": can_follow(viewer),
        "what_stops": WHAT_STOPS,
        "what_stays": WHAT_STAYS,
    }


def follow(*, actor: User, viewer: home.Viewer, supplier_tenant_id: uuid.UUID) -> MarketFollow:
    if not can_follow(viewer):
        raise MarketRejected("owner_required")
    if supplier_tenant_id == require_tenant():
        raise MarketRejected("supplier_is_self")
    with platform_context():
        from market.models import MarketProfile

        prof = MarketProfile.unscoped.filter(tenant_id=supplier_tenant_id).first()
        tenant = Tenant.unscoped.filter(id=supplier_tenant_id).first()
    if tenant is None or prof is None or not (prof.published or {}):
        raise MarketRejected("supplier_unknown")
    name = str((prof.published or {}).get("public_name") or tenant.name)
    f: MarketFollow | None = MarketFollow.objects.filter(
        supplier_tenant_id=supplier_tenant_id
    ).first()
    if f is None:
        f = MarketFollow.objects.create(
            tenant_id=require_tenant(), supplier_tenant_id=supplier_tenant_id, supplier_name=name
        )
    else:
        f.status = MarketFollow.Status.ACTIVE
        f.cancelled_at = None
        f.followed_at = timezone.now()
        f.supplier_name = name
        f.save()
    audit.record(
        kind="market.followed",
        title=f"متابعة مورد: {name}",
        actor=actor,
        ref_entity="market.MarketFollow",
        ref_id=f.id,
    )
    return f


def unfollow(*, actor: User, viewer: home.Viewer, f: MarketFollow) -> MarketFollow:
    """إلغاء المتابعة قرار تسويقي — لا يمسّ طلباً ولا دفتراً."""
    if not can_follow(viewer):
        raise MarketRejected("owner_required")
    if f.status == MarketFollow.Status.ACTIVE:
        f.status = MarketFollow.Status.CANCELLED
        f.cancelled_at = timezone.now()
        f.save(update_fields=["status", "cancelled_at"])
        audit.record(
            kind="market.unfollowed",
            title=f"إلغاء متابعة مورد: {f.supplier_name}",
            actor=actor,
            ref_entity="market.MarketFollow",
            ref_id=f.id,
        )
    return f


def is_follower(*, follower_tenant_id: Any, supplier_tenant_id: Any) -> bool:
    with platform_context():
        return MarketFollow.unscoped.filter(
            tenant_id=follower_tenant_id,
            supplier_tenant_id=supplier_tenant_id,
            status=MarketFollow.Status.ACTIVE,
        ).exists()


def followers_count(supplier_tenant_id: Any) -> int:
    """المورد يرى عدداً لا أسماء."""
    with platform_context():
        return MarketFollow.unscoped.filter(
            supplier_tenant_id=supplier_tenant_id, status=MarketFollow.Status.ACTIVE
        ).count()


# ------------------------------------------------------------------ MP-05 تفاصيل العرض


def _authorized_tiers(offer: MarketOffer, buyer_tenant_id: Any) -> list[dict[str, Any]] | None:
    """شرائح القوائم الخاصة للمشتري النشط على هذا العرض — وإلا لا شيء."""
    if buyer_tenant_id is None:
        return None
    from market.price_lists import tier_payload

    with platform_context():
        lists = list(MarketPriceList.unscoped.filter(offer_id=offer.id))
        for pl in lists:
            if MarketPriceListMember.unscoped.filter(
                price_list=pl,
                buyer_tenant_id=buyer_tenant_id,
                status=MarketPriceListMember.Status.ACTIVE,
            ).exists():
                return [tier_payload(t, offer) for t in list(pl.tiers or [])]
    return None


def offer_detail(*, offer_id: uuid.UUID, buyer_tenant_id: Any) -> dict[str, Any] | None:
    """العرض بشروطه كاملة: عام لأي زائر؛ خاص/للمتابعين لمن خُوِّل — وإلا لا شيء (كغير الموجود)؛
    المخفي/المحذوف «سُحب» بعروض الناشر القائمة؛ المنتهي بآخر سعر معروف بلا تأكيد."""
    with platform_context():
        o = MarketOffer.unscoped.filter(id=offer_id).first()
    if o is None:
        return None
    if o.status == MarketOffer.Status.DRAFT:
        return None
    tiers = _authorized_tiers(o, buyer_tenant_id)
    if o.audience == MarketOffer.Audience.PRIVATE and tiers is None:
        return None
    if o.audience == MarketOffer.Audience.FOLLOWERS and not (
        buyer_tenant_id
        and is_follower(follower_tenant_id=buyer_tenant_id, supplier_tenant_id=o.tenant_id)
    ):
        return None
    with platform_context():
        seller = Tenant.unscoped.get(id=o.tenant_id)
        from market.models import MarketAccount, MarketProfile

        acc = MarketAccount.unscoped.filter(tenant_id=o.tenant_id).first()
        prof = MarketProfile.unscoped.filter(tenant_id=o.tenant_id).first()
        buyer = Tenant.unscoped.filter(id=buyer_tenant_id).first() if buyer_tenant_id else None
        others = list(
            MarketOffer.unscoped.filter(
                tenant_id=o.tenant_id,
                status=MarketOffer.Status.PUBLISHED,
                audience=MarketOffer.Audience.PUBLIC,
                suspended_at__isnull=True,
                valid_until__gte=timezone.localdate(),
            ).exclude(id=o.id)[:5]
        )
    seller_name = str(((prof.published if prof else {}) or {}).get("public_name") or seller.name)
    badge, badge_label = badge_of(acc)
    factor, base_name = _base_factor(o)
    fees_ok, fees_label = _fees(o)
    today = timezone.localdate()
    # المعلَّق بقرار المشغّل (PLT-07) يظهر للمشتري كالمسحوب — بلا سبب ولا وصمة (ACC-139)
    withdrawn = o.status == MarketOffer.Status.HIDDEN or o.suspended_at is not None
    expired = o.status == MarketOffer.Status.EXPIRED or (
        o.valid_until is not None and o.valid_until < today
    )
    unit_price = (o.price_minor * 1000) // factor if o.price_minor is not None else None
    currency = seller.base_currency
    buyer_currency = buyer.base_currency if buyer else ""
    days_since = (
        max(0, (timezone.now() - o.confirmed_at).days) if o.confirmed_at is not None else None
    )
    return {
        **offer_card(o, seller_name),
        "seller_badge": badge,
        "seller_badge_label": badge_label,
        "description": o.description,
        "unit_price_minor": str(unit_price) if unit_price is not None else "",
        "base_unit_name": base_name,
        "factor_milli": str(factor),
        "fees_decided": fees_ok,
        "fees_label": fees_label,
        "audience": o.audience,
        "audience_label": MarketOffer.Audience(o.audience).label,
        "currency": currency,
        "buyer_currency": buyer_currency,
        "currency_mismatch": bool(buyer_currency and buyer_currency != currency),
        "confirmed_at": _iso(o.confirmed_at),
        "days_since_confirmed": days_since,
        "valid_until": o.valid_until.isoformat() if o.valid_until else "",
        "expired": expired and not withdrawn,
        "withdrawn": withdrawn,
        "tiers": tiers or [],
        "others": [offer_card(x, seller_name) for x in others],
        "updated_at": _iso(o.updated_at),
    }
