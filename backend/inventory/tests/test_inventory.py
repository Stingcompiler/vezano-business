"""INV-01 أرصدة المخزون وINV-02 سجل حركة الصنف (T1.28): السالب يُحفظ ويُعلن لا يُصفَّر (ACC-17)؛ لا
مجموع كمّي عبر وحدات مختلفة — وحدة الشراء بمعاملها قراءةً مساعدة (R-08)؛ حد التنبيه اقتراح؛ كل حركة
لها مصدر ومستند ورصيد بعدها؛ المالك يرى أي فرع وغيره فرعه."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from catalog import services as catalog_services
from conftest import TwoTenants
from core.auth.devices import register_device
from core.models import Role, Unit, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from sales.tests.test_sale import ctx as _sale_ctx  # noqa: F401
from sales.tests.test_sale import do_push, sale_op


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    from sales.tests.test_sale import ctx as make

    c = make.__wrapped__(two_tenants)  # type: ignore[attr-defined]
    with tenant_context(c["tenant"].id):
        kg = Unit.objects.create(tenant=c["tenant"], code="kg", name="كغ", is_base=True)
        carton = Unit.objects.create(tenant=c["tenant"], code="carton", name="كرتونة")
        sugar = catalog_services.create_item(
            name="سكر", base_unit=kg, sale_price_minor=10000, units=[(carton, 12000)]
        )
        sugar.alert_threshold_milli = 5000
        sugar.save(update_fields=["alert_threshold_milli"])
        tea = catalog_services.create_item(name="شاي أسود 250غ", base_unit=kg, sale_price_minor=0)
    return {**c, "sugar": sugar, "tea": tea}


def _api(c: dict[str, Any]) -> tuple[Client, dict[str, str]]:
    with tenant_context(c["tenant"].id):
        reg = register_device(user=c["owner"], branch=c["branch"], name="مكتب")
    return Client(), {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}


def _cashier(c: dict[str, Any], branch: Any) -> tuple[Client, dict[str, str]]:
    with platform_context():
        u = User.objects.create_user(
            tenant=c["tenant"], username="samira", display_name="سميرة ع.", is_owner=False
        )
        role = Role.unscoped.create(tenant=c["tenant"], code="cashier", name="كاشير")
        UserBranchAccess.unscoped.create(tenant=c["tenant"], user=u, branch=branch, role=role)
    with tenant_context(c["tenant"].id):
        reg = register_device(user=u, branch=branch, name="كاشير 1")
    return Client(), {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}


def _sale(c: dict[str, Any], item_id: str, **kw: Any) -> dict[str, Any]:
    op = sale_op(c, **kw)
    for m in op["members"]:
        if m["entity"] in ("sales.SaleLine", "inventory.StockMovement"):
            m["payload"]["item_id"] = item_id
    return op


def test_balances_negative_low_and_units(ctx: dict[str, Any], two_tenants: TwoTenants) -> None:
    sugar, tea = str(ctx["sugar"].id), str(ctx["tea"].id)
    # كرتونة سكر = 12 كغ ثم كيلو: الرصيد −13 كغ (لا استلام مسجَّل) — يُحفظ ويُعلن
    assert do_push(ctx, _sale(ctx, sugar, invoice="S-1", factor="12000", price="120000")) == [
        "accepted"
    ]
    assert do_push(ctx, _sale(ctx, sugar, invoice="S-2")) == ["accepted"]
    assert do_push(ctx, _sale(ctx, tea, invoice="S-3", qty="2000", price="5000")) == ["accepted"]
    c, h = _api(ctx)
    r = c.get("/api/inventory/balances", **h)  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert body["branch_id"] == str(ctx["branch"].id) and len(body["branches"]) == 2
    rows = {x["name"]: x for x in body["rows"]}
    assert rows["سكر"]["qty_milli"] == "-13000" and rows["سكر"]["tag"] == "negative"
    assert rows["سكر"]["sale_unit"]["name"] == "كغ"
    assert rows["سكر"]["purchase_unit"] == {
        "code": "carton",
        "name": "كرتونة",
        "decimal_places": 0,
        "factor_milli": "12000",
    }
    assert rows["سكر"]["alert_threshold_milli"] == "5000"
    assert rows["شاي أسود 250غ"]["qty_milli"] == "-2000"
    assert rows["شاي أسود 250غ"]["purchase_unit"] is None
    assert rows["شاي أسود 250غ"]["price_missing"] is True
    # حد التنبيه اقتراح: استلام يرفع السكر إلى 3 كغ → «تحت حد التنبيه» (5)
    from inventory.models import StockMovement

    with tenant_context(ctx["tenant"].id):
        StockMovement.objects.create(
            tenant=ctx["tenant"],
            branch=ctx["branch"],
            item_id=ctx["sugar"].id,
            delta_base_qty_milli=16000,
            reason="receive",
        )
    rows = {x["name"]: x for x in c.get("/api/inventory/balances", **h).json()["rows"]}  # type: ignore[arg-type]
    assert rows["سكر"]["qty_milli"] == "3000" and rows["سكر"]["tag"] == "low"
    # فرع آخر بلا حركة: لا صفوف (لا صفر مزعوم)؛ الكاشير لا يرى فرعاً غير فرعه
    other = two_tenants.a_branches[1]
    r = c.get(f"/api/inventory/balances?branch_id={other.id}", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["rows"] == []
    cc, ch = _cashier(ctx, ctx["branch"])
    r = cc.get(f"/api/inventory/balances?branch_id={other.id}", **ch)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "branch_forbidden"
    r = cc.get("/api/inventory/balances", **ch)  # type: ignore[arg-type]
    assert r.status_code == 200 and len(r.json()["branches"]) == 1


def test_item_movements_have_source_doc_and_running_balance(ctx: dict[str, Any]) -> None:
    sugar = str(ctx["sugar"].id)
    assert do_push(ctx, _sale(ctx, sugar, invoice="INV-KRT-A2-26-000009")) == ["accepted"]
    c, h = _api(ctx)
    r = c.get(f"/api/inventory/items/{sugar}/movements?range=all", **h)  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert body["item"]["name"] == "سكر" and body["balance_milli"] == "-1000"
    (row,) = body["rows"]
    assert row["label"] == "بيع نقطة بيع" and row["doc"] == "INV-KRT-A2-26-000009"
    assert row["actor"] == "سالم" and row["delta_milli"] == "-1000"
    assert row["balance_after_milli"] == "-1000"
    # مدى بلا حركة: الصفوف فارغة و«آخر حركة» تُذكر (نفرّق بين «لم يتحرّك» و«لا حركة في المدى»)
    from datetime import timedelta

    from django.utils import timezone

    from inventory.models import StockMovement

    with tenant_context(ctx["tenant"].id):
        StockMovement.objects.filter(item_id=ctx["sugar"].id).update(
            occurred_at=timezone.now() - timedelta(days=45)
        )
    body = c.get(f"/api/inventory/items/{sugar}/movements", **h).json()  # type: ignore[arg-type]
    assert body["rows"] == [] and body["total_count"] == 1 and body["last_movement_at"] != ""
    # صنف لم يتحرّك بعد
    body = c.get(f"/api/inventory/items/{ctx['tea'].id}/movements", **h).json()  # type: ignore[arg-type]
    assert body["rows"] == [] and body["total_count"] == 0 and body["last_movement_at"] == ""
    assert c.get(f"/api/inventory/items/{uuid.uuid4()}/movements", **h).status_code == 404  # type: ignore[arg-type]


def _receipt_op(
    c: dict[str, Any], item_id: str, *, qty: str, factor: str, cost: str = ""
) -> dict[str, Any]:
    rid = str(uuid.uuid4())
    base = str(int(qty) * int(factor) // 1000)
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "stock_receipt",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "inventory.GoodsReceipt",
                "id": rid,
                "schema_version": 1,
                "payload": {
                    "receipt_id": rid,
                    "receipt_number": "RCV-KRT-A2-26-000001",
                    "branch_id": str(c["branch"].id),
                    "device_id": str(c["device"].id),
                    "user_id": str(c["owner"].id),
                    "supplier_name": "مخزن البركة للجملة",
                    "reference": "فاتورة المورد 8841",
                    "business_date": "2026-09-16",
                    "occurred_at": "2026-09-16T10:05:00Z",
                },
            },
            {
                "entity": "inventory.GoodsReceiptLine",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "line_id": "l1",
                    "receipt_id": rid,
                    "item_id": item_id,
                    "item_name": "سكر",
                    "unit_code": "carton",
                    "factor_milli": factor,
                    "qty_milli": qty,
                    "base_qty_milli": base,
                    "unit_cost_minor": cost,
                },
            },
            {
                "entity": "inventory.StockMovement",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "movement_id": "m",
                    "branch_id": str(c["branch"].id),
                    "item_id": item_id,
                    "delta_base_qty_milli": base,
                    "reason": "receive",
                    "source_entity": "inventory.GoodsReceipt",
                    "source_id": rid,
                    "occurred_at": "2026-09-16T10:05:00Z",
                },
            },
        ],
    }


def test_stock_receipt_push_no_cost_required(ctx: dict[str, Any]) -> None:
    """INV-04: المورد والمرجع والكمية مطلوبة والتكلفة اختيارية؛ 40 كرتونة × 12 = 480 كغ تدخل
    المخزون بحركة `receive`؛ الحركة تحمل المستند والفاعل في INV-02؛ حركة لا تطابق السطور تُرفض."""
    from inventory.models import GoodsReceipt

    sugar = str(ctx["sugar"].id)
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="40000", factor="12000")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        r = GoodsReceipt.objects.get()
        assert r.supplier_name == "مخزن البركة للجملة" and r.user_name == "سالم"
        (ln,) = r.lines.all()
        assert ln.base_qty_milli == 480000 and ln.unit_cost_minor is None
        assert catalog_services.branch_balances(ctx["branch"].id) == {sugar: "480000"}
    c, h = _api(ctx)
    body = c.get(f"/api/inventory/items/{sugar}/movements", **h).json()  # type: ignore[arg-type]
    (row,) = body["rows"]
    assert row["label"] == "استلام بضاعة" and row["doc"] == "RCV-KRT-A2-26-000001"
    assert row["actor"] == "سالم · فاتورة المورد 8841" and row["delta_milli"] == "480000"
    # حركة لا تطابق السطور / وحدة بلا معامل / بلا مرجع — مرفوضة
    bad = _receipt_op(ctx, sugar, qty="1000", factor="12000")
    bad["members"][2]["payload"]["delta_base_qty_milli"] = "1000"
    assert do_push(ctx, bad) == ["rejected"]
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="1000", factor="0")) == ["rejected"]
    noref = _receipt_op(ctx, sugar, qty="1000", factor="1000")
    noref["members"][0]["payload"]["reference"] = ""
    assert do_push(ctx, noref) == ["rejected"]
    # التكلفة إن أُدخلت تُحفظ
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="2000", factor="1000", cost="900")) == [
        "accepted"
    ]
    with tenant_context(ctx["tenant"].id):
        assert GoodsReceipt.objects.count() == 2


def test_openings_review_approve_once_per_item(
    ctx: dict[str, Any], two_tenants: TwoTenants
) -> None:
    """INV-03: مستند واحد يجمع الأصناف؛ الكمية رقم لا تقدير؛ المالك يعتمد فوراً فيُنشأ الرصيد؛
    أمين المخزن يُرسل للاعتماد؛ الافتتاحي مرة واحدة لكل صنف وقبل أول حركة؛ الاعتماد للمالك."""
    from inventory.models import StockOpening

    sugar, tea = str(ctx["sugar"].id), str(ctx["tea"].id)
    c, h = _api(ctx)
    lines = [
        {
            "item_id": sugar,
            "unit_code": "carton",
            "unit_name": "كرتونة",
            "factor_milli": "12000",
            "qty_milli": "15000",
            "unit_cost_minor": "600",
        },
        {"item_id": tea, "qty_milli": "1800000"},
    ]
    # كمية غير رقمية → لا نقبل تقديراً
    r = c.post(
        "/api/inventory/openings",
        {"lines": [{"item_id": sugar, "qty_milli": "تقريباً نصف مخزن"}]},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"] == [
        {"line": 0, "field": "qty_milli", "code": "invalid"}
    ]
    r = c.post("/api/inventory/openings", {"lines": lines}, content_type="application/json", **h)  # type: ignore[arg-type]
    assert r.status_code == 201
    op = r.json()["opening"]
    assert op["status"] == "approved" and op["line_count"] == 2
    assert op["lines"][0]["base_qty_milli"] == "180000" and op["value_minor"] == "9000"
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(ctx["branch"].id) == {
            sugar: "180000",
            tea: "1800000",
        }
    # مرة واحدة لكل صنف وقبل أول حركة
    r = c.post(
        "/api/inventory/openings",
        {"lines": [{"item_id": sugar, "qty_milli": "1000"}]},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    codes = {(e["field"], e["code"]) for e in r.json()["errors"]}
    assert r.status_code == 400 and codes == {
        ("item_id", "has_movements"),
        ("item_id", "already_opened"),
    }
    # INV-02: المستند والمعتمد
    body = c.get(f"/api/inventory/items/{tea}/movements", **h).json()  # type: ignore[arg-type]
    assert (
        body["rows"][0]["label"] == "افتتاحية" and body["rows"][0]["actor"] == "سالم · اعتماد أولي"
    )
    # أمين المخزن في فرع آخر: يُرسل للاعتماد ولا يعتمد؛ المالك يعتمد
    other = two_tenants.a_branches[1]
    cc, ch = _cashier(ctx, other)
    r = cc.post(
        "/api/inventory/openings",
        {"lines": [{"item_id": sugar, "qty_milli": "5000"}]},
        content_type="application/json",
        **ch,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["opening"]["status"] == "submitted"
    oid = r.json()["opening"]["id"]
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(other.id) == {}
    r = cc.post(f"/api/inventory/openings/{oid}/approve", **ch)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    r = c.get(f"/api/inventory/openings?branch_id={other.id}", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["can_approve"] is True
    assert [o["status"] for o in r.json()["openings"]] == ["submitted"]
    r = c.post(f"/api/inventory/openings/{oid}/approve", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["opening"]["status"] == "approved"
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(other.id) == {sugar: "5000"}
        assert StockOpening.objects.count() == 2
    r = c.post(f"/api/inventory/openings/{oid}/approve", **h)  # type: ignore[arg-type]
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "already_approved"
