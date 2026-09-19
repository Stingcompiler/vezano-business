"""NOT-03/NOT-04 (T2.11): الجمهور من دفتر المنشأة وحدها ويُحصى خادمياً بعد إزالة التكرار ومن أوقف
التسويق؛ جمهور مستأجر آخر يُرفض بلا تسريب (ACC-103)؛ الرسالة تحمل اسم المحل؛ الموانع بأسبابها
(لا نص، رصيد لا يكفي، وقت ليلي يحتاج تأكيداً)؛ الحصة الشهرية بالباقة؛ الكاشير لا ينشئ."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core import subscription
from core.models import Campaign
from core.tenancy import tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401
from parties import services as party_services
from parties.models import Party

pytestmark = pytest.mark.django_db(transaction=True)


def _party(c: dict[str, Any], name: str, phone: str, **kw: Any) -> Party:
    from sync.counter import ensure_state

    with tenant_context(c["tenant"].id):
        ensure_state(c["tenant"].id)
        p = party_services.create_party(
            party_id=None,
            name=name,
            phone=phone,
            created_by=c["users"]["owner"],
            distinct_from=None,
        )
        for k, v in kw.items():
            setattr(p, k, v)
        if kw:
            p.save()
    return p


def _post(cl: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return cl.post(path, body, content_type="application/json", headers=h)


def test_audience_counts_blockers_and_cross_tenant_rejection(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    now = timezone.now()
    # ثلاثة أذنوا (واحد أوقف لاحقاً، وواحد يشارك الرقم مع رابع)، وواحد بلا رقم، وواحد لم يأذن
    _party(ctx, "أحمد", "0912000001", marketing_consent_at=now)
    _party(ctx, "فاطمة", "0912000002", marketing_consent_at=now, marketing_opt_out_at=now)
    _party(ctx, "خالد", "0912000003", marketing_consent_at=now)
    _party(ctx, "خالد (مكرر)", "0912000003", marketing_consent_at=now)
    _party(ctx, "بلا رقم", "", marketing_consent_at=now)
    _party(ctx, "عمر", "0912000009")
    # طرف في منشأة أخرى على الجهاز نفسه
    with tenant_context(two_tenants.b.id):
        from core.models import User
        from sync.counter import ensure_state

        ensure_state(two_tenants.b.id)
        other_owner = User.objects.create_user(
            tenant=two_tenants.b, username="ob", display_name="مالك آخر", is_owner=True
        )
        foreign = party_services.create_party(
            party_id=None,
            name="زبون منشأة أخرى",
            phone="0999",
            created_by=other_owner,
            distinct_from=None,
        )
    cl, h = Client(), _h(ctx["tokens"]["owner"])
    r = _post(
        cl, h, "/api/campaigns/preview", {"message": "", "audience": {"segments": ["subscribed"]}}
    )
    assert r.status_code == 200, r.content
    p = r.json()
    seg = {s["key"]: s for s in p["audience"]["segments"]}
    assert seg["subscribed"]["count"] == 5 and seg["market_followers"]["available"] is False
    # المؤهلون بعد الاستبعاد: أحمد + خالد (المكرر أُزيل، الموقوف وبلا رقم مستبعدان)
    assert p["audience"]["eligible"] == 2 and p["audience"]["excluded_opt_out"] == 1
    assert p["audience"]["excluded_no_phone"] == 1 and p["audience"]["duplicates"] == 1
    assert p["shop_name"] == "بقالة النيل — تجريبي"
    codes = [b["code"] for b in p["blockers"]]
    assert codes == ["no_message"]
    # رسالة بلا هوية المرسل
    r = _post(
        cl,
        h,
        "/api/campaigns/preview",
        {"message": "خصم 10%", "audience": {"segments": ["subscribed"]}},
    )
    assert [b["code"] for b in r.json()["blockers"]] == ["sender_identity_missing", "quota_short"]
    # رسالة صالحة: 164 حرفاً = رسالتان؛ الحاجة 2 × 2 = 4 رسائل — التجريبية حصتها 0 → رصيد لا يكفي
    msg = ("سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل — تجريبي " * 3)[:164]
    r = _post(
        cl, h, "/api/campaigns/preview", {"message": msg, "audience": {"segments": ["subscribed"]}}
    )
    p = r.json()
    assert p["chars"] == 164 and p["parts"] == 2 and p["cost_messages"] == 4
    assert [b["code"] for b in p["blockers"]] == ["quota_short"] and p["blockers"][0]["need"] == 4
    # باقة «فرعان» (1,200 رسالة): لا مانع؛ إرسال ليلي يحتاج تأكيداً صريحاً
    with tenant_context(ctx["tenant"].id):
        subscription.set_for_scenario(state="active", plan_code="dual")
    night = datetime.now(tz=UTC).replace(hour=23, minute=10) + timedelta(days=1)
    r = _post(
        cl,
        h,
        "/api/campaigns/preview",
        {
            "message": msg,
            "audience": {"segments": ["subscribed"]},
            "scheduled_at": night.isoformat(),
        },
    )
    p = r.json()
    assert p["quota"]["remaining"] == 1200 and [b["code"] for b in p["blockers"]] == ["night_send"]
    assert p["blockers"][0]["confirmable"] is True
    r = _post(
        cl,
        h,
        "/api/campaigns/preview",
        {
            "message": msg,
            "audience": {"segments": ["subscribed"]},
            "scheduled_at": night.isoformat(),
            "night_confirmed": True,
        },
    )
    assert r.json()["blockers"] == []
    # ACC-103: زبون منشأة أخرى → رفض بلا تسريب (لا عدد ولا اسم)؛ وشريحة «تجّار آخرين» كذلك
    r = _post(
        cl,
        h,
        "/api/campaigns/preview",
        {"message": msg, "audience": {"segments": ["subscribed"], "party_ids": [str(foreign.id)]}},
    )
    assert r.status_code == 400 and r.json()["detail"] == "audience_out_of_tenant"
    assert "زبون منشأة أخرى" not in r.content.decode() and "0999" not in r.content.decode()
    r = _post(
        cl,
        h,
        "/api/campaigns/preview",
        {"message": msg, "audience": {"segments": ["other_merchants"]}},
    )
    assert r.status_code == 400 and r.json()["detail"] == "audience_out_of_tenant"
    # حفظ كمسودة يُحصي الجمهور خادمياً ويُقيَّد بالحصة؛ الاعتماد ليس هنا
    r = _post(
        cl,
        h,
        "/api/campaigns",
        {
            "name": "خصم نهاية الأسبوع",
            "message": msg,
            "audience": {"segments": ["subscribed", "with_debt"]},
        },
    )
    assert r.status_code == 201, r.content
    c = r.json()["campaign"]
    assert c["status"] == "draft" and c["audience_count"] == 2 and c["cost_messages"] == 4
    assert c["excluded_count"] == 3
    lst = cl.get("/api/campaigns", headers=h).json()
    assert (
        lst["campaigns"][0]["id"] == c["id"] and lst["subscribers"] == 3
    )  # أحمد وخالد والمكرر أذنوا ولم يوقفوا
    assert lst["quota"]["used"] == 0 and lst["can_create"] is True and lst["can_approve"] is True
    with tenant_context(ctx["tenant"].id):
        assert Campaign.objects.get(id=c["id"]).audience_rules["segments"] == [
            "subscribed",
            "with_debt",
        ]
    # المدير ينشئ ولا يعتمد ولا يرى الفوترة؛ الكاشير لا يرى القائمة
    hm = _h(ctx["tokens"]["manager"])
    lst = cl.get("/api/campaigns", headers=hm).json()
    assert (
        lst["can_create"] is True
        and lst["can_approve"] is False
        and lst["can_see_billing"] is False
    )
    hc = _h(ctx["tokens"]["cashier"])
    assert cl.get("/api/campaigns", headers=hc).status_code == 403
    assert (
        _post(cl, hc, "/api/campaigns/preview", {"message": msg, "audience": {}}).status_code == 403
    )
    assert uuid.UUID(c["id"])
