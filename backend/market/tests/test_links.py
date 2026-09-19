"""MP-07/MP-14/MP-15 (T3.9): المعاينة عامة دوماً بلا سعر خاص (ACC-150)؛ الرابط بعمر ولا يُحيا
(ACC-06)؛ القبول لا ينشر أحداً (ACC-118) والقياس عدّادات بلا هوية؛ طلب التخويل يصل المورد بمن
أنت فقط ورفضه بلا سبب (ACC-121)؛ المعلَّقة تمنع الجديد وتُبقي السابق (ACC-135)؛ البلاغ سبب ودليل
ورقم لصاحبه وحده ولا يُعلِّق شيئاً (ACC-139)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth.tokens import issue_session_tokens
from core.models import User
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market import links
from market.models import MarketAccount, MarketInvite, MarketOffer, MarketProfile

pytestmark = pytest.mark.django_db(transaction=True)


def _seed_supplier(t: Any, *, suspended: bool = False) -> MarketOffer:
    today = timezone.localdate()
    with platform_context():
        MarketAccount.unscoped.create(
            tenant=t,
            verification="verified",
            role="both",
            verified_until=today + timedelta(days=100),
            publish_suspended_at=timezone.now() if suspended else None,
        )
        MarketProfile.unscoped.create(
            tenant=t,
            public_name="مخزن البركة — تجريبي",
            published={
                "public_name": "مخزن البركة — تجريبي",
                "category_line": "جملة",
                "categories": ["سكر"],
                "service_areas": ["بحري"],
                "fulfilment": ["توصيل"],
            },
            published_at=timezone.now(),
        )
        o: MarketOffer = MarketOffer.unscoped.create(
            tenant=t,
            public_name="سكر أبيض",
            unit_name="كرتونة",
            pack_label="كرتونة 12×1كغ",
            price_minor=118000,
            min_order_qty=5,
            status="published",
            audience="private",
            valid_until=today + timedelta(days=3),
            confirmed_at=timezone.now(),
        )
    return o


def test_share_invite_authorization_and_report(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hm = _h(ctx["tokens"]["manager"])
    priv = _seed_supplier(two_tenants.b)
    # المعاينة عامة دوماً: العرض الخاص بلا سعر ولو كان المرسل يراه
    p = c.get(f"/api/market/share/preview?offer={priv.id}", headers=h).json()["preview"]
    assert p["price_minor"] == "" and "المخوَّلين" in p["price_line"]
    assert p["title"] == "سكر أبيض — كرتونة 12×1كغ"
    # المشاركة بصلاحية النشر: المدير ممنوع؛ المالك ينشئ رابطاً بعمر
    body = {"offer_id": str(priv.id)}
    assert _post(c, hm, "/api/market/invites", body).status_code == 403
    r = _post(c, h, "/api/market/invites", body)
    assert r.status_code == 201
    token = r.json()["token"]
    assert r.json()["path"] == f"/market/i/{token}" and r.json()["preview"]["price_minor"] == ""
    # فتح الرابط بلا حساب: زيارة تُعدّ ولا سعر خاص
    d = Client().get(f"/api/public/market/invite/{token}")
    assert d.status_code == 200 and d.json()["invite"]["preview"]["price_minor"] == ""
    lst = c.get("/api/market/invites", headers=h).json()
    assert lst["invites"][0]["counts"]["visits"] == 1 and lst["share_days"] == 7
    # الإلغاء → الرابط منتهٍ (410) ولا يُحيا
    iid = lst["invites"][0]["id"]
    assert _post(c, h, f"/api/market/invites/{iid}/revoke").status_code == 200
    assert Client().get(f"/api/public/market/invite/{token}").status_code == 410
    # دعوة منشأة: رابط جديد؛ القبول بحساب المدعوّ لا ينشر ملفه، ويُعدّ تسجيلاً إن كانت أحدث من الدعوة
    r = _post(c, h, "/api/market/invites", {"kind": "invite", "message": "تعالوا"})
    assert r.status_code == 201
    itoken = r.json()["token"]
    assert r.json()["invite"]["kind"] == "invite"
    with platform_context():
        ob = User.objects.create_user(
            tenant=two_tenants.b, username="ob", display_name="ب", is_owner=True
        )
        _s, rb = issue_session_tokens(ob)
    hb = {"Authorization": f"Bearer {rb.access_token}"}
    assert _post(c, h, f"/api/market/invite/{itoken}/accept").status_code == 400  # الذات
    assert _post(c, hb, f"/api/market/invite/{itoken}/accept").status_code == 200
    with platform_context():
        inv = MarketInvite.unscoped.get(token_hash=links._hash(itoken))
        assert inv.status == "accepted" and str(inv.accepted_tenant_id) == str(two_tenants.b.id)
        assert inv.signups == 0  # منشأة ب أقدم من الدعوة — لا تسجيل يُنسب
        assert MarketProfile.unscoped.filter(tenant_id=ctx["tenant"].id).count() == 0
    # طلب تخويل: يصل المورد اسم المنشأة ومنطقتها وشارتها — لا أكثر؛ رفضه بلا سبب
    r = _post(
        c,
        h,
        "/api/market/invites",
        {"kind": "authorization", "supplier_tenant_id": str(two_tenants.b.id), "message": "نحن"},
    )
    assert r.status_code == 201 and r.json()["invite"]["status"] == "sent"
    inc = c.get("/api/market/authorizations/incoming", headers=hb).json()["requests"]
    assert len(inc) == 1 and set(inc[0]) == {
        "id",
        "buyer_name",
        "area",
        "verified",
        "message",
        "status",
        "status_label",
        "created_at",
    }
    r = _post(
        c, hb, "/api/market/authorizations/incoming", {"invite_id": inc[0]["id"], "accept": False}
    )
    assert r.status_code == 200 and r.json()["request"]["status"] == "declined"
    mine = c.get("/api/market/invites", headers=h).json()["invites"]
    auth_row = next(i for i in mine if i["kind"] == "authorization")
    assert auth_row["status"] == "declined" and "reason" not in auth_row
    # MP-14: المعلَّقة تمنع الجديد وتُبقي السابق
    with platform_context():
        acc = MarketAccount.unscoped.get(tenant=two_tenants.b)
        acc.publish_suspended_at = timezone.now()
        acc.save(update_fields=["publish_suspended_at"])
    s = Client().get(f"/api/public/market/suppliers/{two_tenants.b.id}/status").json()["supplier"]
    assert s["suspended"] is True and len(s["kept"]) == 3 and s["blocked"][0]["title"]
    # MP-15: «انتحال» بلا دليل لا يُرسل؛ ثم بلاغ برقم لصاحبه وحده ولا يُعلِّق شيئاً
    r = _post(c, h, "/api/market/reports", {"offer_id": str(priv.id), "reason": "impersonation"})
    assert r.status_code == 400 and r.json()["detail"] == "evidence_required"
    r = _post(
        c,
        h,
        "/api/market/reports",
        {
            "offer_id": str(priv.id),
            "reason": "impersonation",
            "evidence_data_url": "data:image/png;base64,AAAA",
            "evidence_name": "مقارنة.png",
        },
    )
    assert r.status_code == 201
    rep = r.json()["report"]
    assert rep["number_label"] == "RP-1" and rep["status"] == "under_review"
    assert rep["target_label"] == "«سكر أبيض — كرتونة 12×1كغ»"
    assert c.get(f"/api/market/reports/{rep['id']}", headers=h).status_code == 200
    assert c.get(f"/api/market/reports/{rep['id']}", headers=hb).status_code == 404
    with platform_context():
        assert MarketOffer.unscoped.get(id=priv.id).status == "published"
    with tenant_context(ctx["tenant"].id):
        reasons = links.reports_payload()["reasons"]
        assert [x["needs_evidence"] for x in reasons] == [True, False, False, False]
