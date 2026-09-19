"""NOT-01/NOT-02 (T2.10): الوارد خادمي المصدر — التشغيلي فوق التسويقي دائماً، المهجورة والمعلّق
والمحجوز تُشتقّ وتُوسم «زال سببها» لا تُمحى، ما يخصّ المالك يظهر عنوانه للموظف ويُحجب محتواه، الرابط
بصلاحية (ACC-113)، العرض المنتهي لا يُنبَّه به (ACC-110)؛ التفضيلات: التشغيلي داخل التطبيق دائم،
قناة بلا وجهة لا تُحفظ، العدّ بعد الحفظ."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import notifications
from core.models import Notification, Session
from core.tenancy import tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401
from shifts.models import Shift

pytestmark = pytest.mark.django_db(transaction=True)


def test_inbox_derives_orders_locks_and_expires(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h, hc = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["cashier"])
    now = timezone.now()
    with tenant_context(ctx["tenant"].id):
        Shift.objects.create(
            tenant=ctx["tenant"],
            branch=ctx["branch"],
            device_id=ctx["device_ids"]["cashier"],
            user_id=ctx["users"]["cashier"].id,
            user_name="أحمد ياسين",
            device_name="جهاز cashier",
            opening_float_minor=0,
            business_date=(now - timedelta(days=3)).date(),
            opened_at=now - timedelta(days=3),
        )
        Session.objects.filter(device_id=ctx["device_ids"]["manager"]).update(
            reported_pending=9, reported_pending_at=now
        )
        # عرض تسويقي انتهى — لا يُنبَّه به (ACC-110) لكنه يبقى مقروءاً موسوماً
        notifications.emit(
            kind="market_offer",
            category="marketing",
            title="عرض سوق — خصم الجملة",
            body="انتهى",
            href="/market",
            dedupe_key="offer:1",
            expires_at=now - timedelta(hours=1),
        )
    r = c.get("/api/notifications", headers=h)
    assert r.status_code == 200, r.content
    p = r.json()
    titles = [i["title"] for i in p["items"]]
    assert set(titles[:2]) == {
        "وردية أحمد ياسين مفتوحة منذ 3 أيام",
        "9 عمليات لم تُرفع من جهاز manager",
    }
    # التشغيلي أولاً ثم الحسابي ثم التسويقي؛ التجريبية تعرض ترقية الباقة
    cats = [i["category"] for i in p["items"]]
    assert cats == sorted(cats, key=lambda k: {"operational": 0, "account": 1, "marketing": 2}[k])
    assert p["needs_action"] >= 2
    offer = next(i for i in p["items"] if i["kind"] == "market_offer")
    assert offer["expired"] is True and offer["needs_action"] is False
    # الموظف: العنوان بلا التفصيل لما يخصّ المالك — «يخصّ المالك»
    with tenant_context(ctx["tenant"].id):
        notifications.emit(
            kind="proof_reviewed",
            category="account",
            title="اعتُمد إثبات تحويل الاشتراك",
            body="TRX-1",
            href="/org/subscription",
            owner_only=True,
            dedupe_key="proof:1",
        )
    pc = c.get("/api/notifications", headers=hc).json()
    locked = next(i for i in pc["items"] if i["kind"] == "proof_reviewed")
    assert locked["locked"] is True and locked["body"] == "" and locked["link_token"] == ""
    nid = locked["id"]
    assert (
        c.post(
            f"/api/notifications/{nid}/read", {}, content_type="application/json", headers=hc
        ).status_code
        == 403
    )
    r = c.post(
        f"/api/notifications/{nid}/open",
        {"token": "x"},
        content_type="application/json",
        headers=hc,
    )
    assert r.status_code == 403 and r.json()["status"] == "permission_denied"
    # الرابط بصلاحية: المالك يفتح بالرمز الصحيح؛ الرمز الخطأ/المنتهي → «انتهت صلاحية هذا
    # الرابط» والوجهة بديلاً
    mine = next(i for i in p["items"] if i["kind"] == "shift_abandoned")
    r = c.post(
        f"/api/notifications/{mine['id']}/open",
        {"token": mine["link_token"]},
        content_type="application/json",
        headers=h,
    )
    assert (
        r.status_code == 200 and r.json()["status"] == "ok" and r.json()["href"] == "/shifts/review"
    )
    assert (
        next(
            i
            for i in c.get("/api/notifications", headers=h).json()["items"]
            if i["id"] == mine["id"]
        )["read"]
        is True
    )
    r = c.post(
        f"/api/notifications/{mine['id']}/open",
        {"token": "stale"},
        content_type="application/json",
        headers=h,
    )
    assert r.json()["status"] == "link_expired" and r.json()["href"] == "/shifts/review"
    # زال السبب: أُقفلت الوردية → يُوسم لا يُمحى
    with tenant_context(ctx["tenant"].id):
        Shift.objects.update(state="closed")
    p = c.get("/api/notifications", headers=h).json()
    gone = next(i for i in p["items"] if i["kind"] == "shift_abandoned")
    assert gone["resolved"] is True and gone["needs_action"] is False
    with tenant_context(ctx["tenant"].id):
        assert Notification.objects.filter(kind="shift_abandoned").count() == 1
    assert uuid.UUID(gone["id"])


def test_preferences_locked_operational_and_channel_destination(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    r = c.get("/api/notifications/preferences", headers=h)
    assert r.status_code == 200
    p = r.json()
    assert (
        p["prefs"]["operational"]["in_app"] is True and p["prefs"]["marketing"]["in_app"] is False
    )
    assert p["sms_balance"]["remaining"] == 20  # تجريبية
    # قناة بلا وجهة: بريد مفعّل ولا بريد → لا نحفظ
    r = c.put(
        "/api/notifications/preferences",
        {"prefs": {"account": {"email": True}}},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "channel_without_destination"
    # بالبريد في مكانه: يُحفظ ويُعدّ
    r = c.put(
        "/api/notifications/preferences",
        {
            "prefs": {"account": {"email": True}, "operational": {"in_app": False}},
            "email": "owner@x.sd",
        },
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["prefs"]["operational"]["in_app"] is True  # دائم لا يُطفأ
    assert p["prefs"]["account"]["email"] is True and p["destination_email"] == "owner@x.sd"
    assert p["counts"] == {"in_app": 2, "sms": 1, "email": 1}
    # إيقاف التسويقي يُخفيه من الوارد
    r = c.put(
        "/api/notifications/preferences",
        {"prefs": {"marketing": {"in_app": False}}},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200
    assert all(
        i["category"] != "marketing" or i["expired"]
        for i in c.get("/api/notifications", headers=h).json()["items"]
    )
