"""PLT-16 (بأمر المالك 2026-09-22): كتالوج الباقات — تعديل السعر والحدود يظهر فوراً في الصفحة
العامة وORG-06 والتحققات؛ باقة جديدة تُنشأ وتُعرض؛ الأرشفة تخفي ولا تكسر اشتراكاً قائماً؛ السعر
المقبل يحتاج 30 يوماً ثم يسري كسولاً؛ الدورة الربعية/السنوية بسعرها تمدّد بمدّتها."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import PlanCatalog, TenantSubscription
from core.subscription import PLANS
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

PLANS_URL = "/api/platform/plans"
PROOFS_URL = "/api/org/subscription/proofs"


def _plan(payload: dict[str, Any], code: str) -> dict[str, Any]:
    return next(p for p in payload["plans"] if p["code"] == code)


def test_plan_catalog_flow(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops6", "هدى — تشغيل")
    owner = _h(ctx["tokens"]["owner"])
    assert c.get(PLANS_URL, headers=owner).status_code == 403
    cat = c.get(PLANS_URL, headers=oh).json()
    assert [p["code"] for p in cat["plans"]] == ["single", "dual", "trial"]
    assert cat["plans"][0]["price_monthly_minor"] == "4500000" and "pos_core" in cat["features"]
    # تعديل السعر والحدود مع سبب → الصفحة العامة وORG-06 تريان الجديد فوراً
    edit = {
        "price_monthly_minor": 5000000,
        "price_yearly_minor": 50000000,
        "max_devices": 4,
        "reason": "تسعير 2027",
    }
    r = _post(c, oh, f"{PLANS_URL}/single/update", edit)
    assert r.status_code == 200
    single = _plan(r.json(), "single")
    assert single["price_monthly_minor"] == "5000000" and single["max_devices"] == 4
    assert r.json()["changes"][0]["changes"]["max_devices"] == {"from": 3, "to": 4}
    pub = c.get("/api/public/plans").json()
    assert _plan(pub, "single")["price_minor"] == "5000000"
    assert _plan(pub, "single")["price_yearly_minor"] == "50000000"
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert _plan(ent, "single")["price_minor"] == "5000000"
    no_core = _post(c, oh, f"{PLANS_URL}/single/update", {"features": ["advanced_reports"]})
    assert no_core.json()["detail"] == "pos_core_required"
    assert _post(c, oh, f"{PLANS_URL}/single/update", {}).json()["detail"] == "nothing_to_change"
    # باقة جديدة تُعرض بترتيبها؛ رمز مكرر مرفوض
    chain = {
        "code": "chain",
        "name": "سلسلة",
        "order": 0,
        "max_branches": 5,
        "max_devices": 15,
        "features": ["pos_core", "multi_branch"],
        "price_monthly_minor": 15000000,
        "reason": "باقة السلاسل",
    }
    assert _post(c, oh, PLANS_URL, chain).status_code == 201
    assert [p["code"] for p in c.get("/api/public/plans").json()["plans"]][0] == "chain"
    assert _post(c, oh, PLANS_URL, {"code": "chain", "name": "x"}).status_code == 409
    # الأرشفة: تختفي من العرض والدفع، ولا تكسر اشتراكاً قائماً عليها
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        sub.plan_code = "chain"
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() + timedelta(days=10)
        sub.save()
    _post(c, oh, f"{PLANS_URL}/chain/update", {"is_active": False, "reason": "توقّف"})
    assert "chain" not in [p["code"] for p in c.get("/api/public/plans").json()["plans"]]
    assert c.get("/api/org/subscription", headers=owner).json()["plan"]["name"] == "سلسلة"
    r = _post(c, owner, PROOFS_URL, {"reference": "TRX-9", "plan_code": "chain"})
    assert r.json()["detail"] == "plan_invalid"
    # الدورة السنوية بسعرها تمدّد 365 يوماً؛ دورة أُلغيت (سعر 0) مرفوضة
    _post(c, oh, f"{PLANS_URL}/single/update", {"price_quarterly_minor": 0, "reason": "بلا ربعي"})
    quarterly = {"reference": "TRX-10", "plan_code": "single", "cycle": "quarterly"}
    assert _post(c, owner, PROOFS_URL, quarterly).json()["detail"] == "cycle_invalid"
    yearly = {"reference": "TRX-11", "plan_code": "single", "cycle": "yearly"}
    r = _post(c, owner, PROOFS_URL, yearly)
    assert r.status_code == 201 and r.json()["proof"]["amount_minor"] == "50000000"
    assert r.json()["proof"]["cycle_label"] == "سنوي"
    pid = r.json()["proof"]["id"]
    with tenant_context(ctx["tenant"].id):
        before = TenantSubscription.objects.get().expires_at
    approve = f"/api/platform/proofs/{ctx['tenant'].id}/{pid}/approve"
    assert _post(c, oh, approve, {}).status_code == 200
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        assert sub.expires_at == before + timedelta(days=365) and sub.plan_code == "single"
    # السعر المقبل: أقل من 30 يوماً مرفوض؛ ثم يُجدول ويسري كسولاً حين يحين
    soon = (timezone.now() + timedelta(days=10)).isoformat()
    later = (timezone.now() + timedelta(days=31)).isoformat()
    price_url = f"{PLANS_URL}/single/price"
    r = _post(c, oh, price_url, {"monthly_minor": 6000000, "effective_at": soon})
    assert r.json()["detail"] == "notice_too_short"
    r = _post(c, oh, price_url, {"monthly_minor": 6000000, "effective_at": later, "reason": "تضخّم"})
    single = _plan(r.json(), "single")
    assert single["price_monthly_minor"] == "5000000"
    assert single["next_price"]["monthly_minor"] == "6000000"
    with platform_context():
        row = PlanCatalog.objects.get(code="single")
        row.next_price_effective_at = timezone.now() - timedelta(minutes=1)
        row.save(update_fields=["next_price_effective_at"])
    PLANS.refresh()
    assert PLANS["single"].price_minor == 6000000
    assert PLANS["single"].next_price_effective_at is None
    assert _plan(c.get("/api/public/plans").json(), "single")["price_minor"] == "6000000"
