"""CAT-02/CAT-03 (T1.9): بطاقة الصنف وحدودها (ACC-25)، الباركود هوية لا اسم، الصورة بعد الصنف،
الوحدات ومعاملاتها — تغيير المعامل لا يعيد تفسير الماضي (ACC-19).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from django.test import Client

from catalog import services
from catalog.limits import FACTOR_MAX_MILLI, IMAGE_MAX_BYTES, NAME_MAX_LEN, PRICE_MAX_MINOR
from catalog.models import ItemUnit
from core.scenario import faults
from core.scenario.seed import DEMO_CASHIER_IDENTIFIER, DEMO_PASSWORD, reset_scenario
from sync.push import PROTOCOL_VERSION

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    # مزوّدو POS/INV المسجَّلون عند التحميل يُعزلون هنا ويُعادون بعد الاختبار
    saved = (list(services.FACTOR_USAGE_PROVIDERS), list(services.ITEM_MOVEMENT_PROVIDERS))
    services.FACTOR_USAGE_PROVIDERS.clear()
    services.ITEM_MOVEMENT_PROVIDERS.clear()
    yield
    services.FACTOR_USAGE_PROVIDERS[:] = saved[0]
    services.ITEM_MOVEMENT_PROVIDERS[:] = saved[1]


class Api:
    def __init__(self) -> None:
        reset_scenario()
        self.client = Client()
        r = self.client.post(
            "/api/auth/account/login",
            {"identifier": DEMO_CASHIER_IDENTIFIER, "password": DEMO_PASSWORD},
            content_type="application/json",
        )
        self.h = {"HTTP_AUTHORIZATION": f"Bearer {r.json()['access']}"}

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self.client.get(path, params or {}, **self.h)  # type: ignore[arg-type]

    def post(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.post(path, body, content_type="application/json", **self.h)  # type: ignore[arg-type]

    def patch(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.patch(path, body, content_type="application/json", **self.h)  # type: ignore[arg-type]

    def units(self) -> dict[str, dict[str, Any]]:
        return {u["code"]: u for u in self.get("/api/catalog/units").json()["units"]}

    def item(self, name: str) -> dict[str, Any]:
        rows = self.get("/api/catalog/items", {"include_inactive": "1"}).json()["items"]
        return next(i for i in rows if i["name"] == name)


def _codes(r: Any) -> set[tuple[str, str]]:
    assert r.status_code == 400 and r.json()["detail"] == "validation_error"
    return {(e["field"], e["code"]) for e in r.json()["errors"]}


def test_units_list_carries_decimal_places() -> None:
    """§٦.٢: منازل الوحدة تحكم الإدخال والعرض — الكيلو 3 والحبة 0."""
    units = Api().units()
    assert units["kg"]["decimal_places"] == 3 and units["kg"]["is_base"] is True
    assert units["piece"]["decimal_places"] == 0
    assert units["carton"]["is_base"] is False


def test_create_rejects_all_errors_together_with_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    """CAT-02 validation_error «خطآن يمنعان الحفظ»: الوحدة لم تُحدَّد + الباركود مستخدم في صنف آخر —
    معاً لا أوّلهما. وحدود الطول والقيمة تُرفض برمز وحدّ وقيمة (ACC-25)."""
    api = Api()
    r = api.post(
        "/api/catalog/items",
        {"name": "سكر ناعم", "base_unit_id": "", "barcode": "6291000000142"},
    )
    assert _codes(r) == {("base_unit_id", "required"), ("barcode", "barcode_taken")}
    taken = next(e for e in r.json()["errors"] if e["code"] == "barcode_taken")
    assert taken["owner_item_name"] == "سكر" and taken["owner_unit_name"] == "كغ"
    assert taken["barcode"] == "6291000000142"
    # الحدود
    units = api.units()
    r = api.post(
        "/api/catalog/items",
        {
            "name": "x" * (NAME_MAX_LEN + 1),
            "base_unit_id": units["piece"]["id"],
            "barcode": "1" * 65,
            "sale_price_minor": str(PRICE_MAX_MINOR + 1),
            "larger_unit_id": units["carton"]["id"],
            "larger_factor_milli": str(FACTOR_MAX_MILLI + 1),
        },
    )
    errs = {e["field"]: e for e in r.json()["errors"]}
    assert errs["name"]["code"] == "too_long" and errs["name"]["limit"] == NAME_MAX_LEN
    assert errs["name"]["actual"] == NAME_MAX_LEN + 1
    assert errs["barcode"]["code"] == "too_long" and errs["barcode"]["limit"] == 64
    assert errs["sale_price_minor"]["code"] == "out_of_range"
    assert errs["sale_price_minor"]["limit"] == PRICE_MAX_MINOR
    assert errs["units"]["code"] == "out_of_range" and errs["units"]["limit"] == FACTOR_MAX_MILLI
    # قيمة غير عددية أو سالبة أو فارغة الاسم
    r = api.post(
        "/api/catalog/items",
        {"name": "   ", "base_unit_id": units["piece"]["id"], "sale_price_minor": "8.50"},
    )
    assert _codes(r) == {("name", "required"), ("sale_price_minor", "not_a_number")}
    r = api.post(
        "/api/catalog/items",
        {"name": "x", "base_unit_id": units["piece"]["id"], "sale_price_minor": "-1"},
    )
    assert _codes(r) == {("sale_price_minor", "out_of_range")}
    # الوحدة الأكبر لا تكون الأساسية نفسها
    r = api.post(
        "/api/catalog/items",
        {
            "name": "x",
            "base_unit_id": units["piece"]["id"],
            "larger_unit_id": units["piece"]["id"],
            "larger_factor_milli": "12000",
        },
    )
    assert ("units", "same_as_base") in _codes(r)


def test_create_then_image_then_card_and_pull() -> None:
    """CAT-02 saving/success: الصنف يُحفظ أولاً ثم الصورة؛ البطاقة تُقرأ من `items/{id}`؛ الصورة لا
    تُرسل في PULL (حضورها فقط)؛ كل كتابة تصل الأجهزة."""
    api = Api()
    units = api.units()
    r = api.post(
        "/api/catalog/items",
        {
            "name": "سكر ناعم",
            "base_unit_id": units["bag"]["id"],
            "barcode": "6291041500213",
            "sale_price_minor": "850",
            "larger_unit_id": units["carton"]["id"],
            "larger_factor_milli": "10000",
        },
    )
    assert r.status_code == 201, r.json()
    card = r.json()
    assert card["base_unit_name"] == "كيس" and card["units"][0]["factor_milli"] == "10000"
    assert card["units"][0]["prior_lines"] == 0 and card["units"][0]["changes"] == []
    assert card["image_present"] is False and card["base_unit_locked"] is False
    iid = card["id"]
    # الباركود صار محجوزاً — فحص التفرّد يقوله باسم صاحبه
    chk = api.get("/api/catalog/barcode", {"value": "6291041500213"}).json()
    assert chk["taken"] is True and chk["owner_item_name"] == "سكر ناعم"
    assert (
        api.get("/api/catalog/barcode", {"value": "6291041500213", "exclude_item_id": iid}).json()[
            "taken"
        ]
        is False
    )
    # الصورة: الحدّ معلن، والأكبر يُرفض بحجمه، وما ليس صورة يُرفض
    big = "data:image/jpeg;base64," + "A" * IMAGE_MAX_BYTES
    r = api.post(f"/api/catalog/items/{iid}/image", {"image_data_url": big})
    assert r.status_code == 413 and r.json()["max_bytes"] == IMAGE_MAX_BYTES
    r = api.post(f"/api/catalog/items/{iid}/image", {"image_data_url": "data:text/plain,x"})
    assert _codes(r) == {("image_data_url", "not_an_image")}
    r = api.post(
        f"/api/catalog/items/{iid}/image", {"image_data_url": "data:image/png;base64,iVBOR"}
    )
    assert r.status_code == 200 and r.json()["image_present"] is True
    assert r.json()["image_data_url"] == "data:image/png;base64,iVBOR"
    # البطاقة
    card = api.get(f"/api/catalog/items/{iid}").json()
    assert card["name"] == "سكر ناعم" and card["image_updated_at"]
    # القائمة وPULL يحملان الحضور لا الصورة
    listed = api.item("سكر ناعم")
    assert listed["image_present"] is True and "image_data_url" not in listed
    reg = api.post("/api/devices/register", {"name": "x"}).json()
    dev = Api.__new__(Api)
    dev.client, dev.h = api.client, {"HTTP_AUTHORIZATION": f"Bearer {reg['access']}"}
    image = dev.post("/api/bootstrap/start", {}).json()
    pull = dev.post(
        "/api/sync/pull",
        {
            "protocol_version": PROTOCOL_VERSION,
            "sync_epoch": image["sync_epoch"],
            "request_id": "p1",
            "cursors": [{"scope": "enterprise", "entity_group": "catalog", "server_seq": 0}],
        },
    ).json()
    mine = next(e for e in pull["entities"] if e["id"] == iid)
    assert mine["payload"]["image_present"] is True and "image_data_url" not in mine["payload"]
    assert mine["payload"]["units"][0]["barcode"] == ""
    assert api.get("/api/catalog/items/00000000-0000-0000-0000-000000000000").status_code == 404


def test_patch_item_and_base_unit_lock() -> None:
    """تعديل البطاقة أونلاين؛ الوحدة الأساسية «لا تتغيّر بعد أول حركة»."""
    api = Api()
    units = api.units()
    sugar = api.item("سكر")
    r = api.patch(
        f"/api/catalog/items/{sugar['id']}",
        {"name": "سكر أبيض ناعم", "sale_price_minor": "12000", "barcode": "6291000000142"},
    )
    assert r.status_code == 200 and r.json()["name"] == "سكر أبيض ناعم"
    assert r.json()["sale_price_minor"] == "12000"
    # باركود صنف آخر مرفوض باسم صاحبه
    r = api.patch(f"/api/catalog/items/{sugar['id']}", {"barcode": "6291000000338"})
    assert _codes(r) == {("barcode", "barcode_taken")}
    assert r.json()["errors"][0]["owner_item_name"] == "شاي أسود 250غ"
    # بلا حركات: الوحدة الأساسية تتغيّر
    r = api.patch(f"/api/catalog/items/{sugar['id']}", {"base_unit_id": units["bag"]["id"]})
    assert r.status_code == 200 and r.json()["base_unit_name"] == "كيس"
    # ولا تصير وحدةً إضافية للصنف نفسه
    r = api.patch(f"/api/catalog/items/{sugar['id']}", {"base_unit_id": units["carton"]["id"]})
    assert _codes(r) == {("base_unit_id", "same_as_unit")}
    # بعد أول حركة تُقفل
    services.ITEM_MOVEMENT_PROVIDERS.append(lambda _item: 3)
    r = api.patch(f"/api/catalog/items/{sugar['id']}", {"base_unit_id": units["kg"]["id"]})
    assert _codes(r) == {("base_unit_id", "locked_after_movement")}
    assert r.json()["errors"][0]["actual"] == 3
    assert api.get(f"/api/catalog/items/{sugar['id']}").json()["base_unit_locked"] is True


def test_units_add_and_factor_change_keeps_past(monkeypatch: pytest.MonkeyPatch) -> None:
    """CAT-03: باركود لكل وحدة؛ تغيير المعامل يسري من الآن ويُسجَّل بعدد السطور السابقة واسم من
    غيّره (ACC-19)؛ الحدود مرفوضة بنص كامل."""
    api = Api()
    units = api.units()
    tea = api.item("شاي أسود 250غ")
    # إضافة وحدة بباركودها
    r = api.post(
        f"/api/catalog/items/{tea['id']}/units",
        {"unit_id": units["carton"]["id"], "factor_milli": "24000", "barcode": "6291000000159"},
    )
    assert r.status_code == 201, r.json()
    carton = r.json()["units"][0]
    assert carton["name"] == "كرتونة" and carton["barcode"] == "6291000000159"
    # الباركود هوية عبر الأصناف والوحدات معاً
    r = api.post(
        "/api/catalog/items",
        {"name": "شاي كرتون", "base_unit_id": units["piece"]["id"], "barcode": "6291000000159"},
    )
    taken = r.json()["errors"][0]
    assert taken["code"] == "barcode_taken" and taken["owner_unit_name"] == "كرتونة"
    assert taken["owner_item_name"] == "شاي أسود 250غ"
    # التكرار والأساسية والحدود
    r = api.post(
        f"/api/catalog/items/{tea['id']}/units",
        {"unit_id": units["carton"]["id"], "factor_milli": "12000"},
    )
    assert _codes(r) == {("unit_id", "duplicate_unit")}
    r = api.post(
        f"/api/catalog/items/{tea['id']}/units",
        {"unit_id": units["pack"]["id"], "factor_milli": "0"},
    )
    assert _codes(r) == {("unit_id", "same_as_base"), ("factor_milli", "out_of_range")}
    r = api.post(f"/api/catalog/items/{tea['id']}/units", {"unit_id": "", "factor_milli": "1.5"})
    assert _codes(r) == {("unit_id", "required"), ("factor_milli", "not_a_number")}
    # تغيير معامل له ماضٍ: 300 سطر بالمعامل القديم تبقى بمعاملها
    services.FACTOR_USAGE_PROVIDERS.append(lambda _iu: 300)
    r = api.patch(f"/api/catalog/items/{tea['id']}/units/{carton['id']}", {"factor_milli": "48000"})
    assert r.status_code == 200, r.json()
    u = r.json()["units"][0]
    assert u["factor_milli"] == "48000" and u["prior_lines"] == 300
    assert len(u["changes"]) == 1
    ch = u["changes"][0]
    assert (ch["old_factor_milli"], ch["new_factor_milli"], ch["prior_lines"]) == (
        "24000",
        "48000",
        300,
    )
    assert ch["changed_by_name"] and ch["changed_at"]
    # المعامل نفسه لا يُسجَّل تغييراً؛ الباركود يُعدَّل وحده
    r = api.patch(
        f"/api/catalog/items/{tea['id']}/units/{carton['id']}",
        {"factor_milli": "48000", "barcode": "6291000000160"},
    )
    assert len(r.json()["units"][0]["changes"]) == 1
    assert r.json()["units"][0]["barcode"] == "6291000000160"
    # حدّ المعامل
    r = api.patch(
        f"/api/catalog/items/{tea['id']}/units/{carton['id']}",
        {"factor_milli": str(FACTOR_MAX_MILLI + 1)},
    )
    assert _codes(r) == {("factor_milli", "out_of_range")}
    # الوحدة المسجّلة في الخادم تحمل المعامل الجديد والتاريخ محفوظ (ACC-19: السطر يحفظ معامله)
    from core.tenancy import platform_context

    with platform_context():
        iu = ItemUnit.unscoped.get(id=carton["id"])
        assert iu.factor_milli == 48000 and iu.changes.count() == 1
    assert (
        api.patch(
            f"/api/catalog/items/{tea['id']}/units/00000000-0000-0000-0000-000000000000",
            {"factor_milli": "1"},
        ).status_code
        == 404
    )


def test_requires_tenant_session() -> None:
    assert Client().get("/api/catalog/units").status_code == 401
