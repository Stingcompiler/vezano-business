"""ACC-08/ACC-09 (T1.5): الجلسات النشطة وإبطالها — الإبطال يمنع الاستمرار لا الماضي.

§٩.٤؛ معيار §١٨ ACC-98.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from django.test import Client

from core.models import Session
from core.scenario import faults
from core.scenario.seed import (
    DEMO_CASHIER_IDENTIFIER,
    DEMO_OWNER_IDENTIFIER,
    DEMO_PASSWORD,
    FIXED,
    reset_scenario,
)
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
    def __init__(self, client: Client, access: str) -> None:
        self.client, self.h = client, {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def get(self, path: str) -> Any:
        return self.client.get(path, **self.h)  # type: ignore[arg-type]

    def post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        return self.client.post(path, body or {}, content_type="application/json", **self.h)  # type: ignore[arg-type]


def account_login(client: Client, identifier: str) -> dict[str, Any]:
    r = client.post(
        "/api/auth/account/login",
        {"identifier": identifier, "password": DEMO_PASSWORD},
        content_type="application/json",
    )
    assert r.status_code == 200, r.content
    data: dict[str, Any] = r.json()
    return data


def cashier_with_device(client: Client) -> tuple[Api, Api, dict[str, Any]]:
    """جلسة الكاشير + جلسة نقل لجهاز سجّله في فرعه."""
    data = account_login(client, DEMO_CASHIER_IDENTIFIER)
    user = Api(client, data["access"])
    reg = user.post("/api/devices/register", {"name": "كاشير 2 — لوحي"}).json()
    return user, Api(client, reg["access"]), reg


def owner_in_a(client: Client) -> Api:
    data = account_login(client, DEMO_OWNER_IDENTIFIER)
    sel = (
        Api(client, "x")
        .client.post(
            "/api/account/select",
            {"tenant_id": str(FIXED["tenant_a"])},
            content_type="application/json",
            HTTP_X_SELECT_TICKET=data["select_ticket"],
        )
        .json()
    )
    return Api(client, sel["access"])


def test_employee_sees_own_sessions_and_device_sessions_only_as_device() -> None:
    reset_scenario()
    client = Client()
    user, _device, reg = cashier_with_device(client)
    rows = user.get("/api/account/sessions").json()["sessions"]
    kinds = {r["session_label"]: r for r in rows}
    assert "كاشير 2 — لوحي" in kinds
    current = [r for r in rows if r["is_current"]]
    assert len(current) == 1 and current[0]["kind"] == "own"
    assert all(r["can_revoke"] for r in rows)  # كلها جلساته هو (بما فيها جلسة نقل جهازه)
    assert kinds["كاشير 2 — لوحي"]["device_id"] == reg["device_id"]


def test_owner_sees_device_sessions_of_tenant_and_can_revoke_them() -> None:
    reset_scenario()
    client = Client()
    _user, _device, reg = cashier_with_device(client)
    owner = owner_in_a(Client())
    rows = owner.get("/api/account/sessions").json()["sessions"]
    dev = next(r for r in rows if r["device_id"] == reg["device_id"])
    assert dev["kind"] == "device" and dev["can_revoke"] and dev["branch_name"] == "الرئيسي"
    # الجلسة ليست منتهية قبل تأكيد الخادم
    assert dev["revoked_at"] == ""
    r = owner.post(f"/api/account/sessions/{dev['session_id']}/revoke")
    assert r.status_code == 200 and r.json()["revoked_at"] != ""
    # الجهاز المُبطَلة جلسته يُمنع من بيع جديد (PUSH يُرفض بجلسة ملغاة)
    r = Api(client, reg["access"]).post(
        "/api/sync/push",
        {
            "protocol_version": PROTOCOL_VERSION,
            "sync_epoch": "x",
            "request_id": "r",
            "operations": [],
        },
    )
    assert r.status_code == 401


def test_non_owner_cannot_revoke_other_users_session() -> None:
    reset_scenario()
    client = Client()
    _user, _device, _reg = cashier_with_device(client)
    owner_client = Client()
    owner = owner_in_a(owner_client)
    owner_rows = owner.get("/api/account/sessions").json()["sessions"]
    owner_session = next(r for r in owner_rows if r["is_current"])["session_id"]
    cashier = Api(client, account_login(Client(), DEMO_CASHIER_IDENTIFIER)["access"])
    r = cashier.post(f"/api/account/sessions/{owner_session}/revoke")
    assert r.status_code == 403
    # ولا يراها أصلاً
    ids = {r["session_id"] for r in cashier.get("/api/account/sessions").json()["sessions"]}
    assert owner_session not in ids


def test_push_reports_pending_and_scheduled_revoke_fires_when_queue_empties() -> None:
    """ACC-09: «هذا الجهاز عليه N عملية لم تُرفع» ثم «أنهِ بعد رفع المعلّق»."""
    reset_scenario()
    client = Client()
    _user, device, reg = cashier_with_device(client)
    with platform_context():
        epoch = Session.unscoped.get(device_id=reg["device_id"]).tenant.sync_state.sync_epoch  # type: ignore[union-attr]

    def push(pending_after: int) -> Any:
        return device.post(
            "/api/sync/push",
            {
                "protocol_version": PROTOCOL_VERSION,
                "sync_epoch": epoch,
                "request_id": f"r{pending_after}",
                "operations": [],
                "pending_after": pending_after,
            },
        )

    assert push(12).status_code == 200
    owner = owner_in_a(Client())
    dev = next(
        r
        for r in owner.get("/api/account/sessions").json()["sessions"]
        if r["device_id"] == reg["device_id"]
    )
    assert dev["reported_pending"] == 12
    r = owner.post(f"/api/account/sessions/{dev['session_id']}/revoke", {"after_upload": True})
    assert r.status_code == 200
    assert r.json()["revoke_after_upload"] is True and r.json()["revoked_at"] == ""
    # ما زال يرفع
    assert push(3).status_code == 200
    # فرغ الطابور → الإنهاء يُنفَّذ؛ الطلب التالي يُرفض
    assert push(0).status_code == 200
    assert push(0).status_code == 401
    dev2 = next(
        r
        for r in owner.get("/api/account/sessions").json()["sessions"]
        if r["device_id"] == reg["device_id"]
    )
    assert dev2["revoked_at"] != "" and dev2["revoke_after_upload"] is False
