"""ORG-05 — سحب مستخدم أو نطاق أو جهاز: السحب لا يمحو عملاً (§٩.٣؛ ACC-45، 63، 64).

ثلاثة أفعال مختلفة: تعطيل المستخدم (يمنع دخوله على كل الأجهزة ولا يمسّ غيره على الجهاز المشترك
ولا يمحو معلّقه)، سحب نطاق فرع (يبقى نشطاً في فروعه الأخرى)، إلغاء الجهاز بمحوه (سرقة أو فقد —
للمالك وبإقرار مكتوب حين عليه معلّق). المعلّق على جهاز مسحوب قابل للاسترداد من SYS-07.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from core.models import Branch, Device, Session, User, UserBranchAccess


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


class RevokeRejected(Exception):
    def __init__(self, code: str, detail: Any = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


def _user_ledger(user: User) -> dict[str, Any]:
    from sales.models import Sale
    from shifts.models import Shift

    open_shift = (
        Shift.objects.filter(user_id=user.id, state="open").select_related("branch").first()
    )
    return {
        "invoices": Sale.objects.filter(user_id=user.id).count(),
        "shifts": Shift.objects.filter(user_id=user.id).count(),
        "open_shift": (
            {
                "id": str(open_shift.id),
                "opened_at": _iso(open_shift.opened_at),
                "branch_name": open_shift.branch.name,
            }
            if open_shift
            else None
        ),
    }


def _devices_of(user: User) -> list[dict[str, Any]]:
    """الأجهزة التي للمستخدم جلسة نشطة عليها: المعلّق المبلَّغ ومن يشاركه الجهاز."""
    sessions = Session.objects.filter(user=user, device__isnull=False, revoked_at__isnull=True)
    device_ids = {s.device_id for s in sessions if s.device_id}
    out = []
    for d in Device.objects.filter(id__in=list(device_ids)).select_related("branch"):
        mine = [s for s in sessions if s.device_id == d.id]
        pending = max((int(s.reported_pending or 0) for s in mine), default=0)
        others = (
            Session.objects.filter(device=d, revoked_at__isnull=True)
            .exclude(user=user)
            .values_list("user__display_name", flat=True)
            .distinct()
        )
        out.append(
            {
                "id": str(d.id),
                "name": d.name,
                "branch_name": d.branch.name,
                "status": d.status,
                "pending": pending,
                "shared_with": sorted({str(n) for n in others}),
            }
        )
    return out


def preview(user: User, *, actor: User, actor_branch: Branch | None) -> dict[str, Any]:
    access = list(
        UserBranchAccess.objects.filter(user=user, revoked_at__isnull=True).select_related(
            "branch", "role"
        )
    )
    ledger = _user_ledger(user)
    devices = _devices_of(user)
    is_owner = actor.is_owner
    return {
        "user": {
            "id": str(user.id),
            "display_name": user.display_name,
            "is_owner": user.is_owner,
            "status": "active" if user.is_active else "disabled",
            "deactivated_at": _iso(user.deactivated_at),
        },
        "scopes": [
            {
                "branch_id": str(a.branch_id),
                "branch_name": a.branch.name,
                "role_name": a.role.name,
                "in_actor_scope": is_owner
                or (actor_branch is not None and a.branch_id == actor_branch.id),
            }
            for a in access
        ],
        "devices": devices,
        "pending_total": sum(int(d["pending"]) for d in devices),
        "ledger": ledger,
        "can": {
            "disable_user": is_owner and not user.is_owner,
            "revoke_branch": (is_owner or actor_branch is not None) and not user.is_owner,
            "wipe_device": is_owner,
        },
        "blockers": ["open_shift"] if ledger["open_shift"] else [],
    }


def disable_user(user: User, *, actor: User, mode: str, reason: str = "") -> dict[str, Any]:
    """تعطيل المستخدم: للمالك وحده؛ وردية مفتوحة باسمه مانع (تُقفل إدارياً أولاً)؛ `now` يُنهي
    جلساته فوراً والمعلّق يبقى على الجهاز للاسترداد؛ `after_upload` يُنهيها حين يبلّغ الجهاز أن
    طابوره فرغ (ACC-09). المستخدمون الآخرون على الجهاز نفسه لا يُمسّون (ACC-63)."""
    if not actor.is_owner:
        raise RevokeRejected("owner_required")
    if user.is_owner:
        raise RevokeRejected("owner_not_revocable")
    ledger = _user_ledger(user)
    if ledger["open_shift"]:
        raise RevokeRejected("open_shift", ledger["open_shift"])
    if mode not in {"now", "after_upload"}:
        raise RevokeRejected("mode_invalid")
    now = timezone.now()
    with transaction.atomic():
        user.is_active = False
        user.deactivated_at = now
        user.deactivated_by_name = actor.display_name
        user.deactivation_reason = reason.strip()[:300]
        user.save(
            update_fields=[
                "is_active",
                "deactivated_at",
                "deactivated_by_name",
                "deactivation_reason",
            ]
        )
        sessions = Session.objects.filter(user=user, revoked_at__isnull=True)
        deferred = 0
        ended = 0
        for s in sessions:
            if mode == "after_upload" and s.device_id and (s.reported_pending or 0) > 0:
                s.revoke_after_upload = True
                s.save(update_fields=["revoke_after_upload"])
                deferred += 1
            else:
                s.revoked_at = now
                s.save(update_fields=["revoked_at"])
                ended += 1
    return {"action": "disable", "sessions_ended": ended, "sessions_deferred": deferred}


def revoke_branch(
    user: User, *, actor: User, actor_branch: Branch | None, branch: Branch
) -> dict[str, Any]:
    """سحب نطاق فرع: مدير الفرع في فرعه، والمالك في أي فرع؛ يبقى الحساب نشطاً في فروعه الأخرى."""
    if user.is_owner:
        raise RevokeRejected("owner_not_revocable")
    if not actor.is_owner and (actor_branch is None or actor_branch.id != branch.id):
        raise RevokeRejected("branch_out_of_scope")
    now = timezone.now()
    with transaction.atomic():
        n = UserBranchAccess.objects.filter(
            user=user, branch=branch, revoked_at__isnull=True
        ).update(revoked_at=now)
        if n == 0:
            raise RevokeRejected("no_access_in_branch")
        # جلساته على أجهزة هذا الفرع تنتهي؛ أجهزة فروعه الأخرى تبقى
        ended = Session.objects.filter(
            user=user, device__branch=branch, revoked_at__isnull=True
        ).update(revoked_at=now)
    remaining = list(
        UserBranchAccess.objects.filter(user=user, revoked_at__isnull=True)
        .values_list("branch__name", flat=True)
        .distinct()
    )
    return {
        "action": "revoke_branch",
        "sessions_ended": int(ended),
        "remaining_branches": remaining,
    }


def wipe_device(
    device: Device, *, actor: User, acknowledgement: str, reason: str = ""
) -> dict[str, Any]:
    """إلغاء الجهاز ومحوه (سرقة أو فقد): للمالك وبإقرار مكتوب حين عليه معلّق — يوقف كل من يعمل
    عليه؛ المعلّق يُعدّ مفقوداً إلا ما يُسترد من SYS-07 قبل المحو."""
    from sync.recovery import RecoveryRejected, wipe

    if not actor.is_owner:
        raise RevokeRejected("owner_required")
    try:
        wipe(device, owner=actor, acknowledgement=acknowledgement)
    except RecoveryRejected as e:
        raise RevokeRejected(e.code) from None
    return {"action": "wipe_device", "device": device.name, "reason": reason.strip()[:300]}


def audit_counts() -> dict[str, int]:
    """للعدّ في سجل التدقيق لاحقاً (ORG-10)."""
    return dict(
        User.objects.filter(is_active=False)
        .values("deactivated_by_name")
        .annotate(n=Count("id"))
        .values_list("deactivated_by_name", "n")
    )


def device_or_none(device_id: Any) -> Device | None:
    try:
        return Device.objects.filter(id=uuid.UUID(str(device_id))).first()
    except ValueError:
        return None
