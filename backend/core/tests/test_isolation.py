"""عزل المستأجرين بثلاث طبقات (§٥.٤) — معايير §١٨ ACC-26 وACC-27 وACC-60 وACC-61."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import pytest
from django.db import DatabaseError, IntegrityError, connection, transaction

from conftest import TwoTenants
from core.db.rls import APP_ROLE
from core.models import Branch, Device, Role, Tenant, User, UserBranchAccess
from core.tenancy import TenantContextMissing, platform_context, tenant_context

pytestmark = pytest.mark.django_db


def _scalar(sql: str, params: Sequence[str | uuid.UUID] = ()) -> object:
    with connection.cursor() as cursor:
        cursor.execute(sql, [str(p) for p in params])
        row = cursor.fetchone()
    return row[0] if row else None


class TestApplicationRole:
    def test_app_role_has_no_bypass_and_is_not_superuser(self, app_role: None) -> None:
        assert _scalar("SELECT current_user") == APP_ROLE
        assert _scalar("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user") is False
        assert _scalar("SELECT rolsuper FROM pg_roles WHERE rolname = current_user") is False

    def test_app_role_does_not_own_tables(self, app_role: None) -> None:
        owner = _scalar("SELECT tableowner FROM pg_tables WHERE tablename = %s", ["core_branch"])
        assert owner != APP_ROLE

    def test_rls_is_enabled_and_forced_on_tenant_tables(self, app_role: None) -> None:
        for table in (
            "core_tenant",
            "core_branch",
            "core_device",
            "core_user",
            "core_role",
            "core_userbranchaccess",
            "core_tenantsettings",
        ):
            enabled = _scalar("SELECT relrowsecurity FROM pg_class WHERE relname = %s", [table])
            forced = _scalar("SELECT relforcerowsecurity FROM pg_class WHERE relname = %s", [table])
            assert (enabled, forced) == (True, True), table


class TestReadIsolation:
    def test_orm_sees_only_current_tenant(self, app_role: None, two_tenants: TwoTenants) -> None:
        with tenant_context(two_tenants.a.id):
            codes = sorted(Branch.objects.values_list("code", flat=True))
            assert codes == ["BHR", "KRT"]
            assert Tenant.objects.count() == 1
        with tenant_context(two_tenants.b.id):
            assert sorted(Branch.objects.values_list("code", flat=True)) == ["KRT", "OMD"]

    def test_raw_sql_is_also_isolated(self, app_role: None, two_tenants: TwoTenants) -> None:
        with tenant_context(two_tenants.a.id):
            assert _scalar("SELECT count(*) FROM core_branch") == 2
            assert (
                _scalar("SELECT count(*) FROM core_branch WHERE tenant_id = %s", [two_tenants.b.id])
                == 0
            )

    def test_other_tenant_row_by_id_is_indistinguishable_from_missing(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        foreign = two_tenants.b_branches[0].id
        with tenant_context(two_tenants.a.id):
            with pytest.raises(Branch.DoesNotExist):
                Branch.objects.get(id=foreign)
            with pytest.raises(Branch.DoesNotExist):
                Branch.objects.get(id=uuid.uuid4())
            # حتى المدير غير المقيّد تطبيقياً تحكمه RLS
            assert Branch.unscoped.filter(id=foreign).count() == 0


class TestNoContext:
    def test_manager_fails_closed_without_context(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with pytest.raises(TenantContextMissing):
            Branch.objects.count()
        with pytest.raises(TenantContextMissing):
            Tenant.objects.count()

    def test_database_returns_nothing_without_context(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        assert _scalar("SELECT count(*) FROM core_branch") == 0
        assert _scalar("SELECT count(*) FROM core_tenant") == 0

    def test_context_does_not_leak_after_exit(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id):
            assert _scalar("SELECT current_setting('sting.tenant_id', true)") == str(
                two_tenants.a.id
            )
            assert Branch.objects.count() == 2
        assert _scalar("SELECT current_setting('sting.tenant_id', true)") == ""
        assert _scalar("SELECT count(*) FROM core_branch") == 0
        with pytest.raises(TenantContextMissing):
            Branch.objects.count()

    def test_platform_context_does_not_leak_after_exit(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with platform_context():
            assert Tenant.objects.count() == 2
        assert _scalar("SELECT current_setting('sting.platform', true)") == ""
        assert _scalar("SELECT count(*) FROM core_tenant") == 0


class TestWriteIsolation:
    def test_insert_for_other_tenant_is_rejected_by_rls(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id), pytest.raises(DatabaseError), transaction.atomic():
            Branch.unscoped.create(tenant=two_tenants.b, name="اختراق", code="XX1")

    def test_update_cannot_move_row_to_other_tenant(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        branch = two_tenants.a_branches[1]
        with tenant_context(two_tenants.a.id), pytest.raises(DatabaseError), transaction.atomic():
            Branch.unscoped.filter(id=branch.id).update(tenant=two_tenants.b)

    def test_composite_fk_rejects_cross_tenant_branch(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with platform_context(), pytest.raises(IntegrityError), transaction.atomic():
            Device.unscoped.create(
                tenant=two_tenants.a, branch=two_tenants.b_branches[0], name="تابلت", prefix="A2"
            )

    def test_composite_fk_rejects_cross_tenant_access_grant(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with platform_context():
            user_a = User.unscoped.create(
                tenant=two_tenants.a, username="cashier", display_name="أحمد الطيب — تجريبي"
            )
            role_b = Role.unscoped.create(tenant=two_tenants.b, code="cashier", name="كاشير")
        with platform_context(), pytest.raises(IntegrityError), transaction.atomic():
            UserBranchAccess.unscoped.create(
                tenant=two_tenants.a, user=user_a, branch=two_tenants.a_branches[0], role=role_b
            )

    def test_device_prefix_not_reused_even_after_revocation(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id):
            first = Device.objects.create(
                tenant=two_tenants.a, branch=two_tenants.a_branches[0], name="تابلت 1", prefix="A2"
            )
            first.status = Device.Status.REVOKED
            first.save(update_fields=["status"])
            with pytest.raises(IntegrityError), transaction.atomic():
                Device.objects.create(
                    tenant=two_tenants.a,
                    branch=two_tenants.a_branches[0],
                    name="تابلت 2",
                    prefix="A2",
                )
        # البادئة نفسها مسموحة عند مستأجر آخر
        with tenant_context(two_tenants.b.id):
            Device.objects.create(
                tenant=two_tenants.b, branch=two_tenants.b_branches[0], name="تابلت", prefix="A2"
            )


class TestCurrency:
    def test_currency_and_exponent_are_immutable(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with tenant_context(two_tenants.a.id):
            with pytest.raises(DatabaseError), transaction.atomic():
                Tenant.objects.filter(id=two_tenants.a.id).update(base_currency="USD")
            with pytest.raises(DatabaseError), transaction.atomic():
                Tenant.objects.filter(id=two_tenants.a.id).update(base_currency_exponent=3)
            # تعديل الاسم مسموح
            Tenant.objects.filter(id=two_tenants.a.id).update(name="بقالة النيل ٢ — تجريبي")
            assert Tenant.objects.get(id=two_tenants.a.id).name == "بقالة النيل ٢ — تجريبي"

    def test_invalid_currency_or_exponent_rejected_by_database(self, app_role: None) -> None:
        with platform_context():
            with pytest.raises(IntegrityError), transaction.atomic():
                Tenant.unscoped.create(name="x", base_currency="sdg", base_currency_exponent=2)
            with pytest.raises(IntegrityError), transaction.atomic():
                Tenant.unscoped.create(name="x", base_currency="SDG", base_currency_exponent=5)
            with pytest.raises(IntegrityError), transaction.atomic():
                Tenant.unscoped.create(name="x", base_currency="SDG", base_currency_exponent=-1)


class TestUserModel:
    def test_username_unique_per_tenant_not_globally(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with platform_context():
            User.unscoped.create(tenant=two_tenants.a, username="owner", display_name="مالك أ")
            User.unscoped.create(tenant=two_tenants.b, username="owner", display_name="مالك ب")
            with pytest.raises(IntegrityError), transaction.atomic():
                User.unscoped.create(tenant=two_tenants.a, username="owner", display_name="مكرر")

    def test_platform_staff_has_no_tenant_and_tenant_user_has_no_flag(
        self, app_role: None, two_tenants: TwoTenants
    ) -> None:
        with platform_context():
            User.unscoped.create(
                tenant=None, username="ops", display_name="مشغّل", is_platform_staff=True
            )
            with pytest.raises(IntegrityError), transaction.atomic():
                User.unscoped.create(tenant=None, username="ghost", display_name="بلا مستأجر")
            with pytest.raises(IntegrityError), transaction.atomic():
                User.unscoped.create(
                    tenant=two_tenants.a, username="x", display_name="x", is_platform_staff=True
                )
