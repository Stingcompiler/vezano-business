"""ORD-01/ORD-02 (T3.10): التحقق خادمي لا محلي (ACC-123)؛ الإرسال فعل واحد بمعرّف واحد (ACC-124)؛
طلب لكل مورد (ACC-126)؛ لا تحويل عملة (ACC-140)؛ المنتهي لا يُرسل بسعره القديم والسعر المتغيّر
يحتاج قبولاً؛ الحدّ الأدنى بالفارق؛ «أُرسل» ليست «قُبل» — لا دين ولا حجز."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth.tokens import issue_session_tokens
from core.models import Tenant, User
from core.tenancy import platform_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market.models import MarketAccount, MarketOffer, MarketOrder, MarketProfile

pytestmark = pytest.mark.django_db(transaction=True)


def _seed(t: Any) -> tuple[MarketOffer, MarketOffer]:
    today = timezone.localdate()
    with platform_context():
        MarketAccount.unscoped.create(
            tenant=t,
            verification="verified",
            role="both",
            verified_until=today + timedelta(days=99),
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

        def mk(name: str, price: int, min_qty: int, valid: Any) -> MarketOffer:
            o: MarketOffer = MarketOffer.unscoped.create(
                tenant=t,
                public_name=name,
                unit_name="كرتونة",
                pack_label="كرتونة 12×1كغ",
                price_minor=price,
                min_order_qty=min_qty,
                status="published",
                audience="public",
                valid_until=valid,
                confirmed_at=timezone.now(),
                delivery_fee_minor=0,
            )
            return o

        sugar = mk("سكر أبيض", 118000, 5, today + timedelta(days=3))
        rice = mk("أرز", 154000, 1, today - timedelta(days=1))
    return sugar, rice


def test_verify_and_submit_idempotent(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hm = _h(ctx["tokens"]["manager"])
    sugar, rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    # ORD-01: التحقق خادمياً — المنتهي والفارق إلى الحدّ الأدنى والسعر المتغيّر
    r = _post(
        c,
        h,
        "/api/market/orders/verify",
        {
            "lines": [
                {"offer_id": str(sugar.id), "qty": 3, "price_minor": "110000"},
                {"offer_id": str(rice.id), "qty": 3, "price_minor": "154000"},
            ]
        },
    )
    assert r.status_code == 200
    v = {x["offer_id"]: x for x in r.json()["lines"]}
    assert v[str(sugar.id)]["changed"] is True and v[str(sugar.id)]["short"] == 2
    assert v[str(rice.id)]["expired"] is True and v[str(rice.id)]["status"] == "expired"
    # ORD-02: المنتهي لا يُرسل بسعره القديم (409)
    op = str(uuid.uuid4())
    base = {"op_id": op, "supplier_tenant_id": sid, "kind": "order"}
    r = _post(
        c,
        h,
        "/api/market/orders",
        {**base, "lines": [{"offer_id": str(rice.id), "qty": 3, "price_minor": "154000"}]},
    )
    assert r.status_code == 409 and r.json()["detail"] == "line_expired"
    # السعر المتغيّر يحتاج قبولاً صريحاً (409) — لا ترقية صامتة
    r = _post(
        c,
        h,
        "/api/market/orders",
        {**base, "lines": [{"offer_id": str(sugar.id), "qty": 6, "price_minor": "110000"}]},
    )
    assert r.status_code == 409 and r.json()["detail"] == "price_changed"
    assert r.json()["extra"]["offers"][0]["new_minor"] == "118000"
    # الحدّ الأدنى بالفارق
    r = _post(
        c,
        h,
        "/api/market/orders",
        {**base, "lines": [{"offer_id": str(sugar.id), "qty": 3, "price_minor": "118000"}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "min_order_not_met"
    assert r.json()["extra"]["offers"][0]["short"] == 2
    # المدير محدود بسقف 300,000 قرش: 6 × 118000 = 708000 > السقف → permission_denied
    r = _post(
        c,
        hm,
        "/api/market/orders",
        {**base, "lines": [{"offer_id": str(sugar.id), "qty": 6, "price_minor": "118000"}]},
    )
    assert r.status_code == 403 and r.json()["extra"]["limit_minor"] == "300000"
    # المالك يرسل؛ إعادة الإرسال بالمعرّف نفسه تعيد الطلب نفسه (ACC-124)
    good = {**base, "lines": [{"offer_id": str(sugar.id), "qty": 6, "price_minor": "118000"}]}
    r = _post(c, h, "/api/market/orders", good)
    assert r.status_code == 201 and r.json()["created"] is True
    o = r.json()["order"]
    assert o["number_label"] == "PO-1" and o["status"] == "sent"
    assert o["status_label"] == "بانتظار رد المورد" and o["total_minor"] == "708000"
    assert o["lines"][0]["price_minor"] == "118000" and o["response_hours"] == 72
    r2 = _post(c, h, "/api/market/orders", good)
    assert r2.status_code == 200 and r2.json()["created"] is False
    assert r2.json()["order"]["id"] == o["id"]
    with platform_context():
        assert MarketOrder.unscoped.count() == 1
    assert c.get(f"/api/market/orders?op_id={op}", headers=h).json()["orders"][0]["id"] == o["id"]
    # طلب سعر بلا التزام سعري: المنتهي مقبول فيه ولا سعر في السطور
    r = _post(
        c,
        h,
        "/api/market/orders",
        {
            "op_id": str(uuid.uuid4()),
            "supplier_tenant_id": sid,
            "kind": "quote",
            "lines": [{"offer_id": str(rice.id), "qty": 3}],
        },
    )
    assert r.status_code == 201
    assert (
        r.json()["order"]["kind"] == "quote" and r.json()["order"]["lines"][0]["price_minor"] == ""
    )
    assert r.json()["order"]["total_minor"] == ""
    # العملة: مورد بعملة أخرى ممنوع بلا تحويل (ACC-140)
    with platform_context():
        egp = Tenant.unscoped.create(
            name="مورد مصري — تجريبي", base_currency="EGP", base_currency_exponent=2
        )
    _seed(egp)
    r = _post(
        c,
        h,
        "/api/market/orders",
        {**good, "op_id": str(uuid.uuid4()), "supplier_tenant_id": str(egp.id)},
    )
    assert r.status_code == 400 and r.json()["detail"] == "currency_mismatch"
    assert r.json()["extra"] == {"offer_currency": "EGP", "buyer_currency": "SDG"}


def test_lists_and_no_reply_resend(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """ORD-03/04: كلٌّ يرى طرفه؛ انقضاء المهلة «لم يُرد عليه» لا رفض؛ إعادة الإرسال إصدار جديد."""
    c, h = Client(), _h(ctx["tokens"]["owner"])
    sugar, _rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    good = {
        "op_id": str(uuid.uuid4()),
        "supplier_tenant_id": sid,
        "kind": "order",
        "lines": [{"offer_id": str(sugar.id), "qty": 6, "price_minor": "118000"}],
    }
    oid = _post(c, h, "/api/market/orders", good).json()["order"]["id"]
    with platform_context():
        ob = User.objects.create_user(
            tenant=two_tenants.b, username="ob2", display_name="ب", is_owner=True
        )
        _s, rb = issue_session_tokens(ob)
    hb = {"Authorization": f"Bearer {rb.access_token}"}
    # المشتري يرى طلبه؛ المورد يراه وارداً؛ لا يرى أحدهما قائمة الآخر
    mine = c.get("/api/market/orders", headers=h).json()
    assert mine["awaiting_count"] == 1 and mine["orders"][0]["buyer_step"] == "بانتظار رد المورد"
    assert mine["orders"][0]["content_line"] == "سكر أبيض كرتونة 12×1كغ ×6"
    assert c.get("/api/market/orders", headers=hb).json()["orders"] == []
    inc = c.get("/api/market/orders/incoming", headers=hb).json()
    assert inc["counts"] == {"all": 1, "awaiting": 1, "near": 0, "no_reply": 0}
    assert inc["orders"][0]["supplier_step"] == "أعِدّ عرض سعر أو اعتذر بسبب."
    assert inc["orders"][0]["buyer_name"] == ctx["tenant"].name
    assert c.get("/api/market/orders/incoming", headers=h).json()["orders"] == []
    # لا تُعاد قبل انقضاء المهلة
    assert _post(c, h, f"/api/market/orders/{oid}/resend").status_code == 400
    with platform_context():
        o = MarketOrder.unscoped.get(id=oid)
        o.sent_at = timezone.now() - timedelta(hours=80)
        o.save(update_fields=["sent_at"])
    mine = c.get("/api/market/orders", headers=h).json()["orders"][0]
    assert mine["no_reply"] is True and mine["list_status_label"] == "لم يُرد عليه"
    assert mine["status"] == "sent"  # لا يُحوَّل إلى مرفوض
    inc = c.get("/api/market/orders/incoming", headers=hb).json()
    assert inc["counts"]["no_reply"] == 1 and inc["counts"]["awaiting"] == 0
    r = _post(c, h, f"/api/market/orders/{oid}/resend")
    assert r.status_code == 200 and r.json()["order"]["version"] == 2
    assert r.json()["order"]["no_reply"] is False
    with platform_context():
        assert MarketOrder.unscoped.count() == 1
