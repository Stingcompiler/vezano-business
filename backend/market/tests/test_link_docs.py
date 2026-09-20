"""LINK-03/04/05 (T3.26 — M3): تحويل الشحنة المستلَمة إلى مستند شراء معتمد مرة واحدة (ACC-130)
بمعاينة الأثر ومصدر واحد؛ استلام يدوي مطابق يوقف التحويل (`conflict`) حتى يُربط أو يُؤكَّد أنهما
شحنتان؛ الفروق تُعرض بلا «رقم صحيح» والتسوية لمن له حدّ مالي؛ المرتجع إلى مستند عكسي بالمقبول وحده
والحدّ من دفتري (ACC-132)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.models import Unit, User
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from inventory.models import GoodsReceipt, PurchaseDocument, PurchaseReturn
from market.models import MarketDocumentLink
from market.tests.test_link import _flag_m3
from market.tests.test_order_flow import _owner_headers
from market.tests.test_orders import _seed
from parties.services import balance_minor, create_party
from sync.counter import ensure_state

pytestmark = pytest.mark.django_db(transaction=True)


def test_convert_receipt_documents_and_return(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    from catalog import services as catalog_services
    from inventory.services import branch_balances

    c, h = Client(), _h(ctx["tokens"]["owner"])
    hc = _h(ctx["tokens"]["cashier"])
    sugar_offer, _rice = _seed(two_tenants.b)
    hb = _owner_headers(two_tenants.b, "ob-docs")
    sid = str(two_tenants.b.id)
    _flag_m3(True)
    with tenant_context(ctx["tenant"].id):
        ensure_state(ctx["tenant"].id)
        owner = User.objects.filter(is_owner=True).first()
        assert owner is not None
        party = create_party(
            party_id=None, name="مخزن البركة", phone="", created_by=owner, distinct_from=None
        )
        party.is_supplier = True
        party.save(update_fields=["is_supplier"])
        kg = Unit.objects.create(tenant=ctx["tenant"], code="kg1", name="كيس 1كغ", is_base=True)
        sugar = catalog_services.create_item(name="سكر أبيض", base_unit=kg, sale_price_minor=12000)
        branch_id = ctx["branch"].id
        stock_before = branch_balances(branch_id).get(sugar.id, 0)
        owed_before = balance_minor(party)
    # ربط الطرف ومطابقة الصنف (T3.25)
    r = _post(c, h, f"/api/market/link/parties/{party.id}/request", {"counterparty_tenant_id": sid})
    link_id = r.json()["link"]["id"]
    assert _post(c, hb, f"/api/market/link/incoming/{link_id}/accept").status_code == 200
    r = _post(
        c,
        h,
        "/api/market/link/items",
        {
            "counterparty_tenant_id": sid,
            "item_id": str(sugar.id),
            "offer_id": str(sugar_offer.id),
            "unit_code": "kg1",
            "factor_milli": "12000",
        },
    )
    assert r.status_code == 200
    # طلب 10 → تأكيد 8 → شحن 8 → استلام 7
    in3 = (timezone.localdate() + timedelta(days=3)).isoformat()
    oid = _post(
        c,
        h,
        "/api/market/orders",
        {
            "op_id": str(uuid.uuid4()),
            "supplier_tenant_id": sid,
            "kind": "order",
            "lines": [{"offer_id": str(sugar_offer.id), "qty": 10, "price_minor": "118000"}],
        },
    ).json()["order"]["id"]
    _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            "lines": [
                {"offer_id": str(sugar_offer.id), "qty_confirmed": 8, "price_minor": "118000"}
            ],
            "valid_until": in3,
            "send": True,
        },
    )
    assert _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2}).status_code == 200
    sh = _post(
        c,
        hb,
        f"/api/market/orders/{oid}/shipments",
        {"lines": [{"offer_id": str(sugar_offer.id), "qty": 8}]},
    ).json()["shipments"][0]["id"]
    r = _post(
        c,
        h,
        f"/api/market/orders/{oid}/receive",
        {
            "shipment_id": sh,
            "lines": [
                {"offer_id": str(sugar_offer.id), "qty_received": 7, "reason": "كرتونة تالفة"}
            ],
        },
    )
    assert r.status_code == 200
    # ---- LINK-03: القائمة والمعاينة — لا شيء يحدث قبل الإقرار
    lst = c.get("/api/market/link/receipts", headers=h).json()
    assert (
        lst["state"] == "ready"
        and lst["pending_count"] == 1
        and lst["shipments"][0]["converted"] is False
    )
    pv = c.get(f"/api/market/link/receipts/{sh}/preview", headers=h).json()
    assert (
        pv["state"] == "ready"
        and pv["party_linked"] is True
        and pv["payable_minor"] == str(7 * 118000)
    )
    assert (
        pv["lines"][0]["base_qty_milli"] == 7 * 12000 and pv["lines"][0]["item_name"] == "سكر أبيض"
    )
    with tenant_context(ctx["tenant"].id):
        assert branch_balances(branch_id).get(sugar.id, 0) == stock_before
        assert PurchaseDocument.objects.count() == 0
    # الكاشير لا يحوّل
    assert _post(c, hc, f"/api/market/link/receipts/{sh}/convert", {}).status_code == 403
    # استلام يدوي مطابق (7 كراتين = 84 كيساً) قبل التحويل → conflict
    from inventory.models import GoodsReceiptLine

    with tenant_context(ctx["tenant"].id):
        rc = GoodsReceipt.objects.create(
            tenant_id=ctx["tenant"].id,
            branch_id=branch_id,
            receipt_number="RC-0771",
            party_id=party.id,
            supplier_name="مخزن البركة",
            reference="يدوي",
            device_id=uuid.UUID(int=0),
            user_id=owner.id,
            user_name="المالك",
            business_date=timezone.localdate(),
            occurred_at=timezone.now(),
        )
        GoodsReceiptLine.objects.create(
            tenant_id=ctx["tenant"].id,
            receipt=rc,
            item_id=sugar.id,
            item_name="سكر أبيض",
            unit_code="kg1",
            factor_milli=1000,
            qty_milli=84000,
            base_qty_milli=84000,
            unit_cost_minor=9833,
        )
    pv = c.get(f"/api/market/link/receipts/{sh}/preview", headers=h).json()
    assert pv["state"] == "duplicate" and pv["duplicates"][0]["receipt_number"] == "RC-0771"
    r = _post(c, h, f"/api/market/link/receipts/{sh}/convert", {})
    assert r.status_code == 409 and r.json()["detail"] == "duplicate_receipt"
    # نؤكّد أنهما شحنتان مختلفتان → التحويل يمضي ويُنشئ مستنداً معتمداً بأثره
    r = _post(
        c, h, f"/api/market/link/receipts/{sh}/convert", {"distinct_receipt_ids": [str(rc.id)]}
    )
    assert r.status_code == 201, r.content
    link = r.json()["link"]
    assert link["mode"] == "created" and link["local_number"].startswith("PD-")
    assert link["my_value_minor"] == str(7 * 118000) and link["their_value_minor"] == str(
        8 * 118000
    )
    with tenant_context(ctx["tenant"].id):
        # 7 كراتين × 12 = 84 كيساً من التحويل وحده (المستند اليدوي في الاختبار بلا حركة مخزون)
        assert branch_balances(branch_id).get(sugar.id, 0) == stock_before + 84000
        doc = PurchaseDocument.objects.get()
        assert (
            doc.status == "approved"
            and doc.total_minor == 7 * 118000
            and doc.supplier_id == party.id
        )
        assert balance_minor(party) == owed_before  # الذمّة للمورد تُقرأ من مستندات الشراء (PTY)
        from inventory.purchase_docs import supplier_owed_from_purchases

        assert supplier_owed_from_purchases(party) == 7 * 118000
    # إعادة التحويل = الرابط نفسه، لا مستند ثانٍ (ACC-130)
    r2 = _post(c, h, f"/api/market/link/receipts/{sh}/convert", {})
    assert r2.status_code == 201 and r2.json()["link"]["id"] == link["id"]
    with tenant_context(ctx["tenant"].id):
        assert PurchaseDocument.objects.count() == 1 and MarketDocumentLink.objects.count() == 1
    lst = c.get("/api/market/link/receipts", headers=h).json()
    assert lst["pending_count"] == 0 and lst["shipments"][0]["local_number"] == link["local_number"]
    # ---- LINK-04: الفرق كرتونة (8 مشحونة / 7 مستلَمة) بلا ترجيح؛ التسوية لمن له حدّ مالي
    d = c.get("/api/market/link/documents", headers=h).json()
    assert d["linked_count"] == 1 and d["diff_count"] == 1
    row = d["links"][0]
    assert row["diff_minor"] == str(118000) and "فتح خلاف موثَّق (ORD-12)" in row["path"]
    assert "الرقم الصحيح" not in str(d)
    r = _post(
        c, hc, f"/api/market/link/documents/{row['id']}/settle", {"path": "agreement", "note": "x"}
    )
    assert r.status_code == 403 and r.json()["extra"].get("referred") is True
    r = _post(c, h, f"/api/market/link/documents/{row['id']}/settle", {"path": "agreement"})
    assert r.status_code == 400 and r.json()["detail"] == "note_required"
    r = _post(
        c,
        h,
        f"/api/market/link/documents/{row['id']}/settle",
        {"path": "agreement", "note": "اتفاق مكتوب: خصم كرتونة"},
    )
    assert r.status_code == 200 and r.json()["link"]["settled_by_name"]
    d = c.get("/api/market/link/documents", headers=h).json()
    assert d["diff_count"] == 0 and d["links"][0]["settled"] is True
    with tenant_context(ctx["tenant"].id):
        assert supplier_owed_from_purchases(party) == 7 * 118000  # التسوية لا تحرّك رقماً
    # ---- LINK-05: مرتجع 3 يوافق المورد على 2 → مستند عكسي بـ2 فقط والباقي بند معلّق
    ru = f"/api/market/orders/{oid}/returns"
    r = _post(
        c, h, ru, {"lines": [{"offer_id": str(sugar_offer.id), "qty": 3, "reason": "عبوات مبلَّلة"}]}
    )
    assert r.status_code == 201, r.content
    rid = r.json()["created"]["id"]
    rets = c.get("/api/market/link/returns", headers=h).json()
    assert rets["pending_count"] == 0  # لم يُحسم بعد فلا يُعرض للتحويل
    r = _post(
        c,
        hb,
        f"{ru}/{rid}/decide",
        {"lines": [{"offer_id": str(sugar_offer.id), "approved_qty": 2}], "note": "كرتونة سليمة"},
    )
    assert r.status_code == 200 and r.json()["return"]["status"] == "partial"
    rets = c.get("/api/market/link/returns", headers=h).json()
    assert rets["pending_count"] == 1 and rets["returns"][0]["lines"][0]["pending"] == 1
    r = _post(c, h, f"/api/market/link/returns/{rid}/convert")
    assert r.status_code == 201, r.content
    rv = r.json()["link"]
    assert rv["local_number"].startswith("RV-") and rv["my_value_minor"] == str(2 * 118000)
    with tenant_context(ctx["tenant"].id):
        pr = PurchaseReturn.objects.get()
        assert pr.status == "accepted" and pr.accepted_minor == 2 * 118000
        assert supplier_owed_from_purchases(party) == 5 * 118000
        assert PurchaseDocument.objects.get().total_minor == 7 * 118000  # الأصل لا يُعدَّل
    # إعادة التحويل = الرابط نفسه
    assert _post(c, h, f"/api/market/link/returns/{rid}/convert").json()["link"]["id"] == rv["id"]
    with tenant_context(ctx["tenant"].id):
        assert PurchaseReturn.objects.count() == 1
    rets = c.get("/api/market/link/returns", headers=h).json()
    assert rets["returns"][0]["converted"] is True and rets["returns"][0]["reverse_partial"] is True
