"""MP-10/MP-11 — عروض البائع: النشر اختيار صنف صنف بسعر مقصود وجمهور وصلاحية (§٦.٥، §١٤.٥؛ ACC-120،
ACC-121). لا زرّ «نشر كل المخزون»؛ الرصيد الداخلي والتكلفة لا يُنشران أبداً؛ التحرير غير النشر
(`market_publish` في ORG-02)؛ الصلاحية تبدأ الآن وتنتهي بتاريخها ما لم تُجدَّد صريحاً.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from catalog.models import Item
from core import audit, home, org
from core.models import Tenant, User
from core.subscription import has_feature
from core.tenancy import require_tenant
from market.models import MarketAccount, MarketOffer, MarketProfile
from market.services import MarketRejected, is_verified_seller

DEFAULT_VALID_DAYS = 14

STATUS_MEANING = {
    "published": "يظهر في البحث وسعره مؤكَّد حتى {until}.",
    "published_private": "لا يظهر في البحث العام. من ليس في القائمة لا يعرف بوجوده.",
    "expired": "انتهت الصلاحية {until}. لا يظهر للمشتري كسعر، ويحتاج تجديد تأكيد — "
    "ولا يتجدّد بتعديل الوصف.",
    "hidden": "أخفيته بنفسك لنقص التوفّر. محفوظ كاملاً وتُعيد نشره بضغطة — الإخفاء ليس حذفاً.",
    "draft": "المسودة عندك ولا يراها السوق حتى تُنشر صريحاً.",
}


SUSPENDED_MEANING = (
    "علّق المشغّل نشر هذا العرض: {reason} — يُخفى من نتائج السوق فقط؛ طلباتك المؤكَّدة ومخزونك "
    "ودفترك لا تُمسّ، ولك اعتراض يراجعه مراجِع غير من علّق."
)


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _dm(d: Any) -> str:
    return f"{d.day:02d}/{d.month:02d}" if d else ""


def can_edit(viewer: home.Viewer) -> bool:
    """ناشر الكتالوج (المالك والمدير) يحرّر المسودة."""
    return viewer.is_owner or viewer.role_code == "manager"


def can_publish(viewer: home.Viewer) -> bool:
    """النشر النهائي بصلاحية أعلى إن ضُبط كذلك في ORG-02 (`market_publish`)."""
    if viewer.is_owner:
        return True
    return org.cell_for(viewer.role_code or "", "market_publish").value == "yes"


def refresh_expiry(qs: Any = None) -> None:
    """المنشور الذي انقضت صلاحيته يصير «منتهٍ» بصمت عند أول جلب — والعدّاد يجعله مرئياً."""
    today = timezone.localdate()
    (qs or MarketOffer.objects).filter(
        status=MarketOffer.Status.PUBLISHED, valid_until__lt=today
    ).update(status=MarketOffer.Status.EXPIRED)


def _shop() -> tuple[str, MarketProfile | None]:
    tenant = Tenant.unscoped.get(id=require_tenant())
    prof = MarketProfile.objects.first()
    return tenant.name, prof


def missing_fields(o: MarketOffer) -> list[dict[str, str]]:
    out = []
    if not o.unit_code:
        out.append(
            {
                "key": "unit",
                "title": "وحدة البيع والعبوة",
                "hint": "مطلوب — بدونها لا تظهر البطاقة في المقارنة",
            }
        )
    if not o.min_order_qty:
        out.append(
            {
                "key": "min_order",
                "title": "حد أدنى للطلب",
                "hint": "مطلوب — يحدد ما تستطيع تنفيذه فعلاً",
            }
        )
    if not o.public_name:
        out.append({"key": "public_name", "title": "الاسم المصرَّح به", "hint": "مطلوب"})
    return out


def public_card(o: MarketOffer, *, for_authorized: bool = False) -> dict[str, Any]:
    """ما يراه غير المدعوّ: الصنف والوحدة والمنطقة وشروط الخدمة — لا سعر خاص ولا اسم مشترٍ
    ولا رصيد."""
    shop_name, prof = _shop()
    pub = (prof.published if prof else {}) or {}
    areas = " · ".join(list(pub.get("service_areas", []))[:2]) or ""
    show_price = o.price_minor is not None and (
        o.audience == MarketOffer.Audience.PUBLIC or for_authorized
    )
    return {
        "id": str(o.id),
        "title": f"{o.public_name} — {o.pack_label}" if o.pack_label else o.public_name,
        "seller_line": " · ".join(x for x in (shop_name, areas, o.fulfilment_note) if x),
        "price_minor": str(o.price_minor) if show_price else "",
        "price_line": (
            "السعر للمشترين المخوَّلين · اطلب تأكيد سعر"
            if o.price_minor is not None and not show_price
            else ("اطلب تأكيد سعر" if o.price_minor is None else "")
        ),
        "unit_name": o.unit_name,
        "pack_label": o.pack_label,
        "min_order_qty": o.min_order_qty,
        "availability": "متوفر" if o.availability == "available" else "حد أقصى للطلب",
        "valid_until": o.valid_until.isoformat() if o.valid_until else "",
        "updated_at": _iso(o.updated_at),
    }


def offer_payload(o: MarketOffer, viewer: home.Viewer | None = None) -> dict[str, Any]:
    private_count = len(o.private_party_ids or [])
    audience_label = (
        "كل المشترين"
        if o.audience == MarketOffer.Audience.PUBLIC
        else f"قائمة خاصة — {private_count} مشترين"
        if o.audience == MarketOffer.Audience.PRIVATE
        else "متابعو منشأتك"
    )
    meaning_key = (
        "published_private"
        if o.status == MarketOffer.Status.PUBLISHED and o.audience != MarketOffer.Audience.PUBLIC
        else o.status
    )
    status_label = MarketOffer.Status(o.status).label
    if meaning_key == "published_private":
        status_label = "منشور — جمهور محدَّد"
    return {
        "id": str(o.id),
        "number": o.number,
        "item_id": str(o.item_id) if o.item_id else "",
        "public_name": o.public_name,
        "description": o.description,
        "unit_code": o.unit_code,
        "unit_name": o.unit_name,
        "pack_label": o.pack_label,
        "price_minor": str(o.price_minor) if o.price_minor is not None else "",
        "min_order_qty": o.min_order_qty,
        "max_order_qty": o.max_order_qty,
        "availability": o.availability,
        "fulfilment_note": o.fulfilment_note,
        "audience": o.audience,
        "audience_label": audience_label,
        "private_party_ids": list(o.private_party_ids or []),
        "valid_until": o.valid_until.isoformat() if o.valid_until else "",
        "status": o.status,
        "status_label": "نشر معلَّق" if o.suspended_at is not None else status_label,
        "meaning": SUSPENDED_MEANING.format(reason=o.suspended_reason)
        if o.suspended_at is not None
        else STATUS_MEANING[meaning_key].format(until=_dm(o.valid_until)),
        "suspended": o.suspended_at is not None,
        "suspended_at": _iso(o.suspended_at),
        "suspended_reason": o.suspended_reason,
        "suspended_reason_code": o.suspended_reason_code,
        "appeal_status": o.appeal_status,
        "appeal_note": o.appeal_note,
        "appeal_opened_at": _iso(o.appeal_opened_at),
        "appeal_decision_note": o.appeal_decision_note,
        "version": o.version,
        "published_at": _iso(o.published_at),
        "updated_at": _iso(o.updated_at),
        "missing": missing_fields(o),
        "card": public_card(o),
        "can_publish": can_publish(viewer) if viewer else False,
    }


def list_payload(viewer: home.Viewer) -> dict[str, Any]:
    refresh_expiry()
    today = timezone.localdate()
    week = today + timedelta(days=7)
    offers = list(MarketOffer.objects.all())
    # الترتيب بما ينتهي هذا الأسبوع لا بتاريخ النشر — الانتهاء هو العمل
    order = {"published": 0, "expired": 1, "draft": 2, "hidden": 3}
    offers.sort(
        key=lambda o: (
            0 if o.status == "published" and o.valid_until and o.valid_until <= week else 1,
            order.get(o.status, 9),
            o.valid_until or today,
        )
    )
    counts = {s: sum(1 for o in offers if o.status == s) for s in order}
    acc = MarketAccount.objects.first()
    return {
        "offers": [offer_payload(o, viewer) for o in offers],
        "counts": counts,
        "total": len(offers),
        "expiring_this_week": sum(
            1
            for o in offers
            if o.status == "published" and o.valid_until and today <= o.valid_until <= week
        ),
        "can_edit": can_edit(viewer),
        "can_publish": can_publish(viewer),
        "seller_verified": bool(acc and acc.verification == MarketAccount.Verification.VERIFIED),
        "plan_allows": has_feature("market_publish"),
    }


def _apply(o: MarketOffer, data: dict[str, Any]) -> None:
    if "item_id" in data and data.get("item_id"):
        item = (
            Item.objects.filter(id=uuid.UUID(str(data["item_id"])))
            .select_related("base_unit")
            .first()
        )
        if item is None:
            raise MarketRejected("item_unknown", "item_id")
        o.item_id = item.id
        if not o.public_name:
            o.public_name = item.name
    if "public_name" in data:
        o.public_name = str(data.get("public_name") or "").strip()[:200]
    if "description" in data:
        o.description = str(data.get("description") or "").strip()[:600]
    if "unit_code" in data:
        code = str(data.get("unit_code") or "").strip()
        o.unit_code = code[:20]
        o.unit_name = str(data.get("unit_name") or "").strip()[:60]
        if code and o.item_id and not o.unit_name:
            item = Item.objects.filter(id=o.item_id).select_related("base_unit").first()
            if item is not None:
                if item.base_unit.code == code:
                    o.unit_name = item.base_unit.name
                else:
                    iu = item.units.select_related("unit").filter(unit__code=code).first()
                    if iu is not None:
                        o.unit_name = iu.unit.name
    if "pack_label" in data:
        o.pack_label = str(data.get("pack_label") or "").strip()[:80]
    if "price_minor" in data:
        raw = str(data.get("price_minor") or "").strip()
        try:
            o.price_minor = int(raw) if raw else None
        except ValueError as e:
            raise MarketRejected("price_invalid", "price_minor") from e
        if o.price_minor is not None and o.price_minor < 0:
            raise MarketRejected("price_invalid", "price_minor")
    for key in ("min_order_qty", "max_order_qty"):
        if key in data:
            raw = str(data.get(key) or "").strip()
            try:
                setattr(o, key, int(raw) if raw else None)
            except ValueError as e:
                raise MarketRejected(f"{key}_invalid", key) from e
    if "availability" in data:
        o.availability = "limited" if data.get("availability") == "limited" else "available"
    if "fulfilment_note" in data:
        o.fulfilment_note = str(data.get("fulfilment_note") or "").strip()[:200]
    if "pickup_only" in data:
        o.pickup_only = bool(data.get("pickup_only"))
    for key in ("delivery_fee_minor", "delivery_free_over_minor"):
        if key in data:
            raw = str(data.get(key) or "").strip()
            try:
                setattr(o, key, int(raw) if raw else None)
            except ValueError as e:
                raise MarketRejected(f"{key}_invalid", key) from e
    if "audience" in data:
        aud = str(data.get("audience") or "public")
        if aud not in MarketOffer.Audience.values:
            raise MarketRejected("audience_invalid", "audience")
        o.audience = aud
    if "private_party_ids" in data:
        o.private_party_ids = [str(x) for x in (data.get("private_party_ids") or [])][:200]
    if "valid_until" in data:
        raw = str(data.get("valid_until") or "").strip()
        if raw:
            try:
                y, m, d = (int(x) for x in raw.split("-"))
                o.valid_until = timezone.localdate().replace(year=y, month=m, day=d)
            except ValueError as e:
                raise MarketRejected("valid_until_invalid", "valid_until") from e
        else:
            o.valid_until = None


PRICE_FIELDS = ("price_minor", "unit_code", "min_order_qty")


def save(
    *, actor: User, viewer: home.Viewer, offer: MarketOffer | None, data: dict[str, Any]
) -> MarketOffer:
    """حفظ المسودة — عند البائع ولا يراها السوق حتى تُنشر صريحاً. تصحيح الوصف لا يجدّد التأكيد
    (ACC-144)؛ تغيير السعر أو الوحدة أو الحدّ الأدنى يُلغي التأكيد القائم فوراً ويطلب تجديداً صريحاً."""
    if not can_edit(viewer):
        raise MarketRejected("permission_denied")
    o = offer or MarketOffer(
        tenant_id=require_tenant(),
        created_by_name=actor.display_name,
        number=MarketOffer.objects.count() + 1,
    )
    before = (o.price_minor, o.unit_code, o.min_order_qty)
    _apply(o, data)
    after = (o.price_minor, o.unit_code, o.min_order_qty)
    if o.status == MarketOffer.Status.PUBLISHED:
        # تعديل المنشور لا يجدّد صلاحيته — إصدار جديد بالتاريخ نفسه
        o.version += 1
        if before != after:
            o.confirmed_at = None
            o.status = MarketOffer.Status.EXPIRED
    o.save()
    return o


RENEW_HOURS = 48


def renew(*, actor: User, viewer: home.Viewer, offer: MarketOffer, days: int = 0) -> MarketOffer:
    """MP-13 — التجديد إقرار سعري بزرّ وختم وقت خادمي (بصلاحية من يلتزم بالسعر): صلاحية جديدة
    بتاريخها، والعرض يعود إلى نتائج البحث إن كان سقط. الماضي ثابت — لا يمسّ طلباً قُبل (ACC-145)."""
    if not can_edit(viewer):
        raise MarketRejected("permission_denied")
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    if offer.status == MarketOffer.Status.DRAFT:
        raise MarketRejected("offer_not_published")
    if missing_fields(offer):
        raise MarketRejected("fields_missing", "", {"missing": missing_fields(offer)})
    now = timezone.now()
    span = timedelta(days=days) if days > 0 else timedelta(hours=RENEW_HOURS)
    offer.confirmed_at = now
    offer.valid_until = (now + span).date()
    if offer.status == MarketOffer.Status.EXPIRED:
        offer.status = MarketOffer.Status.PUBLISHED
    offer.version += 1
    offer.save()
    audit.record(
        kind="market.offer_renewed",
        title=f"تجديد تأكيد السعر والتوفر: {offer.public_name}",
        actor=actor,
        detail=f"حتى {offer.valid_until}",
        ref_entity="market.MarketOffer",
        ref_id=offer.id,
    )
    return offer


def renewals_payload(viewer: home.Viewer) -> dict[str, Any]:
    """ما ينتهي وما انتهى — الأقرب انتهاءً أولاً."""
    refresh_expiry()
    today = timezone.localdate()
    offers = [
        o
        for o in MarketOffer.objects.all()
        if o.status in {MarketOffer.Status.PUBLISHED, MarketOffer.Status.EXPIRED}
    ]
    offers.sort(key=lambda o: (o.status != "expired", o.valid_until or today))
    return {
        "offers": [
            {
                **offer_payload(o, viewer),
                "confirmed_at": _iso(o.confirmed_at),
                "days_left": (o.valid_until - today).days if o.valid_until else None,
            }
            for o in offers
        ],
        "can_renew": can_publish(viewer),
        "renew_hours": RENEW_HOURS,
        "rules": RENEWAL_RULES,
    }


RENEWAL_RULES = [
    {
        "action": "تصحيح الوصف أو الصورة",
        "effect": "لا يجدّد التأكيد ولا يغيّر حالة الصلاحية. العرض يبقى منتهياً كما هو.",
        "verdict": "لا يجدّد",
    },
    {
        "action": "تعديل منطقة الخدمة",
        "effect": "لا يجدّد السعر، ويُخطر المشترين المخوَّلين بأن التوصيل تغيّر.",
        "verdict": "لا يجدّد",
    },
    {
        "action": "تغيير السعر أو الوحدة",
        "effect": "يُلغي التأكيد القائم فوراً ويطلب تجديداً صريحاً. لا سعر جديد بتأكيد قديم.",
        "verdict": "يُلغي التأكيد",
    },
    {
        "action": "تغيير الحد الأدنى للطلب",
        "effect": "يُلغي التأكيد لأنه يغيّر ما يستطيع المشتري طلبه بهذا السعر.",
        "verdict": "يُلغي التأكيد",
    },
    {
        "action": "زر «تجديد التأكيد»",
        "effect": "الفعل الوحيد الذي يمنح ختماً خادمياً جديداً بمدة صلاحية معلنة.",
        "verdict": "يجدّد",
    },
]


def publish(*, actor: User, viewer: home.Viewer, offer: MarketOffer) -> MarketOffer:
    """النشر بصلاحية أعلى: بائع متحقَّق، باقة تفتح النشر، والحقول اللازمة — وإلا النقص مسمّى."""
    if not can_edit(viewer):
        raise MarketRejected("permission_denied")
    if not can_publish(viewer):
        raise MarketRejected("publish_permission_required")
    if not is_verified_seller():
        raise MarketRejected("seller_not_verified")
    if offer.suspended_at is not None:
        raise MarketRejected("publish_suspended", "status", {"reason": offer.suspended_reason})
    if not has_feature("market_publish"):
        raise MarketRejected("plan_feature_required", "", {"feature": "market_publish"})
    missing = missing_fields(offer)
    if missing:
        raise MarketRejected("fields_missing", "", {"missing": missing})
    now = timezone.now()
    if offer.valid_until is None or offer.valid_until < timezone.localdate():
        offer.valid_until = timezone.localdate() + timedelta(days=DEFAULT_VALID_DAYS)
    offer.status = MarketOffer.Status.PUBLISHED
    offer.published_at = now
    offer.confirmed_at = now
    offer.published_by_name = actor.display_name
    offer.hidden_at = None
    offer.version += 1
    offer.save()
    audit.record(
        kind="market.offer_published",
        title=f"نشر عرض: {offer.public_name}",
        actor=actor,
        detail=f"الجمهور {offer.audience} · حتى {offer.valid_until}",
        ref_entity="market.MarketOffer",
        ref_id=offer.id,
    )
    return offer


def appeal_suspension(
    *, actor: User, viewer: home.Viewer, offer: MarketOffer, body: dict[str, Any]
) -> MarketOffer:
    """PLT-07: اعتراض البائع على تعليق النشر — مسار مسجَّل بمستند؛ حتى حسمه يبقى التعليق سارياً."""
    if not can_edit(viewer):
        raise MarketRejected("permission_denied")
    if offer.suspended_at is None:
        raise MarketRejected("not_suspended", "status")
    if offer.appeal_status == "open":
        raise MarketRejected("appeal_open", "appeal")
    note = str(body.get("note") or "").strip()
    if not note:
        raise MarketRejected("note_required", "note")
    offer.appeal_status = "open"
    offer.appeal_note = note[:600]
    offer.appeal_doc_name = str(body.get("doc_name") or "")[:200]
    offer.appeal_doc_data_url = str(body.get("data_url") or "")
    offer.appeal_opened_at = timezone.now()
    offer.appeal_decided_at = None
    offer.appeal_reviewer_name = ""
    offer.appeal_decision_note = ""
    offer.save()
    audit.record(
        kind="market.suspension_appealed",
        title=f"اعتراض على تعليق نشر: {offer.public_name}",
        actor=actor,
        detail=note[:200],
        ref_entity="market.MarketOffer",
        ref_id=offer.id,
    )
    return offer


def hide(*, actor: User, viewer: home.Viewer, offer: MarketOffer) -> MarketOffer:
    """الإخفاء ليس حذفاً: محفوظ كاملاً وتُعيد نشره بضغطة."""
    if not can_edit(viewer):
        raise MarketRejected("permission_denied")
    offer.status = MarketOffer.Status.HIDDEN
    offer.hidden_at = timezone.now()
    offer.save(update_fields=["status", "hidden_at", "updated_at"])
    return offer


def preview(*, viewer: home.Viewer, data: dict[str, Any]) -> dict[str, Any]:
    """ما سيظهر ولمن — قبل الحفظ: البطاقة العامة، ما يُنشر، ما ينقص، ما يُحجب أبداً."""
    o = MarketOffer(tenant_id=require_tenant())
    _apply(o, data)
    return {
        "card": public_card(o),
        "published_fields": [
            {
                "title": "الاسم والصنف والوصف المصرَّح به",
                "hint": "نص منفصل عن اسمك الداخلي — تعدّله للسوق دون تغيير بطاقتك",
            },
            {
                "title": "المنطقة وطريقة التنفيذ",
                "hint": "توصيل داخل المنطقة أو استلام من المخزن",
            },
        ],
        "missing": missing_fields(o),
        "hidden_fields": [
            {
                "title": "رصيد المخزون الفعلي",
                "hint": "لا يُنشر أبداً. تعرض «متوفر» أو «حد أقصى للطلب» وليس الكمية",
            },
            {
                "title": "تكلفة الشراء وهامشك",
                "hint": "لا يُنشر أبداً ولا يدخل أي حساب معروض للمشتري",
            },
        ],
        "can_publish": can_publish(viewer),
        "seller_verified": is_verified_seller(),
        "plan_allows": has_feature("market_publish"),
    }
