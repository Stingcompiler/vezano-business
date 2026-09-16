"""عقد JWT (§٩.٤): رمز وصول قصير العمر، تجديد مدوّر، إلغاء جلسات وتجديدات الجهاز المسحوب.

- يستعمل Simple JWT مثبّت الإصدار (0001) مع قائمة سوداء للتجديدات المدوَّرة (`token_blacklist`).
- كل رمز يحمل `tenant_id` و`session_id` (`jti` للجلسة) و`device_id` إن كان النقل لجهاز POS.
- JWT لا يثبت وحده أن الصلاحيات لم تتغير: `SessionAuthentication` يفحص حالة الجلسة والمستخدم
  والجهاز عند كل طلب (§٩.٤ البند الرابع).
"""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone
from rest_framework import exceptions
from rest_framework.request import Request
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken, Token

from core.models import Device, Session, User
from core.tenancy import platform_context

CLAIM_TENANT = "tid"
CLAIM_SESSION = "sid"
CLAIM_DEVICE = "did"


def issue_session_tokens(
    user: User, *, device: Device | None = None, user_agent: str = ""
) -> tuple[Session, RefreshToken]:
    """ينشئ جلسة ويصدر زوج الرموز. يُستدعى داخل سياق مستأجر أو منصة."""
    session = Session.unscoped.create(
        tenant=user.tenant,
        user=user,
        device=device,
        user_agent=user_agent[:300],
        last_seen_at=timezone.now(),
    )
    refresh = RefreshToken.for_user(user)
    refresh[CLAIM_TENANT] = str(user.tenant_id) if user.tenant_id else ""
    refresh[CLAIM_SESSION] = str(session.id)
    refresh[CLAIM_DEVICE] = str(device.id) if device else ""
    return session, refresh


def rotate_refresh(raw_refresh: str) -> RefreshToken:
    """تجديد مدوّر: يُدرج القديم في القائمة السوداء ويُصدر جديداً بنفس المطالبات.

    يعمل في سياق المنصة لأن الطلب لم يُصادَق بعد؛ الهوية تُستمد من الرمز والجلسة لا من الحمولة.
    القائمة السوداء (OutstandingToken/BlacklistedToken) والقراءة داخل معاملة واحدة، فإعادة نفس
    الرمز من تبويب ثانٍ متزامن تجد القديم محظوراً وتُرفض (معيار §١٨ ACC-98).
    """
    with platform_context():
        old = RefreshToken(raw_refresh)  # type: ignore[arg-type]  # stubs تتوقع Token؛ السلسلة مقبولة
        session_id = str(old.get(CLAIM_SESSION, ""))
        session = Session.unscoped.select_for_update(of=("self",)).filter(id=session_id).first()
        if session is None or session.revoked_at is not None:
            raise exceptions.AuthenticationFailed("session_revoked")
        device = Device.unscoped.filter(id=session.device_id).first() if session.device_id else None
        if session.device_id and (device is None or device.status != Device.Status.ACTIVE):
            raise exceptions.AuthenticationFailed("device_revoked")
        user = User.unscoped.get(id=session.user_id)
        if not user.is_active:
            raise exceptions.AuthenticationFailed("user_inactive")
        # check_blacklist تُستدعى في RefreshToken.__init__ — الوصول هنا يعني أنه لم يُحظر قبل القفل؛
        # نعيد الفحص بعد أخذ قفل الجلسة حتى يخسر المتزامن الثاني.
        old.check_blacklist()
        old.blacklist()
        new = RefreshToken.for_user(user)
        for claim in (CLAIM_TENANT, CLAIM_SESSION, CLAIM_DEVICE):
            new[claim] = old.get(claim, "")
        session.last_seen_at = timezone.now()
        session.save(update_fields=["last_seen_at"])
        return new


def revoke_session(session: Session) -> None:
    """إلغاء الجلسة: يوقف التجديد فوراً ويُرفض الوصول عند أول فحص خادمي."""
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])


def revoke_device_sessions(device: Device) -> int:
    """سحب الجهاز (§٩.٣) يلغي كل جلساته وتجديداتها."""
    with platform_context():
        return Session.unscoped.filter(device=device, revoked_at__isnull=True).update(
            revoked_at=timezone.now()
        )


class SessionAuthentication(JWTAuthentication):
    """يفحص الجلسة والمستخدم والجهاز مع كل طلب؛ يعرّض `request.auth` كـ`AuthContext`."""

    def authenticate(self, request: Request) -> tuple[User, AuthContext] | None:  # type: ignore[override]
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        assert isinstance(user, User)
        return user, self.build_context(user, token)

    def get_user(self, validated_token: Token) -> User:  # type: ignore[override]
        user_id = validated_token.get("user_id")
        with platform_context():
            user = User.unscoped.filter(id=user_id).first()
        if user is None or not user.is_active:
            raise exceptions.AuthenticationFailed("user_inactive", code="user_inactive")
        return user

    @staticmethod
    def build_context(user: User, token: Token) -> AuthContext:
        session_id = str(token.get(CLAIM_SESSION, ""))
        device_id = str(token.get(CLAIM_DEVICE, "")) or None
        with platform_context():
            session = Session.unscoped.filter(id=session_id).first() if session_id else None
            device = Device.unscoped.filter(id=device_id).first() if device_id else None
        if session is None or session.revoked_at is not None:
            raise exceptions.AuthenticationFailed("session_revoked", code="session_revoked")
        if device_id and (device is None or device.status != Device.Status.ACTIVE):
            raise exceptions.AuthenticationFailed("device_revoked", code="device_revoked")
        tenant_id = token.get(CLAIM_TENANT, "")
        return AuthContext(
            user=user,
            session=session,
            device=device,
            tenant_id=uuid.UUID(str(tenant_id)) if tenant_id else None,
        )


class AuthContext:
    """ما تُستمد منه هوية المستأجر وجهاز النقل: المصادقة لا حقول يختارها العميل (§٥.٤ بند ٢)."""

    def __init__(
        self, *, user: User, session: Session, device: Device | None, tenant_id: uuid.UUID | None
    ) -> None:
        self.user = user
        self.session = session
        self.device = device
        self.tenant_id = tenant_id

    def __repr__(self) -> str:
        device = self.device.id if self.device else None
        return f"AuthContext(user={self.user.id}, session={self.session.id}, device={device})"

    # DRF يتوقع أن يكون auth قابلاً للتحويل إلى bool
    def __bool__(self) -> bool:
        return True

    def as_dict(self) -> dict[str, Any]:
        return {
            "user_id": str(self.user.id),
            "session_id": str(self.session.id),
            "device_id": str(self.device.id) if self.device else None,
            "tenant_id": str(self.tenant_id) if self.tenant_id else None,
        }
