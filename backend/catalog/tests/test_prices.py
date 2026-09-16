"""CAT-04/CAT-05 (T1.10): السعر سلسلة تواريخ؛ التغيير للمالك؛ سعر دون التكلفة تنبيه لا منع؛
الاستيراد دفعةً بهوية تمنع التكرار، معاينة بلا كتابة، جزئي صريح، استئناف بعد انقطاع، تراجع دفعةً
(معيار §١٨ ACC-86).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from catalog import prices
from catalog.models import Item, ItemPrice, PriceImportBatch
from core.scenario import faults
from core.scenario.seed import (
    DEMO_CASHIER_IDENTIFIER,
    DEMO_OWNER_IDENTIFIER,
    DEMO_PASSWORD,
    FIXED,
    reset_scenario,
)
from core.tenancy import platform_context

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    for reg in (prices.COST_PROVIDERS, prices.PRICE_USAGE_PROVIDERS, prices.BULK_PRICING_BLOCKERS):
        reg.clear()
    yield
    for reg in (prices.COST_PROVIDERS, prices.PRICE_USAGE_PROVIDERS, prices.BULK_PRICING_BLOCKERS):
        reg.clear()


class Api:
    def __init__(self, *, owner: bool) -> None:
        reset_scenario()
        self.client = Client()
        if owner:
            r = self.client.post(
                "/api/auth/account/login",
                {"identifier": DEMO_OWNER_IDENTIFIER, "password": DEMO_PASSWORD},
                content_type="application/json",
            )
            r = self.client.post(
                "/api/account/select",
                {"tenant_id": str(FIXED["tenant_a"])},
                content_type="application/json",
                HTTP_X_SELECT_TICKET=r.json()["select_ticket"],
            )
        else:
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

    def item(self, name: str) -> dict[str, Any]:
        rows = self.get("/api/catalog/items", {"include_inactive": "1"}).json()["items"]
        return next(i for i in rows if i["name"] == name)


def test_price_history_and_units_follow() -> None:
    """CAT-04 ready/success: سطر أول من السيناريو؛ الجديد يسري من الآن ويغلق القديم؛ سعر الكرتونة
    يتبع تلقائياً؛ السعر نفسه لا يُسجَّل سطراً."""
    api = Api(owner=True)
    sugar = api.item("سكر")
    v = api.get(f"/api/catalog/items/{sugar['id']}/price").json()
    assert v["can_change"] is True and v["sale_price_minor"] == "10000"
    assert len(v["history"]) == 1 and v["history"][0]["effective_to"] == ""
    assert v["units"][0]["name"] == "كرتونة" and v["units"][0]["price_minor"] == "120000"
    r = api.post(f"/api/catalog/items/{sugar['id']}/price", {"price_minor": "11000"})
    assert r.status_code == 200 and r.json()["changed"] is True
    h = r.json()["history"]
    assert [x["price_minor"] for x in h] == ["11000", "10000"]
    assert h[0]["effective_to"] == "" and h[1]["effective_to"] and h[0]["changed_by_name"]
    assert r.json()["units"][0]["price_minor"] == "132000"
    # السعر نفسه: لا سطر جديد
    r = api.post(f"/api/catalog/items/{sugar['id']}/price", {"price_minor": "11000"})
    assert r.json()["changed"] is False and len(r.json()["history"]) == 2
    # الحدود (ACC-25)
    r = api.post(f"/api/catalog/items/{sugar['id']}/price", {"price_minor": "-5"})
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "out_of_range"
    # تعديل السعر من بطاقة الصنف (CAT-02) سطرٌ في التاريخ أيضاً
    r = api.client.patch(
        f"/api/catalog/items/{sugar['id']}",
        {"sale_price_minor": "12500"},
        content_type="application/json",
        **api.h,  # type: ignore[arg-type]
    )
    assert r.status_code == 200
    assert len(api.get(f"/api/catalog/items/{sugar['id']}/price").json()["history"]) == 3


def test_price_change_is_owner_only_and_request_change() -> None:
    """CAT-04 permission_denied: الكاشير يرى السعر وتاريخه ولا يغيّره — «اطلب تغييراً»."""
    api = Api(owner=False)
    sugar = api.item("سكر")
    v = api.get(f"/api/catalog/items/{sugar['id']}/price").json()
    assert v["can_change"] is False and v["can_see_cost"] is False and len(v["history"]) == 1
    r = api.post(f"/api/catalog/items/{sugar['id']}/price", {"price_minor": "11000"})
    assert r.status_code == 403 and r.json()["detail"] == "price_owner_only"
    r = api.post(
        f"/api/catalog/items/{sugar['id']}/price-request",
        {"proposed_price_minor": "11000", "reason": "السوق المحلي أعلى"},
    )
    assert r.status_code == 201 and r.json()["status"] == "pending"
    v = api.get(f"/api/catalog/items/{sugar['id']}/price").json()
    assert v["pending_requests"][0]["proposed_price_minor"] == "11000"
    assert v["pending_requests"][0]["reason"] == "السوق المحلي أعلى"
    # الاستيراد للمالك كذلك
    r = api.post("/api/catalog/prices/import/preview", {"file_name": "x.csv", "content": ""})
    assert r.status_code == 403 and r.json()["detail"] == "price_owner_only"


def test_below_cost_warns_once_and_hidden_for_those_without_cost() -> None:
    """CAT-04 validation_error: ننبّه ولا نمنع — تأكيد واحد بالهامش السالب؛ ولمن لا يرى التكلفة
    لا تنبيه أصلاً."""
    prices.COST_PROVIDERS.append(lambda _item: 9000)
    api = Api(owner=True)
    sugar = api.item("سكر")
    assert api.get(f"/api/catalog/items/{sugar['id']}/price").json()["average_cost_minor"] == "9000"
    r = api.post(f"/api/catalog/items/{sugar['id']}/price", {"price_minor": "8500"})
    assert r.status_code == 409
    assert r.json() == {
        "detail": "below_cost",
        "average_cost_minor": "9000",
        "price_minor": "8500",
        "margin_minor": "-500",
    }
    r = api.post(
        f"/api/catalog/items/{sugar['id']}/price",
        {"price_minor": "8500", "confirm_below_cost": True},
    )
    assert r.status_code == 200 and r.json()["sale_price_minor"] == "8500"
    # من لا يرى التكلفة لا يراها في العرض (الكاشير في السيناريو نفسه)
    r = api.client.post(
        "/api/auth/account/login",
        {"identifier": DEMO_CASHIER_IDENTIFIER, "password": DEMO_PASSWORD},
        content_type="application/json",
    )
    cashier = api.client.get(
        f"/api/catalog/items/{sugar['id']}/price",
        HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}",
    ).json()
    assert cashier["average_cost_minor"] == "" and cashier["can_see_cost"] is False


CSV = (
    "الصنف,السعر\n"
    "{sugar},110.00\n"
    "6291000000338,240.00\n"
    "زيت 1 لتر,-780.00\n"
    "unknown-id-58,300.00\n"
    "دقيق 5 كغ,abc\n"
    "{sugar},115\n"
    "أرز 1 كغ,٣٥٫٥\n"
)


def test_import_preview_partial_apply_resume_and_revert() -> None:
    """CAT-05: معاينة بلا كتابة (جاهز/مرفوض/بلا تغيير)، الملف نفسه لا يكرّر، الاعتماد يطبّق الصالح
    فقط، الانقطاع يُستأنف بلا تكرار، المرفوض يُنزَّل بسببه ورقم سطره، والتراجع دفعةً."""
    api = Api(owner=True)
    sugar = api.item("سكر")
    content = CSV.format(sugar=sugar["id"])
    r = api.post(
        "/api/catalog/prices/import/preview", {"file_name": "prices-sep.csv", "content": content}
    )
    assert r.status_code == 200, r.json()
    b = r.json()
    assert (b["ready_count"], b["rejected_count"], b["unchanged_count"]) == (2, 4, 1)
    assert b["status"] == "previewed" and b["max_increase_pct"] == 10
    by_line = {row["line"]: row for row in b["rows"]}
    assert by_line[2]["result"] == "update" and by_line[2]["old_price_minor"] == "10000"
    assert by_line[3]["result"] == "unchanged" and by_line[3]["name"] == "شاي أسود 250غ"
    assert by_line[4]["reason"] == "negative" and by_line[5]["reason"] == "item_not_found"
    assert by_line[6]["reason"] == "not_a_number" and by_line[7]["reason"] == "duplicate"
    assert by_line[8]["result"] == "update" and by_line[8]["new_price_minor"] == "3550"
    # لم يُكتب شيء
    assert api.item("سكر")["sale_price_minor"] == "10000"
    # الملف نفسه → الدفعة نفسها
    r2 = api.post(
        "/api/catalog/prices/import/preview", {"file_name": "again.csv", "content": content}
    )
    assert r2.json()["id"] == b["id"]
    # المرفوض يُنزَّل بسببه ورقم سطره
    csv_out = api.get(f"/api/catalog/prices/import/{b['id']}/rejected.csv")
    assert csv_out.status_code == 200 and csv_out["Content-Type"].startswith("text/csv")
    text = csv_out.content.decode("utf-8")
    assert (
        "4,زيت 1 لتر,-780.00,سعر سالب" in text
        and "5,unknown-id-58,300.00,لا صنف بهذا المعرّف" in text
    )
    assert "6,دقيق 5 كغ,abc,سعر غير رقمي" in text and "7," in text
    # انقطاع بعد صف واحد (محاكاة): ما اكتمل يبقى
    r = api.post(f"/api/catalog/prices/import/{b['id']}/apply", {"stop_after": 1})
    assert r.json()["status"] == "applying" and r.json()["applied_count"] == 1
    assert api.item("سكر")["sale_price_minor"] == "11000"
    assert api.item("أرز 1 كغ")["sale_price_minor"] == "32000"
    # الاستئناف يكمل بلا تكرار
    r = api.post(f"/api/catalog/prices/import/{b['id']}/apply", {})
    assert r.json()["status"] == "applied" and r.json()["applied_count"] == 2
    assert api.item("أرز 1 كغ")["sale_price_minor"] == "3550"
    with platform_context():
        assert ItemPrice.unscoped.filter(batch_id=b["id"]).count() == 2
        assert ItemPrice.unscoped.filter(item_id=sugar["id"]).count() == 2
    # إعادة الاعتماد لا تكرّر
    r = api.post(f"/api/catalog/prices/import/{b['id']}/apply", {})
    assert r.json()["applied_count"] == 2
    with platform_context():
        assert ItemPrice.unscoped.filter(batch_id=b["id"]).count() == 2
    # التراجع دفعةً
    r = api.post(f"/api/catalog/prices/import/{b['id']}/revert", {})
    assert r.status_code == 200 and r.json()["status"] == "reverted"
    assert api.item("سكر")["sale_price_minor"] == "10000"
    assert api.item("أرز 1 كغ")["sale_price_minor"] == "32000"
    assert api.post(f"/api/catalog/prices/import/{b['id']}/revert", {}).status_code == 409


def test_revert_refused_after_window_or_when_sold() -> None:
    api = Api(owner=True)
    sugar = api.item("سكر")
    content = f"الصنف,السعر\n{sugar['id']},120\n"
    b = api.post(
        "/api/catalog/prices/import/preview", {"file_name": "p.csv", "content": content}
    ).json()
    assert api.post(f"/api/catalog/prices/import/{b['id']}/apply", {}).json()["status"] == "applied"
    prices.PRICE_USAGE_PROVIDERS.append(lambda _i, _p, _s: 3)
    r = api.post(f"/api/catalog/prices/import/{b['id']}/revert", {})
    assert (
        r.status_code == 409 and r.json()["reason"] == "sold_at_new_price" and r.json()["sold"] == 3
    )
    prices.PRICE_USAGE_PROVIDERS.clear()
    with platform_context():
        PriceImportBatch.unscoped.filter(id=b["id"]).update(
            applied_at=timezone.now() - timedelta(hours=25)
        )
    r = api.post(f"/api/catalog/prices/import/{b['id']}/revert", {})
    assert r.status_code == 409 and r.json()["reason"] == "window_passed"
    # التسعير الجماعي محجوب بعد الانتهاء (§١١.٢)؛ سعر الصنف الواحد يبقى
    prices.BULK_PRICING_BLOCKERS.append(lambda _t: True)
    r = api.post("/api/catalog/prices/import/preview", {"file_name": "p2.csv", "content": content})
    assert r.status_code == 403 and r.json()["detail"] == "bulk_pricing_blocked"
    assert (
        api.post(f"/api/catalog/items/{sugar['id']}/price", {"price_minor": "13000"}).status_code
        == 200
    )
    with platform_context():
        assert Item.unscoped.get(id=sugar["id"]).sale_price_minor == 13000
