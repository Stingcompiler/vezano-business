"""ترقية/تخفيض من المستأجر (بأمر المالك 2026-09-22؛ 0005 §١١٢): عرض الترقية بفرق مقسَّط على
المتبقي يُدفع بإثبات `kind=upgrade` والاعتماد يغيّر الباقة فوراً بلا تمديد؛ التخفيض يُجدول عند
التجديد ويُمنع إن تجاوز الاستعمال حدود الباقة الأصغر؛ المدير لا يملك المسار."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import Branch, TenantSubscription
from core.subscription import PLANS, has_feature
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

CHANGE = "/api/org/subscription/change"
PROOFS = "/api/org/subscription/proofs"


def test_upgrade_and_downgrade(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    oh = _operator_headers("ops8", "هدى — تشغيل")
    assert (
        c.get(f"{CHANGE}?plan_code=dual", headers=_h(ctx["tokens"]["manager"])).status_code == 403
    )
    # تجريبية → لا فرق: تُدفع الباقة كاملة عند التجديد
    q = c.get(f"{CHANGE}?plan_code=dual", headers=owner).json()["quote"]
    assert q["kind"] == "renewal" and q["amount_minor"] == "0"
    # اشتراك سارٍ على «فرع واحد» بـ15 يوماً متبقية → ترقية إلى «فرعان» بفرق (85,000−45,000)×15/30
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        sub.plan_code = "single"
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() + timedelta(days=15, hours=1)
        sub.save()
    q = c.get(f"{CHANGE}?plan_code=dual", headers=owner).json()["quote"]
    assert q["kind"] == "upgrade" and q["remaining_days"] == 15
    assert q["amount_minor"] == str((8_500_000 - 4_500_000) * 15 // 30)
    assert c.get(f"{CHANGE}?plan_code=single", headers=owner).status_code == 409
    # إثبات الفرق بـkind=upgrade → المبلغ = الفرق، والاعتماد يغيّر الباقة بلا تمديد ويُصدر إيصالاً
    r = _post(c, owner, PROOFS, {"reference": "TRX-UP1", "plan_code": "dual", "kind": "upgrade"})
    assert r.status_code == 201
    pr = r.json()["proof"]
    assert pr["amount_minor"] == q["amount_minor"] and pr["cycle_label"] == "فرق ترقية"
    with tenant_context(ctx["tenant"].id):
        before = TenantSubscription.objects.get().expires_at
        assert has_feature("multi_branch") is False
    approve = f"/api/platform/proofs/{ctx['tenant'].id}/{pr['id']}/approve"
    assert _post(c, oh, approve, {}).status_code == 200
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        assert sub.plan_code == "dual" and sub.expires_at == before
        assert has_feature("multi_branch") is True
    receipts = c.get("/api/org/subscription/receipts", headers=owner).json()["receipts"]
    assert receipts[0]["plan_name"] == "فرعان" and receipts[0]["cycle_label"] == "فرق ترقية"
    # تخفيض إلى «فرع واحد»: يُمنع ما دام فرعان نشطين (المستأجر الاختباري له فرعان)، ثم يُجدول
    q = c.get(f"{CHANGE}?plan_code=single", headers=owner).json()["quote"]
    assert q["kind"] == "downgrade" and q["blocked_reasons"]
    assert _post(c, owner, CHANGE, {"plan_code": "single"}).status_code == 409
    with tenant_context(ctx["tenant"].id):
        Branch.objects.filter(is_default=False).update(is_active=False)
        # المستخدمون الثلاثة يتجاوزون حدّ «فرع واحد» (مستخدمان — 0005 §١١٤): زيادة مستخدم تسعهم
        sub = TenantSubscription.objects.get()
        sub.extra_users = 1
        sub.save(update_fields=["extra_users"])
    r = _post(c, owner, CHANGE, {"plan_code": "single"})
    assert r.status_code == 200 and r.json()["next_plan_code"] == "single"
    assert r.json()["next_plan_name"] == PLANS["single"].name
    # المستحق للتجديد صار على الباقة الأصغر، والتجديد يستهلك الجدولة
    due = c.get(PROOFS, headers=owner).json()["due"]
    assert due["plan_code"] == "single"
    r = _post(c, owner, PROOFS, {"reference": "TRX-RN1", "plan_code": "single"})
    pid = r.json()["proof"]["id"]
    assert (
        _post(c, oh, f"/api/platform/proofs/{ctx['tenant'].id}/{pid}/approve", {}).status_code
        == 200
    )
    with tenant_context(ctx["tenant"].id):
        sub = TenantSubscription.objects.get()
        assert sub.plan_code == "single" and sub.next_plan_code == ""
    # إلغاء تخفيض غير موجود
    assert _post(c, owner, CHANGE, {"cancel": True}).json()["detail"] == "nothing_to_cancel"
