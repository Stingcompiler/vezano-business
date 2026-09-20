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


def _operator_headers(username: str, name: str) -> dict[str, str]:
    from core.auth.tokens import issue_session_tokens

    with platform_context():
        op = User.unscoped.create(
            tenant=None, username=username, display_name=name, is_platform_staff=True
        )
        ensure_operator(op)
        _s, rt = issue_session_tokens(op)
    return {"Authorization": f"Bearer {rt.access_token}"}


def test_proof_review_claims_and_announcements(ctx: dict[str, Any]) -> None:  # noqa: F811
    """PLT-03: الحجز 15 دقيقة باسم الزميل، رقم العملية يُفحص قبل الاعتماد، الاعتماد مرة واحدة،
    الرفض بسبب؛ PLT-04: الجمهور قبل الجدولة، لا وعد بميزة خارج الباقة (ACC-104)، الجدولة تُسجَّل
    ولا تُرسل، والإلغاء باسم من نفّذه، وPUB-03 يقرأ النافذة."""
    from datetime import timedelta

    from django.utils import timezone

    c, h = Client(), _h(ctx["tokens"]["owner"])
    oh1 = _operator_headers("op1", "م. الطيب")
    oh2 = _operator_headers("op2", "سارة")
    # إيصالان للمستأجر: الأول يُعتمد؛ الثاني بنفس المرجع يُرفض قبل الاعتماد
    r = _post(c, h, "/api/org/subscription/proofs", {"reference": "TRX-55712", "plan_code": "dual"})
    assert r.status_code == 201, r.json()
    pid = r.json()["proof"]["id"]
    tid = str(ctx["tenant"].id)
    lst = c.get("/api/platform/proofs", headers=oh1).json()
    assert lst["pending_count"] == 1 and lst["claim_minutes"] == 15
    row = lst["proofs"][0]
    assert row["tenant_name"] == ctx["tenant"].name and row["reference"] == "TRX-55712"
    assert row["claim"] is None and row["reference_used"] is None
    assert c.get("/api/platform/proofs", headers=h).status_code == 403
    base = f"/api/platform/proofs/{tid}/{pid}"
    # الطيب يفتحها → محجوزة له؛ سارة ترى الاسم ولا تعتمد (تعارض) وتطلب التسليم
    r = _post(c, oh1, f"{base}/open")
    assert r.status_code == 200 and r.json()["proof"]["claim"]["mine"] is True
    r = _post(c, oh2, f"{base}/open")
    assert r.json()["proof"]["claim"]["by_name"] == "م. الطيب"
    assert r.json()["proof"]["claim"]["mine"] is False
    r = _post(c, oh2, f"{base}/approve")
    assert r.status_code == 409 and r.json()["detail"] == "claimed_by_other"
    assert r.json()["extra"]["by_name"] == "م. الطيب"
    r = _post(c, oh2, f"{base}/handover")
    assert r.status_code == 200 and r.json()["proof"]["claim"]["handover_requested"] is True
    # الرفض بلا سبب مرفوض؛ الاعتماد مرة واحدة
    assert _post(c, oh1, f"{base}/reject", {"reason": ""}).json()["detail"] == "reason_required"
    r = _post(c, oh1, f"{base}/approve")
    assert r.status_code == 200 and r.json()["proof"]["status"] == "approved"
    assert _post(c, oh1, f"{base}/approve").status_code == 409
    # إيصال ثانٍ بنفس المرجع (بعد أن صار السابق معتمداً) → reference_used قبل الاعتماد
    r = _post(c, h, "/api/org/subscription/proofs", {"reference": "TRX-55712", "plan_code": "dual"})
    assert r.status_code == 409  # المستأجر نفسه يُمنع من إعادة الرفع بالمرجع نفسه
    # مستأجر آخر يرفع المرجع نفسه: المراجع يرى أنها مستهلكة بلا اسم المستأجر الآخر
    from conftest import TwoTenants  # noqa: F401
    from core.models import Tenant, TenantSubscription
    from core.subscription import PLANS

    with platform_context():
        t2 = Tenant.unscoped.create(name="متجر ثانٍ", base_currency="SDG", base_currency_exponent=2)
        TenantSubscription.unscoped.create(
            tenant=t2,
            plan_code="single",
            state="active",
            expires_at=timezone.now() + timedelta(days=5),
            renewal_amount_minor=PLANS["single"].price_minor,
        )
        from core.models import SubscriptionProof

        p2 = SubscriptionProof.unscoped.create(
            tenant=t2,
            reference="TRX-55712",
            plan_code="single",
            amount_minor=PLANS["single"].price_minor,
            submitted_by_name="مالك ثانٍ",
        )
    row2 = next(
        p
        for p in c.get("/api/platform/proofs", headers=oh1).json()["proofs"]
        if p["id"] == str(p2.id)
    )
    assert (
        row2["reference_used"]["same_tenant"] is False
        and row2["reference_used"]["tenant_name"] == ""
    )
    r = _post(c, oh1, f"/api/platform/proofs/{t2.id}/{p2.id}/approve")
    assert r.status_code == 400 and r.json()["detail"] == "reference_used"
    r = _post(
        c,
        oh1,
        f"/api/platform/proofs/{t2.id}/{p2.id}/reject",
        {"reason": "رقم العملية مستعمل سابقاً"},
    )
    assert r.status_code == 200 and r.json()["proof"]["status"] == "rejected"
    # PLT-04: الجمهور قبل الجدولة؛ وعد بميزة سوق لكل المتاجر يُمنع؛ الجدولة تُسجَّل؛ PUB-03 يقرأ
    pv = _post(
        c,
        oh1,
        "/api/platform/announcements/preview",
        {"audience": "all", "body": "ميزة سوق مميّزة جديدة", "kind": "notice"},
    ).json()
    assert pv["promise_outside_plan"] is True and pv["targeted"] >= 2
    assert [s["label"] for s in pv["segments"]][0] == "متاجر ذات مزامنة سوق فعّالة"
    starts = (timezone.now() + timedelta(hours=6)).isoformat()
    ends = (timezone.now() + timedelta(hours=6, minutes=40)).isoformat()
    r = _post(
        c,
        oh1,
        "/api/platform/announcements",
        {
            "title": "صيانة مزامنة السوق — الجمعة 03:00–03:40",
            "body": "قد يتأخّر ظهور عروض السوق نحو 40 دقيقة.",
            "audience": "all",
            "starts_at": starts,
            "ends_at": ends,
        },
    )
    assert r.status_code == 200 and r.json()["announcement"]["status"] == "draft"
    aid = r.json()["announcement"]["id"]
    r = _post(c, oh1, f"/api/platform/announcements/{aid}/schedule")
    assert r.status_code == 400 and r.json()["detail"] == "promise_outside_plan"
    r = _post(
        c,
        oh1,
        "/api/platform/announcements",
        {
            "id": aid,
            "title": "صيانة مزامنة السوق — الجمعة 03:00–03:40",
            "body": "قد يتأخّر ظهور عروض السوق نحو 40 دقيقة.",
            "audience": "market",
            "starts_at": starts,
            "ends_at": ends,
        },
    )
    assert r.json()["announcement"]["audience"] == "market"
    r = _post(c, oh1, f"/api/platform/announcements/{aid}/schedule")
    assert r.status_code == 200 and r.json()["announcement"]["status"] == "scheduled"
    assert r.json()["announcement"]["audience_count"] == pv["segments"][0]["count"]
    st = Client().get("/api/public/status").json()
    assert "صيانة مزامنة السوق" in st["maintenance"]["notice"]
    r = _post(c, oh2, f"/api/platform/announcements/{aid}/cancel")
    assert r.status_code == 200 and r.json()["announcement"]["cancelled_by_name"] == "سارة"
    assert Client().get("/api/public/status").json()["maintenance"]["notice"] == ""


def test_outbound_and_market_verifications(ctx: dict[str, Any]) -> None:  # noqa: F811
    """PLT-05: لوحة الإرسال بلا أسرار — الطابور الفارغ وضع سليم، نفاد الحصة يوقف الحملات أولاً
    (`partial`)، وتعذّر المزوّدين معاً يحتجز لا يُسقط (`server_error`) ويُسجَّل باسم من أعلنه؛
    PLT-06: الطابور بالأقدم أولاً، «أدلة ناقصة» تحتاج سبباً، والتوثيق يُسجَّل بمن قرّر ومتى."""
    from django.test import override_settings

    c, h = Client(), _h(ctx["tokens"]["owner"])
    oh = _operator_headers("op5", "طيب — تشغيل")
    # ---- PLT-05: لا طابور = empty (لا خطأ)، ولا سرّ في الردّ
    p = c.get("/api/platform/outbound", headers=oh).json()
    assert p["state"] == "empty" and p["queue"]["queued"] == 0
    assert [ch["key"] for ch in p["channels"]] == ["sms_primary", "sms_fallback", "push", "email"]
    forbidden = {"api_key", "secret", "token", "endpoint", "password", "dsn"}
    assert all(not (forbidden & set(ch)) for ch in p["channels"])
    assert p["channels"][1]["status"] == "ready" and p["channels"][3]["status_label"] == "سليم"
    # نفاد الحصة (حصة 0 للاختبار) → partial والاحتياطي يستقبل التحويل
    with override_settings(STING_CAMPAIGN_DAILY_QUOTA=0):
        p = c.get("/api/platform/outbound", headers=oh).json()
    assert p["state"] == "partial" and p["quota"]["remaining"] == 0
    assert p["channels"][0]["status"] == "exhausted" and p["channels"][1]["status"] == "receiving"
    # تعطّل معلَن للأساسي ثم الاحتياطي → server_error، مسجَّل باسم المشغّل
    r = _post(
        c, oh, "/api/platform/outbound/channels/sms_primary", {"state": "down", "note": "انقطاع"}
    )
    assert r.status_code == 200 and r.json()["state"] == "empty"
    assert (
        r.json()["channels"][0]["status"] == "down"
        and r.json()["channels"][1]["status"] == "receiving"
    )
    r = _post(c, oh, "/api/platform/outbound/channels/sms_fallback", {"state": "down"})
    assert r.status_code == 200 and r.json()["state"] == "server_error"
    assert _post(c, oh, "/api/platform/outbound/channels/fax", {"state": "down"}).status_code == 400
    with platform_context():
        assert OperatorAccessLog.objects.filter(action="channel_down").count() == 2
    r = _post(c, oh, "/api/platform/outbound/channels/sms_primary", {"state": "up"})
    assert r.json()["channels"][0]["status"] == "ok"
    # المالك (حساب متجر) لا يرى اللوحة
    assert c.get("/api/platform/outbound", headers=h).status_code == 403
    # ---- PLT-06: طلب تحقق من المالك
    v = c.get("/api/platform/verifications", headers=oh).json()
    assert v["pending_count"] == 0 and v["requests"] == [] and v["avg_review_hours_week"] == 0
    assert "التوثيق لا يشمل جودة السلع" in v["badge_text"]
    c.put(
        "/api/market/account",
        {
            "business_address": "الخرطوم بحري",
            "service_area_note": "توصيل داخل المنطقة",
            "accept_terms": True,
            "registry_doc": {"name": "registry.jpg", "data_url": "data:image/jpeg;base64,AAAA"},
        },
        content_type="application/json",
        headers=h,
    )
    assert c.post("/api/market/account/verification/submit", headers=h).status_code == 200
    v = c.get("/api/platform/verifications", headers=oh).json()
    assert v["pending_count"] == 1 and v["requests"][0]["status"] == "pending"
    row = v["requests"][0]
    assert row["status_label"] == "مكتمل المستندات" and "سجل تجاري" in row["docs_line"]
    assert row["has_doc"] is True and row["waiting_hours"] == 0
    tid = row["tenant_id"]
    # المستند يُفتح عند الحاجة وتُسجَّل المشاهدة
    r = _post(c, oh, f"/api/platform/verifications/{tid}/document")
    assert r.status_code == 200 and r.json()["doc_name"] == "registry.jpg"
    with platform_context():
        assert OperatorAccessLog.objects.filter(action="verification_doc_view").count() == 1
    # «أدلة ناقصة» بلا سبب محدّد = خطأ؛ بسبب = يعود للتاجر حقلاً حقلاً
    r = _post(c, oh, f"/api/platform/verifications/{tid}/decide", {"decision": "needs_more"})
    assert r.status_code == 400 and r.json()["detail"] == "reasons_required"
    r = _post(
        c,
        oh,
        f"/api/platform/verifications/{tid}/decide",
        {"decision": "needs_more", "reasons": {"registry_doc": "الطرف الأيسر مقطوع"}},
    )
    assert r.status_code == 200 and r.json()["request"]["status"] == "needs_more"
    assert "الطرف الأيسر مقطوع" in r.json()["request"]["note"]
    assert r.json()["request"]["status_label"] == "ناقص"
    # التاجر يعيد التقديم → يُوثَّق: بمن قرّر ومتى
    assert c.post("/api/market/account/verification/submit", headers=h).status_code == 200
    r = _post(c, oh, f"/api/platform/verifications/{tid}/decide", {"decision": "verified"})
    assert r.status_code == 200
    req = r.json()["request"]
    assert req["status"] == "verified" and req["reviewer_name"] == "طيب — تشغيل"
    assert req["reviewed_at"]
    v = c.get("/api/platform/verifications", headers=oh).json()
    assert v["pending_count"] == 0 and v["requests"][0]["status"] == "verified"
    # القرار الثاني على طلب محسوم
    r = _post(c, oh, f"/api/platform/verifications/{tid}/decide", {"decision": "rejected"})
    assert r.status_code == 400 and r.json()["detail"] == "not_pending"
    with platform_context():
        assert OperatorAccessLog.objects.filter(action="verification_verified").count() == 1
