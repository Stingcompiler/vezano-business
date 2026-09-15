"""دورة الجهاز (§٩.١، §٩.٣): تسجيل أونلاين → اعتماد تسجيل آمن → إلغاء أمني.

- التسجيل يمنح هوية وبادئة واعتماداً (`registration_secret`) يُعرض مرة واحدة ويُحفظ هاشه فقط.
- تجديد رمز المزامنة باعتماد التسجيل بعد فحص حالة الجهاز.
- الإلغاء أمني: يمنع الوصول المعتاد ويلغي الجلسات، ولا يُعامل كانتهاء اشتراك. البادئة لا تُعاد.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass

from django.utils import timezone
from rest_framework import exceptions

from core.auth.tokens import issue_session_tokens, revoke_device_sessions
from core.models import Branch, Device, User

PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # بلا I/O/0/1 لتفادي الالتباس على الإيصال


@dataclass(frozen=True)
class Registration:
    device: Device
    registration_secret: str  # يُعرض مرة واحدة
    refresh: str
    access: str


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def allocate_prefix(branch: Branch) -> str:
    """بادئة جهاز فريدة داخل المستأجر لا تُعاد ولو أُلغي الجهاز (§٨.٢)."""
    used = set(Device.objects.filter(tenant=branch.tenant).values_list("prefix", flat=True))
    for _ in range(1000):
        candidate = "".join(secrets.choice(PREFIX_ALPHABET) for _ in range(2))
        if candidate not in used:
            return candidate
    raise RuntimeError("prefix space exhausted")


def register_device(*, user: User, branch: Branch, name: str, user_agent: str = "") -> Registration:
    """يسجل جهازاً في فرع يخوَّل فيه المستخدم ويصدر اعتماد التسجيل وجلسة نقل أولى."""
    if user.tenant_id != branch.tenant_id:
        raise exceptions.PermissionDenied("branch_not_in_tenant")
    if not user.branch_access.filter(branch=branch, revoked_at__isnull=True).exists():
        raise exceptions.PermissionDenied("no_branch_access")
    secret = secrets.token_urlsafe(32)
    device = Device.objects.create(
        tenant=branch.tenant,
        branch=branch,
        name=name[:200],
        prefix=allocate_prefix(branch),
        registration_secret_hash=_hash_secret(secret),
    )
    _, refresh = issue_session_tokens(user, device=device, user_agent=user_agent)
    return Registration(
        device=device,
        registration_secret=secret,
        refresh=str(refresh),
        access=str(refresh.access_token),
    )


def renew_with_registration(
    *, device: Device, registration_secret: str, user: User, user_agent: str = ""
) -> tuple[str, str]:
    """يجدد رمز المزامنة باعتماد التسجيل بعد فحص حالة الجهاز (§٩.١)؛ الجهاز الملغى يُرفض."""
    if device.status != Device.Status.ACTIVE:
        raise exceptions.AuthenticationFailed("device_revoked")
    if not secrets.compare_digest(
        device.registration_secret_hash, _hash_secret(registration_secret)
    ):
        raise exceptions.AuthenticationFailed("bad_registration_secret")
    if user.tenant_id != device.tenant_id:
        raise exceptions.PermissionDenied("device_not_in_tenant")
    _, refresh = issue_session_tokens(user, device=device, user_agent=user_agent)
    return str(refresh), str(refresh.access_token)


def revoke_device(device: Device) -> int:
    """إلغاء اعتماد الجهاز (§٩.٣): رفض PUSH المعتاد ومنع تنزيل بيانات جديدة.

    الاسترداد المقيد مسار آخر (SYS-07).
    """
    device.status = Device.Status.REVOKED
    device.revoked_at = timezone.now()
    device.save(update_fields=["status", "revoked_at"])
    return revoke_device_sessions(device)
