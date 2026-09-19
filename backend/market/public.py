"""MP-01/MP-02 — السوق العام: الرئيسية والدليل (§١٢.٧، §١٤.٥، §١٤.٦؛ ACC-120، ACC-121، ACC-150).

تُقرأ بلا حساب: العروض العامة تُرى كاملةً بلا تسجيل (لا تسجيل قبل القيمة)، ولا يخرج من أي منشأة
إلا المنشور المصرَّح به — لا عنوان ولا هاتف ولا رصيد ولا سعر شريحة ولا قائمة خاصة ولو فُتح الرابط
من هاتف مشترٍ مخوَّل. المنطقة أولاً: منطقة بلا موردين حقيقة عن السوق لا خطأ في البحث، ولا نعرض موردي
منطقة أخرى كأنهم خيار. لا يُعرض إلا المنشور المؤكَّد؛ الترتيب داخل كل وحدة على حدة — لا «الأرخص»
عبر وحدات مختلفة.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core.models import Tenant
from core.search_normalize import normalize_search
from core.tenancy import platform_context
from market.models import MarketAccount, MarketOffer, MarketProfile
from market.services import badge_of


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
    """الشارة هوية لا تزكية: موثَّقة المستندات / التحقق منتهٍ / نشر معلَّق / بلا شارة."""
    return badge_of(acc)


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


# ------------------------------------------------------------------ MP-03 ملف المورد العام

BADGE_MEANS = [
    "تحققنا من وجود هذه المنشأة ومن هوية مسؤولها بمستند سجل تجاري.",
]
BADGE_NOT = [
    "أن بضاعته جيدة أو مطابقة للوصف — الوصف مسؤوليته لا مسؤوليتنا.",
    "أنه سيسلّم في الموعد. مهلة التسليم بند في اتفاقكما لا ضمان منا.",
    "أن Sting طرف في الدفع أو ضامن لأي طلب بينكما.",
]


def supplier_profile(tenant_id: Any) -> dict[str, Any] | None:
    """الملف العام: الهوية والشارة بحدودها أولاً ثم العروض العامة؛ الخاص لا يظهر أصلاً."""
    with platform_context():
        p = MarketProfile.unscoped.filter(tenant_id=tenant_id).exclude(published={}).first()
        acc = MarketAccount.unscoped.filter(tenant_id=tenant_id).first()
    if p is None:
        return None
    pub = p.published or {}
    badge, badge_label = _badge(acc)
    offers = _public_offers([p.tenant_id])
    name = str(pub.get("public_name", ""))
    since = p.published_at
    return {
        **supplier_card(p, pub, acc, len(offers)),
        "since": _iso(since),
        "badge_means": BADGE_MEANS if badge in {"verified", "expired"} else [],
        "badge_not": BADGE_NOT if badge in {"verified", "expired"} else [],
        "verified_until": acc.verified_until.isoformat() if acc and acc.verified_until else "",
        "suspended_at": _iso(acc.publish_suspended_at) if acc else "",
        # حقائق قابلة للتحقق — من طلبات فعلية مؤكدة من طرفين (ORD لاحقاً؛ الآن صفر صادق)
        "facts": {"confirmed_orders": 0, "fulfilled": 0, "partial": 0, "open_disputes": 0},
        "offers": [offer_card(o, name) for o in offers],
    }


# ------------------------------------------------------------------ MP-04 البحث والمقارنة


def _base_factor(o: MarketOffer) -> tuple[int, str]:
    if not o.item_id or not o.unit_code:
        return 1000, o.unit_name
    from catalog.models import Item

    with platform_context():
        item = (
            Item.unscoped.filter(id=o.item_id, tenant_id=o.tenant_id)
            .select_related("base_unit")
            .first()
        )
        if item is None:
            return 1000, o.unit_name
        if item.base_unit.code == o.unit_code:
            return 1000, item.base_unit.name
        iu = item.units.select_related("unit").filter(unit__code=o.unit_code).first()
        return (int(iu.factor_milli) if iu else 1000), item.base_unit.name


def _fees(o: MarketOffer) -> tuple[bool, str]:
    """(محسومة؟، الوصف): الاستلام بلا رسوم، توصيل برسم معلوم، توصيل مجاني فوق حدّ، أو غير محسومة."""
    if o.pickup_only:
        return True, "استلام من المخزن — بلا رسوم"
    if o.delivery_fee_minor is not None:
        if o.delivery_free_over_minor is not None:
            return True, f"توصيل مجاني فوق {o.delivery_free_over_minor // 100}"
        if o.delivery_fee_minor == 0:
            return True, "توصيل داخل المنطقة مشمول"
        return True, "توصيل برسم معلوم"
    return False, "رسوم النقل تُحدَّد عند الطلب — غير محسومة"


def search(*, q: str = "", area: str = "") -> dict[str, Any]:
    """MP-04: النتائج مجمّعة بالعبوة/الوحدة؛ الترتيب بسعر الوحدة داخل المجموعة وللمحسوم رسومه
    وحده؛ غير المحسوم «قبل الرسوم — خارج الترتيب»؛ المنتهي حديثاً خارج الترتيب معروض للسياق؛
    أكثر من مجموعة = `partial` (لا «الأرخص»)."""
    today = timezone.localdate()
    profiles = [(p, pub, a) for p, pub, a in _published_profiles() if _matches_area(pub, area)]
    names = {p.tenant_id: str(pub.get("public_name", "")) for p, pub, _a in profiles}
    qn = normalize_search(q) if q else ""
    with platform_context():
        rows = list(
            MarketOffer.unscoped.filter(
                tenant_id__in=list(names),
                status__in=[MarketOffer.Status.PUBLISHED, MarketOffer.Status.EXPIRED],
                audience=MarketOffer.Audience.PUBLIC,
            )
        )
    rows = [o for o in rows if not qn or qn in normalize_search(o.public_name)]
    groups: dict[str, list[dict[str, Any]]] = {}
    for o in rows:
        expired = o.valid_until is None or o.valid_until < today
        if expired and (o.valid_until is None or (today - o.valid_until).days > 7):
            continue  # الميت لا يُعرض حتى للسياق بعد أسبوع
        factor, base_name = _base_factor(o)
        fees_ok, fees_label = _fees(o)
        unit_price = (o.price_minor * 1000) // factor if o.price_minor is not None else None
        row = {
            **offer_card(o, names.get(o.tenant_id, "")),
            "unit_price_minor": str(unit_price) if unit_price is not None else "",
            "base_unit_name": base_name,
            "fees_decided": fees_ok,
            "fees_label": fees_label,
            "min_order_label": (
                f"حد أدنى {o.min_order_qty} {o.unit_name}" if o.min_order_qty else "بلا حد أدنى"
            ),
            "expired": expired,
            "expired_yesterday": bool(expired and o.valid_until == today - timedelta(days=1)),
            "ranked": bool(not expired and fees_ok and o.price_minor is not None),
        }
        groups.setdefault(o.pack_label or o.unit_name or "—", []).append(row)
    out_groups: list[dict[str, Any]] = []
    for label, items in groups.items():
        ranked = sorted(
            [r for r in items if r["ranked"]], key=lambda r: int(r["unit_price_minor"] or 0)
        )
        unranked = [r for r in items if not r["ranked"] and not r["expired"]]
        expired_rows = [r for r in items if r["expired"]]
        out_groups.append(
            {
                "label": label,
                "count": len([r for r in items if not r["expired"]]),
                "rankable": len(ranked),
                "offers": ranked + unranked + expired_rows,
            }
        )
    out_groups.sort(key=lambda g: -int(g["count"]))
    live = sum(int(g["count"]) for g in out_groups)
    sellers: set[str] = set()
    for g in out_groups:
        for r in g["offers"]:
            sellers.add(str(r["seller_tenant_id"]))
    all_tenants = [p.tenant_id for p, _pub, _a in _published_profiles()]
    all_offers = [
        o for o in _public_offers(all_tenants) if not qn or qn in normalize_search(o.public_name)
    ]
    return {
        "q": q,
        "area": area,
        "groups": out_groups,
        "offers_count": live,
        "suppliers_count": len(sellers),
        "multi_unit": len(out_groups) > 1,
        "all_areas_count": len(all_offers),
        "fetched_at": _iso(timezone.now()),
    }
