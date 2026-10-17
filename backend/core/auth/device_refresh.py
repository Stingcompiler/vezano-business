"""تجديد الجلسة برمز لتطبيق الجوال (0005 §١٦٢؛ خطة الجوال §٢.١ والخطر ٦).

التطبيق الأصلي لا يملك Cookie المتصفح `HttpOnly` (§١٢١)، فيحفظ رمز تجديد في `expo-secure-store`.
الويب لا يمرّ من هنا أبداً — يبقى على `remember`/`resume`.

- **الإصدار** (`issue`): يستهلك رمز التجديد JWT الذي جاء من تسجيل الجهاز أو تجديده باعتماده، فيبقى
  للجلسة اعتماد تجديد واحد. يشترط جلسة حيّة على جهاز مسجَّل فعّال؛ وأي سلسلة سابقة للجلسة تُبطَل.
- **التدوير** (`rotate`): كل استعمال يُصدر رمزاً جديداً ويُعلِّم القديم مستعملاً — القديم باطل فوراً.
- **كشف الإعادة**: رمز مستعمل يعود = نسخة مسروقة أو مكرّرة؛ تُبطَل السلسلة كلها والجلسة معها (فيسقط
  رمز الوصول الحالي أيضاً لأن `SessionAuthentication` يفحص الجلسة مع كل طلب).
- **الربط بالجهاز**: كل صفّ مربوط بجلسة وجهاز؛ يُرسل العميل `device_id` ومخالفته تُبطل السلسلة.
- **الإبطال**: إلغاء الجلسة (ACC-09، الخروج) أو سحب الجهاز وتجميده ومحوه (ORG-05/SYS-07) يُبطل
  السلاسل فوراً عبر `revoke_session`/`revoke_device_sessions`، والتدوير يعيد فحص الجلسة والجهاز
  والمستخدم في كل مرة فيُرفض حتى ما أُلغي بتحديث جماعي لا يمرّ بهما (تعطيل المستخدم، سحب النطاق).
- **العمر**: أفق الـCookie نفسه (`REFRESH_TOKEN_LIFETIME`) منزلقاً مع كل تدوير.
- الرمز الخام 256 بت عشوائية ولا يُحفظ إلا هاشه (sha256 يكفي لسرّ بهذه الإنتروبيا).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from core.auth.tokens import CLAIM_DEVICE, CLAIM_SESSION, CLAIM_TENANT, revoke_session
from core.models import Device, DeviceRefreshToken, Session, User
from core.tenancy import platform_context

log = logging.getLogger(__name__)

Reason = DeviceRefreshToken.RevokeReason


class RefreshRejected(Exception):
    """كل رفض يصل العميل 401 `token_invalid` واحداً — السبب للسجل والاختبار لا للاستجابة."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Issued:
    access: str
    refresh_token: str
    expires_at: datetime
    session_id: str
    user_id: str
    tenant_id: str
    device_id: str


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def lifetime() -> timedelta:
    value = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    assert isinstance(value, timedelta)
    return value


def _live(qs: QuerySet[DeviceRefreshToken]) -> QuerySet[DeviceRefreshToken]:
    return qs.filter(revoked_at__isnull=True)


def _revoke_family(family: uuid.UUID, reason: str) -> None:
    _live(DeviceRefreshToken.unscoped.filter(family=family)).update(
        revoked_at=timezone.now(), revoke_reason=reason
    )


def _check_live(session: Session) -> tuple[Device, User]:
    """الجلسة حيّة، على جهاز مسجَّل فعّال، لمستخدم نشط — وإلا فالسبب."""
    if session.revoked_at is not None:
        raise RefreshRejected(Reason.SESSION_REVOKED)
    device = Device.unscoped.filter(id=session.device_id).first() if session.device_id else None
    if device is None:
        raise RefreshRejected("device_session_required")
    if device.status != Device.Status.ACTIVE:
        raise RefreshRejected(Reason.DEVICE_REVOKED)
    user = User.unscoped.get(id=session.user_id)
    if not user.is_active:
        raise RefreshRejected(Reason.USER_INACTIVE)
    return device, user


def _mint(session: Session, device: Device, user: User, family: uuid.UUID) -> Issued:
    raw = secrets.token_urlsafe(32)
    now = timezone.now()
    row = DeviceRefreshToken.unscoped.create(
        tenant_id=session.tenant_id,
        session=session,
        device=device,
        family=family,
        token_hash=_hash(raw),
        expires_at=now + lifetime(),
    )
    # رمز وصول وحده — لا RefreshToken JWT موازٍ (لا صفوف OutstandingToken يتيمة)
    access = AccessToken.for_user(user)
    access[CLAIM_TENANT] = str(session.tenant_id or "")
    access[CLAIM_SESSION] = str(session.id)
    access[CLAIM_DEVICE] = str(device.id)
    session.last_seen_at = now
    session.save(update_fields=["last_seen_at"])
    return Issued(
        access=str(access),
        refresh_token=raw,
        expires_at=row.expires_at,
        session_id=str(session.id),
        user_id=str(user.id),
        tenant_id=str(session.tenant_id or ""),
        device_id=str(device.id),
    )


def issue(raw_jwt_refresh: str) -> Issued:
    """يستبدل رمز التجديد JWT لجلسة جهاز بأول رمز في سلسلة جديدة؛ الـJWT يُحظر (يُستهلك)."""
    try:
        old = RefreshToken(raw_jwt_refresh)  # type: ignore[arg-type]  # stubs تتوقع Token
    except TokenError:
        raise RefreshRejected("jwt_invalid") from None
    with platform_context():  # معاملة: الرفض يُرجع كل شيء
        session = (
            Session.unscoped.select_for_update(of=("self",))
            .filter(id=str(old.get(CLAIM_SESSION, "")))
            .first()
        )
        if session is None:
            raise RefreshRejected(Reason.SESSION_REVOKED)
        device, user = _check_live(session)
        if str(old.get(CLAIM_DEVICE, "")) != str(device.id):
            raise RefreshRejected(Reason.DEVICE_MISMATCH)
        try:
            # بعد قفل الجلسة: المتزامن الثاني بالـJWT نفسه يجده محظوراً
            old.check_blacklist()
        except TokenError:
            raise RefreshRejected("jwt_invalid") from None
        old.blacklist()
        _live(DeviceRefreshToken.unscoped.filter(session=session)).update(
            revoked_at=timezone.now(), revoke_reason=Reason.REISSUED
        )
        return _mint(session, device, user, uuid.uuid4())


def rotate(raw: str, device_id: uuid.UUID) -> Issued:
    """يدوّر الرمز: يُعلِّم القديم مستعملاً ويُصدر التالي في السلسلة نفسها."""
    outcome = _rotate(raw, device_id)
    # الرفض يُرفع بعد خروج `platform_context` (وهو معاملة) حتى يبقى إبطال السلسلة والجلسة
    if isinstance(outcome, str):
        raise RefreshRejected(outcome)
    return outcome


def _rotate(raw: str, device_id: uuid.UUID) -> Issued | str:
    with platform_context():
        found = DeviceRefreshToken.unscoped.filter(token_hash=_hash(raw)).values_list(
            "id", "session_id"
        )
        if not found:
            return "unknown"
        row_id, session_id = found[0]
        with transaction.atomic():
            # ترتيب الأقفال كما في `issue` (الجلسة ثم الرمز) — لا تشابك بين المتزامنين
            session = Session.unscoped.select_for_update(of=("self",)).get(id=session_id)
            row = DeviceRefreshToken.unscoped.select_for_update().get(id=row_id)
            failure: tuple[str, bool] | None = None
            if row.revoked_at is not None:
                failure = (str(row.revoke_reason or "revoked"), False)
            elif row.used_at is not None:
                failure = (Reason.REUSE, True)
            elif row.device_id != device_id:
                failure = (Reason.DEVICE_MISMATCH, True)
            elif row.expires_at <= timezone.now():
                failure = ("expired", False)
            else:
                try:
                    device, user = _check_live(session)
                except RefreshRejected as e:
                    failure = (e.code, True)
            if failure is None:
                now = timezone.now()
                row.used_at = now
                row.save(update_fields=["used_at"])
                # تنظيف: ما انقضى أفقه من السلسلة لا يفيد كشف الإعادة بعد الآن
                DeviceRefreshToken.unscoped.filter(
                    family=row.family, expires_at__lt=now - lifetime()
                ).delete()
                return _mint(session, device, user, row.family)
            code, revoke = failure
            if revoke:
                _revoke_family(row.family, code)
            if code == Reason.REUSE:
                revoke_session(session)
                log.warning(
                    "device refresh reuse detected: family=%s session=%s", row.family, session.id
                )
            return code
