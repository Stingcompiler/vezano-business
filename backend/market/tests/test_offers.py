"""MP-10/MP-11 (T3.4): النشر صنفاً صنفاً بسعر مقصود وجمهور وصلاحية؛ لا رصيد ولا تكلفة في البطاقة؛
النقص مسمّى (وحدة البيع وحدّ أدنى)؛ التحرير غير النشر (المدير يحفظ مسودة ولا ينشر)؛ النشر لبائع
متحقَّق بباقة تفتحه؛ المنتهي يظهر منتهياً بصمت عند الجلب والمخفي محفوظ."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from catalog import services as catalog_services
from core import subscription
from core.models import Unit
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market.models import MarketAccount, MarketOffer

pytestmark = pytest.mark.django_db(transaction=True)


def _put(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.put(path, body, content_type="application/json", headers=h)


def test_offers_draft_publish_gates_and_states(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h, hm = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["manager"])
    from sync.counter import ensure_state

    with tenant_context(ctx["tenant"].id):
        ensure_state(ctx["tenant"].id)
        kg = Unit.objects.filter(code="kg").first() or Unit.objects.create(
            tenant=ctx["tenant"], code="kg", name="كغ", is_base=True
        )
        carton = Unit.objects.filter(code="carton").first() or Unit.objects.create(
            tenant=ctx["tenant"], code="carton", name="كرتونة"
        )
        sugar = catalog_services.create_item(
            name="سكر أبيض", base_unit=kg, sale_price_minor=10000, units=[(carton, 12000)]
        )
    # المعاينة قبل الحفظ: ما يُنشر وما ينقص وما يُحجب
    r = _post(
        c,
        h,
        "/api/market/offers/preview",
        {
            "item_id": str(sugar.id),
            "public_name": "سكر أبيض",
            "fulfilment_note": "توصيل داخل المنطقة",
        },
    )
    assert r.status_code == 200
    p = r.json()
    assert [m["key"] for m in p["missing"]] == ["unit", "min_order"]
    assert p["card"]["price_line"] == "اطلب تأكيد سعر" and "stock" not in str(p["card"])
    assert p["hidden_fields"][0]["title"] == "رصيد المخزون الفعلي"
    # المدير يحفظ مسودة ولا ينشر (التحرير غير النشر)
    r = _post(c, hm, "/api/market/offers", {"item_id": str(sugar.id), "public_name": "سكر أبيض"})
    assert r.status_code == 201 and r.json()["offer"]["status"] == "draft"
    oid = r.json()["offer"]["id"]
    assert r.json()["offer"]["can_publish"] is False
    r = c.post(f"/api/market/offers/{oid}/publish", headers=hm)
    assert r.status_code == 403 and r.json()["detail"] == "publish_permission_required"
    # المالك: النشر يحتاج بائعاً متحقَّقاً ثم باقة تفتحه ثم الحقول
    r = c.post(f"/api/market/offers/{oid}/publish", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "seller_not_verified"
    with tenant_context(ctx["tenant"].id):
        acc = MarketAccount.objects.create(
            tenant=ctx["tenant"], verification=MarketAccount.Verification.VERIFIED, role="both"
        )
        subscription.set_for_scenario(state="active", plan_code="single")
    r = c.post(f"/api/market/offers/{oid}/publish", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "plan_feature_required"
    with tenant_context(ctx["tenant"].id):
        subscription.set_for_scenario(state="active", plan_code="dual")
    r = c.post(f"/api/market/offers/{oid}/publish", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "fields_missing"
    assert [m["key"] for m in r.json()["extra"]["missing"]] == ["unit", "min_order"]
    # إكمال الوحدة والحدّ الأدنى والسعر العام ثم النشر: الصلاحية تبدأ الآن
    r = _put(
        c,
        h,
        f"/api/market/offers/{oid}",
        {
            "unit_code": "carton",
            "pack_label": "كرتونة 12×1كغ",
            "min_order_qty": "5",
            "price_minor": "1150000",
            "audience": "public",
            "publish": True,
        },
    )
    assert r.status_code == 200, r.content
    o = r.json()["offer"]
    assert o["status"] == "published" and o["unit_name"] == "كرتونة" and o["valid_until"]
    assert (
        o["card"]["title"] == "سكر أبيض — كرتونة 12×1كغ" and o["card"]["price_minor"] == "1150000"
    )
    assert o["meaning"].startswith("يظهر في البحث وسعره مؤكَّد حتى")
    # سعر خاص لا يظهر في البطاقة العامة
    r = _put(
        c, h, f"/api/market/offers/{oid}", {"audience": "private", "private_party_ids": ["a", "b"]}
    )
    assert r.json()["offer"]["card"]["price_minor"] == ""
    assert r.json()["offer"]["card"]["price_line"] == "السعر للمشترين المخوَّلين · اطلب تأكيد سعر"
    assert r.json()["offer"]["status_label"] == "منشور — جمهور محدَّد"
    # القائمة: العدّادات والانتهاء بصمت والإخفاء ليس حذفاً
    with tenant_context(ctx["tenant"].id):
        off = MarketOffer.objects.get(id=oid)
        off.valid_until = timezone.localdate() - timedelta(days=1)
        off.save(update_fields=["valid_until"])
        MarketOffer.objects.create(tenant=ctx["tenant"], public_name="دقيق", status="hidden")
        MarketOffer.objects.create(tenant=ctx["tenant"], public_name="شاي", status="draft")
    lst = c.get("/api/market/offers", headers=h).json()
    assert lst["counts"] == {"published": 0, "expired": 1, "draft": 1, "hidden": 1}
    assert lst["total"] == 3 and lst["can_publish"] is True and lst["seller_verified"] is True
    exp = next(x for x in lst["offers"] if x["id"] == oid)
    assert exp["status"] == "expired" and "تجديد تأكيد (MP-13)" in exp["meaning"]
    r = c.post(f"/api/market/offers/{oid}/hide", headers=h)
    assert (
        r.json()["offer"]["status"] == "hidden"
        and "الإخفاء ليس حذفاً" in r.json()["offer"]["meaning"]
    )
    # الكاشير لا يرى العروض
    assert c.get("/api/market/offers", headers=_h(ctx["tokens"]["cashier"])).status_code == 403
    assert acc.role == "both"
