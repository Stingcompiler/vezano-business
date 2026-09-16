"""ACC-05 (T1.3): تسجيل الجهاز والنسخة المادية بصفحات ثابتة تُستأنف.

§٨.١٠؛ معايير §١٨ ACC-40، 41، 52، 53.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth.accounts import create_account
from core.auth.memberships import create_tenant
from core.models import Unit
from core.scenario import faults
from core.tenancy import platform_context
from sync.models_log import BootstrapImage, BootstrapPage

pytestmark = pytest.mark.django_db(transaction=True)

PASSWORD = "correct horse battery staple"  # noqa: S105 — اختبار


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


def bearer(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def post(
    client: Client, path: str, body: dict[str, Any] | None, token: str
) -> tuple[int, dict[str, Any]]:
    r = client.post(path, body or {}, content_type="application/json", **bearer(token))  # type: ignore[arg-type]
    data: dict[str, Any] = r.json() if r.content else {}
    return r.status_code, data


@pytest.fixture
def owner_session() -> dict[str, Any]:
    """حساب أنشأ منشأة بوصفة البقالة → جلسة مالك داخلها (بلا جهاز بعد)."""
    account = create_account("0912447001", PASSWORD, "المالك")
    result = create_tenant(
        account,
        client_request_id=uuid.uuid4(),
        name="بقالة النيل",
        sector="grocery",
        currency="SDG",
        first_branch_name="فرع بحري",
    )
    client = Client()
    code, data = post(
        client, "/api/auth/account/login", {"identifier": "0912447001", "password": PASSWORD}, ""
    )
    assert code == 200 and "access" in data, data
    return {"client": client, "access": data["access"], "tenant_id": str(result.creation.tenant_id)}


def register(client: Client, access: str) -> dict[str, Any]:
    code, reg = post(client, "/api/devices/register", {"name": "تابلت الكاشير"}, access)
    assert code == 201, reg
    return reg


class TestRegisterDevice:
    def test_registers_in_default_branch_and_issues_device_session(
        self, owner_session: dict[str, Any]
    ) -> None:
        client, access = owner_session["client"], owner_session["access"]
        reg = register(client, access)
        assert set(reg) == {
            "device_id",
            "prefix",
            "branch_id",
            "registration_secret",
            "access",
            "refresh",
        }
        me = client.get("/api/auth/me", **bearer(reg["access"])).json()
        assert me["device_id"] == reg["device_id"] and me["tenant_id"] == owner_session["tenant_id"]

    def test_renew_with_registration_secret_after_reload(
        self, owner_session: dict[str, Any]
    ) -> None:
        client, access = owner_session["client"], owner_session["access"]
        reg = register(client, access)
        code, renewed = post(
            client,
            "/api/devices/renew",
            {"device_id": reg["device_id"], "registration_secret": reg["registration_secret"]},
            access,
        )
        assert code == 200 and renewed["prefix"] == reg["prefix"] and "access" in renewed
        me = client.get("/api/auth/me", **bearer(renewed["access"])).json()
        assert me["device_id"] == reg["device_id"]
        code, err = post(
            client,
            "/api/devices/renew",
            {"device_id": reg["device_id"], "registration_secret": "wrong"},
            access,
        )
        assert (code, err["detail"]) == (401, "bad_registration_secret")

    def test_requires_tenant_session(self) -> None:
        create_account("0912447001", PASSWORD)
        code, _ = post(Client(), "/api/devices/register", {"name": "x"}, "")
        assert code == 401


class TestBootstrapImage:
    def test_image_has_named_scopes_and_frozen_pages(self, owner_session: dict[str, Any]) -> None:
        client, access = owner_session["client"], owner_session["access"]
        reg = register(client, access)
        code, image = post(client, "/api/bootstrap/start", None, reg["access"])
        assert code == 201, image
        assert [s["group"] for s in image["scopes"]] == [
            "catalog",
            "parties",
            "balances",
            "settings",
        ]
        by = {s["group"]: s for s in image["scopes"]}
        # الإعدادات: فرع + ٣ وحدات + طريقتا دفع + ٤ أدوار = ١٠ كيانات في صفحة واحدة
        assert by["settings"] == {"group": "settings", "total": 10, "pages": 1}
        assert by["catalog"]["total"] == 0 and by["catalog"]["pages"] == 1
        assert image["page_size"] == 200 and image["schema_version"] == 1
        assert image["expires_at"] > image["as_of"]
        # الصفحة المجمّدة لا تتغير بعد إضافة وحدة جديدة (ACC-53: لا ازدواج ولا فقد داخل النسخة)
        with platform_context():
            Unit.unscoped.create(tenant_id=owner_session["tenant_id"], code="box", name="علبة")
        r = client.get(
            f"/api/bootstrap/{image['image_id']}/page",
            {"group": "settings", "page": 1},
            **bearer(reg["access"]),
        )
        assert r.status_code == 200
        page = r.json()
        assert page["pages"] == 1 and len(page["entities"]) == 10
        names = {e["payload"]["name"] for e in page["entities"] if e["entity"] == "core.Unit"}
        assert names == {"حبة", "كرتونة", "كيلو"}
        # نسخة جديدة تلتقط الوحدة الرابعة
        code, image2 = post(client, "/api/bootstrap/start", None, reg["access"])
        assert {s["group"]: s["total"] for s in image2["scopes"]}["settings"] == 11

    def test_page_out_of_range_and_expired_image(self, owner_session: dict[str, Any]) -> None:
        client, access = owner_session["client"], owner_session["access"]
        reg = register(client, access)
        _, image = post(client, "/api/bootstrap/start", None, reg["access"])
        h = bearer(reg["access"])
        url = f"/api/bootstrap/{image['image_id']}/page"
        assert client.get(url, {"group": "settings", "page": 2}, **h).status_code == 404
        assert client.get(url, {"group": "nope", "page": 1}, **h).status_code == 404
        assert client.get(url, {"group": "settings", "page": "x"}, **h).status_code == 400
        with platform_context():
            BootstrapImage.unscoped.filter(id=image["image_id"]).update(
                expires_at=timezone.now() - timedelta(seconds=1)
            )
        r = client.get(url, {"group": "settings", "page": 1}, **h)
        assert (r.status_code, r.json()["detail"]) == (410, "image_expired")
        code, _ = post(client, f"/api/bootstrap/{image['image_id']}/complete", None, reg["access"])
        assert code == 410

    def test_complete_marks_once_and_other_device_cannot_read(
        self, owner_session: dict[str, Any], two_tenants: TwoTenants
    ) -> None:
        client, access = owner_session["client"], owner_session["access"]
        reg = register(client, access)
        _, image = post(client, "/api/bootstrap/start", None, reg["access"])
        code, done = post(
            client, f"/api/bootstrap/{image['image_id']}/complete", None, reg["access"]
        )
        assert code == 200 and done["completed_at"]
        code, again = post(
            client, f"/api/bootstrap/{image['image_id']}/complete", None, reg["access"]
        )
        assert code == 200 and again["completed_at"] == done["completed_at"]
        # جهاز ثانٍ في المنشأة نفسها لا يقرأ نسخة جهاز آخر
        reg2 = register(client, access)
        r = client.get(
            f"/api/bootstrap/{image['image_id']}/page",
            {"group": "settings", "page": 1},
            **bearer(reg2["access"]),
        )
        assert r.status_code == 404
        # جلسة بلا جهاز → 403
        assert client.post("/api/bootstrap/start", **bearer(access)).status_code == 403
        with platform_context():
            assert BootstrapPage.unscoped.filter(image_id=image["image_id"]).count() == 4
