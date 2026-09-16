"""ACC-01/ACC-02 (T1.1): دخول الحساب، القفل المعلن، رمز التحقق المحايد وبديله اليدوي (0005)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import pytest
from django.db import connection
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth import verify
from core.auth.accounts import LOCK_POLICY, create_account, normalize_identifier
from core.db.rls import APP_ROLE
from core.models import Account, ManualVerificationRequest, Role, User, VerificationCode
from core.scenario import faults
from core.tenancy import platform_context, tenant_context

pytestmark = pytest.mark.django_db(transaction=True)

PASSWORD = "correct horse battery staple"  # noqa: S105 — اختبار
PHONE = "0912 447 001"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield
    faults.clear()


def _user(two_tenants: TwoTenants, tenant_index: int, account: Account, username: str) -> User:
    tenant = two_tenants.a if tenant_index == 0 else two_tenants.b
    with platform_context():
        user = User.objects.create_user(
            tenant=tenant, username=username, display_name=username, account=account
        )
        Role.unscoped.get_or_create(tenant=tenant, code="owner", defaults={"name": "مالك"})
    return user


def post(client: Client, path: str, body: dict[str, object]) -> tuple[int, dict[str, object]]:
    r = client.post(path, body, content_type="application/json")
    data: dict[str, object] = r.json() if r.content else {}
    return r.status_code, data


class TestNormalize:
    def test_phone_variants_and_email(self) -> None:
        assert normalize_identifier("0912 447 001") == ("0912447001", "phone")
        assert normalize_identifier("٠٩١٢٤٤٧٠٠١") == ("0912447001", "phone")
        assert normalize_identifier("00249 912-447-001") == ("+249912447001", "phone")
        assert normalize_identifier(" Owner@Sting.Example ") == ("owner@sting.example", "email")
        with pytest.raises(ValueError, match="identifier"):
            normalize_identifier("owner")


class TestAccountLogin:
    def test_single_membership_issues_session_pair(self, two_tenants: TwoTenants) -> None:
        account = create_account(PHONE, PASSWORD, "المالك")
        _user(two_tenants, 0, account, "owner")
        code, data = post(
            Client(),
            "/api/auth/account/login",
            {"identifier": "٠٩١٢ ٤٤٧ ٠٠١", "password": PASSWORD},
        )
        assert code == 200 and "access" in data and "refresh" in data and "session_id" in data
        assert "memberships" not in data

    def test_multiple_memberships_return_list_and_select_ticket(
        self, two_tenants: TwoTenants
    ) -> None:
        account = create_account(PHONE, PASSWORD)
        _user(two_tenants, 0, account, "owner")
        _user(two_tenants, 1, account, "owner")
        code, data = post(
            Client(), "/api/auth/account/login", {"identifier": PHONE, "password": PASSWORD}
        )
        assert code == 200 and "access" not in data
        memberships = data["memberships"]
        assert isinstance(memberships, list) and len(memberships) == 2
        names = {m["tenant_name"] for m in memberships}
        assert names == {two_tenants.a.name, two_tenants.b.name}
        assert isinstance(data["select_ticket"], str) and data["select_ticket"]

    def test_unknown_and_wrong_password_share_one_message(self, two_tenants: TwoTenants) -> None:
        """D26: «رسالةٌ واحدة لحالتين» — لا تفريق بين رقم غير مسجّل وكلمة خاطئة."""
        account = create_account(PHONE, PASSWORD)
        _user(two_tenants, 0, account, "owner")
        unknown = post(
            Client(), "/api/auth/account/login", {"identifier": "0999999999", "password": "x"}
        )
        wrong = post(Client(), "/api/auth/account/login", {"identifier": PHONE, "password": "x"})
        malformed = post(
            Client(), "/api/auth/account/login", {"identifier": "owner", "password": "x"}
        )
        assert unknown == wrong == malformed == (401, {"detail": "invalid_credentials"})

    def test_progressive_announced_delay_after_five_failures(self, two_tenants: TwoTenants) -> None:
        """D26: «بعد خمس محاولات: تأخير تصاعدي معلن بعدّاد ظاهر، لا حظر صامت»."""
        account = create_account(PHONE, PASSWORD)
        _user(two_tenants, 0, account, "owner")
        client = Client()
        for _ in range(LOCK_POLICY.free_attempts - 1):
            assert (
                post(client, "/api/auth/account/login", {"identifier": PHONE, "password": "x"})[0]
                == 401
            )
        code, data = post(client, "/api/auth/account/login", {"identifier": PHONE, "password": "x"})
        assert code == 429
        assert data["detail"] == "retry_after"
        assert data["retry_after_seconds"] == LOCK_POLICY.base_delay_seconds
        assert data["failed_logins"] == LOCK_POLICY.free_attempts
        # أثناء القفل حتى كلمة المرور الصحيحة تُرفض بعدّاد معلن — لا حظر صامت ولا تسريب
        code, data = post(
            client, "/api/auth/account/login", {"identifier": PHONE, "password": PASSWORD}
        )
        assert code == 429 and data["detail"] == "retry_after"
        # انقضاء القفل ثم فشل آخر → التأخير يتضاعف
        with platform_context():
            Account.unscoped.filter(id=account.id).update(
                locked_until=timezone.now() - timedelta(seconds=1)
            )
        code, data = post(client, "/api/auth/account/login", {"identifier": PHONE, "password": "x"})
        assert code == 429 and data["retry_after_seconds"] == LOCK_POLICY.base_delay_seconds * 2
        # نجاح بعد الانقضاء يصفّر العدّاد
        with platform_context():
            Account.unscoped.filter(id=account.id).update(locked_until=None)
        code, _ = post(
            client, "/api/auth/account/login", {"identifier": PHONE, "password": PASSWORD}
        )
        assert code == 200
        with platform_context():
            assert Account.unscoped.get(id=account.id).failed_logins == 0

    def test_lock_policy_caps(self) -> None:
        assert LOCK_POLICY.delay_for(4) == 0
        assert LOCK_POLICY.delay_for(5) == 30
        assert LOCK_POLICY.delay_for(6) == 60
        assert LOCK_POLICY.delay_for(20) == 15 * 60

    def test_account_table_invisible_outside_platform_context(
        self, two_tenants: TwoTenants
    ) -> None:
        """RLS: جداول الحساب لسياق المنصة وحده — من سياق مستأجر لا يُرى شيء."""
        create_account(PHONE, PASSWORD)
        with connection.cursor() as cursor:
            cursor.execute(f"SET ROLE {APP_ROLE}")
        try:
            with tenant_context(two_tenants.a.id):
                assert Account.unscoped.count() == 0
            with platform_context():
                assert Account.unscoped.count() == 1
        finally:
            with connection.cursor() as cursor:
                cursor.execute("RESET ROLE")


class TestVerificationCode:
    def test_request_then_confirm_returns_ticket(self) -> None:
        client = Client()
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"}
        )
        assert code == 202
        assert data["resend_after_seconds"] == verify.POLICY.resend_after_seconds
        assert data["resends_left"] == verify.POLICY.max_resends
        assert data["policy"]["code_ttl_seconds"] == 600  # type: ignore[index]
        r = client.get("/api/scenario/verification-code", {"identifier": PHONE})
        assert r.status_code == 200
        otp = r.json()["code"]
        assert len(otp) == verify.POLICY.code_length
        code, data = post(
            client,
            "/api/auth/verify/confirm",
            {"identifier": PHONE, "purpose": "recover", "code": otp},
        )
        assert code == 200 and isinstance(data["verified_ticket"], str)
        # الرمز يُستهلك مرة واحدة
        code, data = post(
            client,
            "/api/auth/verify/confirm",
            {"identifier": PHONE, "purpose": "recover", "code": otp},
        )
        assert (code, data["detail"]) == (410, "code_expired")

    def test_wrong_code_counts_attempts_then_expires(self) -> None:
        client = Client()
        post(client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "register"})
        for left in range(verify.POLICY.max_confirm_attempts - 1, -1, -1):
            code, data = post(
                client,
                "/api/auth/verify/confirm",
                {"identifier": PHONE, "purpose": "register", "code": "000000"},
            )
            assert (code, data["detail"], data["attempts_left"]) == (400, "code_invalid", left)
        code, data = post(
            client,
            "/api/auth/verify/confirm",
            {"identifier": PHONE, "purpose": "register", "code": "000000"},
        )
        assert (code, data["detail"]) == (410, "code_expired")

    def test_expired_code_is_gone_not_invalid(self) -> None:
        """D26: «انتهاؤه حدثٌ متوقّع لا خطأ» — 410 لا 400."""
        client = Client()
        post(client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"})
        otp = client.get("/api/scenario/verification-code", {"identifier": PHONE}).json()["code"]
        with platform_context():
            VerificationCode.unscoped.update(expires_at=timezone.now() - timedelta(seconds=1))
        code, data = post(
            client,
            "/api/auth/verify/confirm",
            {"identifier": PHONE, "purpose": "recover", "code": otp},
        )
        assert (code, data["detail"]) == (410, "code_expired")
        # بعد الانتهاء يُطلب رمز جديد فوراً (لا عدّاد على رمز ميت)
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"}
        )
        assert code == 202 and data["sends"] == 1

    def test_resend_counter_limit_and_same_code(self) -> None:
        """D8: «متاحة بعد 60 ثانية، ومرتين كحد أقصى»؛ D26: إعادة الإرسال لا تُنشئ رمزاً ثانياً."""
        client = Client()
        post(client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"})
        first = client.get("/api/scenario/verification-code", {"identifier": PHONE}).json()["code"]
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"}
        )
        assert (code, data["detail"]) == (429, "resend_too_soon")
        assert 0 < int(data["retry_after_seconds"]) <= verify.POLICY.resend_after_seconds  # type: ignore[call-overload]

        def age() -> None:
            with platform_context():
                VerificationCode.unscoped.update(
                    last_sent_at=timezone.now() - timedelta(seconds=61)
                )

        age()
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"}
        )
        assert code == 202 and (data["sends"], data["resends_left"]) == (2, 1)
        age()
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"}
        )
        assert code == 202 and (data["sends"], data["resends_left"]) == (3, 0)
        age()
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"}
        )
        assert (code, data["detail"], data["manual_suggested"]) == (429, "resend_limit", True)
        # الرمز الأول ما زال هو الصالح
        code, _ = post(
            client,
            "/api/auth/verify/confirm",
            {"identifier": PHONE, "purpose": "recover", "code": first},
        )
        assert code == 200

    def test_send_failure_three_times_suggests_manual(self) -> None:
        """D8: «فشل إرسال الرمز ثلاث مرات. … التحقق اليدوي بالدعم مسار مكتمل»."""
        faults.set_fault("verify_send_fail", True)
        client = Client()
        for n in (1, 2):
            code, data = post(
                client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "register"}
            )
            assert (code, data["detail"], data["send_failures"], data["manual_suggested"]) == (
                503,
                "send_failed",
                n,
                False,
            )
        code, data = post(
            client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "register"}
        )
        assert (code, data["send_failures"], data["manual_suggested"]) == (503, 3, True)
        # الرمز الذي لم يُرسل لا يُقبل
        code, data = post(
            client,
            "/api/auth/verify/confirm",
            {"identifier": PHONE, "purpose": "register", "code": "123456"},
        )
        assert code == 410
        faults.set_fault("verify_send_fail", False)
        code, data = post(
            client,
            "/api/auth/verify/manual",
            {"identifier": PHONE, "purpose": "register", "tenant_name": "بقالة النيل"},
        )
        assert code == 201 and data["status"] == "open"
        with platform_context():
            req = ManualVerificationRequest.unscoped.get(id=str(data["request_id"]))
            assert (req.identifier, req.tenant_name) == ("0912447001", "بقالة النيل")

    def test_dev_code_endpoint_hidden_without_faults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = Client()
        post(client, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"})
        monkeypatch.setenv("STING_ENV", "production")
        assert (
            client.get("/api/scenario/verification-code", {"identifier": PHONE}).status_code == 404
        )

    def test_malformed_identifier_rejected(self) -> None:
        code, data = post(
            Client(), "/api/auth/verify/request", {"identifier": "owner", "purpose": "recover"}
        )
        assert (code, data["detail"]) == (400, "identifier_invalid")


def test_health_reports_database(client: Client) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True}
