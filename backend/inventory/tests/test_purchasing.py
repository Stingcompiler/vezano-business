"""PUR-01/PUR-02 (T2.13): الأمر وعدٌ لا التزام — لا يحرّك مخزوناً ولا ذمة؛ يُكتب بوحدة الشراء مع
المكافئ بوحدة البيع والسعر التقديري من آخر شراء معروف؛ سطر بلا وحدة أو مورد لا يورّد الصنف يُسأل
عنه قبل الحفظ والسطر الخاطئ وحده يُعلَّم؛ الحفظ والإرسال منفصلان وفشل الإرسال يبقي الأمر «لم يُرسل»؛
الملغى يبقى بسببه؛ أمين المخزن يرى بلا عمود القيمة ولا يُنشئ."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from catalog import services as catalog_services
from core.models import Role, User, UserBranchAccess
from core.scenario import faults
from core.tenancy import platform_context, tenant_context
from inventory.tests.test_inventory import _api, _cashier, _receipt_op, ctx  # noqa: F401
from parties import services as party_services
from sales.tests.test_sale import do_push

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _clear_faults() -> Any:
    faults.clear()
    yield
    faults.clear()


def _post(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.post(path, body, content_type="application/json", **h)  # type: ignore[arg-type]


def test_order_preview_create_send_cancel_and_roles(ctx: dict[str, Any]) -> None:  # noqa: F811
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
        other = party_services.create_party(
            party_id=None,
            name="منظفات الخليج",
            phone="0922",
            created_by=ctx["owner"],
            distinct_from=None,
        )
        other.is_supplier = True
        other.save(update_fields=["is_supplier"])
        # الشاي بلا سعر شراء معروف
        from core.models import Unit

        kg = Unit.objects.get(code="kg")
        catalog_services.create_item(name="شاي أحمر", base_unit=kg, sale_price_minor=5000)
    # استلام سابق من مؤسسة الرياض: 40 كرتونة سكر بـ900.00 → آخر سعر شراء للكرتون معروف،
    # والمورد يورّد السكر
    op = _receipt_op(ctx, sugar, qty="40000", factor="12000", cost="90000")
    op["members"][0]["payload"]["party_id"] = str(supplier.id)
    assert do_push(ctx, op) == ["accepted"]
    c, h = _api(ctx)
    with tenant_context(ctx["tenant"].id):
        from catalog.models import Item

        tea = str(Item.objects.get(name="شاي أحمر").id)
        from inventory.models import StockMovement

        stock_before = StockMovement.objects.count()
    # المعاينة: كرتون = 12 كغ، رصيد 480 كغ، سعر تقديري 900.00 × 10 = 9,000.00؛ الشاي بلا سعر →
    # تقدير جزئي
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders/preview",
        {
            "supplier_id": str(supplier.id),
            "confirmed": True,
            "lines": [
                {"item_id": sugar, "unit_code": "carton", "qty_milli": "10000"},
                {"item_id": tea, "unit_code": "kg", "qty_milli": "5000"},
            ],
        },
    )
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["errors"] == [] and p["estimated_partial"] is True and p["estimated_total_minor"] == ""
    s_line = p["lines"][0]
    assert s_line["base_qty_milli"] == "120000" and s_line["base_unit_name"] == "كغ"
    assert s_line["balance_milli"] == "480000" and s_line["est_total_minor"] == "900000"
    assert s_line["days_of_stock"] is None  # لا صادر خلال 30 يوماً
    # سطر بلا وحدة + مورد لا يورّد الصنف: السطر الخاطئ وحده يُعلَّم
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders/preview",
        {
            "supplier_id": str(supplier.id),
            "lines": [
                {"item_id": sugar, "unit_code": "carton", "qty_milli": "10000"},
                {"item_id": tea, "unit_code": "", "qty_milli": "12000"},
            ],
        },
    )
    assert [e["code"] for e in r.json()["errors"]] == ["unit_required"] and r.json()["errors"][0][
        "line"
    ] == 1
    assert len(r.json()["lines"]) == 1
    # مؤسسة الرياض تورّد السكر لا الشاي → سؤال قبل الحفظ لا بعده
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders",
        {
            "supplier_id": str(supplier.id),
            "lines": [
                {"item_id": sugar, "unit_code": "carton", "qty_milli": "10000"},
                {"item_id": tea, "unit_code": "kg", "qty_milli": "5000"},
            ],
        },
    )
    assert r.status_code == 400 and r.json()["detail"] == "lines_invalid"
    err = r.json()["extra"]["errors"][0]
    assert err["code"] == "supplier_mismatch" and err["confirmable"] is True and err["line"] == 1
    # بالتأكيد يُحفظ: الأمر لا يحرّك مخزوناً ولا ذمة
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders",
        {
            "supplier_id": str(supplier.id),
            "confirmed": True,
            "lines": [
                {"item_id": sugar, "unit_code": "carton", "qty_milli": "10000"},
                {"item_id": tea, "unit_code": "kg", "qty_milli": "5000"},
            ],
        },
    )
    assert r.status_code == 201, r.content
    o = r.json()["order"]
    assert o["number"] == "1" and o["status"] == "open" and o["lines_count"] == 2
    assert o["estimated_total_minor"] == "" and o["lines"][0]["est_total_minor"] == "900000"
    with tenant_context(ctx["tenant"].id):
        assert StockMovement.objects.count() == stock_before
        assert party_services.supplier_owed_minor(supplier) == 0
        assert catalog_services.branch_balances(ctx["branch"].id)[sugar] == "480000"
    # الإرسال فعل منفصل — فشله يبقي الأمر محفوظاً «لم يُرسل» مع إعادة
    faults.set_fault("po_send_fail", True)
    r = _post(c, h, f"/api/inventory/purchasing/orders/{o['id']}/send", {})
    assert r.status_code == 400 and r.json()["detail"] == "send_failed"
    assert r.json()["extra"]["order"]["status"] == "unsent"
    faults.set_fault("po_send_fail", False)
    r = _post(c, h, f"/api/inventory/purchasing/orders/{o['id']}/send", {})
    assert r.status_code == 200 and r.json()["order"]["status"] == "sent"
    # القائمة: مفتوحة واحدة؛ الإلغاء يحتاج سبباً ويبقى في السجل
    lst = c.get("/api/inventory/purchasing/orders?scope=open", **h).json()  # type: ignore[arg-type]
    assert (
        lst["open_count"] == 1 and lst["orders"][0]["number"] == "1" and lst["can_create"] is True
    )
    assert (
        _post(
            c, h, f"/api/inventory/purchasing/orders/{o['id']}/cancel", {"reason": ""}
        ).status_code
        == 400
    )
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/orders/{o['id']}/cancel",
        {"reason": "تغيّر السعر بعد الإرسال"},
    )
    assert r.status_code == 200 and r.json()["order"]["status"] == "cancelled"
    lst = c.get("/api/inventory/purchasing/orders?scope=open", **h).json()  # type: ignore[arg-type]
    assert lst["open_count"] == 0 and lst["orders"] == [] and lst["last_closed"]["number"] == "1"
    all_orders = c.get("/api/inventory/purchasing/orders?scope=all", **h).json()  # type: ignore[arg-type]
    assert all_orders["orders"][0]["cancelled_reason"] == "تغيّر السعر بعد الإرسال"
    # أمين المخزن يرى بلا عمود القيمة ولا يُنشئ؛ الكاشير لا يرى
    with platform_context():
        role = Role.unscoped.create(tenant=ctx["tenant"], code="storekeeper", name="أمين مخزن")
        keeper = User.objects.create_user(tenant=ctx["tenant"], username="keep", display_name="ندى")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=keeper, branch=ctx["branch"], role=role
        )
    with tenant_context(ctx["tenant"].id):
        from core.auth.devices import register_device

        reg = register_device(user=keeper, branch=ctx["branch"], name="جهاز المخزن")
    kh = {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}
    lst = c.get("/api/inventory/purchasing/orders?scope=all", **kh).json()  # type: ignore[arg-type]
    assert lst["can_create"] is False and lst["value_hidden"] is True and lst["ask_name"] == "سالم"
    assert (
        lst["orders"][0]["estimated_total_minor"] == ""
        and "est_total_minor" not in lst["orders"][0]["lines"][0]
    )
    assert (
        _post(
            c,
            kh,
            "/api/inventory/purchasing/orders",
            {"supplier_id": str(supplier.id), "lines": []},
        ).status_code
        == 403
    )
    cc, ch = _cashier(ctx, ctx["branch"])
    assert cc.get("/api/inventory/purchasing/orders", **ch).status_code == 403  # type: ignore[arg-type]
