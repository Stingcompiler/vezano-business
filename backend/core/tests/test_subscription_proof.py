"""ORG-07 (T2.5): الرفع لا يُفعِّل — «معلّق للمراجعة»؛ رقم العملية إلزامي وفريد (المكرر يعيد
الاعتماد الأول)؛ المسار البديل نصّ ثم صورة؛ الاعتماد يمدّد شهراً مرة واحدة بمرجعه؛ الرفض بسبب."""

from __future__ import annotations

import base64
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import subscription
from core.models import User
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)

IMG = base64.b64encode(b"\x89PNG fake").decode()


def _post(c: Client, h: dict[str, str], body: dict[str, Any]) -> Any:
    return c.post("/api/org/subscription/proofs", body, content_type="application/json", headers=h)


def test_submit_pending_duplicate_and_review(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    r = c.get("/api/org/subscription/proofs", headers=h)
    assert (
        r.status_code == 200
        and r.json()["proofs"] == []
        and r.json()["due"]["amount_minor"] == "4500000"
    )
    # الرقم إلزامي
    r = _post(c, h, {"reference": "  ", "plan_code": "dual"})
    assert r.status_code == 400 and r.json()["detail"] == "reference_required"
    # الرفع يسجّل معلّقاً — لا تفعيل
    with tenant_context(ctx["tenant"].id):
        before = subscription.ensure_subscription().expires_at
    r = _post(
        c,
        h,
        {
            "reference": "TRX-55712",
            "plan_code": "dual",
            "image_name": "receipt-oct.jpg",
            "image_size": 1200000,
            "image_data": IMG,
        },
    )
    assert r.status_code == 201, r.content
    proof = r.json()["proof"]
    assert (
        proof["status"] == "pending"
        and proof["has_image"] is True
        and proof["amount_minor"] == "8500000"
    )
    with tenant_context(ctx["tenant"].id):
        assert subscription.ensure_subscription().expires_at == before
        assert subscription.ensure_subscription().plan_code == "trial"
    # الإيصال نفسه ثانية → يُرفض بعرض الأول
    r = _post(c, h, {"reference": "TRX-55712", "plan_code": "dual"})
    assert r.status_code == 409 and r.json()["existing"]["id"] == proof["id"]
    # مدير الفرع لا يرفع
    assert (
        _post(c, _h(ctx["tokens"]["manager"]), {"reference": "X1", "plan_code": "dual"}).status_code
        == 403
    )
    # المراجعة: موظف منصة يعتمد → تمديد 30 يوماً بالباقة الجديدة، مرة واحدة
    with platform_context():
        staff = User.unscoped.create(
            tenant=None, username="plt", display_name="مراجع المنصة", is_platform_staff=True
        )
    # موظف المنصة يستعمل جلسة حساب بلا جهاز (تخويل الفرع ليس مطلوباً للمراجعة)
    from core.auth.tokens import issue_session_tokens

    with platform_context():
        _s, refresh = issue_session_tokens(staff)
    sh = {"Authorization": f"Bearer {refresh.access_token}"}
    url = f"/api/platform/tenants/{ctx['tenant'].id}/subscription-proofs/{proof['id']}/review"
    assert (
        c.post(url, {"decision": "reject"}, content_type="application/json", headers=sh).json()[
            "detail"
        ]
        == "reason_required"
    )
    r = c.post(url, {"decision": "approve"}, content_type="application/json", headers=sh)
    assert r.status_code == 200, r.content
    assert r.json()["proof"]["status"] == "approved" and r.json()["proof"]["extension_days"] == 30
    with tenant_context(ctx["tenant"].id):
        sub = subscription.ensure_subscription()
        assert sub.plan_code == "dual" and sub.state == "active"
        assert (sub.expires_at - timezone.now()) > timedelta(days=55)  # 30 القائمة + 30 التمديد
    # لا شهر إضافي بالخطأ
    r = c.post(url, {"decision": "approve"}, content_type="application/json", headers=sh)
    assert r.status_code == 400 and r.json()["detail"] == "already_reviewed"
    # المالك لا يراجع
    assert (
        c.post(url, {"decision": "approve"}, content_type="application/json", headers=h).status_code
        == 403
    )


def test_text_first_then_image_and_rejection(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    r = _post(c, h, {"reference": "TRX-9", "plan_code": "single", "note": "تحويل 2026-09-19"})
    assert r.status_code == 201 and r.json()["proof"]["has_image"] is False
    pid = r.json()["proof"]["id"]
    r = c.post(
        f"/api/org/subscription/proofs/{pid}/image",
        {"image_name": "r.jpg", "image_size": 3 * 1024 * 1024, "image_data": IMG},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "image_too_large"
    r = c.post(
        f"/api/org/subscription/proofs/{pid}/image",
        {"image_name": "r.jpg", "image_size": 900, "image_data": IMG},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200 and r.json()["proof"]["has_image"] is True
    with platform_context():
        staff = User.unscoped.create(
            tenant=None, username="plt2", display_name="مراجع", is_platform_staff=True
        )
    from core.auth.tokens import issue_session_tokens

    with platform_context():
        _s, refresh = issue_session_tokens(staff)
    sh = {"Authorization": f"Bearer {refresh.access_token}"}
    r = c.post(
        f"/api/platform/tenants/{ctx['tenant'].id}/subscription-proofs/{pid}/review",
        {"decision": "reject", "reason": "فرق مبلغ"},
        content_type="application/json",
        headers=sh,
    )
    assert r.status_code == 200 and r.json()["proof"]["status"] == "rejected"
    assert r.json()["proof"]["rejection_reason"] == "فرق مبلغ"
    with tenant_context(ctx["tenant"].id):
        assert subscription.ensure_subscription().plan_code == "trial"
