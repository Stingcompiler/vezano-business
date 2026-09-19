"""CUS-01/CUS-02 (T3.1): صفحة المحل عبر رابط/QR بلا جلسة تكشف المنشور فقط؛ الاشتراك صريح بقناة
المحل، يتساهل في صيغة الرقم ويرفض الناقص، لا ينشئ طرفاً في الدفتر، ويدخل جمهور «المشتركون» في
الحملات ويُحترم إلغاؤه؛ الرابط المؤقت المنتهي يحوّل إلى صفحة المحل الدائمة ورابط لا وجود له 404."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import campaigns, portal, subscription
from core.models import Campaign, CampaignMessage, PortalSubscriber
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from parties.models import Party

pytestmark = pytest.mark.django_db(transaction=True)


def test_portal_page_subscribe_audience_and_expired_link(ctx: dict[str, Any]) -> None:  # noqa: F811
    cl, h = Client(), _h(ctx["tokens"]["owner"])
    # المالك يأخذ الرابط وQR ويحرّر العنوان والساعات
    r = cl.get("/api/org/portal", headers=h)
    assert r.status_code == 200 and r.json()["qr_svg"].startswith("<svg")
    slug = r.json()["slug"]
    assert len(slug) == 8 and r.json()["link"].endswith(f"/portal/{slug}")
    r = cl.put(
        "/api/org/portal",
        {"address": "شارع الجمهورية — الخرطوم", "hours": "8:00 – 22:00"},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200 and r.json()["address"] == "شارع الجمهورية — الخرطوم"
    # الصفحة العامة بلا جلسة: الاسم والعنوان والساعات ولا شيء من الدفتر
    r = Client().get(f"/api/portal/{slug}")
    assert r.status_code == 200
    p = r.json()
    assert p["shop"]["name"] == "بقالة النيل — تجريبي" and p["shop"]["hours"] == "8:00 – 22:00"
    assert p["announcements"] == [] and p["link_state"] == ""
    assert "party" not in str(p) and "balance" not in str(p)
    assert Client().get("/api/portal/zzzzzzzz").status_code == 404
    # الاشتراك: نتساهل في الصيغة، ونرفض الناقص بنصّه
    r = Client().post(
        f"/api/portal/{slug}/subscribe", {"phone": "091"}, content_type="application/json"
    )
    assert r.status_code == 400 and r.json()["detail"] == "phone_invalid"
    r = Client().post(
        f"/api/portal/{slug}/subscribe",
        {"phone": "+249 91-200-0555", "push_permission": "denied"},
        content_type="application/json",
    )
    assert r.status_code == 201
    sub = r.json()["subscriber"]
    assert sub["active"] is True and sub["push_enabled"] is False and sub["unread"] == 0
    with tenant_context(ctx["tenant"].id):
        s = PortalSubscriber.objects.get(token=sub["token"])
        assert s.phone_normalized == "249912000555"
        # لا طرف في الدفتر
        assert not Party.objects.filter(phone_normalized="249912000555").exists()
        subscription.set_for_scenario(state="active", plan_code="dual")
    # الجمهور: المشترك يُحصى في «المشتركون» ويُرسل له
    r = _post(
        cl,
        h,
        "/api/campaigns/preview",
        {
            "message": "عرض نهاية الأسبوع — بقالة النيل — تجريبي",
            "audience": {"segments": ["subscribed"]},
        },
    )
    assert r.status_code == 200 and r.json()["audience"]["eligible"] == 1
    r = _post(
        cl,
        h,
        "/api/campaigns",
        {
            "name": "خصم نهاية الأسبوع",
            "message": "عرض نهاية الأسبوع — بقالة النيل — تجريبي",
            "audience": {"segments": ["subscribed"]},
        },
    )
    cid = r.json()["campaign"]["id"]
    with tenant_context(ctx["tenant"].id):
        c = Campaign.objects.get(id=cid)
        c.valid_until = timezone.localdate() + timedelta(days=3)
        c.save(update_fields=["valid_until"])
    r = _post(cl, h, f"/api/campaigns/{cid}/approve", {"send_now": True})
    assert r.status_code == 200, r.content
    with tenant_context(ctx["tenant"].id):
        m = CampaignMessage.objects.get(campaign_id=cid)
        assert m.subscriber_id == s.id and m.party_id is None and m.state == "delivered"
        assert portal.subscriber_payload(s)["unread"] == 1
    # الإعلان يظهر على الصفحة بتاريخه وصلاحيته؛ ورابط الحملة ساري
    p = Client().get(f"/api/portal/{slug}?c={cid}").json()
    assert p["announcements"][0]["title"] == "خصم نهاية الأسبوع" and p["link_state"] == ""
    assert p["announcements"][0]["expired"] is False
    # انتهى العرض: الرابط المؤقت يحوّل إلى صفحة المحل الدائمة، والإعلان يبقى موسوماً «انتهى»
    with tenant_context(ctx["tenant"].id):
        c.valid_until = timezone.localdate() - timedelta(days=1)
        c.save(update_fields=["valid_until"])
    p = Client().get(f"/api/portal/{slug}?c={cid}").json()
    assert p["link_state"] == "expired" and p["announcements"][0]["expired"] is True
    # رابط حملة لا وجود لها = الرسالة نفسها
    assert (
        Client()
        .get(f"/api/portal/{slug}?c=00000000-0000-0000-0000-000000000000")
        .json()["link_state"]
        == "expired"
    )
    # إلغاء الاشتراك يُحترم في الإرسال التالي (CUS-04 يأتي في T3.2 — هنا بالخدمة)
    with tenant_context(ctx["tenant"].id):
        s.opt_out_at = timezone.now()
        s.save(update_fields=["opt_out_at"])
        assert campaigns.audience({"segments": ["subscribed"]}, count_only=True)["eligible"] == 0


def test_messages_prefs_unsubscribe_and_undo(ctx: dict[str, Any]) -> None:  # noqa: F811
    cl, h = Client(), _h(ctx["tokens"]["owner"])
    slug = cl.get("/api/org/portal", headers=h).json()["slug"]
    r = Client().post(
        f"/api/portal/{slug}/subscribe",
        {"phone": "0912000777", "push_permission": "granted"},
        content_type="application/json",
    )
    tok = r.json()["subscriber"]["token"]
    # لا رسائل بعد — انتظارٌ لا عطب
    r = Client().get(f"/api/portal/{slug}/messages?t={tok}")
    assert r.status_code == 200 and r.json()["messages"] == []
    assert r.json()["subscriber"]["channels"] == {"push": True, "sms": False, "inbox": True}
    # رمز لا يخصّ هذا المحل = لا شيء
    assert Client().get(f"/api/portal/{slug}/messages?t=nope").status_code == 404
    # حملة تصل المشترك ثم تُقرأ؛ ورسالة لمشترك آخر لا تُفتح
    with tenant_context(ctx["tenant"].id):
        subscription.set_for_scenario(state="active", plan_code="dual")
    r = _post(
        cl,
        h,
        "/api/campaigns",
        {
            "name": "وصلت بضاعة جديدة",
            "message": "وصل زيت جديد — بقالة النيل — تجريبي",
            "audience": {"segments": ["subscribed"]},
        },
    )
    cid = r.json()["campaign"]["id"]
    assert _post(cl, h, f"/api/campaigns/{cid}/approve", {"send_now": True}).status_code == 200
    r = Client().get(f"/api/portal/{slug}/messages?t={tok}").json()
    assert len(r["messages"]) == 1 and r["messages"][0]["read_at"] == ""
    assert (
        r["messages"][0]["shop_name"] == "بقالة النيل — تجريبي" and r["subscriber"]["unread"] == 1
    )
    mid = r["messages"][0]["id"]
    assert Client().post(f"/api/portal/{slug}/messages/{mid}/read?t={tok}").status_code == 200
    r = Client().get(f"/api/portal/{slug}/messages?t={tok}").json()
    assert r["messages"][0]["read_at"] and r["subscriber"]["unread"] == 0
    other = (
        Client()
        .post(
            f"/api/portal/{slug}/subscribe",
            {"phone": "0912000888"},
            content_type="application/json",
        )
        .json()["subscriber"]["token"]
    )
    assert Client().post(f"/api/portal/{slug}/messages/{mid}/read?t={other}").status_code == 403
    # التفضيلات: قناة بقناة؛ إيقاف الكل بلا إلغاء = نسأل عن القصد
    r = Client().put(
        f"/api/portal/{slug}/me?t={tok}",
        {"channels": {"push": False, "sms": True, "inbox": True}},
        content_type="application/json",
    )
    assert r.status_code == 200 and r.json()["subscriber"]["channels"]["sms"] is True
    r = Client().put(
        f"/api/portal/{slug}/me?t={tok}",
        {"channels": {"push": False, "sms": False, "inbox": False}},
        content_type="application/json",
    )
    assert r.status_code == 400 and r.json()["detail"] == "all_channels_off"
    # إلغاء هذا المحل وحده: الرسائل تبقى، ولا تصله جديدة، والتراجع 7 أيام
    r = Client().delete(f"/api/portal/{slug}/me?t={tok}")
    assert r.status_code == 200 and r.json()["subscriber"]["active"] is False
    assert r.json()["subscriber"]["undo_until"] and r.json()["subscriber"]["undo_expired"] is False
    assert len(Client().get(f"/api/portal/{slug}/messages?t={tok}").json()["messages"]) == 1
    with tenant_context(ctx["tenant"].id):
        assert campaigns.audience({"segments": ["subscribed"]}, count_only=True)["eligible"] == 1
    assert Client().post(f"/api/portal/{slug}/resubscribe?t={tok}").status_code == 200
    with tenant_context(ctx["tenant"].id):
        assert campaigns.audience({"segments": ["subscribed"]}, count_only=True)["eligible"] == 2
        s = PortalSubscriber.objects.get(token=tok)
        s.opt_out_at = timezone.now() - timedelta(days=8)
        s.save(update_fields=["opt_out_at"])
    r = Client().post(f"/api/portal/{slug}/resubscribe?t={tok}")
    assert r.status_code == 410 and r.json()["detail"] == "undo_expired"
    assert (
        Client().get(f"/api/portal/{slug}/me?t={tok}").json()["subscriber"]["undo_expired"] is True
    )
