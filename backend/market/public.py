"""MP-01/MP-02 — السوق العام: الرئيسية والدليل (§١٢.٧، §١٤.٥، §١٤.٦؛ ACC-120، ACC-121، ACC-150).

تُقرأ بلا حساب: العروض العامة تُرى كاملةً بلا تسجيل (لا تسجيل قبل القيمة)، ولا يخرج من أي منشأة
إلا المنشور المصرَّح به — لا عنوان ولا هاتف ولا رصيد ولا سعر شريحة ولا قائمة خاصة ولو فُتح الرابط
من هاتف مشترٍ مخوَّل. المنطقة أولاً: منطقة بلا موردين حقيقة عن السوق لا خطأ في البحث، ولا نعرض موردي
منطقة أخرى كأنهم خيار. لا يُعرض إلا المنشور المؤكَّد؛ الترتيب داخل كل وحدة على حدة — لا «الأرخص»
عبر وحدات مختلفة.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from django.utils import timezone

from core.models import Tenant
from core.search_normalize import normalize_search
from core.tenancy import platform_context
from market.models import MarketAccount, MarketOffer, MarketProfile


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _published_profiles() -> list[tuple[MarketProfile, dict[str, Any], MarketAccount | None]]:
    out = []
    with platform_context():
        accounts = {a.tenant_id: a for a in MarketAccount.unscoped.all()}
        for p in MarketProfile.unscoped.exclude(published={}).order_by("public_name"):
            pub = p.published or {}
            if not pub.get("public_name") or not pub.get("service_areas"):
                continue
            out.append((p, pub, accounts.get(p.tenant_id)))
    return out


def _public_offers(tenant_ids: list[Any]) -> list[MarketOffer]:
    today = timezone.localdate()
    with platform_context():
        return list(
            MarketOffer.unscoped.filter(
                tenant_id__in=tenant_ids,
                status=MarketOffer.Status.PUBLISHED,
                audience=MarketOffer.Audience.PUBLIC,
                valid_until__gte=today,
            ).order_by("public_name")
        )


def _badge(acc: MarketAccount | None) -> tuple[str, str]:
    """الشارة هوية لا تزكية: موثَّقة المستندات أو بلا شارة."""
    if acc and acc.verification == MarketAccount.Verification.VERIFIED:
        return "verified", "موثَّقة المستندات"
    return "none", "بلا شارة"


def _matches_area(pub: dict[str, Any], area: str) -> bool:
    if not area:
        return True
    a = normalize_search(area)
    return any(
        a in normalize_search(str(x)) or normalize_search(str(x)) in a
        for x in pub.get("service_areas", [])
    )


def supplier_card(
    p: MarketProfile, pub: dict[str, Any], acc: MarketAccount | None, offers_count: int
) -> dict[str, Any]:
    badge, badge_label = _badge(acc)
    return {
        "tenant_id": str(p.tenant_id),
        "public_name": str(pub.get("public_name", "")),
        "category_line": str(pub.get("category_line", "")),
        "categories": list(pub.get("categories", [])),
        "service_areas": list(pub.get("service_areas", [])),
        "fulfilment": list(pub.get("fulfilment", [])),
        "offers_count": offers_count,
        "badge": badge,
        "badge_label": badge_label,
        "published_at": _iso(p.published_at),
    }


def offer_card(o: MarketOffer, seller_name: str) -> dict[str, Any]:
    """البطاقة العامة: السعر العام وحده أو «اطلب سعراً» — بكلمتها لا بفراغ (N-02)."""
    return {
        "id": str(o.id),
        "seller_tenant_id": str(o.tenant_id),
        "seller_name": seller_name,
        "public_name": o.public_name,
        "unit_name": o.unit_name,
        "pack_label": o.pack_label,
        "price_minor": str(o.price_minor) if o.price_minor is not None else "",
        "price_line": "" if o.price_minor is not None else "اطلب سعراً",
        "availability": "متوفر" if o.availability == "available" else "حد أقصى للطلب",
        "confirmed_until": o.valid_until.isoformat() if o.valid_until else "",
        "min_order_qty": o.min_order_qty,
    }


def areas() -> list[dict[str, Any]]:
    """المناطق التي يخدمها مورد ناشر واحد على الأقل، بعدد مورديها — لاختيار المنطقة."""
    c: Counter[str] = Counter()
    for _p, pub, _a in _published_profiles():
        for x in pub.get("service_areas", []):
            c[str(x)] += 1
    return [{"name": k, "suppliers": v} for k, v in sorted(c.items(), key=lambda kv: -kv[1])]


def home(*, area: str = "", q: str = "") -> dict[str, Any]:
    """MP-01: الموردون الذين يخدمون المنطقة وعروضهم العامة المؤكَّدة، مجمّعة بالوحدة."""
    profiles = [(p, pub, a) for p, pub, a in _published_profiles() if _matches_area(pub, area)]
    names = {p.tenant_id: str(pub.get("public_name", "")) for p, pub, _a in profiles}
    offers = _public_offers(list(names))
    qn = normalize_search(q) if q else ""
    if qn:
        offers = [o for o in offers if qn in normalize_search(o.public_name)]
        matched = {o.tenant_id for o in offers}
        profiles = [
            t
            for t in profiles
            if t[0].tenant_id in matched or qn in normalize_search(str(t[1].get("public_name", "")))
        ]
    counts = Counter(o.tenant_id for o in offers)
    by_unit: dict[str, list[dict[str, Any]]] = {}
    for o in sorted(
        offers, key=lambda x: (x.unit_name, x.price_minor if x.price_minor is not None else 1 << 62)
    ):
        by_unit.setdefault(o.unit_name or "—", []).append(offer_card(o, names.get(o.tenant_id, "")))
    return {
        "area": area,
        "areas": areas(),
        "q": q,
        "suppliers": [
            supplier_card(p, pub, a, counts.get(p.tenant_id, 0)) for p, pub, a in profiles
        ],
        "offers_by_unit": [{"unit_name": u, "offers": xs} for u, xs in by_unit.items()],
        "offers_count": len(offers),
        "suppliers_count": len(profiles),
        "fetched_at": _iso(timezone.now()),
    }


def directory(*, area: str = "", category: str = "") -> dict[str, Any]:
    """MP-02: تصفية بالخدمة لا بالعنوان الخاص — بالمنطقة والفئة، مع عدّ البدائل لأزرار المخرج."""
    allp = _published_profiles()
    cn = normalize_search(category) if category else ""

    def cat_ok(pub: dict[str, Any]) -> bool:
        return not cn or any(cn in normalize_search(str(x)) for x in pub.get("categories", []))

    rows = [(p, pub, a) for p, pub, a in allp if _matches_area(pub, area) and cat_ok(pub)]
    counts = Counter(o.tenant_id for o in _public_offers([p.tenant_id for p, _pub, _a in allp]))
    cats: Counter[str] = Counter()
    for _p, pub, _a in allp:
        for x in pub.get("categories", []):
            cats[str(x)] += 1
    return {
        "area": area,
        "category": category,
        "areas": areas(),
        "categories": [{"name": k, "suppliers": v} for k, v in cats.most_common()],
        "suppliers": [supplier_card(p, pub, a, counts.get(p.tenant_id, 0)) for p, pub, a in rows],
        "total": len(rows),
        # المخرج بأزرار تحمل أثرها: «كل المناطق (N نتيجة)» / «كل الفئات (M نتيجة)»
        "alternatives": {
            "all_areas": sum(1 for p, pub, a in allp if cat_ok(pub)),
            "all_categories": sum(1 for p, pub, a in allp if _matches_area(pub, area)),
            "everything": len(allp),
        },
        "fetched_at": _iso(timezone.now()),
    }


def tenant_name(tid: Any) -> str:
    with platform_context():
        t = Tenant.unscoped.filter(id=tid).first()
    return t.name if t else ""
