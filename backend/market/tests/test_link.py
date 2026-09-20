"""LINK-01/LINK-02 (T3.25 — M3): كل شيء خلف علم `market_m3` من PLT-12؛ الربط للمالك وبقبول
الطرف الآخر لا بالاسم (ACC-131) ولا يغيّر رصيداً؛ المطابقة بمعامل صريح — وحدتان مختلفتان بلا
معامل تُرفض، وعبوة بلا عدد «ناقص تعريف»، وتغيّر تعريف المورد «يحتاج مراجعة»."""

from __future__ import annotations

import os
from typing import Any

import pytest
from django.test import Client

from conftest import TwoTenants
from core.models import Unit, User
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market.models import MarketItemMapping, MarketOffer, MarketPartyLink
from market.tests.test_order_flow import _owner_headers
from market.tests.test_orders import _seed
from parties.services import balance_minor, create_party
from stingops.models import OpsFlag
from sync.counter import ensure_state

pytestmark = pytest.mark.django_db(transaction=True)


def _flag_m3(on: bool) -> None:
    with platform_context():
        OpsFlag.objects.update_or_create(
            key="market_m3",
            scope_kind="env",
            scope=os.environ.get("STING_ENV", ""),
            defaults={"enabled": on, "changed_by_name": "اختبار"},
        )


def test_party_link_and_item_mapping(ctx: dict[str, Any], two_tenants: TwoTenants) -> None:  # noqa: F811
    from catalog import services as catalog_services

    c, h = Client(), _h(ctx["tokens"]["owner"])
    hm = _h(ctx["tokens"]["manager"])
    sugar_offer, _rice = _seed(two_tenants.b)  # «مخزن البركة — تجريبي» ناشر
    hb = _owner_headers(two_tenants.b, "ob-link")
    with tenant_context(ctx["tenant"].id):
        ensure_state(ctx["tenant"].id)
        owner = User.objects.filter(is_owner=True).first()
        party = create_party(
            party_id=None, name="مخزن البركة", phone="", created_by=owner, distinct_from=None
        )
        party.is_supplier = True
        party.save(update_fields=["is_supplier"])
        kg = Unit.objects.create(tenant=ctx["tenant"], code="kg1", name="كيس 1كغ", is_base=True)
        carton = Unit.objects.create(tenant=ctx["tenant"], code="ctn", name="كرتونة")
        sugar = catalog_services.create_item(
            name="سكر أبيض", base_unit=kg, sale_price_minor=12000, units=[(carton, 12000)]
        )
        balance_before = balance_minor(party)
    # ---- العلم مطفأ: القراءة تقول phase_locked والكتابة 423
    p = c.get("/api/market/link/parties", headers=h).json()
    assert p["state"] == "phase_locked" and p["parties"][0]["party_name"] == "مخزن البركة"
    r = _post(
        c,
        h,
        f"/api/market/link/parties/{party.id}/request",
        {"counterparty_tenant_id": str(two_tenants.b.id)},
    )
    assert r.status_code == 423 and r.json()["detail"] == "phase_locked"
    _flag_m3(True)
    # ---- LINK-01: المدير لا يربط؛ بلا اختيار = المرشّحون بمعرّفاتهم (لا «الأرجح»)
    r = _post(
        c,
        hm,
        f"/api/market/link/parties/{party.id}/request",
        {"counterparty_tenant_id": str(two_tenants.b.id)},
    )
    assert r.status_code == 403
    r = _post(c, h, f"/api/market/link/parties/{party.id}/request", {})
    assert r.status_code == 400 and r.json()["detail"] == "ambiguous_name"
    cands = r.json()["extra"]["candidates"]
    assert [x["tenant_id"] for x in cands] == [str(two_tenants.b.id)]
    assert cands[0]["public_name"] == "مخزن البركة — تجريبي" and cands[0]["badge"] == "verified"
    assert "rank" not in cands[0] and "score" not in cands[0]
    # الطلب يُرسل ولا يربط قبل قبول الطرف الآخر
    r = _post(
        c,
        h,
        f"/api/market/link/parties/{party.id}/request",
        {"counterparty_tenant_id": str(two_tenants.b.id)},
    )
    assert r.status_code == 201 and r.json()["link"]["status"] == "requested"
    link_id = r.json()["link"]["id"]
    assert (
        _post(
            c,
            h,
            f"/api/market/link/parties/{party.id}/request",
            {"counterparty_tenant_id": str(two_tenants.b.id)},
        ).status_code
        == 400
    )
    # الطرف الآخر يرى الطلب ويقبله (المالك وحده)
    inc = c.get("/api/market/link/incoming", headers=hb).json()
    assert inc["pending_count"] == 1 and inc["requests"][0]["requester_name"] == ctx["tenant"].name
    r = _post(c, hb, f"/api/market/link/incoming/{link_id}/accept")
    assert r.status_code == 200 and r.json()["link"]["status"] == "accepted"
    assert _post(c, hb, f"/api/market/link/incoming/{link_id}/accept").status_code == 400
    p = c.get("/api/market/link/parties", headers=h).json()
    assert p["state"] == "ready" and p["linked_count"] == 1
    assert p["parties"][0]["link"]["status"] == "accepted"
    # الرصيد لم يتغيّر بالربط
    with tenant_context(ctx["tenant"].id):
        assert balance_minor(party) == balance_before
    # ---- LINK-02: وحدتان مختلفتان بلا معامل → factor_required؛ بمعامل 12 → مطابَق
    body = {
        "counterparty_tenant_id": str(two_tenants.b.id),
        "item_id": str(sugar.id),
        "offer_id": str(sugar_offer.id),
        "unit_code": "kg1",
    }
    r = _post(c, h, "/api/market/link/items", body)
    assert r.status_code == 400 and r.json()["detail"] == "factor_required"
    r = _post(c, h, "/api/market/link/items", {**body, "factor_milli": "12000"})
    assert r.status_code == 200
    m = r.json()["mapping"]
    assert m["status"] == "matched" and m["factor_milli"] == "12000" and m["confirmed_by_name"]
    lst = c.get(f"/api/market/link/items?counterparty={two_tenants.b.id}", headers=h).json()
    assert (
        lst["state"] == "ready"
        and lst["matched_count"] == 1
        and lst["unmapped_offers"][0]["public_name"] == "أرز"
    )
    # عرض بعبوة بلا عدد معلَن → ناقص تعريف بلا تخمين
    with platform_context():
        rice = MarketOffer.unscoped.get(public_name="أرز")
        rice.pack_label = "كرتونة"
        rice.save(update_fields=["pack_label"])
        tea_unit_item = catalog_services  # noqa: F841 — للتذكير أن الصنف من الكتالوج
    with tenant_context(ctx["tenant"].id):
        rice_item = catalog_services.create_item(name="أرز", base_unit=kg, sale_price_minor=15000)
    r = _post(
        c,
        h,
        "/api/market/link/items",
        {**body, "item_id": str(rice_item.id), "offer_id": str(rice.id)},
    )
    assert r.status_code == 200 and r.json()["mapping"]["status"] == "needs_definition"
    # تغيّر تعريف المورد → يحتاج مراجعة، ولا يُستعمل في التحويل حتى التأكيد
    from market.link import mapping_for

    with platform_context():
        sugar_offer.version += 1
        sugar_offer.pack_label = "كرتونة 10×1كغ"
        sugar_offer.save(update_fields=["version", "pack_label"])
    lst = c.get(f"/api/market/link/items?counterparty={two_tenants.b.id}", headers=h).json()
    row = next(x for x in lst["mappings"] if x["offer_id"] == str(sugar_offer.id))
    assert row["status"] == "needs_review" and row["supplier_changed"] is True
    with tenant_context(ctx["tenant"].id):
        assert mapping_for(two_tenants.b.id, sugar_offer.id) is None
    r = _post(c, h, f"/api/market/link/items/{m['id']}/confirm")
    assert r.status_code == 200 and r.json()["mapping"]["status"] == "matched"
    with tenant_context(ctx["tenant"].id):
        assert mapping_for(two_tenants.b.id, sugar_offer.id) is not None
        assert MarketItemMapping.objects.count() == 2
        assert MarketPartyLink.objects.get().status == "accepted"
    # الكاشير لا يرى المطابقة كتابةً
    hc = _h(ctx["tokens"]["cashier"])
    assert (
        _post(c, hc, "/api/market/link/items", {**body, "factor_milli": "12000"}).status_code == 403
    )
    # إلغاء الربط من المالك
    r = _post(c, h, f"/api/market/link/parties/{party.id}/cancel")
    assert r.status_code == 200 and r.json()["link"]["status"] == "cancelled"
