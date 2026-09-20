"""دخول الحساب (ACC-02): معرّف مطبَّع + كلمة مرور، رفض موحّد، وقفل تصاعدي معلن (0005 §٢، §٤).

- الرفض رسالة واحدة `invalid_credentials` للرقم غير المسجّل وكلمة المرور الخاطئة (34-D26: «التفريق
  بينهما يسمح للغريب بمسح أرقام»).
- بعد `LOCK_POLICY.free_attempts` محاولات فاشلة: تأخير يتضاعف ويُعلَن بعدّاد (`retry_after_seconds`)
  لا حظر صامت.
- عضوية واحدة → زوج رموز الجلسة مباشرة؛ أكثر → قائمة العضويات وتذكرة اختيار قصيرة العمر (ACC-03).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import Token

from core.auth.tokens import issue_session_tokens
from core.models import Account, Session, User
from core.tenancy import platform_context


@dataclass(frozen=True)
class LockPolicy:
    free_attempts: int = 5
    base_delay_seconds: int = 30
    max_delay_seconds: int = 15 * 60

    def delay_for(self, failed_logins: int) -> int:
        """التأخير بعد المحاولة الفاشلة رقم `failed_logins` (١-مبني)؛ صفر قبل بلوغ الحدّ."""
        if failed_logins < self.free_attempts:
            return 0
        exponent = failed_logins - self.free_attempts
        return int(min(self.base_delay_seconds * (2**exponent), self.max_delay_seconds))


LOCK_POLICY = LockPolicy()

_ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_identifier(raw: str) -> tuple[str, str]:
    """يعيد (المعرّف المطبَّع، نوعه). الهاتف أرقام لاتينية بلا فواصل؛ البريد بأحرف صغيرة.

    يرفع ValueError إن لم يكن الإدخال هاتفاً (٨–١٥ رقماً مع + اختيارية) ولا بريداً.
    """
    s = raw.strip().translate(_ARABIC_INDIC)
    if "@" in s:
        s = s.lower()
        if not _EMAIL_RE.match(s):
            raise ValueError("identifier")
        return s, Account.Kind.EMAIL
    digits = re.sub(r"[\s\-().]", "", s)
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not re.fullmatch(r"\+?\d{8,15}", digits):
        raise ValueError("identifier")
    return digits, Account.Kind.PHONE


def create_account(raw_identifier: str, password: str, display_name: str = "") -> Account:
    identifier, kind = normalize_identifier(raw_identifier)
    with platform_context():
        return Account.unscoped.create(
            identifier=identifier,
            identifier_kind=kind,
            password=make_password(password),
            display_name=display_name,
        )


class SelectTicket(Token):
    """تذكرة اختيار المنشأة (ACC-03): تُصدر بعد كلمة المرور الصحيحة لحساب بعدة عضويات."""

    token_type = "select"  # noqa: S105 — نوع الرمز لا سرّ
    lifetime = timedelta(minutes=5)


@dataclass(frozen=True)
class Membership:
    user_id: str
    tenant_id: str
    tenant_name: str
    is_owner: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "tenant_id": self.tenant_id,
            "tenant_name": self.tenant_name,
            "is_owner": self.is_owner,
        }


@dataclass(frozen=True)
class LoginOutcome:
    """إما جلسة (عضوية واحدة) أو عضويات + تذكرة اختيار (أكثر من عضوية)."""

    session: Session | None = None
    access: str = ""
    refresh: str = ""
    memberships: tuple[Membership, ...] = ()
    select_ticket: str = ""


class InvalidCredentials(Exception):
    pass


class LoginLocked(Exception):
    def __init__(self, retry_after_seconds: int, failed_logins: int) -> None:
        super().__init__(f"locked:{retry_after_seconds}")
        self.retry_after_seconds = retry_after_seconds
        self.failed_logins = failed_logins


def _memberships_of(account: Account) -> list[User]:
    return list(
        User.unscoped.filter(account=account, is_active=True, tenant__isnull=False)
        .select_related("tenant")
        .order_by("created_at")
    )


def login_account(raw_identifier: str, password: str, *, user_agent: str = "") -> LoginOutcome:
    """يرفع InvalidCredentials (موحّد) أو LoginLocked (تأخير معلن).

    الاستثناءات تُرفع خارج المعاملة حتى يبقى عدّاد الفشل والقفل محفوظين.
    """
    try:
        identifier, _ = normalize_identifier(raw_identifier)
    except ValueError:
        raise InvalidCredentials from None
    now = timezone.now()
    failure: Exception | None = None
    outcome: LoginOutcome | None = None
    with platform_context(), transaction.atomic():
        account = (
            Account.unscoped.select_for_update()
            .filter(identifier=identifier, is_active=True)
            .first()
        )
        if account is None:
            # كلفة مماثلة لفحص كلمة مرور حتى لا يُستدل على وجود الحساب من الزمن
            check_password(password, make_password("x"))
            failure = InvalidCredentials()
        elif account.locked_until and account.locked_until > now:
            failure = LoginLocked(
                int((account.locked_until - now).total_seconds()) + 1, account.failed_logins
            )
        elif not check_password(password, account.password):
            account.failed_logins += 1
            delay = LOCK_POLICY.delay_for(account.failed_logins)
            account.locked_until = now + timedelta(seconds=delay) if delay else None
            account.save(update_fields=["failed_logins", "locked_until"])
            failure = LoginLocked(delay, account.failed_logins) if delay else InvalidCredentials()
        else:
            if account.failed_logins or account.locked_until:
                account.failed_logins = 0
                account.locked_until = None
                account.save(update_fields=["failed_logins", "locked_until"])
            outcome = _outcome_for(account, user_agent)
    if failure is not None:
        raise failure
    assert outcome is not None
    return outcome


def _outcome_for(account: Account, user_agent: str) -> LoginOutcome:
    users = _memberships_of(account)
    if len(users) == 1:
        session, refresh = issue_session_tokens(users[0], user_agent=user_agent)
        return LoginOutcome(session=session, access=str(refresh.access_token), refresh=str(refresh))
    # صفر عضوية: ACC-03 «لا منشأة بعد» تقرّر (T1.2)؛ أكثر من واحدة: اختيار
    ticket = SelectTicket()
    ticket["aid"] = str(account.id)
    return LoginOutcome(
        memberships=tuple(
            Membership(str(u.id), str(u.tenant_id), u.tenant.name if u.tenant else "", u.is_owner)
            for u in users
        ),
        select_ticket=str(ticket),
    )


class AccountExists(Exception):
    pass


class RegisterTicketInvalid(Exception):
    pass


def register_account(
    verified_ticket: str, password: str, display_name: str, *, user_agent: str = ""
) -> LoginOutcome:
    """تسجيل حساب جديد بمعرّف تحقّق (ACC-02 بغرض `register`) وكلمة مرور — يعيد نتيجة كالدخول
    (صفر عضوية → تذكرة اختيار تقود إلى ACC-04 إنشاء المنشأة)."""
    from core.auth.verify import VerifiedTicket

    try:
        ticket = VerifiedTicket(verified_ticket)  # type: ignore[arg-type]
    except TokenError:
        raise RegisterTicketInvalid from None
    if ticket.get("purpose") != "register":
        raise RegisterTicketInvalid
    identifier = str(ticket.get("idn", ""))
    if not identifier:
        raise RegisterTicketInvalid
    with platform_context(), transaction.atomic():
        if Account.unscoped.filter(identifier=identifier).exists():
            raise AccountExists
        account = create_account(identifier, password, display_name.strip())
        return _outcome_for(account, user_agent)
