"""الإضافات المدفوعة (0005 §١١٦): عرض بسعر الوحدة مقسَّطاً على المتبقي، يُدفع بإثبات `kind=addon`،
الاعتماد يرفع الحدّ بلا تمديد ويُصدر إيصالاً «إضافة»، والمستحق للتجديد يشمل الإضافات؛ التخفيض
فوري بلا ردّ مال ويُمنع إن تجاوز الاستعمال؛ التجريبية لا تشتري إضافات."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import subscription
from core.models import TenantSubscription
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

ADDON = "/api/org/subscription/addon"
PROOFS = "/api/org/subscription/proofs"


def test_buy_and_reduce_device_addon(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    assert (
        c.get(f"{ADDON}?kind=devices&qty=1", headers=_h(ctx["tokens"]["manager"])).status_code
        == 403
    )
    # التجريبية لا تشتري إضافات
    r = c.get(f"{ADDON}?kind=devices&qty=1", headers=owner)
    assert r.status_code == 409 and r.json()["detail"] == "paid_plan_required"
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        sub.plan_code = "single"
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() + timedelta(days=15, hours=1)
        sub.save()
        assert subscription.can_register_device() == (False, "device_limit")
    assert c.get(f"{ADDON}?kind=nope&qty=1", headers=owner).json()["detail"] == "addon_invalid"
    assert c.get(f"{ADDON}?kind=devices&qty=0", headers=owner).json()["detail"] == "qty_invalid"
    q = c.get(f"{ADDON}?kind=devices&qty=2", headers=owner).json()["quote"]
    unit = subscription.PLANS["single"].addon_device_minor
    assert q["remaining_days"] == 15 and q["amount_minor"] == str(unit * 2 * 15 // 30)
    assert q["renewal_monthly_minor"] == str(unit * 2)
    r = _post(
        c,
        owner,
        PROOFS,
        {
            "reference": "TRX-AD1",
            "plan_code": "single",
            "kind": "addon",
            "addon_kind": "devices",
            "addon_qty": 2,
        },
    )
    assert r.status_code == 201, r.content
    pr = r.json()["proof"]
    assert pr["amount_minor"] == q["amount_minor"] and pr["cycle_label"] == "إضافة"
    assert pr["addon_kind"] == "devices" and pr["addon_qty"] == 2
    with tenant_context(ctx["tenant"].id):
        before = TenantSubscription.objects.get().expires_at
    oh = _operator_headers("ops9", "هدى — تشغيل")
    assert (
        _post(c, oh, f"/api/platform/proofs/{ctx['tenant'].id}/{pr['id']}/approve", {}).status_code
        == 200
    )
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        assert sub.addon_devices == 2 and sub.expires_at == before
        assert subscription.effective_limits(sub)["devices"] == 5
        assert subscription.can_register_device() == (True, "")
    receipts = c.get("/api/org/subscription/receipts", headers=owner).json()["receipts"]
    assert receipts[0]["cycle_label"] == "إضافة" and receipts[0]["cycle"] == "addon"
    # المستحق للتجديد = الباقة + الإضافات × أشهر الدورة
    due = c.get(PROOFS, headers=owner).json()["due"]
    price = subscription.PLANS["single"].price_minor
    assert due["amount_minor"] == str(price + unit * 2)
    assert due["addons_amount_minor"] == str(unit * 2)
    quarterly = next(x for x in due["cycles"] if x["cycle"] == "quarterly")
    assert quarterly["amount_minor"] == str(
        subscription.PLANS["single"].price_quarterly_minor + unit * 2 * 3
    )
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert ent["limits"]["devices"] == {"used": 3, "max": 5, "extra": 0, "addon": 2}
    dev = next(a for a in ent["addons"] if a["kind"] == "devices")
    assert dev["qty"] == 2 and dev["unit_monthly_minor"] == str(unit)
    assert ent["can_buy_addons"] is True
    # المدير يرى الكمية بلا أسعار
    m = c.get("/api/org/subscription", headers=_h(ctx["tokens"]["manager"])).json()
    assert next(a for a in m["addons"] if a["kind"] == "devices")["unit_monthly_minor"] is None
    # التخفيض: 3 أجهزة نشطة على حدّ 3 بعد سحب إضافتين — يُسمح بإضافة واحدة ثم يُمنع الثانية؟
    # 3 نشطة ≤ 3+2−2 = 3 → يُسمح بسحب الاثنتين
    r = _post(c, owner, ADDON, {"kind": "devices", "qty": 3})
    assert r.status_code == 400 and r.json()["detail"] == "qty_invalid"
    r = _post(c, owner, ADDON, {"kind": "devices", "qty": 2})
    assert r.status_code == 200 and r.json()["limits"]["devices"]["max"] == 3
    # إضافة مستخدم ثم محاولة تخفيضها والمستخدمون الثلاثة يتجاوزون حدّ «فرع واحد» (2)
    with tenant_context(ctx["tenant"].id):
        TenantSubscription.objects.update(addon_users=1)
    r = _post(c, owner, ADDON, {"kind": "users", "qty": 1})
    assert r.status_code == 409 and r.json()["detail"] == "limits_exceeded"


def test_addon_not_offered_and_expired(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    with tenant_context(ctx["tenant"].id):
        sub = subscription.ensure_subscription()
        sub.plan_code = "single"
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() - timedelta(days=2)
        sub.save()
    assert (
        c.get(f"{ADDON}?kind=users&qty=1", headers=owner).json()["detail"] == "paid_plan_required"
    )
    from core.models import PlanCatalog
    from core.tenancy import platform_context

    with platform_context():
        PlanCatalog.objects.filter(code="single").update(addon_user_minor=0)
    subscription.PLANS.refresh()
    with tenant_context(ctx["tenant"].id):
        TenantSubscription.objects.update(expires_at=timezone.now() + timedelta(days=10))
    assert c.get(f"{ADDON}?kind=users&qty=1", headers=owner).json()["detail"] == "addon_not_offered"
    # إثبات إضافة غير معروضة يُرفض
    r = _post(
        c,
        owner,
        PROOFS,
        {
            "reference": "TRX-AD2",
            "plan_code": "single",
            "kind": "addon",
            "addon_kind": "users",
            "addon_qty": 1,
        },
    )
    assert r.status_code == 400
