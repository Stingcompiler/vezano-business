"""ACC-10 (T1.6): معالج بدء الاستخدام — اختياري ويُستأنف، والشعار بحدّ معلن (§١٤.٣)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from django.test import Client

from core.scenario import faults
from core.scenario.seed import DEMO_CASHIER_IDENTIFIER, DEMO_PASSWORD, reset_scenario

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


def session(client: Client) -> dict[str, str]:
    r = client.post(
        "/api/auth/account/login",
        {"identifier": DEMO_CASHIER_IDENTIFIER, "password": DEMO_PASSWORD},
        content_type="application/json",
    )
    return {"HTTP_AUTHORIZATION": f"Bearer {r.json()['access']}"}


def test_status_reflects_data_and_dismiss_persists() -> None:
    reset_scenario()
    client = Client()
    h = session(client)
    r = client.get("/api/tenants/onboarding", **h)  # type: ignore[arg-type]
    assert r.status_code == 200
    body: dict[str, Any] = r.json()
    assert (
        body["tenant_name"].startswith("بقالة النيل") and body["currency_name"] == "الجنيه السوداني"
    )
    assert body["branches"] == 1 and body["dismissed"] is False
    assert body["steps"]["org"] == {"done": True}
    assert body["steps"]["items"] == {"imported": 0, "rejected": 0, "sales": 0}
    assert body["steps"]["logo"] == {"present": False}
    r = client.patch(
        "/api/tenants/onboarding",
        {"dismissed": True},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 200 and r.json()["dismissed"] is True
    assert client.get("/api/tenants/onboarding", **h).json()["dismissed"] is True  # type: ignore[arg-type]


def test_logo_limit_is_enforced_and_small_logo_stored() -> None:
    reset_scenario()
    client = Client()
    h = session(client)
    big = "data:image/png;base64," + ("A" * (2 * 1024 * 1024 + 10))
    r = client.patch(
        "/api/tenants/onboarding",
        {"logo_data_url": big},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 413
    assert r.json()["detail"] == "logo_too_large" and r.json()["max_bytes"] == 2 * 1024 * 1024
    small = "data:image/png;base64,iVBORw0KGgo="
    r = client.patch(
        "/api/tenants/onboarding",
        {"logo_data_url": small},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 200 and r.json()["steps"]["logo"] == {"present": True}


def test_requires_tenant_session() -> None:
    assert Client().get("/api/tenants/onboarding").status_code == 401
