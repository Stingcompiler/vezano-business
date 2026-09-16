"""JWT والأجهزة وPIN — §٩.١–٩.٤؛ معايير §١٨ ACC-62 وACC-65 وACC-98."""

from __future__ import annotations

import threading

import pytest
from django.db import connections
from django.test import Client
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from conftest import TwoTenants
from core.auth.devices import register_device, renew_with_registration, revoke_device
from core.auth.pin import (
    InvalidPin,
    Verifier,
    check_pin,
    derive_verifier,
    set_user_pin,
    verifiers_for_device,
)
from core.models import Role, Session, Tenant, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def owner(two_tenants: TwoTenants) -> User:
    with platform_context():
        user = User.objects.create_user(
            tenant=two_tenants.a, username="owner", display_name="المالك — تجريبي", is_owner=True
        )
        user.set_password("correct horse battery staple")
        user.save(update_fields=["password"])
        role = Role.unscoped.create(tenant=two_tenants.a, code="owner", name="مالك")
        for branch in two_tenants.a_branches:
            UserBranchAccess.unscoped.create(
                tenant=two_tenants.a, user=user, branch=branch, role=role
            )
    return user


def login(client: Client, tenant: Tenant, username: str, password: str) -> dict[str, str]:
    r = client.post(
        "/api/auth/login",
        {"tenant_id": str(tenant.id), "username": username, "password": password},
        content_type="application/json",
    )
    assert r.status_code == 200, r.content
    data: dict[str, str] = r.json()
    return data


def bearer(access: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access}"}


class TestLoginAndSession:
    def test_login_issues_pair_and_me_reflects_session(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        c = Client()
        tokens = login(c, two_tenants.a, "owner", "correct horse battery staple")
        me = c.get("/api/auth/me", headers=bearer(tokens["access"]))
        assert me.status_code == 200
        assert me.json()["tenant_id"] == str(two_tenants.a.id)
        assert me.json()["session_id"] == tokens["session_id"]
        assert me.json()["device_id"] is None

    def test_wrong_password_or_unknown_tenant_same_generic_message(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        c = Client()
        bad = c.post(
            "/api/auth/login",
            {"tenant_id": str(two_tenants.a.id), "username": "owner", "password": "x"},
            content_type="application/json",
        )
        ghost = c.post(
            "/api/auth/login",
            {
                "tenant_id": "00000000-0000-7000-8000-000000000000",
                "username": "owner",
                "password": "x",
            },
            content_type="application/json",
        )
        assert bad.status_code == ghost.status_code == 401
        assert bad.json() == ghost.json() == {"detail": "invalid_credentials"}

    def test_same_username_in_other_tenant_cannot_login_here(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        r = Client().post(
            "/api/auth/login",
            {
                "tenant_id": str(two_tenants.b.id),
                "username": "owner",
                "password": "correct horse battery staple",
            },
            content_type="application/json",
        )
        assert r.status_code == 401

    def test_logout_revokes_session_and_blocks_access_and_refresh(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        c = Client()
        tokens = login(c, two_tenants.a, "owner", "correct horse battery staple")
        assert c.post("/api/auth/logout", headers=bearer(tokens["access"])).status_code == 204
        # الوصول بنفس access (لم ينتهِ زمنياً) مرفوض لأن الجلسة ملغاة — JWT وحده لا يكفي (§٩.٤)
        assert c.get("/api/auth/me", headers=bearer(tokens["access"])).status_code == 401
        assert (
            c.post(
                "/api/auth/refresh", {"refresh": tokens["refresh"]}, content_type="application/json"
            ).status_code
            == 401
        )


class TestRefreshRotation:
    def test_rotation_blacklists_old_refresh(self, owner: User, two_tenants: TwoTenants) -> None:
        c = Client()
        tokens = login(c, two_tenants.a, "owner", "correct horse battery staple")
        first = c.post(
            "/api/auth/refresh", {"refresh": tokens["refresh"]}, content_type="application/json"
        )
        assert first.status_code == 200
        assert first.json()["session_id"] == tokens["session_id"]
        replay = c.post(
            "/api/auth/refresh", {"refresh": tokens["refresh"]}, content_type="application/json"
        )
        assert replay.status_code == 401
        assert c.get("/api/auth/me", headers=bearer(first.json()["access"])).status_code == 200

    def test_concurrent_refresh_from_two_tabs_does_not_kill_session(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        """تبويبان يجدّدان نفس الرمز معاً: واحد ينجح والآخر يُرفض، والجلسة تبقى سليمة (ACC-98)."""
        tokens = login(Client(), two_tenants.a, "owner", "correct horse battery staple")
        results: list[int] = []
        barrier = threading.Barrier(2)

        def attempt() -> None:
            barrier.wait()
            try:
                r = Client().post(
                    "/api/auth/refresh",
                    {"refresh": tokens["refresh"]},
                    content_type="application/json",
                )
                results.append(r.status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=attempt) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(results) == [200, 401]
        with platform_context():
            assert Session.unscoped.get(id=tokens["session_id"]).revoked_at is None


class TestDevices:
    def test_register_device_requires_branch_access_and_allocates_unique_prefix(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id):
            r1 = register_device(user=owner, branch=two_tenants.a_branches[0], name="تابلت الكاشير")
            r2 = register_device(user=owner, branch=two_tenants.a_branches[0], name="تابلت ٢")
            assert r1.device.prefix != r2.device.prefix
            assert len(r1.registration_secret) >= 40
            assert r1.device.registration_secret_hash != r1.registration_secret
        me = Client().get("/api/auth/me", headers=bearer(r1.access))
        assert me.json()["device_id"] == str(r1.device.id)

    def test_register_in_foreign_branch_denied(self, owner: User, two_tenants: TwoTenants) -> None:
        with tenant_context(two_tenants.a.id), pytest.raises(PermissionDenied):
            register_device(user=owner, branch=two_tenants.b_branches[0], name="x")

    def test_renew_with_registration_secret_then_revocation(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id):
            reg = register_device(user=owner, branch=two_tenants.a_branches[0], name="تابلت")
            _, access2 = renew_with_registration(
                device=reg.device, registration_secret=reg.registration_secret, user=owner
            )
            with pytest.raises(AuthenticationFailed):
                renew_with_registration(
                    device=reg.device,
                    registration_secret="wrong",  # noqa: S106
                    user=owner,
                )
        assert Client().get("/api/auth/me", headers=bearer(access2)).status_code == 200
        with tenant_context(two_tenants.a.id):
            revoked_sessions = revoke_device(reg.device)
            assert revoked_sessions == 2
            with pytest.raises(AuthenticationFailed):
                renew_with_registration(
                    device=reg.device, registration_secret=reg.registration_secret, user=owner
                )
        # الرمز الحي للجهاز الملغى يُرفض عند أول فحص خادمي (§٩.٣)
        assert Client().get("/api/auth/me", headers=bearer(access2)).status_code == 401
        assert Client().get("/api/auth/me", headers=bearer(reg.access)).status_code == 401

    def test_forged_revoked_device_flag_in_payload_changes_nothing(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        """ACC-65: وسم from_revoked_device أو device_id في الحمولة لا يغيّر الهوية.

        الهوية من الرمز والجلسة فقط.
        """
        c = Client()
        tokens = login(c, two_tenants.a, "owner", "correct horse battery staple")
        with tenant_context(two_tenants.a.id):
            reg = register_device(user=owner, branch=two_tenants.a_branches[0], name="تابلت")
        me = c.get(
            f"/api/auth/me?device_id={reg.device.id}&from_revoked_device=1",
            headers=bearer(tokens["access"]),
        )
        assert me.status_code == 200
        assert me.json()["device_id"] is None


class TestPin:
    def test_verifier_roundtrip_and_no_plaintext(self) -> None:
        v = derive_verifier("482913")
        assert check_pin("482913", v)
        assert not check_pin("482914", v)
        assert "482913" not in v.encode()
        assert Verifier.decode(v.encode()) == v
        assert v.iterations >= 210_000

    def test_length_follows_tenant_setting(self) -> None:
        assert derive_verifier("1234", required_length=4).algorithm == "pbkdf2_sha256"
        with pytest.raises(InvalidPin):
            derive_verifier("1234")  # الافتراضي ٦
        with pytest.raises(InvalidPin):
            derive_verifier("12a456")
        with pytest.raises(InvalidPin):
            derive_verifier("1234567", required_length=6)

    def test_verifiers_download_only_to_authorized_branch_devices(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        """ACC-62: كاشير يطلب متحققات فرع آخر → لا تنزَّل أسرار غير مطلوبة (§٨.٦)."""
        with platform_context():
            role = Role.unscoped.create(tenant=two_tenants.a, code="cashier", name="كاشير")
            cashier_krt = User.objects.create_user(
                tenant=two_tenants.a, username="c1", display_name="كاشير الرئيسي"
            )
            cashier_bhr = User.objects.create_user(
                tenant=two_tenants.a, username="c2", display_name="كاشير بحري"
            )
            UserBranchAccess.unscoped.create(
                tenant=two_tenants.a, user=cashier_krt, branch=two_tenants.a_branches[0], role=role
            )
            UserBranchAccess.unscoped.create(
                tenant=two_tenants.a, user=cashier_bhr, branch=two_tenants.a_branches[1], role=role
            )
        with tenant_context(two_tenants.a.id):
            set_user_pin(owner, "111111")
            set_user_pin(cashier_krt, "222222")
            set_user_pin(cashier_bhr, "333333")
            device_krt = register_device(
                user=owner, branch=two_tenants.a_branches[0], name="تابلت الرئيسي"
            ).device
            names = sorted(v.user.username for v in verifiers_for_device(device_krt))
            assert names == ["c1", "owner"]  # لا c2 (فرع آخر)
            # سحب تخويل c1 يوقف تنزيل متحققه
            UserBranchAccess.objects.filter(user=cashier_krt).update(
                revoked_at="2026-09-15T00:00:00Z"
            )
            assert sorted(v.user.username for v in verifiers_for_device(device_krt)) == ["owner"]

    def test_pin_reset_bumps_version_keeps_single_row(
        self, owner: User, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id):
            first = set_user_pin(owner, "111111")
            second = set_user_pin(owner, "999999")
            assert (first.version, second.version) == (1, 2)
            assert check_pin("999999", Verifier.decode(second.encoded))
            assert not check_pin("111111", Verifier.decode(second.encoded))
