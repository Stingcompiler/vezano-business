"""PUR-03/PUR-04 (T2.14): الاعتماد توقيع على مبلغ — المستند يُبنى من الأمر بفروقه؛ الحفظ لا يمنعه
نقص والاعتماد يمنعه (رقم فاتورة المورد، زيادة بلا سبب)؛ فوق الحدّ يُعرض الرقمان والإحالة تُبقيه
مسوّدة وتنبّه المالك؛ الاعتماد مرة واحدة بالهوية يحرّك المخزون (استلام بحركاته) والذمّة (تستحق بعد
30 يوماً) ويحدّث الأمر؛ المرتجع بسعر المستند لا يتجاوز المستلَم ناقص المردود، بسبب لكل سطر، يخفّض
المخزون والذمّة؛ ردّ المورد الجزئي يُسجَّل والمرفوض لا يُخصم."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.models import Notification, Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from inventory.models import PurchaseDocument, StockMovement
from inventory.tests.test_inventory import _api, _receipt_op, ctx  # noqa: F401
from parties import services as party_services
from sales.tests.test_sale import do_push

pytestmark = pytest.mark.django_db(transaction=True)


def _post(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.post(path, body, content_type="application/json", **h)  # type: ignore[arg-type]


def _patch(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.patch(path, body, content_type="application/json", **h)  # type: ignore[arg-type]


def test_document_limit_refer_approve_return_and_response(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    with tenant_context(ctx["tenant"].id):
        supplier = party_services.create_party(
            party_id=None,
            name="مؤسسة الرياض للمواد الغذائية",
            phone="0911",
            created_by=ctx["owner"],
            distinct_from=None,
        )
        supplier.is_supplier = True
        supplier.save(update_fields=["is_supplier"])
    # استلام سابق: 40 كرتونة × 900.00 → متوسط تكلفة الكرتون 900.00
    op = _receipt_op(ctx, sugar, qty="40000", factor="12000", cost="90000")
    op["members"][0]["payload"]["party_id"] = str(supplier.id)
    assert do_push(ctx, op) == ["accepted"]
    c, h = _api(ctx)
    # أمر: 400 كرتونة × 900.00 = 360,000.00 — فوق حدّ المدير (300,000.00)
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders",
        {
            "supplier_id": str(supplier.id),
            "confirmed": True,
            "lines": [{"item_id": sugar, "unit_code": "carton", "qty_milli": "400000"}],
        },
    )
    assert r.status_code == 201, r.content
    order_id = r.json()["order"]["id"]
    # مدير الفرع يبدأ المستند من الأمر
    with platform_context():
        role = Role.unscoped.create(tenant=ctx["tenant"], code="manager", name="مدير فرع")
        mgr = User.objects.create_user(tenant=ctx["tenant"], username="mgr", display_name="خالد")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=mgr, branch=ctx["branch"], role=role
        )
    with tenant_context(ctx["tenant"].id):
        from core.auth.devices import register_device

        reg = register_device(user=mgr, branch=ctx["branch"], name="جهاز المدير")
    mh = {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}
    r = _post(c, mh, f"/api/inventory/purchasing/orders/{order_id}/document", {})
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["number"] == "1" and d["status"] == "draft" and d["total_minor"] == "36000000"
    assert d["order_estimated_minor"] == "36000000" and d["diff_count"] == 0
    assert d["approval"] == {
        "viewer_name": "خالد",
        "limit_minor": "300000",
        "over_limit": True,
        "can_approve": False,
    }
    assert [b["code"] for b in d["blockers"]] == ["invoice_number_required"]
    # الطلب ثانيةً يعيد المسوّدة نفسها
    assert (
        _post(c, mh, f"/api/inventory/purchasing/orders/{order_id}/document", {}).json()[
            "document"
        ]["id"]
        == d["id"]
    )
    doc_id = d["id"]
    line_id = d["lines"][0]["id"]
    # الحفظ لا يمنعه نقص: وصل 410 بسعر 910.00 (فرق كمية وسعر) بلا سبب ولا رقم فاتورة
    r = _patch(
        c,
        mh,
        f"/api/inventory/purchasing/documents/{doc_id}",
        {"lines": [{"id": line_id, "received_qty_milli": "410000", "unit_price_minor": "91000"}]},
    )
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["total_minor"] == "37310000" and d["lines"][0]["diff"] == "qty"
    assert {b["code"] for b in d["blockers"]} == {
        "invoice_number_required",
        "excess_reason_required",
    }
    # الاعتماد يُمنع: أولاً الحدّ (الرقمان)، ثم المعوّقات
    r = _post(c, mh, f"/api/inventory/purchasing/documents/{doc_id}/approve", {})
    assert r.status_code == 403 and r.json()["detail"] == "over_limit"
    assert r.json()["extra"] == {"limit_minor": "300000", "total_minor": "37310000"}
    # الإحالة تُبقيه مسوّدة (محالاً) وتنبّه المالك
    r = _post(c, mh, f"/api/inventory/purchasing/documents/{doc_id}/refer", {})
    assert r.status_code == 200 and r.json()["document"]["status"] == "referred"
    assert r.json()["document"]["referred_to_name"] == "سالم"
    with tenant_context(ctx["tenant"].id):
        n = Notification.objects.get(kind="purchase_referred")
        assert n.needs_action is True and n.href == f"/purchasing/documents/{doc_id}"
        stock_before = StockMovement.objects.count()
        assert party_services.supplier_owed_minor(supplier) == 0
    # المالك: بلا معوّقات لا اعتماد
    r = _post(c, h, f"/api/inventory/purchasing/documents/{doc_id}/approve", {})
    assert r.status_code == 400 and r.json()["detail"] == "blocked"
    assert len(r.json()["extra"]["blockers"]) == 2
    # بالرقم والسبب يُعتمد: استلام بحركاته، ذمّة تستحق بعد 30 يوماً، الأمر مستلَم، الأثر معلَن
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{doc_id}/approve",
        {
            "supplier_invoice_number": "F-2291",
            "lines": [{"id": line_id, "excess_reason": "المورد أرسل 10 كراتين زيادة هدية مدفوعة"}],
        },
    )
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["status"] == "approved" and d["approved_by_name"] == "سالم" and d["approved_at"]
    assert d["receipt_number"] == "PD-1" and d["due_at"] and d["blockers"] == []
    fx = d["effects"]
    assert fx["stock"] == [{"item_name": "سكر", "qty_milli": "410000", "unit_name": "كرتونة"}]
    # المتوسط المرجّح للكرتون: (40×900 + 410×910) / 450 = 909.11
    assert fx["cost"][0]["before_minor"] == "90000" and fx["cost"][0]["after_minor"] == "90911"
    assert fx["payable_minor"] == "37310000"
    with tenant_context(ctx["tenant"].id):
        assert StockMovement.objects.count() == stock_before + 1
        mv = StockMovement.objects.order_by("-received_at").first()
        assert mv is not None and mv.reason == "receive" and mv.delta_base_qty_milli == 4920000
        assert party_services.supplier_owed_minor(supplier) == 37310000
        from catalog import services as catalog_services

        assert catalog_services.branch_balances(ctx["branch"].id)[sugar] == "5400000"
    o = c.get(f"/api/inventory/purchasing/orders/{order_id}", **h).json()["order"]  # type: ignore[arg-type]
    assert o["status"] == "received"
    # الاعتماد مرة واحدة: التكرار لا يضيف استلاماً ثانياً؛ والتعديل بعده ممنوع
    r = _post(c, h, f"/api/inventory/purchasing/documents/{doc_id}/approve", {})
    assert r.status_code == 200
    with tenant_context(ctx["tenant"].id):
        assert StockMovement.objects.count() == stock_before + 1
        assert PurchaseDocument.objects.get(id=doc_id).receipt is not None
    r = _patch(c, h, f"/api/inventory/purchasing/documents/{doc_id}", {"note": "x"})
    assert r.status_code == 400 and r.json()["detail"] == "document_locked"
    # PUR-04: المرتجع لا يتجاوز المستلَم وبسبب لكل سطر
    det = c.get(f"/api/inventory/purchasing/documents/{doc_id}", **h).json()  # type: ignore[arg-type]
    assert det["return_limits"] == {line_id: 410000}
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{doc_id}/return",
        {"lines": [{"document_line_id": line_id, "qty_milli": "500000", "reason": ""}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "lines_invalid"
    assert {e["code"] for e in r.json()["extra"]["errors"]} == {
        "exceeds_received",
        "reason_required",
    }
    # 20 كرتونة تالفة بسعر المستند (910.00) = 18,200.00 إشعار دائن؛ المخزون ينقص
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{doc_id}/return",
        {
            "lines": [
                {"document_line_id": line_id, "qty_milli": "20000", "reason": "تالف عند الفتح"}
            ]
        },
    )
    assert r.status_code == 201, r.content
    ret = r.json()["return"]
    assert ret["number"] == "1" and ret["status"] == "recorded" and ret["total_minor"] == "1820000"
    assert ret["lines"][0]["unit_price_minor"] == "91000"
    with tenant_context(ctx["tenant"].id):
        assert party_services.supplier_owed_minor(supplier) == 37310000 - 1820000
        assert catalog_services.branch_balances(ctx["branch"].id)[sugar] == "5160000"
        mv = StockMovement.objects.order_by("-received_at").first()
        assert mv is not None and mv.reason == "purchase_return"
    det = c.get(f"/api/inventory/purchasing/documents/{doc_id}", **h).json()  # type: ignore[arg-type]
    assert det["return_limits"] == {line_id: 390000} and len(det["returns"]) == 1
    # ردّ المورد: قبل 15 من 20 — المقبول وحده يُخصم، المرفوض يبقى مفتوحاً ولا يعود للمخزون
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}",
        {
            "note": "قبلنا 15 كرتونة؛ الخمس الباقية تلفها من التخزين عندكم",
            "lines": [
                {"id": ret["lines"][0]["id"], "accepted_qty_milli": "15000", "supplier_note": ""}
            ],
        },
    )
    assert r.status_code == 200, r.content
    ret = r.json()["return"]
    assert ret["status"] == "partial" and ret["accepted_minor"] == "1365000"
    assert ret["rejected_minor"] == "455000" and ret["responded_at"]
    with tenant_context(ctx["tenant"].id):
        assert party_services.supplier_owed_minor(supplier) == 37310000 - 1365000
        assert catalog_services.branch_balances(ctx["branch"].id)[sugar] == "5160000"
    # المدير يعتمد ما دون حدّه: 3 كراتين × 900.00 = 2,700.00 < 3,000.00
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders",
        {
            "supplier_id": str(supplier.id),
            "confirmed": True,
            "lines": [{"item_id": sugar, "unit_code": "carton", "qty_milli": "3000"}],
        },
    )
    small = r.json()["order"]["id"]
    d2 = _post(c, mh, f"/api/inventory/purchasing/orders/{small}/document", {}).json()["document"]
    assert d2["approval"]["over_limit"] is False and d2["approval"]["can_approve"] is True
    r = _post(
        c,
        mh,
        f"/api/inventory/purchasing/documents/{d2['id']}/approve",
        {"supplier_invoice_number": "F-2300"},
    )
    assert r.status_code == 200 and r.json()["document"]["approved_by_name"] == "خالد"
