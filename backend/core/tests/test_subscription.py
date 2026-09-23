"""ORG-06/08 (T2.4): الحالة من الخادم دائماً؛ المبالغ للمالك لا لمدير الفرع؛ الحدود أرقام صريحة
وبلوغها يمنع جهازاً جديداً لا البيع؛ الانتهاء لا يحجب الدفتر (G-08) ويتدرّج الحجب (§١١.٢)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import subscription
from core.models import Device, TenantSubscription
from core.tenancy import tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def test_entitlements_and_amount_visibility(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    r = c.get("/api/org/subscription", headers=_h(ctx["tokens"]["owner"]))
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["plan"]["code"] == "trial" and p["plan"]["state"] == "trial"
    assert p["plan"]["price_minor"] == "0" and p["can_see_amounts"] is True
    assert p["limits"]["devices"] == {"used": 3, "max": 3, "extra": 0, "addon": 0}
    # حدّ المستخدمين من الكتالوج (0005 §١١٤): التجريبية كالفرع الواحد — مستخدمان
    assert p["limits"]["branches"]["max"] == 1 and p["limits"]["users"]["max"] == 2
    codes = [f["code"] for f in p["features"]]
    assert codes[0] == "pos_core" and p["features"][0]["status"] == "open"
    assert next(f for f in p["features"] if f["code"] == "supplier_analytics")["status"] == "locked"
    assert [x["code"] for x in p["plans"]] == ["single", "dual", "trial"]
    assert p["if_expired"]["continues"][0] == "البيع كاملاً — نقدي وآجل ومختلط"
    # مدير الفرع: الحدود والميزات بلا مبالغ
    m = c.get("/api/org/subscription", headers=_h(ctx["tokens"]["manager"])).json()
    assert m["can_see_amounts"] is False and m["plan"]["price_minor"] is None
    assert m["limits"]["devices"]["max"] == 3
    # الكاشير لا يفتح الاشتراك
    assert c.get("/api/org/subscription", headers=_h(ctx["tokens"]["cashier"])).status_code == 403


def test_device_limit_blocks_registration_not_selling(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    with tenant_context(ctx["tenant"].id):
        allowed, why = subscription.can_register_device()
        assert (allowed, why) == (False, "device_limit")  # 3 أجهزة على باقة 3
        # سحب جهاز يفتح مقعداً
        Device.objects.filter(id=ctx["device_ids"]["cashier"]).update(status="revoked")
        assert subscription.can_register_device() == (True, "")
    r = c.get("/api/org/devices", headers=_h(ctx["tokens"]["owner"]))
    assert r.json()["device_limit"] == 3
    # فرع ثانٍ على باقة فرع واحد
    r = c.post(
        "/api/org/branches",
        {"name": "فرع ثانٍ", "code": "SEC"},
        content_type="application/json",
        headers=_h(ctx["tokens"]["owner"]),
    )
    assert r.status_code == 400 and r.json()["detail"] == "branch_limit"


def test_expiry_grace_and_stops(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _h(ctx["tokens"]["owner"])
    with tenant_context(ctx["tenant"].id):
        sub = subscription.ensure_subscription()
        sub.plan_code = "dual"
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() - timedelta(days=3)
        sub.save()
        assert subscription.status_of(sub) == "grace"
        assert subscription.has_feature("campaigns") is True  # سماح 0–14 يوماً
        assert subscription.has_feature("pos_core") is True
        sub.expires_at = timezone.now() - timedelta(days=20)
        sub.save()
        assert subscription.status_of(sub) == "expired"
        assert subscription.has_feature("campaigns") is False
        assert subscription.has_feature("advanced_reports") is False
        assert subscription.has_feature("pos_core") is True  # الأساسي لا يتوقف بحال
        assert subscription.can_register_device() == (True, "")  # قبل اليوم 31 يُسمح
        sub.expires_at = timezone.now() - timedelta(days=40)
        sub.save()
        assert subscription.can_register_device() == (False, "subscription_expired")
    r = c.get("/api/org/subscription/expiry", headers=oh)
    assert r.status_code == 200 and r.json()["expired"] is True and r.json()["state"] == "expired"
    assert r.json()["days_since_expiry"] == 40 and r.json()["can_renew"] is True
    assert (
        "الحملات والإرسال" in r.json()["stops"]
        and "تصدير نسخة محلية كاملة" in r.json()["continues"]
    )
    # الموظف يرى القائمة بلا تجديد
    e = c.get("/api/org/subscription/expiry", headers=_h(ctx["tokens"]["cashier"])).json()
    assert e["can_renew"] is False and e["expired"] is True
    # البيع لا يتوقف: PUSH يعمل — يُثبت في البوابة (T2.17)؛ هنا المدخل المركزي وحده


def test_scenario_endpoint_sets_subscription() -> None:
    from core.scenario.seed import FIXED, reset_scenario

    reset_scenario()
    c = Client()
    r = c.post(
        "/api/scenario/subscription",
        {"state": "expired", "days_since_expiry": 20, "plan_code": "dual"},
        content_type="application/json",
    )
    assert r.status_code == 200, r.content
    with tenant_context(FIXED["tenant_a"]):
        sub = subscription.ensure_subscription()
        assert sub.plan_code == "dual" and subscription.status_of(sub) == "expired"
