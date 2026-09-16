"""ACC-03/ACC-04 (T1.2): العضويات والاختيار وإنشاء المنشأة بوصفة القطاع.

0005 §٤؛ معايير §١٨ ACC-23، 26، 27، 138.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator, Mapping

import pytest
from django.db import connection
from django.test import Client

from conftest import TwoTenants
from core.auth.accounts import create_account
from core.db.rls import APP_ROLE
from core.models import (
    Branch,
    PaymentMethod,
    Role,
    Tenant,
    TenantCreation,
    Unit,
    User,
    UserBranchAccess,
)
from core.scenario import faults
from core.scenario.seed import DEMO_OWNER_IDENTIFIER, DEMO_PASSWORD, reset_scenario
from core.tenancy import platform_context, tenant_context

pytestmark = pytest.mark.django_db(transaction=True)

PASSWORD = "correct horse battery staple"  # noqa: S105 — اختبار
PHONE = "0912447001"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


def post(
    client: Client, path: str, body: Mapping[str, object], ticket: str = ""
) -> tuple[int, dict[str, object]]:
    headers = {"HTTP_X_SELECT_TICKET": ticket} if ticket else {}
    r = client.post(path, dict(body), content_type="application/json", **headers)  # type: ignore[arg-type]
    data: dict[str, object] = r.json() if r.content else {}
    return r.status_code, data


def login(client: Client, identifier: str, password: str) -> dict[str, object]:
    code, data = post(
        client, "/api/auth/account/login", {"identifier": identifier, "password": password}
    )
    assert code == 200, data
    return data


class TestMembershipsAndSelect:
    def test_scenario_owner_sees_three_memberships_including_suspended(self) -> None:
        """28-D21: الحالي · تبديل · موقوف — الموقوفة تظهر بسببها ولا تُخفى."""
        reset_scenario()
        client = Client()
        data = login(client, DEMO_OWNER_IDENTIFIER, DEMO_PASSWORD)
        ticket = str(data["select_ticket"])
        r = client.get("/api/account/memberships", HTTP_X_SELECT_TICKET=ticket)
        assert r.status_code == 200
        rows = r.json()["memberships"]
        by_name = {m["tenant_name"]: m for m in rows}
        assert set(by_name) == {
            "بقالة النيل — تجريبي",
            "مخزن البركة — تجريبي",
            "متجر الخرطوم — تجريبي",
        }
        assert by_name["بقالة النيل — تجريبي"] == {
            **by_name["بقالة النيل — تجريبي"],
            "role_name": "مالك",
            "scope": "كل الفروع",
            "status": "active",
        }
        assert by_name["متجر الخرطوم — تجريبي"]["status"] == "suspended"
        # الاختيار: النشطة تُصدر جلسة، الموقوفة 403 بسبب
        code, sel = post(
            client,
            "/api/account/select",
            {"tenant_id": by_name["مخزن البركة — تجريبي"]["tenant_id"]},
            ticket,
        )
        assert (
            code == 200
            and "access" in sel
            and sel["tenant_id"] == by_name["مخزن البركة — تجريبي"]["tenant_id"]
        )
        code, err = post(
            client,
            "/api/account/select",
            {"tenant_id": by_name["متجر الخرطوم — تجريبي"]["tenant_id"]},
            ticket,
        )
        assert (code, err["detail"]) == (403, "membership_suspended")
        # جلسة المنشأة المختارة تكشف مستأجرها لا سواه
        me = client.get("/api/auth/me", HTTP_AUTHORIZATION=f"Bearer {sel['access']}").json()
        assert me["tenant_id"] == sel["tenant_id"]
        # الجلسة نفسها تصلح مصدراً للعضويات (تبديل لاحق من ACC-09)
        r = client.get("/api/account/memberships", HTTP_AUTHORIZATION=f"Bearer {sel['access']}")
        assert r.status_code == 200 and len(r.json()["memberships"]) == 3

    def test_no_identity_is_401_and_bad_ticket_too(self) -> None:
        client = Client()
        assert client.get("/api/account/memberships").status_code == 401
        assert (
            client.get("/api/account/memberships", HTTP_X_SELECT_TICKET="x.y.z").status_code == 401
        )
        code, _ = post(client, "/api/account/select", {"tenant_id": str(uuid.uuid4())})
        assert code == 401

    def test_select_other_account_tenant_is_404(self, two_tenants: TwoTenants) -> None:
        create_account(PHONE, PASSWORD)
        other = create_account("0999888777", PASSWORD)
        with platform_context():
            User.objects.create_user(
                tenant=two_tenants.a, username="x", display_name="x", account=other
            )
        client = Client()
        data = login(client, PHONE, PASSWORD)
        code, err = post(
            client,
            "/api/account/select",
            {"tenant_id": str(two_tenants.a.id)},
            str(data["select_ticket"]),
        )
        assert (code, err["detail"]) == (404, "membership_not_found")

    def test_scope_lists_branches_for_partial_access(self, two_tenants: TwoTenants) -> None:
        account = create_account(PHONE, PASSWORD)
        with platform_context():
            role = Role.unscoped.create(tenant=two_tenants.a, code="storekeeper", name="أمين مخزن")
            u = User.objects.create_user(
                tenant=two_tenants.a, username="sk", display_name="sk", account=account
            )
            UserBranchAccess.unscoped.create(
                tenant=two_tenants.a, user=u, branch=two_tenants.a_branches[0], role=role
            )
        client = Client()
        login(client, PHONE, PASSWORD)  # عضوية واحدة → جلسة مباشرة
        r = client.get(
            "/api/account/memberships",
            HTTP_AUTHORIZATION=f"Bearer {login(client, PHONE, PASSWORD)['access']}",
        )
        m = r.json()["memberships"][0]
        assert (m["role_name"], m["scope"]) == ("أمين مخزن", two_tenants.a_branches[0].name)


class TestCreateTenant:
    def _ticket(self, client: Client) -> str:
        create_account(PHONE, PASSWORD, "المالك")
        return str(login(client, PHONE, PASSWORD)["select_ticket"])

    def test_sectors_and_currencies_listed(self) -> None:
        r = Client().get("/api/tenants/sectors")
        assert r.status_code == 200
        assert r.json()["sectors"] == [{"code": "grocery", "name": "بقالة ومواد غذائية"}]
        assert r.json()["currencies"] == [
            {"code": "SDG", "name": "الجنيه السوداني (SDG)", "exponent": 2}
        ]

    def test_validation_blocks_empty_name_and_sector_but_not_duplicate_name(
        self, two_tenants: TwoTenants
    ) -> None:
        """34-D26: «اسم المنشأة فارغ، والقطاع غير مختار … أما تكرار الاسم فلا يُمنع»."""
        client = Client()
        ticket = self._ticket(client)
        body = {
            "client_request_id": str(uuid.uuid4()),
            "name": "  ",
            "sector": "",
            "currency": "SDG",
        }
        code, err = post(client, "/api/tenants", body, ticket)
        assert code == 400 and err["detail"] == "validation_error"
        assert err["invalid_fields"] == {"name": "empty", "sector": "empty"}
        body = {
            "client_request_id": str(uuid.uuid4()),
            "name": two_tenants.a.name,
            "sector": "grocery",
            "currency": "SDG",
            "first_branch_name": "فرع بحري",
        }
        code, ok = post(client, "/api/tenants", body, ticket)
        assert code == 201, ok
        assert ok["tenant_name"] == two_tenants.a.name

    def test_recipe_creates_units_payments_roles_owner_and_branch(self) -> None:
        client = Client()
        ticket = self._ticket(client)
        rid = str(uuid.uuid4())
        body = {
            "client_request_id": rid,
            "name": "بقالة النيل",
            "sector": "grocery",
            "currency": "SDG",
            "first_branch_name": "فرع بحري",
        }
        code, out = post(client, "/api/tenants", body, ticket)
        assert code == 201
        assert out["created"] == {
            "items": 0,
            "groups": 0,
            "branches": 1,
            "units": 3,
            "payment_methods": 2,
            "roles": 4,
        }
        assert "access" in out and out["sector"] == "grocery"
        tid = uuid.UUID(str(out["tenant_id"]))
        with platform_context():
            tenant = Tenant.unscoped.get(id=tid)
            assert (tenant.base_currency, tenant.base_currency_exponent) == ("SDG", 2)
            assert Branch.unscoped.get(tenant=tenant).name == "فرع بحري"
            assert {u.name for u in Unit.unscoped.filter(tenant=tenant)} == {
                "حبة",
                "كرتونة",
                "كيلو",
            }
            assert {p.name: p.is_cash for p in PaymentMethod.unscoped.filter(tenant=tenant)} == {
                "نقداً": True,
                "تحويلاً بنكياً": False,
            }
            assert {r.name for r in Role.unscoped.filter(tenant=tenant)} == {
                "مالك",
                "مدير",
                "كاشير",
                "أمين مخزن",
            }
            owner = User.unscoped.get(tenant=tenant)
            assert owner.is_owner and owner.display_name == "المالك"
        # الجلسة الصادرة تخصّ المنشأة الجديدة
        me = client.get("/api/auth/me", HTTP_AUTHORIZATION=f"Bearer {out['access']}").json()
        assert me["tenant_id"] == str(tid)
        # العضوية الجديدة تظهر في القائمة
        r = client.get("/api/account/memberships", HTTP_X_SELECT_TICKET=ticket)
        assert [m["tenant_name"] for m in r.json()["memberships"]] == ["بقالة النيل"]

    def test_repeat_with_same_request_id_returns_same_tenant_not_a_second(self) -> None:
        """34-D26 server_error: «إعادة الإرسال هنا تُنشئ منشأتين لمستخدمٍ أراد واحدة» — فلا تفعل."""
        client = Client()
        ticket = self._ticket(client)
        rid = str(uuid.uuid4())
        body = {
            "client_request_id": rid,
            "name": "بقالة النيل",
            "sector": "grocery",
            "currency": "SDG",
        }
        code1, first = post(client, "/api/tenants", body, ticket)
        code2, second = post(client, "/api/tenants", body, ticket)
        assert (code1, code2) == (201, 200)
        assert first["tenant_id"] == second["tenant_id"]
        r = client.get(f"/api/tenants/creation/{rid}", HTTP_X_SELECT_TICKET=ticket)
        assert r.status_code == 200 and r.json()["tenant_id"] == first["tenant_id"]
        assert (
            client.get(
                f"/api/tenants/creation/{uuid.uuid4()}", HTTP_X_SELECT_TICKET=ticket
            ).status_code
            == 404
        )
        with platform_context():
            assert Tenant.unscoped.filter(name="بقالة النيل").count() == 1
            assert TenantCreation.unscoped.count() == 1

    def test_default_branch_name_when_blank(self) -> None:
        client = Client()
        ticket = self._ticket(client)
        body = {
            "client_request_id": str(uuid.uuid4()),
            "name": "بقالة",
            "sector": "grocery",
            "currency": "SDG",
            "first_branch_name": "",
        }
        code, out = post(client, "/api/tenants", body, ticket)
        assert code == 201
        with platform_context():
            assert Branch.unscoped.get(id=str(out["branch_id"])).name == "الرئيسي"

    def test_units_and_payments_isolated_by_rls(self, two_tenants: TwoTenants) -> None:
        with platform_context():
            Unit.unscoped.create(tenant=two_tenants.a, code="piece", name="حبة", is_base=True)
            PaymentMethod.unscoped.create(
                tenant=two_tenants.b, code="cash", name="نقداً", is_cash=True
            )
        with connection.cursor() as cursor:
            cursor.execute(f"SET ROLE {APP_ROLE}")
        try:
            with tenant_context(two_tenants.b.id):
                assert Unit.unscoped.count() == 0 and PaymentMethod.unscoped.count() == 1
            with tenant_context(two_tenants.a.id):
                assert Unit.unscoped.count() == 1 and PaymentMethod.unscoped.count() == 0
        finally:
            with connection.cursor() as cursor:
                cursor.execute("RESET ROLE")
