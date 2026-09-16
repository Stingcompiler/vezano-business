"""ACC-06 (T1.4): الدعوة بهوية الحساب — لا نُفشي، ولا يُستهلك القبول بالفشل.

§١٤.٦؛ معيار §١٨ ACC-62.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import Invitation, User, UserBranchAccess
from core.scenario import faults
from core.scenario.seed import (
    DEMO_CASHIER_IDENTIFIER,
    DEMO_INVITE_TOKEN,
    DEMO_OWNER_IDENTIFIER,
    DEMO_PASSWORD,
    reset_scenario,
)
from core.tenancy import platform_context

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


class Auth:
    """هوية الطلب: جلسة (Bearer) أو تذكرة اختيار — كما يعيدها الدخول."""

    def __init__(self, client: Client, identifier: str) -> None:
        r = client.post(
            "/api/auth/account/login",
            {"identifier": identifier, "password": DEMO_PASSWORD},
            content_type="application/json",
        )
        assert r.status_code == 200, r.content
        data = r.json()
        self.client = client
        if "access" in data:
            self.headers = {"HTTP_AUTHORIZATION": f"Bearer {data['access']}"}
        else:
            self.headers = {"HTTP_X_SELECT_TICKET": data["select_ticket"]}

    def get(self, path: str) -> Any:
        return self.client.get(path, **self.headers)  # type: ignore[arg-type]

    def post(self, path: str) -> Any:
        return self.client.post(path, **self.headers)  # type: ignore[arg-type]


def test_invitee_sees_details_and_accepts_once() -> None:
    reset_scenario()
    client = Client()
    h = Auth(client, DEMO_CASHIER_IDENTIFIER)
    r = h.get(f"/api/invites/{DEMO_INVITE_TOKEN}")
    assert r.status_code == 200
    view: dict[str, Any] = r.json()
    assert (view["status"], view["tenant_name"], view["role_name"], view["branch_name"]) == (
        "valid",
        "مخزن البركة — تجريبي",
        "أمين مخزن",
        "المخزن الرئيسي",
    )
    assert view["inviter_name"].startswith("عثمان الطيب")
    r = h.post(f"/api/invites/{DEMO_INVITE_TOKEN}/accept")
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    user_id = r.json()["user_id"]
    # القبول متكرّر الأثر: لا عضوية ثانية
    r = h.post(f"/api/invites/{DEMO_INVITE_TOKEN}/accept")
    assert r.status_code == 200 and r.json()["user_id"] == user_id
    with platform_context():
        assert User.unscoped.filter(id=user_id).count() == 1
        u = User.unscoped.get(id=user_id)
        assert not u.is_owner and u.account is not None
        assert UserBranchAccess.unscoped.filter(user=u).count() == 1
    # صار للحساب عضويتان → الدخول يعرض القائمة
    r = client.post(
        "/api/auth/account/login",
        {"identifier": DEMO_CASHIER_IDENTIFIER, "password": DEMO_PASSWORD},
        content_type="application/json",
    )
    names = {m["tenant_name"] for m in r.json()["memberships"]}
    assert names == {"بقالة النيل — تجريبي", "مخزن البركة — تجريبي"}


def test_other_account_gets_not_for_you_without_details() -> None:
    """34-D26: «هذه الدعوة لحسابٍ آخر» وكفى — لا اسم المنشأة ولا الدور."""
    reset_scenario()
    client = Client()
    h = Auth(client, DEMO_OWNER_IDENTIFIER)
    r = h.get(f"/api/invites/{DEMO_INVITE_TOKEN}")
    assert r.status_code == 200
    assert r.json() == {
        "status": "not_for_you",
        "tenant_name": "",
        "inviter_name": "",
        "role_name": "",
        "branch_name": "",
        "expires_at": "",
        "tenant_id": "",
        "user_id": "",
    }
    r = h.post(f"/api/invites/{DEMO_INVITE_TOKEN}/accept")
    assert r.status_code == 403 and r.json()["tenant_name"] == ""


def test_expired_and_unknown_and_unauthenticated() -> None:
    reset_scenario()
    client = Client()
    h = Auth(client, DEMO_CASHIER_IDENTIFIER)
    assert client.get(f"/api/invites/{DEMO_INVITE_TOKEN}").status_code == 401
    assert h.get("/api/invites/nope").json()["status"] == "not_found"
    with platform_context():
        Invitation.unscoped.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert h.get(f"/api/invites/{DEMO_INVITE_TOKEN}").json()["status"] == "expired"
    r = h.post(f"/api/invites/{DEMO_INVITE_TOKEN}/accept")
    assert r.status_code == 410


def test_device_verifiers_listed_for_branch_users_only() -> None:
    """§٨.٦: المتحققات إلى أجهزة أصحابها فقط؛ القائمة كاملة كل مرة."""
    reset_scenario()
    client = Client()
    r = client.post(
        "/api/auth/account/login",
        {"identifier": DEMO_CASHIER_IDENTIFIER, "password": DEMO_PASSWORD},
        content_type="application/json",
    )
    access = r.json()["access"]
    reg = client.post(
        "/api/devices/register",
        {"name": "x"},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {access}",
    ).json()
    r = client.get("/api/devices/verifiers", HTTP_AUTHORIZATION=f"Bearer {reg['access']}")
    assert r.status_code == 200
    body = r.json()
    assert body["prefix"] == reg["prefix"] and body["pin_length"] == 6
    rows = {v["display_name"]: v for v in body["verifiers"]}
    assert set(rows) == {"المالك — تجريبي", "أحمد الطيب — تجريبي"}
    assert rows["أحمد الطيب — تجريبي"]["role_name"] == "كاشير"
    assert rows["المالك — تجريبي"]["role_name"] == "مالك"
    assert rows["أحمد الطيب — تجريبي"]["encoded"].startswith("pbkdf2_sha256$")
    # سحب تخويل الكاشير: يغيب من القائمة التالية
    with platform_context():
        UserBranchAccess.unscoped.filter(user__username="cashier").update(revoked_at=timezone.now())
    r = client.get("/api/devices/verifiers", HTTP_AUTHORIZATION=f"Bearer {reg['access']}")
    assert {v["display_name"] for v in r.json()["verifiers"]} == {"المالك — تجريبي"}
    # جلسة بلا جهاز → 403
    assert (
        client.get("/api/devices/verifiers", HTTP_AUTHORIZATION=f"Bearer {access}").status_code
        == 403
    )
