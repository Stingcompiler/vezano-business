"""HOME-01/02/03 (T1.7): الرئيسية حسب الصلاحية، المعلّق على الأجهزة، البحث بترتيب ثابت.

R-01، R-02.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from django.test import Client

from core.scenario import faults
from core.scenario.seed import (
    DEMO_CASHIER_IDENTIFIER,
    DEMO_OWNER_IDENTIFIER,
    DEMO_PASSWORD,
    FIXED,
    reset_scenario,
)
from sync.push import PROTOCOL_VERSION

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


def bearer(access: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {access}"}


def login(client: Client, identifier: str) -> dict[str, Any]:
    r = client.post(
        "/api/auth/account/login",
        {"identifier": identifier, "password": DEMO_PASSWORD},
        content_type="application/json",
    )
    data: dict[str, Any] = r.json()
    return data


def owner_access(client: Client) -> str:
    data = login(client, DEMO_OWNER_IDENTIFIER)
    r = client.post(
        "/api/account/select",
        {"tenant_id": str(FIXED["tenant_a"])},
        content_type="application/json",
        HTTP_X_SELECT_TICKET=data["select_ticket"],
    )
    return str(r.json()["access"])


def test_owner_home_has_finance_and_employee_home_hides_it() -> None:
    reset_scenario()
    client = Client()
    owner = client.get("/api/home", **bearer(owner_access(client))).json()  # type: ignore[arg-type]
    assert owner["kind"] == "owner" and owner["can_see_finance"] is True
    assert owner["margin_locked"] is True and owner["branches_synced"] is True
    assert [b["name"] for b in owner["branches"]] == ["الرئيسي"]
    assert owner["decisions"] == [] and owner["kpis"] == [] and owner["attention"] == []
    cashier = login(Client(), DEMO_CASHIER_IDENTIFIER)
    emp = client.get("/api/home", **bearer(cashier["access"])).json()  # type: ignore[arg-type]
    assert emp["kind"] == "employee" and emp["can_see_finance"] is False
    assert emp["quick_actions"] == ["sale", "payment", "return"]
    assert emp["user"] == {
        "display_name": "أحمد الطيب — تجريبي",
        "role_name": "كاشير",
        "branch_name": "الرئيسي",
        "device_name": "",
    }


def test_pending_on_devices_appears_as_attention_for_owner_only() -> None:
    reset_scenario()
    client = Client()
    cashier = login(client, DEMO_CASHIER_IDENTIFIER)
    reg = client.post(
        "/api/devices/register",
        {"name": "الكاشير 1"},
        content_type="application/json",
        **bearer(cashier["access"]),  # type: ignore[arg-type]
    ).json()
    epoch = client.post("/api/bootstrap/start", **bearer(reg["access"])).json()["sync_epoch"]  # type: ignore[arg-type]
    r = client.post(
        "/api/sync/push",
        {
            "protocol_version": PROTOCOL_VERSION,
            "sync_epoch": epoch,
            "request_id": "r1",
            "operations": [],
            "pending_after": 3,
        },
        content_type="application/json",
        **bearer(reg["access"]),  # type: ignore[arg-type]
    )
    assert r.status_code == 200
    owner = client.get("/api/home", **bearer(owner_access(Client()))).json()  # type: ignore[arg-type]
    assert owner["branches_synced"] is False
    assert len(owner["attention"]) == 1
    a = owner["attention"][0]
    assert (a["title_count"], a["title"], a["detail"], a["action"]) == (
        3,
        "عمليات معلقة منذ",
        "الكاشير 1 — لا اتصال بالخادم",
        "مركز المزامنة",
    )
    emp = client.get("/api/home", **bearer(cashier["access"])).json()  # type: ignore[arg-type]
    assert emp["attention"] == []
    notices = client.get("/api/notices", **bearer(owner_access(Client()))).json()  # type: ignore[arg-type]
    assert notices["needs_action"] == 1


def test_search_has_fixed_kind_order_and_counts() -> None:
    reset_scenario()
    client = Client()
    r = client.get("/api/search", {"q": "الواحة"}, **bearer(owner_access(client)))  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert [g["kind"] for g in body["groups"]] == ["parties", "documents", "items"]
    assert [g["label"] for g in body["groups"]] == ["أطراف", "مستندات", "أصناف"]
    assert body["total"] == 0 and body["kinds_with_results"] == 0 and body["restricted"] == []
    assert body["suggestions"]["other_branches"] is False


def test_requires_tenant_session() -> None:
    assert Client().get("/api/home").status_code == 401
