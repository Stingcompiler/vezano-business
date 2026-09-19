"""MP-12 — أسعار شرائح وقوائم خاصة (§٥.٥، §٦.٥؛ ACC-121، ACC-138): كل شريحة منشآت مسمّاة بعلاقة
مخوَّلة وأسعار بوحداتها وحدود كمية؛ فجوة بين شريحتين تمنع الحفظ (طلب في الفجوة لا يجد سعراً)؛
«بالتفاوض» مقبول ويمنع الطلب الفوري؛ منشأة ثالثة تفتح رابط القائمة ترى «الرابط لم يعد صالحاً»
نفسها — لا «لا تملك صلاحية» لأنها تخبره أن القائمة موجودة ومن يملكها."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import Tenant, User
from core.tenancy import platform_context, require_tenant
from market.models import MarketOffer, MarketPriceList, MarketPriceListMember, MarketProfile
from market.offers import can_edit, can_publish
from market.services import MarketRejected

INVITE_DAYS = 7


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _normalize_tiers(raw: Any) -> list[dict[str, Any]]:
    tiers: list[dict[str, Any]] = []
    for t in raw if isinstance(raw, list) else []:
        if not isinstance(t, dict):
            continue
        try:
            lo = int(str(t.get("min", "0")).strip() or 0)
            hi_raw = str(t.get("max", "") or "").strip()
            hi = int(hi_raw) if hi_raw else None
            pr_raw = str(t.get("price_minor", "") or "").strip()
            price = int(pr_raw) if pr_raw else None
        except ValueError as e:
            raise MarketRejected("tier_invalid", "tiers") from e
        if lo <= 0 or (hi is not None and hi < lo) or (price is not None and price < 0):
            raise MarketRejected("tier_invalid", "tiers")
        tiers.append({"min": lo, "max": hi, "price_minor": price})
    tiers.sort(key=lambda x: x["min"])
    return tiers


def check_gaps(tiers: list[dict[str, Any]]) -> list[dict[str, int]]:
    """فجوة بين شريحتين: الثانية تنتهي عند 49 والثالثة تبدأ من 60 → 50–59 بلا سعر معلن."""
    gaps = []
    for a, b in zip(tiers, tiers[1:], strict=False):
        if a["max"] is None:
            break
        if b["min"] > a["max"] + 1:
            gaps.append({"from": a["max"] + 1, "to": b["min"] - 1})
    return gaps


def _base_factor(offer: MarketOffer) -> tuple[int, str]:
    """معامل وحدة العرض إلى وحدة الأساس واسمها — لسعر الوحدة («98.33 /كغ»)؛ بلا صنف = 1."""
    if not offer.item_id or not offer.unit_code:
        return 1000, offer.unit_name
    from catalog.models import Item

    item = Item.objects.filter(id=offer.item_id).select_related("base_unit").first()
    if item is None:
        return 1000, offer.unit_name
    if item.base_unit.code == offer.unit_code:
        return 1000, item.base_unit.name
    iu = item.units.select_related("unit").filter(unit__code=offer.unit_code).first()
    return (int(iu.factor_milli) if iu else 1000), item.base_unit.name


def tier_payload(t: dict[str, Any], offer: MarketOffer) -> dict[str, Any]:
    unit = offer.unit_name or "وحدة"
    factor, base_name = _base_factor(offer)
    price = t["price_minor"]
    unit_price = (price * 1000) // factor if price is not None and factor else None
    label = f"{t['min']} – {t['max']} {unit}" if t["max"] is not None else f"أكثر من {t['min'] - 1}"
    return {
        "min": t["min"],
        "max": t["max"],
        "label": label,
        "price_minor": str(price) if price is not None else "",
        "unit_price_minor": str(unit_price) if unit_price is not None else "",
        "base_unit_name": base_name,
        "negotiable": price is None,
        "pack_label": offer.pack_label,
    }


def member_payload(m: MarketPriceListMember) -> dict[str, Any]:
    now = timezone.now()
    if m.status == MarketPriceListMember.Status.INVITED:
        left = (m.invite_expires_at - now).days if m.invite_expires_at else None
        hint = f"دعوة مرسلة ولم تُقبل · تنتهي بعد {left} أيام" if left is not None else "دعوة مرسلة"
    elif m.status == MarketPriceListMember.Status.SUSPENDED:
        hint = "التخويل موقوف بطلبك — لا يرى الأسعار الآن"
    else:
        hint = f"مخوَّلة منذ {m.authorized_at:%d %B}" if m.authorized_at else "مخوَّلة"
    return {
        "id": str(m.id),
        "buyer_tenant_id": str(m.buyer_tenant_id),
        "buyer_name": m.buyer_name,
        "status": m.status,
        "status_label": MarketPriceListMember.Status(m.status).label,
        "hint": hint,
        "invited_at": _iso(m.invited_at),
        "authorized_at": _iso(m.authorized_at),
    }


def list_payload(pl: MarketPriceList) -> dict[str, Any]:
    tiers = list(pl.tiers or [])
    members = list(pl.members.order_by("invited_at"))
    active = [m for m in members if m.status == MarketPriceListMember.Status.ACTIVE]
    return {
        "id": str(pl.id),
        "name": pl.name,
        "offer_id": str(pl.offer_id),
        "offer_name": pl.offer.public_name,
        "pack_label": pl.offer.pack_label,
        "unit_name": pl.offer.unit_name,
        "tiers": [tier_payload(t, pl.offer) for t in tiers],
        "gaps": check_gaps(tiers),
        "members": [member_payload(m) for m in members],
        "active_count": len(active),
        "updated_at": _iso(pl.updated_at),
    }


def lists_payload(viewer: home.Viewer) -> dict[str, Any]:
    lists = list(MarketPriceList.objects.select_related("offer").order_by("name"))
    return {
        "lists": [list_payload(pl) for pl in lists],
        "can_edit": can_edit(viewer),
        "can_manage": can_publish(viewer),
    }


def save_list(
    *,
    actor: User,
    viewer: home.Viewer,
    price_list: MarketPriceList | None,
    offer_id: str,
    name: str,
    tiers: Any,
) -> MarketPriceList:
    """الحفظ يرفض الفجوات بين الشرائح بمداها — «أغلق الفجوة أو صرّح بالسعر الساري فيها»."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    try:
        offer = MarketOffer.objects.get(id=uuid.UUID(str(offer_id)))
    except (ValueError, MarketOffer.DoesNotExist) as e:
        raise MarketRejected("offer_unknown", "offer_id") from e
    norm = _normalize_tiers(tiers)
    gaps = check_gaps(norm)
    if gaps:
        raise MarketRejected("tier_gap", "tiers", {"gaps": gaps})
    pl = price_list or MarketPriceList(tenant_id=require_tenant())
    pl.name = name.strip()[:120] or pl.name or "قائمة خاصة"
    pl.offer = offer
    pl.tiers = norm
    pl.save()
    if offer.audience != MarketOffer.Audience.PRIVATE:
        offer.audience = MarketOffer.Audience.PRIVATE
        offer.save(update_fields=["audience", "updated_at"])
    audit.record(
        kind="market.price_list_saved",
        title=f"قائمة خاصة: {pl.name}",
        actor=actor,
        ref_entity="market.MarketPriceList",
        ref_id=pl.id,
    )
    return pl


def invite_member(
    *, actor: User, viewer: home.Viewer, price_list: MarketPriceList, buyer_tenant_id: str
) -> MarketPriceListMember:
    """دعوة منشأة مسمّاة — بإذنها هي تُقبل (لا تسجيل نيابةً عنها)؛ منشأتك نفسها ليست مشترياً."""
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    try:
        bid = uuid.UUID(str(buyer_tenant_id))
    except ValueError as e:
        raise MarketRejected("buyer_unknown", "buyer_tenant_id") from e
    if bid == require_tenant():
        raise MarketRejected("buyer_is_self", "buyer_tenant_id")
    with platform_context():
        buyer = Tenant.unscoped.filter(id=bid).first()
        prof = MarketProfile.unscoped.filter(tenant_id=bid).first()
    if buyer is None:
        raise MarketRejected("buyer_unknown", "buyer_tenant_id")
    name = (prof.published or {}).get("public_name") if prof else ""
    m: MarketPriceListMember
    m, created = MarketPriceListMember.objects.get_or_create(
        tenant_id=require_tenant(),
        price_list=price_list,
        buyer_tenant_id=bid,
        defaults={
            "buyer_name": str(name or buyer.name),
            "invite_expires_at": timezone.now() + timedelta(days=INVITE_DAYS),
        },
    )
    if not created and m.status == MarketPriceListMember.Status.SUSPENDED:
        m.status = MarketPriceListMember.Status.ACTIVE
        m.suspended_at = None
        m.save(update_fields=["status", "suspended_at"])
    return m


def suspend_member(
    *, viewer: home.Viewer, member: MarketPriceListMember, suspend: bool
) -> MarketPriceListMember:
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    if suspend:
        member.status = MarketPriceListMember.Status.SUSPENDED
        member.suspended_at = timezone.now()
    else:
        member.status = MarketPriceListMember.Status.ACTIVE
        member.suspended_at = None
    member.save(update_fields=["status", "suspended_at"])
    return member


# ------------------------------------------------------------------ جانب المشتري (بلا تسريب)


def accept_invite(
    *, buyer_tenant_id: uuid.UUID, list_id: uuid.UUID
) -> MarketPriceListMember | None:
    """المشتري يقبل الدعوة بحسابه: دعوة صالحة له وحده تصير «نشطة»؛ غير ذلك لا شيء."""
    with platform_context():
        m: MarketPriceListMember | None = MarketPriceListMember.unscoped.filter(
            price_list_id=list_id, buyer_tenant_id=buyer_tenant_id
        ).first()
        if m is None or m.status != MarketPriceListMember.Status.INVITED:
            return None
        if m.invite_expires_at and m.invite_expires_at < timezone.now():
            return None
        m.status = MarketPriceListMember.Status.ACTIVE
        m.authorized_at = timezone.now()
        m.save(update_fields=["status", "authorized_at"])
        return m


def visible_list_for(*, buyer_tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any] | None:
    """ما يراه المشتري المخوَّل: الشرائح بأسعارها — ولغيره لا شيء (كأنها غير موجودة)."""
    with platform_context():
        m = MarketPriceListMember.unscoped.filter(
            price_list_id=list_id,
            buyer_tenant_id=buyer_tenant_id,
            status=MarketPriceListMember.Status.ACTIVE,
        ).first()
        if m is None:
            return None
        pl = MarketPriceList.unscoped.select_related("offer").get(id=list_id)
        seller = Tenant.unscoped.get(id=pl.tenant_id)
        return {
            "id": str(pl.id),
            "name": pl.name,
            "seller_name": seller.name,
            "offer_name": pl.offer.public_name,
            "pack_label": pl.offer.pack_label,
            "tiers": [tier_payload(t, pl.offer) for t in list(pl.tiers or [])],
        }
