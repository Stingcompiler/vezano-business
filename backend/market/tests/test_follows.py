"""MP-05/MP-06 (T3.8): العرض العام لأي زائر بشروطه وتاريخ تأكيده؛ الخاص لعضو القائمة النشط
والمتابعين للمتابِع النشط، وغيرهما 404 نفسه (ACC-121)؛ المخفي «سُحب»؛ العملة لا تُحوَّل
(ACC-140)؛ المتابعة قرار المالك تُلغى وحدها والمورد يرى عدداً لا أسماء (ACC-134)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth.tokens import issue_session_tokens
from core.models import User
from core.tenancy import platform_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market.models import (
    MarketAccount,
    MarketOffer,
    MarketPriceList,
    MarketPriceListMember,
    MarketProfile,
)

pytestmark = pytest.mark.django_db(transaction=True)


def test_offer_detail_audiences_and_follow(ctx: dict[str, Any], two_tenants: TwoTenants) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hm = _h(ctx["tokens"]["manager"])
    today = timezone.localdate()
    # البائع = المنشأة ب؛ المشتري = منشأة ctx (أ)
    with platform_context():
        MarketAccount.unscoped.create(
            tenant=two_tenants.b,
            verification="verified",
            role="both",
            verified_until=today + timedelta(days=100),
        )
        MarketProfile.unscoped.create(
            tenant=two_tenants.b,
            public_name="مخزن البركة — تجريبي",
            published={
                "public_name": "مخزن البركة — تجريبي",
                "category_line": "جملة",
                "categories": ["سكر"],
                "service_areas": ["بحري"],
                "fulfilment": ["توصيل"],
            },
            published_at=timezone.now(),
        )

        def mk(audience: str, status: str = "published") -> MarketOffer:
            o: MarketOffer = MarketOffer.unscoped.create(
                tenant=two_tenants.b,
                public_name="سكر أبيض",
                unit_name="كرتونة",
                pack_label="كرتونة 12×1كغ",
                price_minor=1180000,
                min_order_qty=5,
                status=status,
                audience=audience,
                valid_until=today + timedelta(days=3),
                confirmed_at=timezone.now() - timedelta(days=3),
                delivery_fee_minor=0,
            )
            return o

        pub = mk("public")
        priv = mk("private")
        fol = mk("followers")
        hidden = mk("public", status="hidden")
        pl = MarketPriceList.unscoped.create(
            tenant=two_tenants.b,
            name="موزّعون",
            offer=priv,
            tiers=[{"min": 5, "max": None, "price_minor": 1100000}],
        )
    # زائر بلا حساب: العام بشروطه، الخاص والمتابعين 404، المخفي «سُحب»
    d = Client().get(f"/api/market/offers/public/{pub.id}")
    assert d.status_code == 200
    o = d.json()["offer"]
    assert o["days_since_confirmed"] == 3 and o["currency"] == "SDG" and o["buyer_currency"] == ""
    assert (
        o["fees_label"] == "توصيل داخل المنطقة مشمول" and o["tiers"] == [] and o["expired"] is False
    )
    assert Client().get(f"/api/market/offers/public/{priv.id}").status_code == 404
    assert Client().get(f"/api/market/offers/public/{fol.id}").status_code == 404
    w = Client().get(f"/api/market/offers/public/{hidden.id}").json()["offer"]
    assert w["withdrawn"] is True and len(w["others"]) == 1
    # مشترٍ بحساب: الخاص بعد قبول الدعوة، والمتابعين بعد المتابعة
    assert c.get(f"/api/market/offers/public/{priv.id}", headers=h).status_code == 404
    with platform_context():
        MarketPriceListMember.unscoped.create(
            tenant=two_tenants.b,
            price_list=pl,
            buyer_tenant_id=ctx["tenant"].id,
            buyer_name="أ",
            status="active",
        )
    o = c.get(f"/api/market/offers/public/{priv.id}", headers=h).json()["offer"]
    assert o["tiers"][0]["price_minor"] == "1100000" and o["currency_mismatch"] is False
    assert c.get(f"/api/market/offers/public/{fol.id}", headers=h).status_code == 404
    # المتابعة: المدير لا يقرّرها؛ المالك يتابع؛ المورد يرى عدداً
    assert (
        _post(
            c, hm, "/api/market/following", {"supplier_tenant_id": str(two_tenants.b.id)}
        ).status_code
        == 403
    )
    r = _post(c, h, "/api/market/following", {"supplier_tenant_id": str(two_tenants.b.id)})
    assert r.status_code == 201 and r.json()["follow"]["status"] == "active"
    fid = r.json()["follow"]["id"]
    assert c.get(f"/api/market/offers/public/{fol.id}", headers=h).status_code == 200
    lst = c.get("/api/market/following", headers=h).json()
    assert lst["active_count"] == 1 and lst["follows"][0]["supplier_name"] == "مخزن البركة — تجريبي"
    assert len(lst["what_stays"]) == 3
    with platform_context():
        ob = User.objects.create_user(
            tenant=two_tenants.b, username="ob", display_name="ب", is_owner=True
        )
        _s, rb = issue_session_tokens(ob)
    hb = {"Authorization": f"Bearer {rb.access_token}"}
    prof = c.get("/api/market/profile", headers=hb).json()["profile"]
    assert prof["followers_count"] == 1 and "follows" not in prof
    # الإلغاء يوقف المتابعين ولا يمسّ الخاص (العلاقة المخوَّلة باقية)
    r = _post(c, h, f"/api/market/following/{fid}/unfollow")
    assert r.status_code == 200 and r.json()["follow"]["status"] == "cancelled"
    assert c.get(f"/api/market/offers/public/{fol.id}", headers=h).status_code == 404
    assert c.get(f"/api/market/offers/public/{priv.id}", headers=h).status_code == 200
    assert c.get("/api/market/profile", headers=hb).json()["profile"]["followers_count"] == 0
    # المنتهي: آخر سعر معروف بلا تأكيد
    with platform_context():
        pub.valid_until = today - timedelta(days=1)
        pub.status = "expired"
        pub.save(update_fields=["valid_until", "status"])
    o = Client().get(f"/api/market/offers/public/{pub.id}").json()["offer"]
    assert o["expired"] is True and o["price_minor"] == "1180000"
