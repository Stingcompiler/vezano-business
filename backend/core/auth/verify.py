"""رمز التحقق المحايد للقناة (G-02 — 13-D8) وبديله اليدوي (0005 §٢).

السياسة كلها هنا وتُعاد للواجهة في كل استجابة، فلا تُكرَّر ثوابت في العميل:
- الرمز ست خانات يعيش `code_ttl_seconds`؛ إعادة الإرسال بعد `resend_after_seconds` وبحدّ
  `max_resends`؛ بعد `max_send_failures` فشلاً في الإرسال يُقترح التحقق اليدوي.
- المرسِل واجهة `VerificationSender` تبنيها `core.auth.senders` من البيئة (واتساب ثم نصية للهاتف،
  SMTP للبريد — 0005 §١١٧)؛ بلا إعداد يبقى `StoredSender` يحفظ الرمز ليُقرأ في التطوير من نقطة
  السيناريو، ويفشل عمداً تحت مفتاح العطل `verify_send_fail`.
"""

from __future__ import annotations

import secrets
from dataclasses import asdict, dataclass
from datetime import timedelta
from typing import Any, Protocol

from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import Token

from core.auth.accounts import normalize_identifier
from core.models import ManualVerificationRequest, VerificationCode
from core.scenario import faults
from core.tenancy import platform_context


@dataclass(frozen=True)
class VerifyPolicy:
    code_length: int = 6
    code_ttl_seconds: int = 10 * 60
    resend_after_seconds: int = 60
    max_resends: int = 2
    max_send_failures: int = 3
    max_confirm_attempts: int = 5

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


POLICY = VerifyPolicy()


class VerificationSender(Protocol):
    def send(self, identifier: str, code: str) -> None:
        """يرفع SendFailed عند تعذّر الإرسال."""


class SendFailed(Exception):
    pass


# الرموز الأخيرة بالنص للتطوير فقط — تُقرأ عبر حارس السيناريو (§١٥.٤)، لا في الإنتاج
_dev_codes: dict[tuple[str, str], str] = {}


class StoredSender:
    def send(self, identifier: str, code: str) -> None:
        if "verify_send_fail" in faults.active():
            raise SendFailed
        if faults.enabled():
            _dev_codes[(identifier, "*")] = code


_SENDER: VerificationSender | None = None


def sender() -> VerificationSender:
    """المرسِل من البيئة (0005 §١١٧ — `core.auth.senders`)؛ يُبنى مرة عند أول إرسال."""
    global _SENDER
    if _SENDER is None:
        from core.auth.senders import build_sender

        _SENDER = build_sender()
    return _SENDER


def dev_code_for(identifier: str) -> str | None:
    if not faults.enabled():
        return None
    return _dev_codes.get((normalize_identifier(identifier)[0], "*"))


class VerifiedTicket(Token):
    """يثبت أن المعرّف تحقّق لغرض بعينه؛ تستهلكه الخطوة التالية (تسجيل/كلمة مرور جديدة)."""

    token_type = "verified"  # noqa: S105 — نوع الرمز لا سرّ
    lifetime = timedelta(minutes=15)


class ResendTooSoon(Exception):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(str(retry_after_seconds))
        self.retry_after_seconds = retry_after_seconds


class ResendLimit(Exception):
    pass


class SendUnavailable(Exception):
    """فشل الإرسال؛ `failures` كم مرة، و`manual_suggested` حين بلغ الحدّ."""

    def __init__(self, failures: int) -> None:
        super().__init__(str(failures))
        self.failures = failures
        self.manual_suggested = failures >= POLICY.max_send_failures


class CodeExpired(Exception):
    pass


class CodeInvalid(Exception):
    def __init__(self, attempts_left: int) -> None:
        super().__init__(str(attempts_left))
        self.attempts_left = attempts_left


def _live(identifier: str, purpose: str, now: Any) -> VerificationCode | None:
    return (
        VerificationCode.unscoped.select_for_update()
        .filter(
            identifier=identifier, purpose=purpose, consumed_at__isnull=True, expires_at__gt=now
        )
        .order_by("-created_at")
        .first()
    )


@dataclass(frozen=True)
class RequestResult:
    expires_at: Any
    resend_after_seconds: int
    resends_left: int
    sends: int


def request_code(raw_identifier: str, purpose: str) -> RequestResult:
    """إرسال أول أو إعادة إرسال. لا يكشف وجود الحساب: الرمز يُنشأ للمعرّف أياً كان (رفض R-05).

    الاستثناءات تُرفع بعد المعاملة حتى تبقى عدّادات الإرسال والفشل محفوظة.
    """
    identifier, _ = normalize_identifier(raw_identifier)
    now = timezone.now()
    failure: Exception | None = None
    result: RequestResult | None = None
    with platform_context(), transaction.atomic():
        live = _live(identifier, purpose, now)
        if live is not None:
            since = (now - live.last_sent_at).total_seconds()
            if since < POLICY.resend_after_seconds:
                failure = ResendTooSoon(int(POLICY.resend_after_seconds - since) + 1)
            elif live.sends - 1 >= POLICY.max_resends:
                failure = ResendLimit()
        if failure is None:
            code = "".join(secrets.choice("0123456789") for _ in range(POLICY.code_length))
            try:
                sender().send(identifier, code)
            except SendFailed:
                # عدّاد الفشل يتراكم على آخر سجل حديث ولو لم يُرسل قط (منتهٍ منذ إنشائه)
                if live is None:
                    live = (
                        VerificationCode.unscoped.select_for_update()
                        .filter(
                            identifier=identifier,
                            purpose=purpose,
                            consumed_at__isnull=True,
                            created_at__gt=now - timedelta(seconds=POLICY.code_ttl_seconds),
                        )
                        .order_by("-created_at")
                        .first()
                    )
                if live is None:
                    live = VerificationCode.unscoped.create(
                        identifier=identifier,
                        purpose=purpose,
                        code_hash=make_password(code),
                        expires_at=now,  # لم يُرسل: منتهٍ منذ الآن فلا يُقبل تأكيده
                        sends=0,
                        last_sent_at=now,
                    )
                live.send_failures += 1
                live.save(update_fields=["send_failures"])
                failure = SendUnavailable(live.send_failures)
            else:
                if live is None:
                    live = VerificationCode.unscoped.create(
                        identifier=identifier,
                        purpose=purpose,
                        code_hash=make_password(code),
                        expires_at=now + timedelta(seconds=POLICY.code_ttl_seconds),
                        last_sent_at=now,
                    )
                else:
                    # الرمز يبقى نفسه عند إعادة الإرسال — «فتصل ثلاثة رموز ويُربك أيّها الصالح» (D26)
                    live.sends += 1
                    live.last_sent_at = now
                    live.save(update_fields=["sends", "last_sent_at"])
                    if faults.enabled():
                        _dev_codes.pop((identifier, "*"), None)
                result = RequestResult(
                    expires_at=live.expires_at,
                    resend_after_seconds=POLICY.resend_after_seconds,
                    resends_left=max(POLICY.max_resends - (live.sends - 1), 0),
                    sends=live.sends,
                )
    if failure is not None:
        raise failure
    assert result is not None
    return result


def confirm_code(raw_identifier: str, purpose: str, code: str) -> str:
    """يعيد تذكرة «تحقّق» أو يرفع CodeExpired / CodeInvalid (بعد المعاملة ليبقى عدّاد المحاولات)."""
    identifier, _ = normalize_identifier(raw_identifier)
    now = timezone.now()
    failure: Exception | None = None
    with platform_context(), transaction.atomic():
        live = _live(identifier, purpose, now)
        if live is None or live.confirm_attempts >= POLICY.max_confirm_attempts:
            failure = CodeExpired()
        elif not check_password(code.strip().translate(_DIGITS), live.code_hash):
            live.confirm_attempts += 1
            live.save(update_fields=["confirm_attempts"])
            failure = CodeInvalid(POLICY.max_confirm_attempts - live.confirm_attempts)
        else:
            live.consumed_at = now
            live.save(update_fields=["consumed_at"])
    if failure is not None:
        raise failure
    ticket = VerifiedTicket()
    ticket["idn"] = identifier
    ticket["purpose"] = purpose
    return str(ticket)


_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def open_manual_request(
    raw_identifier: str, purpose: str, tenant_name: str
) -> ManualVerificationRequest:
    identifier, _ = normalize_identifier(raw_identifier)
    with platform_context():
        return ManualVerificationRequest.unscoped.create(
            identifier=identifier, purpose=purpose, tenant_name=tenant_name.strip()
        )
