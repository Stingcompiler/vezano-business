"""الجلسات النشطة وإبطالها (ACC-09؛ §٩.٤): الإبطال يمنع الاستمرار لا الماضي.

- الموظف يرى جلساته هو ويُنهيها؛ إنهاء جلسة على جهاز منشأة للمالك — الجهاز عهدةُ المنشأة.
- «أنهِ بعد رفع المعلّق»: يُجدوَل ويُنفَّذ حين يبلّغ الجهاز في PUSH أن طابوره فرغ.
- لا تفاؤل: الإبطال لا يُعرض منتهياً قبل تأكيد الخادم؛ ولا يُمحى معلّق عند الإبطال.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db.models import Q
from django.utils import timezone

from core.auth.tokens import revoke_session
from core.models import Account, Device, Session, User
from core.tenancy import platform_context


@dataclass(frozen=True)
class SessionRow:
    session_id: str
    kind: str  # own | device
    session_label: str
    is_current: bool
    tenant_id: str
    tenant_name: str
    branch_name: str
    device_id: str
    last_seen_at: str
    revoked_at: str
    revoke_after_upload: bool
    reported_pending: int | None
    can_revoke: bool

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def _label(s: Session, device: Device | None) -> str:
    if device is not None:
        return device.name
    ua = s.user_agent
    return ua[:60] if ua else "web"


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def list_sessions(account: Account, current: Session) -> list[SessionRow]:
    """جلسات الحساب كلها + جلسات أجهزة المنشآت التي يملكها (باسم الجهاز بلا تفصيل عمّن دخل)."""
    with platform_context():
        users = list(User.unscoped.filter(account=account).select_related("tenant"))
        owned = {u.tenant_id for u in users if u.is_owner and u.is_active}
        q = Q(user__in=users)
        if owned:
            q |= Q(device__isnull=False, tenant_id__in=owned)
        sessions = (
            Session.unscoped.filter(q)
            .select_related("tenant", "device", "device__branch", "user")
            .order_by("-last_seen_at")
        )
        rows: list[SessionRow] = []
        for s in sessions:
            own = s.user.account_id == account.id
            kind = "own" if own else "device"
            rows.append(
                SessionRow(
                    session_id=str(s.id),
                    kind=kind,
                    session_label=_label(s, s.device),
                    is_current=s.id == current.id,
                    tenant_id=str(s.tenant_id or ""),
                    tenant_name=s.tenant.name if s.tenant else "",
                    branch_name=s.device.branch.name if s.device else "",
                    device_id=str(s.device_id or ""),
                    last_seen_at=_iso(s.last_seen_at),
                    revoked_at=_iso(s.revoked_at),
                    revoke_after_upload=s.revoke_after_upload,
                    reported_pending=s.reported_pending,
                    can_revoke=own or (s.tenant_id in owned),
                )
            )
        return rows


class RevokeForbidden(Exception):
    pass


class SessionNotFound(Exception):
    pass


def revoke(account: Account, session_id: str, *, after_upload: bool) -> SessionRow:
    with platform_context():
        s = (
            Session.unscoped.select_for_update(of=("self",))
            .filter(id=session_id)
            .select_related("tenant", "device", "device__branch", "user")
            .first()
        )
        if s is None:
            raise SessionNotFound
        own = s.user.account_id == account.id
        owner_of = (
            bool(s.tenant_id)
            and User.unscoped.filter(
                account=account, tenant_id=str(s.tenant_id), is_owner=True, is_active=True
            ).exists()
        )
        if not (own or owner_of):
            raise RevokeForbidden
        if s.revoked_at is None:
            if after_upload and s.device is not None and (s.reported_pending or 0) > 0:
                s.revoke_after_upload = True
                s.save(update_fields=["revoke_after_upload"])
            else:
                revoke_session(s)
    rows = list_sessions(account, s)
    return next(r for r in rows if r.session_id == str(s.id))


def report_pending(session: Session, pending_after: int) -> None:
    """يسجل ما أبلغه الجهاز بعد PUSH وينفّذ الإنهاء المجدول حين يفرغ الطابور."""
    with platform_context():
        session.reported_pending = pending_after
        session.reported_pending_at = timezone.now()
        fields = ["reported_pending", "reported_pending_at"]
        if session.revoke_after_upload and pending_after == 0 and session.revoked_at is None:
            session.revoked_at = timezone.now()
            session.revoke_after_upload = False
            fields += ["revoked_at", "revoke_after_upload"]
        session.save(update_fields=fields)
