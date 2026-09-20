"""GROW-01/02/03 (T3.27 — M4): خلف علم `market_m4`؛ الاقتراح من الحركة الفعلية بسببه ولا يشتري
نيابةً عنك؛ تحليلات المورد بلا درجة ولا حكم من مستندين؛ طلب العرض الممول بلا افتراض وللمالك
والتسعير قرار مفتوح (G-04)."""

from __future__ import annotations

import os
from typing import Any

import pytest

from core.tenancy import platform_context, tenant_context
from inventory.models import PurchaseDocument
from inventory.tests.test_inventory import _api, _receipt_op, ctx  # noqa: F401
from inventory.tests.test_purchase_docs import _post
from parties import services as party_services
from sales.tests.test_sale import do_push
from stingops.models import OpsFlag

pytestmark = pytest.mark.django_db(transaction=True)


def _flag_m4(on: bool) -> None:
    with platform_context():
        OpsFlag.objects.update_or_create(
            key="market_m4",
            scope_kind="env",
            scope=os.environ.get("STING_ENV", ""),
            defaults={"enabled": on, "changed_by_name": "اختبار"},
        )


def test_replenish_suppliers_and_promotion(ctx: dict[str, Any]) -> None:  # noqa: F811
    from inventory.tests.test_inventory import _sale

    sugar = str(ctx["sugar"].id)
    c, h = _api(ctx)
    # مطفأ: phase_locked للقراءة، 423 للكتابة
    assert c.get("/api/grow/replenish", **h).json()["state"] == "phase_locked"  # type: ignore[arg-type]
    assert (
        _post(c, h, "/api/grow/replenish", {"supplier_id": "x", "lines": [{}]}).status_code == 423
    )
    _flag_m4(True)
    # لا مورد ولا بيع: الصنف بلا مورد لا يُقترح له شيء؛ لا حاجة = empty بعدد ما فُحص
    p = c.get("/api/grow/replenish", **h).json()  # type: ignore[arg-type]
    assert p["state"] == "empty" and p["checked_count"] == 2 and p["next_check"] == "غداً 6 ص"
    # مورد معتمد من مستند شراء + مبيعات 30 يوماً → اقتراح بسببه
    with tenant_context(ctx["tenant"].id):
        supplier = party_services.create_party(
            party_id=None,
            name="مؤسسة الرياض",
            phone="0911",
            created_by=ctx["owner"],
            distinct_from=None,
        )
        supplier.is_supplier = True
        supplier.save(update_fields=["is_supplier"])
    op = _receipt_op(ctx, sugar, qty="2000", factor="12000", cost="90000")  # كرتونتان = 24 كغ
    op["members"][0]["payload"]["party_id"] = str(supplier.id)
    assert do_push(ctx, op) == ["accepted"]
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders",
        {
            "supplier_id": str(supplier.id),
            "confirmed": True,
            "lines": [{"item_id": sugar, "unit_code": "carton", "qty_milli": "1000"}],
        },
    )
    assert r.status_code == 201, r.content
    order_id = r.json()["order"]["id"]
    assert _post(c, h, f"/api/inventory/purchasing/orders/{order_id}/send", {}).status_code == 200
    d = _post(c, h, f"/api/inventory/purchasing/orders/{order_id}/document", {}).json()["document"]
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/approve",
        {"supplier_invoice_number": "F-1"},
    )
    assert r.status_code == 200, r.content
    # بيع 30 كغ خلال النافذة (1 كغ يومياً) → الرصيد 10+24+12 = 46 كغ … نبيع 30 → 16 كغ
    for i in range(3):
        assert do_push(ctx, _sale(ctx, sugar, invoice=f"G-{i}", qty="10000", price="10000")) == [
            "accepted"
        ]
    p = c.get("/api/grow/replenish?compute=1", **h).json()  # type: ignore[arg-type]
    assert p["state"] in {"ready", "empty"}
    row = next((x for x in p["rows"] if x["item_id"] == sugar), None)
    # الرصيد 16 كغ، بيع يومي 1 كغ، المهلة من التاريخ (≈0 يوم) + أمان 5 → لا حاجة (16 > 5) → empty
    assert p["state"] == "empty" and (row is None or row["need"] is False)
    # نُنزل الرصيد ببيع 14 كغ إضافية → 2 كغ ← الحاجة 5−2 = 3 كغ = كرتونة واحدة
    assert do_push(ctx, _sale(ctx, sugar, invoice="G-9", qty="14000", price="10000")) == [
        "accepted"
    ]
    p = c.get("/api/grow/replenish?compute=1", **h).json()  # type: ignore[arg-type]
    assert p["state"] == "ready" and p["need_count"] == 1
    row = next(x for x in p["rows"] if x["item_id"] == sugar)
    assert row["supplier_name"] == "مؤسسة الرياض" and row["need"] and row["unit_name"]
    # المقترح = ⌈(⌈بيع يومي × (مهلة + أمان)⌉ − الرصيد) ÷ معامل الكرتونة⌉ — كل رقم من السجلّ
    import math

    horizon = (row["lead_days"] or 0) + p["safety_days"]
    need = max(0, math.ceil(int(row["daily_milli"]) * horizon) - int(row["stock_milli"]))
    assert row["suggested"] == math.ceil(need / int(row["factor_milli"]))
    assert "بيع" in row["basis"] and "أمان 5 أيام" in row["basis"]
    # التحويل إلى أمر شراء باختيار صريح — لا شيء يُطلب قبله
    with tenant_context(ctx["tenant"].id):
        from inventory.models import PurchaseOrder

        before = PurchaseOrder.objects.count()
    r = _post(
        c,
        h,
        "/api/grow/replenish",
        {
            "supplier_id": str(supplier.id),
            "lines": [{"item_id": sugar, "qty_milli": "2000", "unit_code": "carton"}],
        },
    )
    assert r.status_code == 201, r.content
    assert r.json()["order"]["status"] == "open"
    grow_order_id = r.json()["order"]["id"]
    with tenant_context(ctx["tenant"].id):
        assert PurchaseOrder.objects.count() == before + 1
    # أمين المخزن يرى الاقتراح ولا يحوّله — يرسله إلى المالك بملاحظاته موسومةً باسمه
    from core.models import Role, User, UserBranchAccess

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
    kp = c.get("/api/grow/replenish", **kh)  # type: ignore[arg-type]
    assert kp.status_code == 200 and kp.json()["state"] == "permission_denied"
    assert kp.json()["can_convert"] is False and kp.json()["value_hidden"] is True
    assert kp.json()["ask_name"] == "سالم" and len(kp.json()["rows"]) >= 1
    assert (
        _post(
            c,
            kh,
            "/api/grow/replenish",
            {"supplier_id": str(supplier.id), "lines": [{"item_id": sugar, "qty_milli": "1000"}]},
        ).status_code
        == 403
    )
    r = _post(
        c,
        kh,
        "/api/grow/replenish",
        {
            "action": "forward",
            "note": "الرفّ يكفي أسبوعاً",
            "lines": [{"item_id": sugar, "unit_code": "carton", "qty_milli": "1000"}],
        },
    )
    assert r.status_code == 200 and r.json()["forwarded"]["by_name"] == "ندى"
    assert r.json()["forwarded"]["to_name"] == "سالم"
    with tenant_context(ctx["tenant"].id):
        assert PurchaseOrder.objects.count() == before + 1  # لا أمر شراء من الإرسال
    assert c.get("/api/grow/replenish", **h).json()["forwards"][0]["note"] == "الرفّ يكفي أسبوعاً"  # type: ignore[arg-type]
    # ---- GROW-02: مستند واحد لا يكفي → empty («تُحسب المؤشرات بعد 5 مستندات»)
    s = c.get("/api/grow/suppliers?compute=1", **h).json()  # type: ignore[arg-type]
    assert (
        s["state"] == "empty"
        and s["suppliers"][0]["enough"] is False
        and s["suppliers"][0]["documents"] == 1
    )
    assert s["suppliers"][0]["min_docs"] == 5 and "score" not in s["suppliers"][0]
    # مستند يُعتمد بعد الحساب → stale بذكره
    with tenant_context(ctx["tenant"].id):
        assert PurchaseDocument.objects.count() == 1
    d2 = _post(c, h, f"/api/inventory/purchasing/orders/{grow_order_id}/document", {}).json()[
        "document"
    ]
    assert (
        _post(
            c,
            h,
            f"/api/inventory/purchasing/documents/{d2['id']}/approve",
            {"supplier_invoice_number": "F-2"},
        ).status_code
        == 200
    )
    s = c.get("/api/grow/suppliers", **h).json()  # type: ignore[arg-type]
    assert s["state"] == "stale" and s["newer_documents"] == [f"PD-{d2['number']}"]
    # ---- GROW-03: بلا جمهور/مدة = خطأ؛ المدير يُعدّ ولا يطلب؛ المالك يطلب والتسعير قرار مفتوح
    from market.models import MarketOffer

    with tenant_context(ctx["tenant"].id):
        offer = MarketOffer.objects.create(
            tenant_id=ctx["tenant"].id,
            public_name="سكر",
            unit_code="carton",
            unit_name="كرتونة",
            pack_label="كرتونة 12×1كغ",
            price_minor=118000,
            min_order_qty=5,
            status="published",
            audience="public",
        )
    g = c.get("/api/grow/promote", **h).json()  # type: ignore[arg-type]
    assert (
        g["state"] == "ready"
        and g["pricing_locked"] is True
        and g["pricing_lock_label"] == "التسعير غير معتمد — يتواصل الفريق"
    )
    r = _post(c, h, "/api/grow/promote", {"offer_id": str(offer.id), "action": "request"})
    assert r.status_code == 400 and r.json()["detail"] == "audience_or_duration_required"
    assert r.json()["extra"]["missing"] == ["audience", "duration_days"]
    r = _post(
        c,
        h,
        "/api/grow/promote",
        {
            "offer_id": str(offer.id),
            "action": "request",
            "audience": "followers",
            "duration_days": 7,
        },
    )
    assert r.status_code == 200 and r.json()["request"]["status"] == "pricing_pending"
    assert r.json()["request"]["status_label"] == "التسعير غير معتمد — يتواصل الفريق"
    pv = c.get(f"/api/grow/promote?preview={offer.id}", **h).json()  # type: ignore[arg-type]
    assert pv["promoted"]["tag"] == "عرض ممول"
    # لا واجهة دفع ولا رقم
    assert "price" not in str(r.json()["request"]) and "amount" not in str(r.json()["request"])
