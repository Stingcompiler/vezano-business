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
