"""CAT-01/CAT-06 (T1.8): البحث بالبادئة والتطبيع، الأسماء البديلة الفريدة، التعطيل بشاهد صريح.

معيار §١٨ ACC-45.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from django.test import Client

from catalog.models import Item
from core.scenario import faults
from core.scenario.seed import DEMO_CASHIER_IDENTIFIER, DEMO_PASSWORD, reset_scenario
from core.tenancy import platform_context
from sync.push import PROTOCOL_VERSION

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


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

    def delete(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.delete(path, body, content_type="application/json", **self.h)  # type: ignore[arg-type]

    def as_device(self, access: str) -> Api:
        other = Api.__new__(Api)
        other.client = self.client
        other.h = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
        return other


def test_list_defaults_to_active_and_search_uses_prefix_and_normalization() -> None:
    api = Api()
    r = api.get("/api/catalog/items")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 6 and body["all_total"] == 7  # المعطَّل مستبعد افتراضياً
    assert [g["name"] for g in body["groups"]] == ["بقالة", "مشروبات", "منظفات"]
    sugar = next(i for i in body["items"] if i["name"] == "سكر")
    assert sugar["aliases"] == ["سكر أبيض"] and sugar["base_unit_name"] == "كغ"
    assert sugar["units"][0]["name"] == "كرتونة" and sugar["units"][0]["factor_milli"] == "12000"
    assert sugar["sale_price_minor"] == "10000" and sugar["barcode"] == "6291000000142"
    # يشمل المعطَّل
    assert api.get("/api/catalog/items", {"include_inactive": "1"}).json()["total"] == 7
    # بادئة الاسم، بادئة كلمة داخلية، الاسم البديل، الباركود، وتطبيع الألف/الأرقام الهندية
    assert {i["name"] for i in api.get("/api/catalog/items", {"q": "زي"}).json()["items"]} == {
        "زيت 1 لتر"
    }
    assert {i["name"] for i in api.get("/api/catalog/items", {"q": "أسود"}).json()["items"]} == {
        "شاي أسود 250غ"
    }
    assert {i["name"] for i in api.get("/api/catalog/items", {"q": "اسود"}).json()["items"]} == {
        "شاي أسود 250غ"
    }
    assert {i["name"] for i in api.get("/api/catalog/items", {"q": "طعام"}).json()["items"]} == {
        "زيت 1 لتر"
    }
    assert {
        i["name"] for i in api.get("/api/catalog/items", {"q": "62910000005"}).json()["items"]
    } == {"زيت 1 لتر"}
    assert {i["name"] for i in api.get("/api/catalog/items", {"q": "دقيق ٥"}).json()["items"]} == {
        "دقيق 5 كغ"
    }
    # المعطَّل لا يظهر في البحث الافتراضي ولو طابق
    assert api.get("/api/catalog/items", {"q": "صابون"}).json()["total"] == 0
    # تصفية بالمجموعة
    drinks = next(g["id"] for g in body["groups"] if g["name"] == "مشروبات")
    assert api.get("/api/catalog/items", {"group_id": drinks}).json()["total"] == 2


def test_alias_is_a_search_key_that_opens_one_item() -> None:
    """CAT-06: الاسم البديل مأخوذ → نسمّي الصنف المالك؛ والنجاح لا يلمس رصيداً ولا سعراً."""
    api = Api()
    items = {i["name"]: i for i in api.get("/api/catalog/items").json()["items"]}
    water, oil = items["ماء 1.5 لتر"], items["زيت 1 لتر"]
    r = api.post(f"/api/catalog/items/{water['id']}/aliases", {"aliases": ["مويه", "ماء معدني"]})
    assert r.status_code == 200 and r.json()["added"] == ["مويه", "ماء معدني"]
    assert r.json()["sale_price_minor"] == water["sale_price_minor"]
    # مأخوذ على صنف آخر — بالتطبيع (زيت طعام ≡ زيت طعام مع ألف/تشكيل)
    r = api.post(f"/api/catalog/items/{water['id']}/aliases", {"aliases": ["زيتُ طعام"]})
    assert r.status_code == 409
    assert (r.json()["detail"], r.json()["owner_item_id"], r.json()["owner_item_name"]) == (
        "alias_taken",
        oil["id"],
        "زيت 1 لتر",
    )
    # الاسم الرسمي لصنف آخر محجوز كذلك؛ والتكرار على الصنف نفسه بلا أثر
    assert (
        api.post(f"/api/catalog/items/{water['id']}/aliases", {"aliases": ["سكر"]}).status_code
        == 409
    )
    assert (
        api.post(f"/api/catalog/items/{water['id']}/aliases", {"aliases": ["مويه"]}).status_code
        == 200
    )
    # الأثر فوري في البحث
    assert {i["name"] for i in api.get("/api/catalog/items", {"q": "موي"}).json()["items"]} == {
        "ماء 1.5 لتر"
    }
    # وفي HOME-03
    s = api.get("/api/search", {"q": "مويه"}).json()
    items_group = next(g for g in s["groups"] if g["kind"] == "items")
    assert [x["title"] for x in items_group["results"]] == ["ماء 1.5 لتر"]


def test_groups_overview_counts_and_ungrouped_row() -> None:
    api = Api()
    r = api.get("/api/catalog/groups")
    body = r.json()
    assert body["group_count"] == 3 and body["total_items"] == 6
    rows = {g["name"]: g for g in body["groups"]}
    assert rows["بقالة"]["items"] == 4 and rows["بقالة"]["aliases"] == ["سكر أبيض", "زيت طعام"]
    assert rows["منظفات"]["items"] == 0  # صنفها الوحيد معطَّل
    assert rows["بلا مجموعة"]["items"] == 0 and body["groups"][-1]["name"] == "بلا مجموعة"
    assert api.post("/api/catalog/groups", {"name": "بقالة"}).status_code == 409
    r = api.post("/api/catalog/groups", {"name": "مخبوزات", "note": "تُجرد يومياً"})
    assert r.status_code == 201 and r.json()["name"] == "مخبوزات"


def test_deactivation_arrives_as_explicit_witness_via_pull_and_bootstrap() -> None:
    """ACC-45: التعطيل يصل كتحديث is_active=false لا باختفاء؛ والنسخة المادية تحمل الكتالوج."""
    api = Api()
    reg = api.post("/api/devices/register", {"name": "x"}).json()
    dev = api.as_device(reg["access"])
    image = dev.post("/api/bootstrap/start", {}).json()
    scopes = {s["group"]: s for s in image["scopes"]}
    assert scopes["catalog"]["total"] == 3 + 7  # مجموعات + أصناف (المعطَّل ضمنها بشاهده)
    page = dev.get(
        f"/api/bootstrap/{image['image_id']}/page", {"group": "catalog", "page": 1}
    ).json()
    soap = next(e for e in page["entities"] if e["payload"].get("name") == "صابون قديم")
    assert soap["payload"]["is_active"] is False and soap["payload"]["deactivated_at"]
    # تعطيل صنف بعد النسخة → يصل في PULL بحمولته المحدّثة
    sugar_id = next(e["id"] for e in page["entities"] if e["payload"].get("name") == "سكر")
    assert (
        api.post(f"/api/catalog/items/{sugar_id}/active", {"is_active": False}).status_code == 200
    )
    pull = dev.post(
        "/api/sync/pull",
        {
            "protocol_version": PROTOCOL_VERSION,
            "sync_epoch": image["sync_epoch"],
            "request_id": "p1",
            "cursors": [
                {
                    "scope": "enterprise",
                    "entity_group": "catalog",
                    "server_seq": image["cutoff_server_seq"],
                }
            ],
        },
    ).json()
    updated = [e for e in pull["entities"] if e["entity"] == "catalog.Item" and e["id"] == sugar_id]
    assert len(updated) == 1 and updated[0]["payload"]["is_active"] is False
    assert pull["tombstones"] == []
    with platform_context():
        assert Item.unscoped.get(id=sugar_id).is_active is False


def test_requires_tenant_session() -> None:
    assert Client().get("/api/catalog/items").status_code == 401


def test_balances_come_from_providers_with_match_time() -> None:
    """POS-01 «المتاح»: بلا مزوّد لا رصيد معروف (قائمة فارغة لا أصفار مزعومة)؛ مع مزوّد INV
    تُجمع الأرصدة لفرع الجلسة ومعها وقت المطابقة (ACC-76)."""
    from catalog import services

    api = Api()
    r = api.get("/api/catalog/balances")
    assert r.status_code == 200 and r.json()["balances"] == [] and r.json()["as_of"]
    with platform_context():
        item = Item.objects.order_by("name").first()
    assert item is not None
    services.BALANCE_PROVIDERS.append(lambda _branch: {item.id: 12000})
    services.BALANCE_PROVIDERS.append(lambda _branch: {item.id: -2000})
    try:
        r = api.get("/api/catalog/balances")
        assert r.json()["balances"] == [{"item_id": str(item.id), "qty_milli": "10000"}]
        assert r.json()["branch_id"]
    finally:
        services.BALANCE_PROVIDERS.clear()
    assert Client().get("/api/catalog/balances").status_code == 401
