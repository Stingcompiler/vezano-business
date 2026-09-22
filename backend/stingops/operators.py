"""PLT-15 — حسابات المشغّلين من مساحة المشغّل (بأمر المالك 2026-09-22؛ 0005 §١٠٥).

كان إنشاء مشغّل من الـshell وحده. الآن: قائمة، إنشاء (بريد + كلمة مرور + اسم)، تعطيل/تفعيل
(التعطيل يُسقط الجلسات)، إعادة تعيين كلمة المرور، وكل تصرّف مسجَّل باسم من قام به في
`OperatorAccessLog`. لا يُعطّل المشغّل نفسه، ولا يُنشأ مشغّل على بريد حساب متجر. التحقّق الثنائي
أُلغي بأمر المالك (0005 §١٠٨).
"""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth.hashers import make_password
from django.utils import timezone

from core.auth import totp
from core.auth.accounts import create_account, normalize_identifier
from core.models import Account, Session, User
from core.tenancy import platform_context
from stingops.models import OperatorAccessLog, OperatorProfile

MIN_PASSWORD = 10
RULE = (
    "المشغّل حساب من نوع آخر: لا يُنشأ على بريد مالك متجر، وكلمة المرور تُعاد بأمر مشغّل آخر، "
    "والتعطيل يُسقط الجلسات فوراً."
)


class OperatorOpRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _row(p: OperatorProfile, *, me: uuid.UUID | None) -> dict[str, Any]:
    u = p.user
    return {
        "id": str(u.id),
        "name": u.display_name,
        "email": u.account.identifier if u.account is not None else "",
        "active": bool(u.is_active),
        "created_at": _iso(p.created_at),
        "last_login_at": _iso(p.last_login_at),
        "is_me": me is not None and u.id == me,
    }


def _log(actor: User, action: str, detail: str) -> None:
    with platform_context():
        OperatorAccessLog.objects.create(
            operator=actor, tenant=None, action=action, detail=detail[:300]
        )


def list_payload(*, me: uuid.UUID | None) -> dict[str, Any]:
    with platform_context():
        rows = [
            _row(p, me=me)
            for p in OperatorProfile.objects.select_related("user", "user__account").order_by(
                "created_at"
            )
        ]
    return {
        "operators": rows,
        "active_count": sum(1 for r in rows if r["active"]),
        "fetched_at": _iso(timezone.now()),
        "rule": RULE,
    }


def create(*, email: str, password: str, name: str, actor: User) -> dict[str, Any]:
    name = name.strip()[:200]
    if not name:
        raise OperatorOpRejected("name_required")
    if len(password) < MIN_PASSWORD:
        raise OperatorOpRejected("password_too_short")
    try:
        identifier, kind = normalize_identifier(email)
    except ValueError:
        raise OperatorOpRejected("invalid_email") from None
    if kind != Account.Kind.EMAIL:
        raise OperatorOpRejected("invalid_email")
    with platform_context():
        existing = Account.unscoped.filter(identifier=identifier).first()
        if existing is not None:
            if User.unscoped.filter(account=existing, tenant__isnull=False).exists():
                raise OperatorOpRejected("tenant_account_email", 409)
            raise OperatorOpRejected("account_exists", 409)
        account = create_account(identifier, password, name)
        user = User.unscoped.create(
            tenant=None,
            username=f"ops-{uuid.uuid4().hex[:10]}",
            display_name=name,
            is_platform_staff=True,
            account=account,
        )
        prof = OperatorProfile.objects.create(user=user, totp_secret=totp.new_secret())
        row = _row(prof, me=actor.id)
    _log(actor, "operator.create", identifier)
    return row


def _profile(op_id: uuid.UUID) -> OperatorProfile:
    prof = (
        OperatorProfile.objects.select_related("user", "user__account")
        .filter(user_id=op_id)
        .first()
    )
    if prof is None:
        raise OperatorOpRejected("not_found", 404)
    return prof


def set_active(op_id: uuid.UUID, *, active: bool, actor: User) -> dict[str, Any]:
    if not active and op_id == actor.id:
        raise OperatorOpRejected("cannot_disable_self", 409)
    with platform_context():
        prof = _profile(op_id)
        if prof.user.is_active == active:
            raise OperatorOpRejected("already_in_state", 409)
        prof.user.is_active = active
        prof.user.save(update_fields=["is_active"])
        if not active:
            Session.unscoped.filter(user=prof.user, revoked_at__isnull=True).update(
                revoked_at=timezone.now()
            )
        row = _row(prof, me=actor.id)
    _log(actor, "operator.enable" if active else "operator.disable", row["email"])
    return row


def reset_password(op_id: uuid.UUID, *, password: str, actor: User) -> dict[str, Any]:
    """كلمة مرور جديدة لمشغّل (نسيها أو سُرّبت) — تُسقط جلساته."""
    if len(password) < MIN_PASSWORD:
        raise OperatorOpRejected("password_too_short")
    with platform_context():
        prof = _profile(op_id)
        account = prof.user.account
        if account is None:
            raise OperatorOpRejected("not_found", 404)
        account.password = make_password(password)
        account.save(update_fields=["password"])
        Session.unscoped.filter(user=prof.user, revoked_at__isnull=True).update(
            revoked_at=timezone.now()
        )
        row = _row(prof, me=actor.id)
    _log(actor, "operator.reset_password", row["email"])
    return row
