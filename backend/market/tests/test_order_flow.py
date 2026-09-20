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
from market.models import MarketOffer, MarketOrder, MarketOrderEvent
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


def test_receive_and_cancel_remaining(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """ORD-09/10: الاستلام لا يتجاوز المشحون (ACC-128) والزيادة بسبب تُحال للمراجعة؛ المرفوض بند
    مطالبة؛ الفارق خلاف لا تسوية (ACC-132)؛ إلغاء المتبقّي يُقفل غير المشحون فقط بسبب وبصلاحية
    حدّ مالي (ACC-129)؛ لا حركة مخزون."""
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hc = _h(ctx["tokens"]["cashier"])
    sugar, _rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    hb = _owner_headers(two_tenants.b, "ob5")
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
    _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 10, "price_minor": "118000"}],
            "valid_until": in3,
            "send": True,
        },
    )
    _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2})
    ship_url = f"/api/market/orders/{oid}/shipments"
    sh1 = _post(c, hb, ship_url, {"lines": [{"offer_id": str(sugar.id), "qty": 8}]}).json()
    shipment_id = sh1["shipments"][0]["id"]
    # ORD-09: الحمولة بأعمدتها؛ المورد لا يستلم
    rp = c.get(f"/api/market/orders/{oid}/receive", headers=h).json()
    assert rp["shipment"]["ref_label"] == "SH-01" and rp["lines"][0]["shipped_in_this"] == 8
    assert rp["lines"][0]["confirmed"] == 10 and rp["pending_shipments"] == ["SH-01"]
    assert c.get(f"/api/market/orders/{oid}/receive", headers=hb).status_code == 404
    # يتجاوز المشحون بلا سبب → رفض خادمي؛ رفض كمية بلا سبب → مرفوض
    recv = f"/api/market/orders/{oid}/receive"
    r = _post(
        c,
        h,
        recv,
        {"shipment_id": shipment_id, "lines": [{"offer_id": str(sugar.id), "qty_received": 9}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "exceeds_shipped"
    assert r.json()["extra"] == {"offer_id": str(sugar.id), "max": 8, "over": 1}
    r = _post(
        c,
        h,
        recv,
        {
            "shipment_id": shipment_id,
            "lines": [{"offer_id": str(sugar.id), "qty_received": 6, "qty_rejected": 1}],
        },
    )
    assert r.status_code == 400 and r.json()["detail"] == "reject_reason_required"
    # استلام 6 ورفض 1 بسبب وفتح خلاف الفارق (8 مشحون − 6 مستلم = 2 فارق)
    r = _post(
        c,
        h,
        recv,
        {
            "shipment_id": shipment_id,
            "open_dispute": True,
            "lines": [
                {
                    "offer_id": str(sugar.id),
                    "qty_received": 6,
                    "qty_rejected": 1,
                    "reason": "صندوقان تالفان",
                    "disposition": "return",
                }
            ],
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["received"] == "SH-01" and r.json()["gap"] == 2
    assert r.json()["dispute_opened"] is True and r.json()["order"]["status"] == "disputed"
    lad = r.json()["ladder"][0]
    assert lad["shipped"] == 8 and lad["received"] == 6 and lad["gap"] == 2
    assert r.json()["received_value_minor"] == str(6 * 118000)
    assert r.json()["gap_value_minor"] == str(2 * 118000)
    assert [e["kind"] for e in r.json()["events"]][-2:] == ["received", "dispute_opened"]
    # الشحنة نفسها لا تُستلم مرتين
    r = _post(
        c,
        h,
        recv,
        {"shipment_id": shipment_id, "lines": [{"offer_id": str(sugar.id), "qty_received": 1}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "already_received"
    # ORD-10: ما يُلغى = المؤكَّد غير المشحون (2)؛ المستلم يبقى؛ الكاشير لا يلغي بل يطلب
    cr = f"/api/market/orders/{oid}/cancel-remaining"
    bd = c.get(cr, headers=h).json()
    assert (
        bd["cancellable_total"] == 2 and bd["received_total"] == 6 and bd["in_transit_total"] == 2
    )
    assert bd["full_cancel_available"] is False and bd["shipment_refs"] == ["SH-01"]
    assert bd["received_value_minor"] == str(6 * 118000)
    assert c.get(cr, headers=hc).json()["can_cancel"] is False
    r = _post(c, hc, cr, {"reason": "تأخّر"})
    assert r.status_code == 403
    r = _post(c, hc, cr, {"request": True})
    assert r.status_code == 200
    assert _post(c, h, cr, {"reason": ""}).status_code == 400
    r = _post(c, h, cr, {"reason": "تأخّر المتبقّي عن موسم الطلب — دبّرنا البديل محلياً."})
    assert r.status_code == 200 and r.json()["already_cancelled"] is True
    assert r.json()["order"]["list_status_label"] == "مكتمل جزئياً — أُلغي المتبقّي"
    assert r.json()["order"]["status"] == "disputed"  # الخلاف قائم — الإلغاء لا يُنهيه
    assert r.json()["lines"][0]["already_cancelled"] == 2
    assert _post(c, h, cr, {"reason": "x"}).json()["detail"] == "already_cancelled"
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["events"][-1]["title"] == "أُلغي المتبقّي — 2"
    assert d["events"][-2]["title"] == "طُلب إلغاء المتبقّي من المالك"
    # لا حركة مخزون من الاستلام (LINK-03 مقفل)
    from inventory.models import StockMovement

    with platform_context():
        assert not StockMovement.unscoped.filter(
            tenant_id=ctx["tenant"].id, note__contains="SH-"
        ).exists()


def test_returns_and_disputes(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """ORD-11/12: المرتجع لا يتجاوز المستلَم غير المُعاد والفحص خادمي (ACC-141) ولا خصم قبل التنفيذ؛
    الخلاف سجل DSP بدفترين مستقلين، الدليل لا تسوية، القبول بحدّ ORG-02، والإغلاق لا يحرّك دفتراً
    (ACC-148)."""
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hc = _h(ctx["tokens"]["cashier"])
    sugar, _rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    hb = _owner_headers(two_tenants.b, "ob6")
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
    _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 10, "price_minor": "118000"}],
            "valid_until": in3,
            "send": True,
        },
    )
    _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2})
    sh = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar.id), "qty": 8}]},
    ).json()["shipments"][0]["id"]
    r = _post(
        c,
        h,
        f"/api/market/orders/{oid}/receive",
        {
            "shipment_id": sh,
            "open_dispute": True,
            "lines": [{"offer_id": str(sugar.id), "qty_received": 7, "reason": "صندوق لم يصل"}],
        },
    )
    assert r.status_code == 200 and r.json()["open_disputes"] == ["DSP-1"]
    # ORD-11: القابل للإرجاع = المستلَم 7؛ الطلب بلا سبب مرفوض؛ 8 > 7 مرفوض خادمياً
    ru = f"/api/market/orders/{oid}/returns"
    rp = c.get(ru, headers=h).json()
    assert rp["lines"][0]["returnable"] == 7 and rp["next_ref"] == "RT-01" and len(rp["steps"]) == 3
    r = _post(c, h, ru, {"lines": [{"offer_id": str(sugar.id), "qty": 8, "reason": "مبلَّلة"}]})
    assert r.status_code == 400 and r.json()["detail"] == "exceeds_returnable"
    assert r.json()["extra"]["max"] == 7
    assert _post(c, h, ru, {"lines": [{"offer_id": str(sugar.id), "qty": 3}]}).status_code == 400
    r = _post(c, h, ru, {"lines": [{"offer_id": str(sugar.id), "qty": 3, "reason": "عبوات مبلَّلة"}]})
    assert r.status_code == 201 and r.json()["created"]["status"] == "requested"
    rid = r.json()["created"]["id"]
    # لا خصم من الذمّة قبل التنفيذ: قيمة المستلم في ORD-05 كما هي
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["received_value_minor"] == str(7 * 118000)
    # الثانية: القابل للإرجاع صار 4 (7 − 3 قيد الموافقة)
    assert c.get(ru, headers=h).json()["lines"][0]["returnable"] == 4
    r = _post(c, h, ru, {"lines": [{"offer_id": str(sugar.id), "qty": 5, "reason": "x"}]})
    assert r.status_code == 400 and r.json()["extra"] == {
        "offer_id": str(sugar.id),
        "max": 4,
        "returned_before": 3,
    }
    # قرار المورد جزئي (2 من 3) — حالة معلَنة؛ المشتري لا يقرّر
    du = f"/api/market/orders/{oid}/returns/{rid}/decide"
    assert (
        _post(c, h, du, {"lines": [{"offer_id": str(sugar.id), "approved_qty": 3}]}).status_code
        == 404
    )
    r = _post(
        c,
        hb,
        du,
        {"lines": [{"offer_id": str(sugar.id), "approved_qty": 2}], "note": "كرتونة سليمة"},
    )
    assert r.status_code == 200 and r.json()["return"]["status"] == "partial"
    assert r.json()["return"]["lines"][0]["approved_qty"] == 2
    assert _post(c, hb, du, {"lines": []}).json()["detail"] == "already_decided"
    assert c.get(ru, headers=h).json()["lines"][0]["returnable"] == 5  # 7 − 2 موافَق عليها
    # ORD-12: الخلاف بدفترين؛ الدور على المورد؛ الكاشير يرفع دليلاً ولا يقبل رقم المورد
    dsu = f"/api/market/orders/{oid}/disputes"
    ds = c.get(dsu, headers=h).json()
    assert ds["can_settle"] is True and len(ds["disputes"]) == 1
    dsp = ds["disputes"][0]
    assert dsp["ref_label"] == "DSP-1" and dsp["title"] == "فارق كرتونة واحدة"
    assert dsp["shipment_ref"] == "SH-01" and dsp["turn_label"] == "بانتظار رد المورد"
    assert dsp["lines"][0]["buyer_value_minor"] == str(7 * 118000)
    assert dsp["lines"][0]["supplier_value_minor"] == str(8 * 118000)
    assert c.get(dsu, headers=hb).json()["disputes"][0]["turn_label"] == "بانتظارك"
    assert c.get(dsu, headers=hc).json()["can_settle"] is False
    did = dsp["id"]
    r = _post(c, hc, f"{dsu}/{did}/evidence", {"title": "صورة الشحنة عند الاستلام — 7 كراتين"})
    assert r.status_code == 200 and r.json()["dispute"]["turn"] == "supplier"
    assert len(r.json()["dispute"]["evidence"]) == 2
    r = _post(c, hb, f"{dsu}/{did}/evidence", {"title": "بيان تحميل يذكر 8 كراتين"})
    assert (
        r.json()["dispute"]["turn"] == "buyer"
        and r.json()["dispute"]["turn_label"] == "بانتظار رد المشتري"
    )
    assert _post(c, hc, f"{dsu}/{did}/accept-supplier").status_code == 403
    assert (
        _post(c, hc, f"{dsu}/{did}/close", {"outcome": "credit", "ref": "CN-9"}).status_code == 403
    )
    r = _post(c, h, f"{dsu}/{did}/mediator")
    assert r.status_code == 200 and r.json()["dispute"]["mediator_requested_at"]
    # قبول رقم المورد وتعديل دفتري (المالك): المستلم يصير 8 ويُغلق بقبول بالحالة؛ دفتر المورد لا يُمسّ
    r = _post(c, h, f"{dsu}/{did}/accept-supplier")
    assert r.status_code == 200 and r.json()["dispute"]["status"] == "closed"
    assert r.json()["dispute"]["outcome"] == "accept"
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["ladder"][0]["received"] == 8 and d["ladder"][0]["gap"] == 0
    assert d["open_disputes"] == [] and d["events"][-1]["title"] == "أُغلق DSP-1 — قبول بالحالة"
    assert _post(c, h, f"{dsu}/{did}/evidence", {"title": "x"}).json()["detail"] == "dispute_closed"


def test_payments_probe_and_restore(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """ORD-13/14/15: الإيصال ليس تحصيلاً (ACC-133) والمرجع مرة واحدة (ACC-15) والتوزيع صريح؛
    الاستعلام بالمعرّف لا ينشئ شيئاً وحمولة مختلفة تعارض (ACC-124)؛ الاستعادة توقف التنفيذ ولا
    تُنشئ قيداً والمراجعة للمالك (ACC-137)."""
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hm = _h(ctx["tokens"]["manager"])
    sugar, _rice = _seed(two_tenants.b)
    sid = str(two_tenants.b.id)
    hb = _owner_headers(two_tenants.b, "ob7")
    in3 = (timezone.localdate() + timedelta(days=3)).isoformat()
    op = str(uuid.uuid4())
    lines = [{"offer_id": str(sugar.id), "qty": 10, "price_minor": "118000"}]
    oid = _post(
        c,
        h,
        "/api/market/orders",
        {"op_id": op, "supplier_tenant_id": sid, "kind": "order", "lines": lines},
    ).json()["order"]["id"]
    # ORD-14: الاستعلام بنفس المعرّف لا ينشئ شيئاً؛ نفس الحمولة = وصل؛ حمولة مختلفة = تعارض بفرقه
    pr = _post(c, h, "/api/market/orders/probe", {"op_id": op, "lines": lines}).json()
    assert pr["found"] is True and pr["same_payload"] is True and pr["diff"] == []
    pr = _post(
        c, h, "/api/market/orders/probe", {"op_id": op, "lines": [{**lines[0], "qty": 14}]}
    ).json()
    assert pr["same_payload"] is False and pr["diff"][0]["server_qty"] == 10
    assert pr["diff"][0]["local_qty"] == 14
    pr = _post(
        c, h, "/api/market/orders/probe", {"op_id": str(uuid.uuid4()), "lines": lines}
    ).json()
    assert pr["found"] is False
    with platform_context():
        assert MarketOrder.unscoped.count() == 1
    # اتفاق وشحن واستلام 8 → المستحقّ 8 × 118000
    _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 10, "price_minor": "118000"}],
            "valid_until": in3,
            "send": True,
        },
    )
    _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2})
    shp = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar.id), "qty": 8}]},
    ).json()["shipments"][0]["id"]
    _post(
        c,
        h,
        f"/api/market/orders/{oid}/receive",
        {"shipment_id": shp, "lines": [{"offer_id": str(sugar.id), "qty_received": 8}]},
    )
    pu = f"/api/market/orders/{oid}/payments"
    pp = c.get(pu, headers=h).json()
    assert pp["due_minor"] == str(8 * 118000) and pp["payments"] == []
    # ORD-13: مبلغ مخالف بلا توزيع مرفوض؛ المرجع مرة واحدة؛ الرفع لا يُسدّد
    r = _post(c, h, pu, {"amount_minor": "500000", "transfer_ref": "TRX-1"})
    assert r.status_code == 400 and r.json()["detail"] == "amount_mismatch"
    assert r.json()["extra"]["due_minor"] == str(8 * 118000)
    r = _post(c, h, pu, {"amount_minor": str(8 * 118000), "transfer_ref": "TRX-1"})
    assert r.status_code == 201 and r.json()["created"]["status"] == "recorded"
    pid = r.json()["created"]["id"]
    assert r.json()["due_minor"] == str(8 * 118000)  # لم تنقص الذمّة بالرفع
    r = _post(c, h, pu, {"amount_minor": "1", "transfer_ref": "TRX-1"})
    assert r.status_code == 400 and r.json()["detail"] == "reference_used"
    # المشتري لا يطابق؛ المورد يطابق؛ الذمّة تنقص عند المطابقة بتاريخين
    assert _post(c, h, f"{pu}/{pid}/match").status_code == 404
    r = _post(c, h, f"{pu}/{pid}/remind")
    assert r.status_code == 200 and r.json()["payment"]["reminded_at"]
    r = _post(c, hb, f"{pu}/{pid}/match", {"note": "وصل"})
    assert r.status_code == 200 and r.json()["payment"]["status"] == "matched"
    assert r.json()["due_minor"] == "0" and r.json()["paid_minor"] == str(8 * 118000)
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["events"][-1]["title"] == "طابَق المورد PAY-1"
    assert (
        "تاريخ التحويل" in d["events"][-1]["detail"]
        and "تاريخ المطابقة" in d["events"][-1]["detail"]
    )
    assert _post(c, hb, f"{pu}/{pid}/match").json()["detail"] == "already_decided"
    # دفعة على طلبين: التوزيع صريح ويساوي المبلغ
    oid2 = _post(
        c,
        h,
        "/api/market/orders",
        {"op_id": str(uuid.uuid4()), "supplier_tenant_id": sid, "kind": "order", "lines": lines},
    ).json()["order"]["id"]
    r = _post(
        c,
        h,
        pu,
        {
            "amount_minor": "300000",
            "transfer_ref": "TRX-2",
            "allocations": [
                {"order_id": oid, "amount_minor": "100000"},
                {"order_id": oid2, "amount_minor": "150000"},
            ],
        },
    )
    assert r.status_code == 400 and r.json()["detail"] == "allocation_mismatch"
    r = _post(
        c,
        h,
        pu,
        {
            "amount_minor": "300000",
            "transfer_ref": "TRX-2",
            "allocations": [
                {"order_id": oid, "amount_minor": "100000"},
                {"order_id": oid2, "amount_minor": "200000"},
            ],
        },
    )
    assert r.status_code == 201 and len(r.json()["created"]["allocations"]) == 2
    # ORD-15: الاستعادة للمالك؛ توقف الشحن؛ الأحداث بعد النسخة تحتاج قراراً واحداً واحداً
    ru = f"/api/market/orders/{oid}/restore"
    point = (timezone.now() - timedelta(minutes=5)).isoformat()
    assert _post(c, hm, ru, {"restored_to": point}).status_code == 403
    assert _post(c, hb, ru, {"restored_to": point}).status_code == 404
    with platform_context():
        MarketOrderEvent.unscoped.filter(
            order_id=oid, kind__in=["sent", "quoted", "accepted"]
        ).update(at=timezone.now() - timedelta(minutes=10))
    r = _post(c, h, ru, {"restored_to": point})
    assert r.status_code == 200 and r.json()["reconciling"] is True
    pending = r.json()["pending"]
    assert len(pending) >= 3 and r.json()["can_review"] is True
    assert r.json()["blocked_transfers"][0]["ref"] == "LINK-03"
    assert c.get(ru, headers=hm).json()["can_review"] is False
    r = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar.id), "qty": 1}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "reconciling"
    ev0 = pending[0]["id"]
    r = _post(c, h, f"{ru}/events/{ev0}", {"decision": "void"})
    assert r.status_code == 400 and r.json()["detail"] == "reason_required"
    assert _post(c, hm, f"{ru}/events/{ev0}", {"decision": "reapply"}).status_code == 403
    for i, e in enumerate(pending):
        body = {"decision": "reapply"} if i else {"decision": "void", "reason": "لم يقع"}
        r = _post(c, h, f"{ru}/events/{e['id']}", body)
        assert r.status_code == 200
    assert r.json()["reconciling"] is False and r.json()["pending"] == []
    assert len(r.json()["decided"]) == len(pending)
    d = c.get(f"/api/market/orders/{oid}", headers=h).json()
    assert d["events"][-1]["title"] == "أُعيد بناء الطلب"
    assert d["received_value_minor"] == str(8 * 118000)  # لا قيد صامت — القيم كما هي
