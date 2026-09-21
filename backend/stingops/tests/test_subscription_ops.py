"""PLT-13 (بأمر المالك 2026-09-21): تصرّف المشغّل في اشتراك مستأجر — تمديد/تغيير باقة/إيقاف/
استئناف/ملاحظة، كلٌّ بسبب مسجَّل في الخط الزمني وفي تدقيق المستأجر؛ الإيقاف يوقف الميزات المدفوعة
ولا يحجب الدفتر ولا البيع النقدي."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import AuditEvent, TenantSubscription
from core.subscription import ensure_subscription, has_feature
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorAccessLog, SubscriptionEvent
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_operator_subscription_actions(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops2", "هدى — تشغيل")
    tid = ctx["tenant"].id
    url = f"/api/platform/tenants/{tid}/subscription"
    # المالك لا يملك المسار
    assert _post(c, _h(ctx["tokens"]["owner"]), url, {"action": "note"}).status_code == 403
    # بلا سبب: مرفوض
    r = _post(c, oh, url, {"action": "extend", "days": 30})
    assert r.status_code == 400 and r.json()["detail"] == "reason_required"
    r = _post(c, oh, url, {"action": "extend", "days": 400, "reason": "x"})
    assert r.json()["detail"] == "days_out_of_range"
    # تمديد 30 يوماً من تاريخ الانتهاء القائم
    with tenant_context(tid):
        before = ensure_subscription().expires_at
    r = _post(c, oh, url, {"action": "extend", "days": 30, "reason": "دفع نقدي في المكتب"})
    assert r.status_code == 200
    with tenant_context(tid):
        sub = TenantSubscription.objects.get()
        assert sub.expires_at == before + timedelta(days=30)
        assert AuditEvent.objects.filter(kind="subscription.extended").exists()
    t = r.json()["tenant"]
    assert t["timeline"][0]["kind"] == "extend" and t["timeline"][0]["days"] == 30
    assert t["timeline"][-1]["kind"] == "start"
    # تغيير الباقة: تجريبية → فرعان؛ الميزة تتغيّر فوراً؛ نفس الباقة مرفوض
    with tenant_context(tid):
        assert has_feature("multi_branch") is False
    r = _post(c, oh, url, {"action": "plan", "plan_code": "dual", "reason": "ترقية باتفاق"})
    assert r.status_code == 200 and r.json()["tenant"]["entitlement"]["plan_code"] == "dual"
    with tenant_context(tid):
        assert has_feature("multi_branch") is True
        assert TenantSubscription.objects.get().state == TenantSubscription.State.ACTIVE
    same = _post(c, oh, url, {"action": "plan", "plan_code": "dual", "reason": "x"})
    assert same.status_code == 409
    assert (
        _post(c, oh, url, {"action": "plan", "plan_code": "trial", "reason": "x"}).json()["detail"]
        == "trial_not_reassignable"
    )
    # الإيقاف: الميزات المدفوعة تتوقف، pos_core لا، والحالة «موقوف» في القائمة والمالك يرى السبب
    r = _post(c, oh, url, {"action": "suspend", "reason": "بلاغ احتيال قيد التحقق"})
    assert r.status_code == 200 and r.json()["tenant"]["status"] == "suspended"
    assert "بلاغ احتيال" in r.json()["tenant"]["due_line"]
    with tenant_context(tid):
        assert has_feature("multi_branch") is False and has_feature("pos_core") is True
    lst = c.get("/api/platform/tenants?filter=suspended", headers=oh).json()
    assert lst["shown"] == 1 and lst["tenants"][0]["status_label"] == "موقوف"
    exp = c.get("/api/org/subscription/expiry", headers=_h(ctx["tokens"]["owner"])).json()
    assert exp["state"] == "suspended" and exp["suspended_reason"] == "بلاغ احتيال قيد التحقق"
    assert _post(c, oh, url, {"action": "suspend", "reason": "x"}).status_code == 409
    # الاستئناف يعيد الميزات
    r = _post(c, oh, url, {"action": "resume", "reason": "انتهى التحقق — لا مخالفة"})
    assert r.status_code == 200 and r.json()["tenant"]["status"] == "active"
    with tenant_context(tid):
        assert has_feature("multi_branch") is True
    # ملاحظة في الخط الزمني فقط
    r = _post(c, oh, url, {"action": "note", "reason": "اتصل المالك بخصوص فرع ثالث"})
    assert r.status_code == 200
    kinds = [e["kind"] for e in r.json()["tenant"]["timeline"]]
    assert kinds[:5] == ["note", "resume", "suspend", "plan_change", "extend"]
    with platform_context():
        assert SubscriptionEvent.objects.filter(tenant_id=tid).count() == 5
        assert OperatorAccessLog.objects.filter(action__startswith="subscription.").count() == 5
    bogus = _post(c, oh, url, {"action": "bogus", "reason": "x"})
    assert bogus.json()["detail"] == "unknown_action"
    # الوقت لا يُلمس بالإيقاف: ما زال حتى التاريخ الممدَّد
    with tenant_context(tid):
        assert TenantSubscription.objects.get().expires_at > timezone.now() + timedelta(days=20)
