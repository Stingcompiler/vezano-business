"""ORD-05/ORD-06 (T3.12): الإصدارات مرقَّمة والاتفاق هو المقبول لا الأحدث (ACC-125)؛ إصدار أحدث
بعد القبول = `conflict` يُعرض لا يُخفى؛ الذمّة من المستلم وحده (ACC-127)؛ منشأة ثالثة 404؛ مسودة
المورد لا تصل المشتري؛ الصلاحية لا تكون ماضياً والزيادة تحتاج سبباً؛ لا تجديد تلقائي للكتالوج."""

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
from market.models import MarketOffer, MarketOrder
from market.tests.test_orders import _seed

pytestmark = pytest.mark.django_db(transaction=True)


def _owner_headers(t: Any, username: str) -> dict[str, str]:
    with platform_context():
        u = User.objects.create_user(tenant=t, username=username, display_name="م", is_owner=True)
        _s, rt = issue_session_tokens(u)
    return {"Authorization": f"Bearer {rt.access_token}"}


def test_versions_quote_accept_conflict(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    sugar, _rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    hb = _owner_headers(two_tenants.b, "ob3")
    r = _post(
        c,
        h,
        "/api/market/orders",
        {
            "op_id": str(uuid.uuid4()),
            "supplier_tenant_id": sid,
            "kind": "order",
            "lines": [{"offer_id": str(sugar.id), "qty": 10, "price_minor": "118000"}],
        },
    )
    oid = r.json()["order"]["id"]
    # ORD-05: الإصدار 1 طلب المشتري وحدث «أُرسل الطلب»؛ منشأة ثالثة 404 نفسه
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["side"] == "buyer" and [v["number"] for v in d["versions"]] == [1]
    assert d["events"][0]["title"] == "أُرسل الطلب" and d["conflict"] is False
    assert d["ladder"][0]["requested"] == 10 and d["ladder"][0]["confirmed"] is None
    with platform_context():
        third = Tenant.unscoped.create(name="ثالثة", base_currency="SDG", base_currency_exponent=2)
    h3 = _owner_headers(third, "o3")
    assert c.get(f"/api/market/orders/{oid}", headers=h3).status_code == 404
    assert c.get(f"/api/market/orders/{oid}/quote", headers=h3).status_code == 404
    # ORD-06: الصلاحية لا تكون ماضياً؛ الزيادة تحتاج سبباً
    q = c.get(f"/api/market/orders/{oid}/quote", headers=hb).json()
    assert q["request"]["lines"][0]["qty_requested"] == 10 and q["catalog_expired"] == []
    yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
    in3 = (timezone.localdate() + timedelta(days=3)).isoformat()
    body = {
        "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 8, "price_minor": "118000"}],
        "valid_until": yesterday,
        "send": True,
    }
    r = _post(c, hb, f"/api/market/orders/{oid}/quote", body)
    assert r.status_code == 400 and r.json()["detail"] == "validity_past"
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            **body,
            "valid_until": in3,
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 12, "price_minor": "118000"}],
        },
    )
    assert r.status_code == 400 and r.json()["detail"] == "increase_reason_required"
    # مسودة لا تصل المشتري
    r = _post(c, hb, f"/api/market/orders/{oid}/quote", {**body, "valid_until": in3, "send": False})
    assert r.status_code == 200 and r.json()["version"]["draft"] is True
    assert [
        v["number"] for v in c.get(f"/api/market/orders/{oid}", headers=h).json()["versions"]
    ] == [1]
    assert c.get(f"/api/market/orders/{oid}", headers=hb).json()["versions"][1]["draft"] is True
    # الإرسال: الإصدار 2 عرض المورد؛ الحالة «عرض سعر»
    r = _post(c, hb, f"/api/market/orders/{oid}/quote", {**body, "valid_until": in3})
    assert r.status_code == 200 and r.json()["version"]["number"] == 2
    assert r.json()["version"]["summary"] == "سكر أبيض 8 لا 10"
    assert r.json()["order"]["status"] == "quoted"
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert [v["number"] for v in d["versions"]] == [1, 2] and d["events"][-1]["kind"] == "quoted"
    # ORD-07 (خادم): قبول النسخة 2 = الاتفاق المثبَّت؛ ثم تعديل لاحق = conflict يُعرض لا يُخفى
    r = _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2})
    assert r.status_code == 200 and r.json()["agreed_version"] == 2
    assert r.json()["order"]["status"] == "accepted" and r.json()["conflict"] is False
    assert r.json()["ladder"][0]["confirmed"] == 8
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            **body,
            "valid_until": in3,
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 8, "price_minor": "125000"}],
        },
    )
    assert r.status_code == 200 and r.json()["version"]["kind"] == "revision"
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["conflict"] is True and d["agreed_version"] == 2 and d["latest_version"] == 3
    assert d["versions"][2]["kind_label"] == "تعديل لاحق من المورد — غير مقبول"
    assert d["versions"][1]["is_agreement"] is True and d["order"]["status"] == "accepted"
    # الذمّة من المستلم وحده: لا قيمة قبل الاستلام
    assert d["received_value_minor"] == "0" and d["gap_value_minor"] == "0"
    # لا تجديد تلقائي: انتهاء الكتالوج يظهر في التحرير ولا يمنع عرضاً
    with platform_context():
        sugar.valid_until = timezone.localdate() - timedelta(days=1)
        sugar.save(update_fields=["valid_until"])
        assert MarketOffer.unscoped.get(id=sugar.id).status == "published"
    q = c.get(f"/api/market/orders/{oid}/quote", headers=hb).json()
    assert q["catalog_expired"] == [str(sugar.id)]
    # اعتذار بسبب على طلب آخر
    r2 = _post(
        c,
        h,
        "/api/market/orders",
        {
            "op_id": str(uuid.uuid4()),
            "supplier_tenant_id": sid,
            "kind": "quote",
            "lines": [{"offer_id": str(sugar.id), "qty": 5}],
        },
    )
    assert r2.status_code == 201, r2.json()
    oid2 = r2.json()["order"]["id"]
    assert _post(c, hb, f"/api/market/orders/{oid2}/decline", {"reason": ""}).status_code == 400
    r = _post(c, hb, f"/api/market/orders/{oid2}/decline", {"reason": "نفد المخزون"})
    assert r.status_code == 200 and r.json()["order"]["status"] == "rejected"
    with platform_context():
        assert MarketOrder.unscoped.get(id=oid2).note == "نفد المخزون"


def test_compare_reject_superseded_and_ship(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """ORD-07/08: القبول يخص النسخة المعروضة وحدها (الأقدم `version_superseded`)؛ الرفض بسبب يعيد
    «بانتظار رد المورد»؛ الشحن لا يتجاوز المؤكَّد ولا يُقتطع صامتاً؛ كل شحنة بمرجع مستقل."""
    c, h = Client(), _h(ctx["tokens"]["owner"])
    sugar, _rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    hb = _owner_headers(two_tenants.b, "ob4")
    in3 = (timezone.localdate() + timedelta(days=3)).isoformat()
    oid = _post(
        c,
        h,
        "/api/market/orders",
        {
            "op_id": str(uuid.uuid4()),
            "supplier_tenant_id": sid,
            "kind": "order",
            "lines": [{"offer_id": str(sugar.id), "qty": 10, "price_minor": "118000"}],
        },
    ).json()["order"]["id"]
    quote = {
        "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 8, "price_minor": "118000"}],
        "valid_until": in3,
        "delivery_days": 3,
        "send": True,
    }
    assert _post(c, hb, f"/api/market/orders/{oid}/quote", quote).status_code == 200  # النسخة 2
    # رفض صريح وطلب تعديل → بانتظار رد المورد؛ ثم النسخة 3
    r = _post(c, h, f"/api/market/orders/{oid}/reject", {"version": 2, "reason": "السعر أعلى"})
    assert r.status_code == 200 and r.json()["order"]["status"] == "sent"
    assert r.json()["events"][-1]["title"] == "رُفضت النسخة 2 وطُلب تعديل"
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            **quote,
            "delivery_days": 5,
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 8, "price_minor": "125500"}],
        },
    )
    assert r.json()["version"]["number"] == 3
    # المقارنة: فتح النسخة 2 = تعارض بفرق النسختين؛ قبولها مرفوض (لا نحوّل ضمناً)
    cmp = c.get(f"/api/market/orders/{oid}/compare?version=2", headers=h).json()
    assert cmp["conflict"] is True and cmp["shown"]["number"] == 2 and cmp["latest"]["number"] == 3
    assert cmp["rows"][0]["diff_label"] == "كميةٌ أقل"
    assert cmp["rows"][0]["version_diff_label"] == "سعرٌ أعلى"
    assert cmp["latest_total_minor"] == str(8 * 125500) and cmp["request_total_minor"] == str(
        10 * 118000
    )
    r = _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2})
    assert r.status_code == 400 and r.json()["detail"] == "version_superseded"
    assert r.json()["extra"]["latest"] == 3
    assert c.get(f"/api/market/orders/{oid}/compare", headers=h).json()["conflict"] is False
    r = _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 3})
    assert r.status_code == 200 and r.json()["agreed_version"] == 3
    # ORD-08: المورد وحده يشحن؛ الحدّ الصلب؛ مراجع مستقلة؛ النسبة
    assert _post(c, h, f"/api/market/orders/{oid}/shipments", {"lines": []}).status_code == 404
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar.id), "qty": 9}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "exceeds_confirmed"
    assert r.json()["extra"] == {"offer_id": str(sugar.id), "max": 8, "over": 1}
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar.id), "qty": 5}], "carrier_ref": "ناقل 7"},
    )
    assert r.status_code == 201 and r.json()["shipped"] == "SH-01" and r.json()["percent"] == 62
    assert r.json()["lines"][0]["remaining"] == 3 and r.json()["next_ref"] == "SH-02"
    lst = c.get("/api/market/orders", headers=h).json()["orders"][0]
    assert lst["list_status_label"] == "مشحون جزئياً — 62%" and lst["status"] == "preparing"
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["ladder"][0]["shipped"] == 5 and d["ladder"][0]["received"] == 0
    assert d["events"][-1]["title"] == "شُحنت SH-01"
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar.id), "qty": 3}]},
    )
    assert (
        r.status_code == 201
        and r.json()["percent"] == 100
        and r.json()["order"]["status"] == "delivered"
    )
    # المشتري يرى الشحنات بمراجعها ولا يشحن
    sb = c.get(f"/api/market/orders/{oid}/shipments", headers=h).json()
    assert sb["side"] == "buyer" and [x["ref_label"] for x in sb["shipments"]] == ["SH-01", "SH-02"]
    assert sb["can_ship"] is False
