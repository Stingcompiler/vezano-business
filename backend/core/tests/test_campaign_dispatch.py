"""NOT-05/NOT-06 (T2.12): الاعتماد صلاحية منفصلة ويعيد التحقق قبل كل محاولة (ACC-109 — من أوقف
التسويق منذ المسودة يُستبعد)؛ الجدولة تُسجَّل ولا تُرسل؛ المتأخرة لا تُرسل تلقائياً؛ الصادر صفّ لكل
طرف مرة واحدة وإعادة التشغيل تكمل لا تكرّر (ACC-108، ACC-88)؛ مقبول ≠ مقروء (ACC-111)؛ الإلغاء
يُفصّل ما أُرسل ولا يُستردّ؛ إعادة المحاولة تخصم مرة أخرى؛ المزوّد الصامت يُقال كما هو."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import campaigns, subscription
from core.models import Campaign, CampaignMessage
from core.scenario import faults
from core.tenancy import tenant_context
from core.tests.test_campaigns import _party, _post
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)

MSG = "سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل — تجريبي"


@pytest.fixture(autouse=True)
def _clear_faults() -> Any:
    faults.clear()
    yield
    faults.clear()


def _setup(c: dict[str, Any]) -> tuple[Client, dict[str, str], str]:
    now = timezone.now()
    with tenant_context(c["tenant"].id):
        subscription.set_for_scenario(state="active", plan_code="dual")
    for i in range(1, 9):
        _party(c, f"زبون {i}", f"09120000{i:02d}", marketing_consent_at=now)
    _party(c, "رقم قصير", "0912", marketing_consent_at=now)  # رقم غير صالح
    cl, h = Client(), _h(c["tokens"]["owner"])
    r = _post(
        cl,
        h,
        "/api/campaigns",
        {"name": "عرض السكر", "message": MSG, "audience": {"segments": ["subscribed"]}},
    )
    assert r.status_code == 201, r.content
    return cl, h, r.json()["campaign"]["id"]


def test_approve_reverifies_schedules_and_overdue_asks(ctx: dict[str, Any]) -> None:  # noqa: F811
    cl, h, cid = _setup(ctx)
    # المدير لا يعتمد (صلاحية منفصلة)
    hm = _h(ctx["tokens"]["manager"])
    assert _post(cl, hm, f"/api/campaigns/{cid}/approve", {"send_now": True}).status_code == 403
    # إعادة التحقق: زبون أوقف التسويق بعد المسودة → يُستبعد الآن لا وقت الحفظ
    with tenant_context(ctx["tenant"].id):
        from parties.models import Party

        Party.objects.filter(name="زبون 8").update(marketing_opt_out_at=timezone.now())
    r = _post(cl, h, f"/api/campaigns/{cid}/verify", {})
    assert (
        r.status_code == 200
        and r.json()["audience"]["eligible"] == 8
        and r.json()["blockers"] == []
    )
    # جدولة ليلية بلا تأكيد → مانع؛ بتأكيد → مجدولة (تُسجَّل ولا تُرسل)
    night = (timezone.now() + timedelta(days=1)).replace(hour=23, minute=0)
    r = _post(cl, h, f"/api/campaigns/{cid}/approve", {"scheduled_at": night.isoformat()})
    assert r.status_code == 400 and r.json()["detail"] == "blocked"
    assert [b["code"] for b in r.json()["extra"]["blockers"]] == ["night_send"]
    r = _post(
        cl,
        h,
        f"/api/campaigns/{cid}/approve",
        {"scheduled_at": night.isoformat(), "night_confirmed": True},
    )
    assert r.status_code == 200, r.content
    c = r.json()["campaign"]
    assert (
        c["status"] == "scheduled" and c["approved_by_name"] == "عثمان الطيب" and c["sent_at"] == ""
    )
    with tenant_context(ctx["tenant"].id):
        assert CampaignMessage.objects.filter(campaign_id=cid).count() == 8
        assert CampaignMessage.objects.filter(campaign_id=cid, state="queued").count() == 8
        # الحصة تُحصى للمجدولة
        assert campaigns.quota()["used"] == 8
    # مضى وقت الإرسال والنظام كان متوقفاً: لا إرسال متأخر تلقائياً — يُسأل
    with tenant_context(ctx["tenant"].id):
        Campaign.objects.filter(id=cid).update(scheduled_at=timezone.now() - timedelta(days=1))
    r = cl.get(f"/api/campaigns/{cid}", headers=h)
    assert r.json()["campaign"]["status"] == "scheduled" and r.json()["campaign"]["overdue"] is True
    with tenant_context(ctx["tenant"].id):
        assert CampaignMessage.objects.filter(campaign_id=cid, state="queued").count() == 8
    # أرسل الآن → الصادر يُرسل مرة واحدة؛ الرقم غير الصالح فشل دائم؛ الباقي سُلِّم؛ لا «قُرئت»
    r = _post(cl, h, f"/api/campaigns/{cid}/approve", {"send_now": True})
    assert r.status_code == 200, r.content
    res = r.json()["campaign"]["results"]
    assert res["sent"] == 8 and res["delivered"] == 7 and res["failed_permanent"] == 1
    assert res["read"] is None and r.json()["campaign"]["status"] == "done"
    # إعادة التشغيل لا تكرّر: الإرسال مرة أخرى لا يغيّر شيئاً (ACC-108)
    with tenant_context(ctx["tenant"].id):
        c_obj = Campaign.objects.get(id=cid)
        assert campaigns.dispatch(c_obj) == {"sent": 0}
        assert CampaignMessage.objects.filter(campaign_id=cid).count() == 8
        assert CampaignMessage.objects.get(campaign_id=cid, phone="0912").attempts == 1


def test_cancel_partial_retry_and_silent_provider(ctx: dict[str, Any]) -> None:  # noqa: F811
    cl, h, cid = _setup(ctx)
    # رفض مؤقت لبعض الأرقام ثم إعادة محاولة تخصم مرة أخرى
    faults.set_fault("sms_temp_reject", True)
    r = _post(cl, h, f"/api/campaigns/{cid}/approve", {"send_now": True})
    assert r.status_code == 200, r.content
    res = r.json()["campaign"]["results"]
    assert res["failed_temporary"] == 3 and res["failed_permanent"] == 1
    temp = next(f for f in res["failures"] if f["code"] == "provider_temp")
    assert temp["count"] == 3 and temp["retryable"] is True
    used_before = r.json()["campaign"]["quota"]["used"]
    faults.set_fault("sms_temp_reject", False)
    r = _post(cl, h, f"/api/campaigns/{cid}/retry", {})
    assert r.status_code == 200, r.content
    assert r.json()["campaign"]["results"]["failed_temporary"] == 0
    assert r.json()["campaign"]["quota"]["used"] == used_before + 3
    # حملة ثانية: إلغاء بعد الجدولة قبل الإرسال — الحصة تعود؛ وحملة ثالثة: المزوّد لا يردّ
    r = _post(
        cl,
        h,
        "/api/campaigns",
        {"name": "ثانية", "message": MSG, "audience": {"segments": ["subscribed"]}},
    )
    cid2 = r.json()["campaign"]["id"]
    later = (timezone.now() + timedelta(hours=3)).replace(hour=12)
    assert (
        _post(
            cl, h, f"/api/campaigns/{cid2}/approve", {"scheduled_at": later.isoformat()}
        ).status_code
        == 200
    )
    r = _post(cl, h, f"/api/campaigns/{cid2}/cancel", {})
    assert r.status_code == 200
    c2 = r.json()["campaign"]
    assert (
        c2["status"] == "cancelled"
        and c2["results"]["cancelled"] == 9
        and c2["results"]["sent"] == 0
    )
    assert c2["results"]["refunded_messages"] == 9 and c2["cost_messages"] == 0
    r = _post(
        cl,
        h,
        "/api/campaigns",
        {"name": "ثالثة", "message": MSG, "audience": {"segments": ["subscribed"]}},
    )
    cid3 = r.json()["campaign"]["id"]
    faults.set_fault("sms_provider_silent", True)
    r = _post(cl, h, f"/api/campaigns/{cid3}/approve", {"send_now": True})
    res = r.json()["campaign"]["results"]
    assert res["provider_silent"] is True and res["awaiting"] == 8 and res["accepted"] == 0
    # الإلغاء بعد بدء الإرسال يفصّل: أُرسلت ولا تُستردّ · أُلغيت 0
    r = _post(cl, h, f"/api/campaigns/{cid3}/cancel", {})
    assert r.status_code == 200 and r.json()["campaign"]["results"]["sent"] == 9
    assert r.json()["campaign"]["results"]["cancelled"] == 0
