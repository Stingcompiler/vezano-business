"""دعوات العضوية (ACC-06): إنشاء (للسيناريو/ORG لاحقاً)، قراءة بالرمز، وقبول متكرّر الأثر.

- الرابط يحمل رمزاً عشوائياً؛ يُحفظ هاشه فقط.
- تُقرأ بهوية الحساب: إن لم يكن المعرّف هو المدعوّ → `not_for_you` بلا تفاصيل
  (لا اسم المنشأة ولا الدور).
- القبول لا يُستهلك بالفشل: يُسجَّل في معاملة واحدة مع العضوية؛ تكراره يعيد النتيجة نفسها.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from core.auth.accounts import normalize_identifier
from core.models import Account, Branch, Invitation, Role, User, UserBranchAccess
from core.tenancy import platform_context

DEFAULT_TTL = timedelta(hours=72)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_invitation(
    *,
    inviter: User,
    branch: Branch,
    role: Role,
    invitee_identifier: str,
    ttl: timedelta = DEFAULT_TTL,
    token: str | None = None,
) -> tuple[Invitation, str]:
    """يعيد الدعوة والرمز الخام (يُعرض/يُرسل مرة واحدة)."""
    identifier, _ = normalize_identifier(invitee_identifier)
    raw = token or secrets.token_urlsafe(24)
    with platform_context():
        inv = Invitation.unscoped.create(
            tenant=branch.tenant,
            branch=branch,
            role=role,
            inviter=inviter,
            invitee_identifier=identifier,
            token_hash=_hash(raw),
            expires_at=timezone.now() + ttl,
        )
    return inv, raw


@dataclass(frozen=True)
class InviteView:
    status: str  # valid | expired | accepted | not_for_you | not_found
    tenant_name: str = ""
    inviter_name: str = ""
    role_name: str = ""
    branch_name: str = ""
    expires_at: str = ""
    tenant_id: str = ""
    user_id: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "tenant_name": self.tenant_name,
            "inviter_name": self.inviter_name,
            "role_name": self.role_name,
            "branch_name": self.branch_name,
            "expires_at": self.expires_at,
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
        }


def _load(token: str) -> Invitation | None:
    return (
        Invitation.unscoped.filter(token_hash=_hash(token))
        .select_related("tenant", "branch", "role", "inviter")
        .first()
    )


def view_invitation(token: str, account: Account) -> InviteView:
    with platform_context():
        inv = _load(token)
        if inv is None:
            return InviteView("not_found")
        if inv.invitee_identifier != account.identifier:
            # لا نقول لمن كانت الدعوة ولا اسم المنشأة (34-D26 permission_denied)
            return InviteView("not_for_you")
        now = timezone.now()
        base = InviteView(
            status="valid",
            tenant_name=inv.tenant.name,
            inviter_name=inv.inviter.display_name,
            role_name=inv.role.name,
            branch_name=inv.branch.name,
            expires_at=inv.expires_at.isoformat().replace("+00:00", "Z"),
            tenant_id=str(inv.tenant_id),
        )
        if inv.accepted_at is not None:
            return InviteView(
                **{**base.__dict__, "status": "accepted", "user_id": str(inv.accepted_user_id)}
            )
        if inv.revoked_at is not None or inv.expires_at <= now:
            return InviteView(**{**base.__dict__, "status": "expired"})
        return base


class InviteUnavailable(Exception):
    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


def accept_invitation(token: str, account: Account) -> InviteView:
    """ينشئ العضوية وتخويل الفرع ويُسجّل القبول في معاملة واحدة؛ التكرار يعيد القبول المسجَّل."""
    with platform_context(), transaction.atomic():
        inv = (
            Invitation.unscoped.select_for_update(of=("self",))
            .filter(token_hash=_hash(token))
            .select_related("tenant", "branch", "role", "inviter")
            .first()
        )
        if inv is None:
            raise InviteUnavailable("not_found")
        if inv.invitee_identifier != account.identifier:
            raise InviteUnavailable("not_for_you")
        if inv.accepted_at is None:
            if inv.revoked_at is not None or inv.expires_at <= timezone.now():
                raise InviteUnavailable("expired")
            user = User.unscoped.filter(account=account, tenant=inv.tenant).first()
            if user is None:
                user = User.objects.create_user(
                    tenant=inv.tenant,
                    username=account.identifier,
                    display_name=account.display_name or account.identifier,
                    account=account,
                )
            UserBranchAccess.unscoped.get_or_create(
                user=user,
                branch=inv.branch,
                defaults={"tenant": inv.tenant, "role": inv.role},
            )
            inv.accepted_user = user
            inv.accepted_at = timezone.now()
            inv.save(update_fields=["accepted_user", "accepted_at"])
    return view_invitation(token, account)
