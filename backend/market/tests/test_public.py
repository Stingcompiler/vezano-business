"""MP-01/MP-02 (T3.6): السوق العام بلا حساب — الموردون الناشرون في المنطقة وعروضهم العامة المؤكَّدة
وحدها (لا خاص ولا منتهٍ ولا مسودة)، لا عنوان ولا هاتف ولا رصيد؛ منطقة بلا موردين فارغة صادقة؛
الدليل بالمنطقة والفئة مع عدّ البدائل."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.tenancy import platform_context
from market.models import MarketAccount, MarketOffer, MarketProfile

pytestmark = pytest.mark.django_db(transaction=True)


def test_public_market_home_and_directory(two_tenants: TwoTenants) -> None:
    today = timezone.localdate()
    with platform_context():
        MarketAccount.unscoped.create(tenant=two_tenants.a, verification="verified", role="both")
        MarketProfile.unscoped.create(
            tenant=two_tenants.a,
            public_name="مخزن البركة للجملة — تجريبي",
            published={
                "public_name": "مخزن البركة للجملة — تجريبي",
                "category_line": "جملة",
                "categories": ["سكر", "شاي"],
                "service_areas": ["الخرطوم بحري", "الخرطوم"],
                "fulfilment": ["توصيل بحدّ أدنى", "استلام من المخزن"],
            },
            published_at=timezone.now(),
        )
        # منشأة ب: منشورة في أم درمان بلا شارة
        MarketProfile.unscoped.create(
            tenant=two_tenants.b,
            public_name="مستودع الشرق — تجريبي",
            published={
                "public_name": "مستودع الشرق — تجريبي",
                "category_line": "تجارة عامة",
                "categories": ["دقيق", "أرز"],
                "service_areas": ["أم درمان"],
                "fulfilment": ["استلام فقط"],
            },
            published_at=timezone.now(),
        )

        def mk(**kw: Any) -> None:
            MarketOffer.unscoped.create(
                tenant=two_tenants.a,
                unit_name="كرتونة",
                pack_label="كرتونة 12×1كغ",
                status="published",
                valid_until=today + timedelta(days=3),
                **kw,
            )

        mk(public_name="سكر أبيض", price_minor=1180000, audience="public")
        mk(public_name="شاي أسود", price_minor=None, audience="public")
        mk(public_name="زيت خاص", price_minor=900000, audience="private")
        MarketOffer.unscoped.create(
            tenant=two_tenants.a,
            public_name="منتهٍ",
            unit_name="كرتونة",
            status="published",
            audience="public",
            price_minor=1,
            valid_until=today - timedelta(days=1),
        )
        MarketOffer.unscoped.create(tenant=two_tenants.a, public_name="مسودة", status="draft")
    c = Client()
    h = c.get("/api/public/market?area=الخرطوم بحري").json()
    assert h["suppliers_count"] == 1 and h["suppliers"][0]["badge_label"] == "موثَّقة المستندات"
    assert h["offers_count"] == 2 and h["suppliers"][0]["offers_count"] == 2
    names = sorted(o["public_name"] for u in h["offers_by_unit"] for o in u["offers"])
    assert names == ["سكر أبيض", "شاي أسود"]
    tea = next(
        o for u in h["offers_by_unit"] for o in u["offers"] if o["public_name"] == "شاي أسود"
    )
    assert tea["price_minor"] == "" and tea["price_line"] == "اطلب سعراً"
    assert "address" not in str(h) and "phone" not in str(h) and "زيت خاص" not in str(h)
    assert {a["name"] for a in h["areas"]} == {"الخرطوم بحري", "الخرطوم", "أم درمان"}
    # منطقة بلا موردين: فارغ صادق
    e = c.get("/api/public/market?area=سنّار").json()
    assert e["suppliers"] == [] and e["offers_count"] == 0 and len(e["areas"]) == 3
    # البحث بالاسم
    assert c.get("/api/public/market?q=سكر").json()["offers_count"] == 1
    # الدليل بالمنطقة والفئة مع البدائل
    d = c.get("/api/public/market/directory?area=أم درمان&category=سكر").json()
    assert d["total"] == 0 and d["alternatives"] == {
        "all_areas": 1,
        "all_categories": 1,
        "everything": 2,
    }
    d = c.get("/api/public/market/directory").json()
    assert d["total"] == 2
    assert {x["badge_label"] for x in d["suppliers"]} == {"موثَّقة المستندات", "بلا شارة"}
    assert len(d["categories"]) == 4
    assert "tenant_a" not in str(d)
