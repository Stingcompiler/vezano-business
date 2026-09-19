"""MP-12/MP-13 (T3.5): الشرائح بحدودها — فجوة تمنع الحفظ بمداها، «بالتفاوض» مقبول؛ الأعضاء
بأسمائهم بدعوة تُقبل بحساب المشتري؛ منشأة ثالثة لا ترى القائمة ولا تعرف بوجودها (ACC-121)؛
تصحيح الوصف لا يجدّد التأكيد وتغيير السعر يلغيه والتجديد فعل صريح بصلاحية من يلتزم بالسعر."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core import subscription
from core.auth.tokens import issue_session_tokens
from core.models import User
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market.models import MarketAccount, MarketOffer

pytestmark = pytest.mark.django_db(transaction=True)


def _put(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.put(path, body, content_type="application/json", headers=h)


def test_price_lists_members_isolation_and_renewal(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    c, h, hm = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["manager"])
    with tenant_context(ctx["tenant"].id):
        MarketAccount.objects.create(
            tenant=ctx["tenant"], verification=MarketAccount.Verification.VERIFIED, role="both"
        )
        subscription.set_for_scenario(state="active", plan_code="dual")
    r = _post(
        c,
        h,
        "/api/market/offers",
        {
            "public_name": "سكر أبيض",
            "unit_code": "carton",
            "unit_name": "كرتونة",
            "pack_label": "كرتونة 12×1كغ",
            "min_order_qty": "5",
            "price_minor": "1180000",
            "publish": True,
        },
    )
    assert r.status_code == 201, r.content
    oid = r.json()["offer"]["id"]
    assert r.json()["offer"]["number"] == 1 and r.json()["offer"]["status"] == "published"
    # لا قوائم خاصة — حالة سويّة
    assert c.get("/api/market/lists", headers=h).json()["lists"] == []
    # فجوة 50–59 تمنع الحفظ بمداها
    tiers = [
        {"min": 5, "max": 19, "price_minor": "1180000"},
        {"min": 20, "max": 49, "price_minor": "1140000"},
        {"min": 60, "max": 120, "price_minor": "1095000"},
        {"min": 121, "max": "", "price_minor": ""},
    ]
    r = _post(c, h, "/api/market/lists", {"offer_id": oid, "name": "موزّعو بحري", "tiers": tiers})
    assert r.status_code == 400 and r.json()["detail"] == "tier_gap"
    assert r.json()["extra"]["gaps"] == [{"from": 50, "to": 59}]
    tiers[2]["min"] = 50
    r = _post(c, h, "/api/market/lists", {"offer_id": oid, "name": "موزّعو بحري", "tiers": tiers})
    assert r.status_code == 201, r.content
    pl = r.json()["list"]
    assert pl["tiers"][0]["label"] == "5 – 19 كرتونة" and pl["tiers"][3]["negotiable"] is True
    assert pl["tiers"][3]["label"] == "أكثر من 120" and pl["gaps"] == []
    lid = pl["id"]
    # العرض صار خاص الجمهور
    assert c.get(f"/api/market/offers/{oid}", headers=h).json()["offer"]["audience"] == "private"
    # المدير لا يحفظ قوائم (بصلاحية من يلتزم بالسعر)
    assert _post(c, hm, "/api/market/lists", {"offer_id": oid, "tiers": tiers}).status_code == 403
    # دعوة المنشأة «ب» بالاسم؛ منشأة ثالثة لا ترى شيئاً
    r = _post(c, h, f"/api/market/lists/{lid}/members", {"buyer_tenant_id": str(two_tenants.b.id)})
    assert r.status_code == 201 and r.json()["member"]["status"] == "invited"
    mid = r.json()["member"]["id"]
    assert (
        _post(
            c, h, f"/api/market/lists/{lid}/members", {"buyer_tenant_id": str(ctx["tenant"].id)}
        ).json()["detail"]
        == "buyer_is_self"
    )
    with platform_context():
        ob = User.objects.create_user(
            tenant=two_tenants.b, username="ob", display_name="مالك ب", is_owner=True
        )
        oc_tenant = two_tenants.b  # منشأة ثالثة تُنشأ أدناه
        _s, rb = issue_session_tokens(ob)
    hb = {"Authorization": f"Bearer {rb.access_token}"}
    # قبل القبول: لا شيء للمشتري
    assert c.get(f"/api/market/lists/{lid}", headers=hb).status_code == 404
    assert _post(c, hb, f"/api/market/lists/{lid}/accept").status_code == 200
    r = c.get(f"/api/market/lists/{lid}", headers=hb)
    assert r.status_code == 200 and r.json()["role"] == "buyer"
    assert r.json()["list"]["tiers"][1]["price_minor"] == "1140000"
    assert "members" not in r.json()["list"]
    # الإيقاف بطلب البائع يحجب فوراً؛ والاستئناف يعيد
    assert (
        c.post(f"/api/market/lists/{lid}/members/{mid}/suspend", headers=h).json()["member"][
            "status"
        ]
        == "suspended"
    )
    assert c.get(f"/api/market/lists/{lid}", headers=hb).status_code == 404
    assert c.post(f"/api/market/lists/{lid}/members/{mid}/resume", headers=h).status_code == 200
    # منشأة ثالثة: 404 نفسه — كأنها غير موجودة
    from core.models import Branch, Tenant

    with platform_context():
        t3 = Tenant.unscoped.create(name="ثالثة", base_currency="SDG", base_currency_exponent=2)
        Branch.unscoped.create(tenant=t3, name="الرئيسي", code="TH", is_default=True)
        o3 = User.objects.create_user(tenant=t3, username="o3", display_name="ثالث", is_owner=True)
        _s, r3 = issue_session_tokens(o3)
    h3 = {"Authorization": f"Bearer {r3.access_token}"}
    assert c.get(f"/api/market/lists/{lid}", headers=h3).status_code == 404
    assert _post(c, h3, f"/api/market/lists/{lid}/accept").status_code == 404
    assert oc_tenant.id != t3.id
    # MP-13: تصحيح الوصف لا يجدّد؛ تغيير السعر يلغي التأكيد
    r = _put(c, h, f"/api/market/offers/{oid}", {"description": "سكر ناعم فاخر"})
    assert r.json()["offer"]["status"] == "published"
    r = _put(c, h, f"/api/market/offers/{oid}", {"price_minor": "1200000"})
    assert r.json()["offer"]["status"] == "expired"
    # المدير لا يجدّد؛ المالك يجدّد 48 ساعة والعرض يعود
    assert _post(c, hm, f"/api/market/offers/{oid}/renew").status_code == 403
    r = _post(c, h, f"/api/market/offers/{oid}/renew")
    assert r.status_code == 200 and r.json()["offer"]["status"] == "published"
    assert (
        r.json()["offer"]["valid_until"] == (timezone.localdate() + timedelta(days=2)).isoformat()
    )
    ren = c.get("/api/market/renewals", headers=h).json()
    assert ren["renew_hours"] == 48 and ren["offers"][0]["days_left"] == 2
    assert ren["rules"][4]["verdict"] == "يجدّد"
    with tenant_context(ctx["tenant"].id):
        assert MarketOffer.objects.get(id=oid).confirmed_at is not None
