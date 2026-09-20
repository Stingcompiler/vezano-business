"""PLT-01/PLT-02 (T3.18): حساب مشغّل منفصل بتحقّق ثنائي دائماً — لا دخول بنصف تحقّق، وحساب مالك
متجر لا يترقّى؛ قائمة المستأجرين بلا دفاتر (ACC-60 · ACC-62) وكل فتح سجل يُدقَّق؛ وصول الدعم
بتذكرة من المالك."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.auth import totp
from core.auth.accounts import create_account
from core.models import User
from core.tenancy import platform_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorAccessLog
from stingops.services import ensure_operator

pytestmark = pytest.mark.django_db(transaction=True)


def test_operator_login_and_tenants(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    acc = create_account("ops.tayeb@sting.internal", "very-secret-ops", "طيب")
    with platform_context():
        op = User.unscoped.create(
            tenant=None,
            username="ops",
            display_name="طيب — تشغيل",
            is_platform_staff=True,
            account=acc,
        )
        prof = ensure_operator(op)
    login = "/api/platform/login"
    # بيانات ناقصة/خاطئة: رسالة موحّدة لا تلمّح إلى وجود الحساب
    r = _post(c, {}, login, {"email": "x@y.z", "password": "p", "otp": "123456"})
    assert r.status_code == 400 and r.json()["detail"] == "invalid_credentials"
    # صحيحان بلا رمز ثنائي — لا دخول بنصف تحقّق
    r = _post(c, {}, login, {"email": "ops.tayeb@sting.internal", "password": "very-secret-ops"})
    assert r.status_code == 400 and r.json()["detail"] == "otp_required"
    r = _post(
        c,
        {},
        login,
        {"email": "ops.tayeb@sting.internal", "password": "very-secret-ops", "otp": "000000"},
    )
    assert r.status_code == 400 and r.json()["detail"] == "otp_invalid"
    code = totp.code_at(prof.totp_secret)
    r = _post(
        c,
        {},
        login,
        {"email": "ops.tayeb@sting.internal", "password": "very-secret-ops", "otp": code},
    )
    assert r.status_code == 200 and r.json()["display_name"] == "طيب — تشغيل"
    oh = {"Authorization": f"Bearer {r.json()['access']}"}
    # حساب مالك متجر: بيانات صحيحة لكنه ليس مشغّلاً → permission_denied
    owner_account = create_account("owner@example.com", "owner-pass-1", "مالك")
    with platform_context():
        owner = User.unscoped.get(id=ctx["users"]["owner"].id)
        owner.account = owner_account
        owner.save(update_fields=["account"])
    r = _post(
        c, {}, login, {"email": "owner@example.com", "password": "owner-pass-1", "otp": "123456"}
    )
    assert r.status_code == 403 and r.json()["detail"] == "tenant_account"
    # PLT-02: المستأجرون بحقول تشغيل وفوترة فقط؛ المالك لا يفتحها
    h = _h(ctx["tokens"]["owner"])
    assert c.get("/api/platform/tenants", headers=h).status_code == 403
    lst = c.get("/api/platform/tenants", headers=oh).json()
    assert lst["total"] >= 1 and lst["access_rule"].startswith("قراءة بيانات مستأجر")
    row = next(t for t in lst["tenants"] if t["id"] == str(ctx["tenant"].id))
    assert set(row) >= {
        "plan_label",
        "due_line",
        "devices",
        "technical",
        "status_label",
        "support_access",
        "actions",
    }
    for forbidden in ("sales", "revenue", "customers", "receivable", "items"):
        assert forbidden not in row
    assert row["support_access"] == "لا وصول فعّال"
    assert "دخول كالمالك" not in row["actions"]
    # مرشّح لا يطابق: يقول ما فُحص
    empty = c.get("/api/platform/tenants?filter=sync_stuck", headers=oh).json()
    assert empty["shown"] == 0 and empty["total"] >= 1
    # التفاصيل تُدقَّق؛ وصول الدعم بتذكرة من المالك يظهر فيها
    r = _post(
        c,
        h,
        "/api/org/support-access",
        {"ticket_ref": "SUP-771", "reason": "خلل مزامنة جهاز الكاشير", "hours": 48},
    )
    assert r.status_code == 201 and r.json()["grant"]["ticket_ref"] == "SUP-771"
    assert (
        _post(
            c,
            _h(ctx["tokens"]["manager"]),
            "/api/org/support-access",
            {"ticket_ref": "x", "reason": "y"},
        ).status_code
        == 403
    )
    d = c.get(f"/api/platform/tenants/{ctx['tenant'].id}", headers=oh).json()["tenant"]
    assert d["support_access"] == "مصرَّح 48 ساعة · تذكرة SUP-771"
    assert d["support_grants"][0]["active"] is True and d["entitlement"]["plan_code"]
    assert "لا زر «دخول كالمالك»." in d["limits"]
    assert "sales" not in d and "customers" not in d
    with platform_context():
        assert (
            OperatorAccessLog.objects.filter(action="tenant_detail", tenant=ctx["tenant"]).count()
            == 1
        )
        assert OperatorAccessLog.objects.filter(action="login").count() == 1
