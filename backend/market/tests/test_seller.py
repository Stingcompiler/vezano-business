"""MP-08/MP-09 (T3.3): حساب واحد ودفتر واحد — دور البائع بطلب تحقق منفصل يراجعه مشرف السوق؛
النقص مسمّى حقلاً حقلاً؛ التفعيل لا ينشر شيئاً؛ الصفحة العامة من المنشور لا من المسوّدة وبالحقول
المصرّح بها فقط؛ بلا منطقة خدمة لا نشر؛ المدير لا يحرّر هوية المنشأة."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.models import User
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401
from market import services
from market.models import MarketAccount

pytestmark = pytest.mark.django_db(transaction=True)


def _put(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.put(path, body, content_type="application/json", headers=h)


def test_seller_verification_and_profile(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hm = _h(ctx["tokens"]["manager"])
    # القائمة: الهوية مكتملة من تحقق الشراء؛ الباقي ناقص
    a = c.get("/api/market/account", headers=h).json()["account"]
    assert a["role"] == "buyer" and a["verification"] == "none" and a["done"] == 1
    assert a["total"] == 4 and a["can_submit"] is True
    # التقديم قبل الاكتمال: النقص مسمّى
    r = c.post("/api/market/account/verification/submit", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "checklist_incomplete"
    assert r.json()["extra"]["missing"] == ["service_area", "terms", "registry_doc"]
    # المدير لا يقدّم
    assert _put(c, hm, "/api/market/account", {"business_address": "x"}).status_code == 403
    # إكمال ثلاثة من أربعة ثم الرابع
    r = _put(
        c,
        h,
        "/api/market/account",
        {
            "business_address": "الخرطوم بحري",
            "service_area_note": "استلام من المخزن وتوصيل داخل المنطقة",
            "accept_terms": True,
        },
    )
    assert r.status_code == 200 and r.json()["account"]["done"] == 3
    assert r.json()["account"]["verification"] == "draft"
    r = _put(
        c,
        h,
        "/api/market/account",
        {"registry_doc": {"name": "registry.jpg", "data_url": "data:image/jpeg;base64,AAAA"}},
    )
    assert r.json()["account"]["done"] == 4
    r = c.post("/api/market/account/verification/submit", headers=h)
    assert r.status_code == 200 and r.json()["account"]["verification"] == "pending"
    assert r.json()["account"]["days_since_submitted"] == 0
    # المشرف: أدلة ناقصة بسبب مسمّى → يعود للمالك حقلاً حقلاً
    with platform_context():
        staff = User.unscoped.create(
            tenant=None, username="plt", display_name="مشرف السوق", is_platform_staff=True
        )
    from core.auth.tokens import issue_session_tokens

    with platform_context():
        _s, refresh = issue_session_tokens(staff)
    sh = {"Authorization": f"Bearer {refresh.access_token}"}
    url = f"/api/platform/tenants/{ctx['tenant'].id}/market-verification/review"
    r = c.post(url, {"decision": "needs_more"}, content_type="application/json", headers=sh)
    assert r.status_code == 400 and r.json()["detail"] == "reasons_required"
    r = c.post(
        url,
        {"decision": "needs_more", "reasons": {"registry_doc": "سجل تجاري غير مقروء"}},
        content_type="application/json",
        headers=sh,
    )
    assert r.status_code == 200 and r.json()["verification"] == "needs_more"
    a = c.get("/api/market/account", headers=h).json()["account"]
    doc = next(i for i in a["checklist"] if i["key"] == "registry_doc")
    assert doc["reason"] == "سجل تجاري غير مقروء"
    # إعادة الرفع والتقديم ثم الاعتماد: دور البائع فُعِّل ولم يُنشر شيء
    _put(
        c,
        h,
        "/api/market/account",
        {"registry_doc": {"name": "r2.jpg", "data_url": "data:image/jpeg;base64,BBBB"}},
    )
    assert (
        c.post("/api/market/account/verification/submit", headers=h).json()["account"][
            "verification"
        ]
        == "pending"
    )
    r = c.post(url, {"decision": "verified"}, content_type="application/json", headers=sh)
    assert r.status_code == 200 and r.json()["verification"] == "verified"
    a = c.get("/api/market/account", headers=h).json()["account"]
    assert a["role"] == "both"
    p = c.get("/api/market/profile", headers=h).json()["profile"]
    assert p["public"]["is_published"] is False and p["public"]["verified"] is True
    # MP-09: المسوّدة تُحفظ بلا منطقة؛ النشر يرفضها بالعاقبة
    r = _put(
        c,
        h,
        "/api/market/profile",
        {
            "public_name": "مخزن البركة للجملة — تجريبي",
            "category_line": "جملة مواد غذائية",
            "categories": "سكر · شاي · زيوت · دقيق",
        },
    )
    assert r.status_code == 200 and r.json()["profile"]["draft"]["categories"] == [
        "سكر",
        "شاي",
        "زيوت",
        "دقيق",
    ]
    assert r.json()["profile"]["public"]["is_published"] is False
    r = _put(c, h, "/api/market/profile", {"publish": True})
    assert r.status_code == 400 and r.json()["detail"] == "service_areas_required"
    r = _put(
        c,
        h,
        "/api/market/profile",
        {
            "service_areas": ["الخرطوم بحري", "الخرطوم"],
            "fulfilment": ["توصيل بحدّ أدنى 50,000 SDG", "استلام من المخزن بموعد"],
            "publish": True,
        },
    )
    assert r.status_code == 200
    pub = r.json()["profile"]["public"]
    assert pub["is_published"] is True and pub["service_areas"] == ["الخرطوم بحري", "الخرطوم"]
    assert pub["badge_label"] == "منشأة موثَّقة المستندات"
    assert "التوثيق لا يشمل جودة السلع" in pub["badge_note"]
    assert "address" not in pub and "phone" not in pub
    # تعديل المسوّدة بعد النشر لا يغيّر المنشور حتى يُنشر
    r = _put(c, h, "/api/market/profile", {"public_name": "اسم جديد"})
    assert r.json()["profile"]["draft"]["public_name"] == "اسم جديد"
    assert r.json()["profile"]["public"]["public_name"] == "مخزن البركة للجملة — تجريبي"
    # المدير يرى ولا يحرّر
    r = c.get("/api/market/profile", headers=hm)
    assert r.status_code == 200 and r.json()["profile"]["can_edit"] is False
    assert _put(c, hm, "/api/market/profile", {"public_name": "x"}).status_code == 403
    with tenant_context(ctx["tenant"].id):
        assert services.is_verified_seller() is True
        assert MarketAccount.objects.count() == 1
