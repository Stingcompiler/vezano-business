"""استرداد جهاز مسحوب وتغيّر جيل الخادم (SYS-07/SYS-08؛ §٩.٣، §٨.١٢؛ ACC-55، 56، 57، 64).

- التسليم إلى الحجر: الجهاز المسحوب أو المجمَّد يسلّم عمله غير المرفوع باعتماد مقيّد؛ الهوية
  (الجهاز والمُدخِل) من الرمز والجلسة الخادمية لا من الحمولة. لا يُطبَّق شيء — يُحجز فقط.
- الاسترداد للمالك: يمرّ بخطّ PUSH نفسه بمعرّفات العمليات الأصلية ومُدخِلها الأصلي؛ المقبول يدخل
  الدفتر منسوباً إلى من أنشأه، والمتعارض يبقى في الحجر ويُحال إلى SYS-03. الجهاز يبقى مسحوباً.
- التجميد فوري ويُبقي المعلّق قابلاً للتسليم؛ المحو يحتاج إقراراً مكتوباً يبقى في سجل التدقيق.
- المصالحة بعد تغيّر الجيل: مقارنة بالهويات الأصلية — ما عند الخادم يُترك، وما فُقد يُرفع من جديد.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from django.db import transaction
from django.utils import timezone

from core.auth.tokens import revoke_device_sessions
from core.models import Device, Session, User
from sync.counter import ensure_state
from sync.models import Operation, QuarantinedOperation
from sync.push import PROTOCOL_VERSION, push
from sync.review import _members, financial_effect_minor


class RecoveryRejected(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def handover(
    *, tenant_id: uuid.UUID, device: Device, actor: User, operations: list[Any]
) -> list[dict[str, str]]:
    """يستقبل العمليات إلى الحجر (`recovered`) بلا تطبيق؛ المكرّر بمعرّفه يُعاد `duplicate`."""
    if device.status == Device.Status.WIPED:
        raise RecoveryRejected("device_wiped")
    if device.status == Device.Status.ACTIVE:
        raise RecoveryRejected("device_active")
    out: list[dict[str, str]] = []
    with transaction.atomic():
        for raw in operations:
            if not isinstance(raw, Mapping):
                continue
            op_id = str(raw.get("operation_id", ""))
            try:
                op_uuid = uuid.UUID(op_id)
            except (ValueError, TypeError):
                out.append({"operation_id": op_id, "status": "rejected"})
                continue
            if Operation.objects.filter(operation_id=op_uuid).exists():
                out.append({"operation_id": op_id, "status": "duplicate"})
                continue
            if QuarantinedOperation.objects.filter(
                operation_id=op_uuid, reason=QuarantinedOperation.Reason.RECOVERED
            ).exists():
                out.append({"operation_id": op_id, "status": "duplicate"})
                continue
            QuarantinedOperation.objects.create(
                tenant_id=tenant_id,
                operation_id=op_uuid,
                device=device.id,
                actor_user=actor.id,
                reason=QuarantinedOperation.Reason.RECOVERED,
                code="device_" + str(device.status),
                detail="",
                original=dict(raw),
            )
            out.append({"operation_id": op_id, "status": "held"})
    return out


def _last_session(device: Device) -> Session | None:
    return Session.unscoped.filter(device=device).order_by("-created_at").first()


def device_payload(device: Device, *, detailed: bool) -> dict[str, Any]:
    """ما على الجهاز المسحوب: العدد والقيمة وآخر نشاط — والتفصيل للمالك وحده."""
    held = list(
        QuarantinedOperation.objects.filter(
            device=device.id,
            reason=QuarantinedOperation.Reason.RECOVERED,
            reviewed_at__isnull=True,
        ).order_by("received_at")
    )
    value = 0
    for q in held:
        kind = str(q.original.get("kind", "")) if isinstance(q.original, Mapping) else ""
        value += financial_effect_minor(kind, _members(q.original))
    last = _last_session(device)
    actors = {q.actor_user for q in held if q.actor_user}
    names = list(User.unscoped.filter(id__in=actors).values_list("display_name", flat=True))
    out: dict[str, Any] = {
        "id": str(device.id),
        "name": device.name,
        "prefix": device.prefix,
        "branch_name": device.branch.name,
        "status": device.status,
        "revoked_at": _iso(device.revoked_at),
        "frozen_at": _iso(device.frozen_at),
        "wiped_at": _iso(device.wiped_at),
        "held_count": len(held),
        "held_value_minor": str(value),
        "reported_pending": (last.reported_pending or 0) if last else 0,
        "reported_pending_at": _iso(last.reported_pending_at) if last else "",
        "last_seen_at": _iso(last.last_seen_at) if last else "",
        "actor_names": names,
    }
    if detailed:
        out["items"] = [
            {
                "id": str(q.id),
                "operation_id": str(q.operation_id),
                "kind": str(q.original.get("kind", "")) if isinstance(q.original, Mapping) else "",
                "members": _members(q.original),
                "received_at": _iso(q.received_at),
                "effect_minor": str(
                    financial_effect_minor(
                        str(q.original.get("kind", "")) if isinstance(q.original, Mapping) else "",
                        _members(q.original),
                    )
                ),
            }
            for q in held
        ]
    return out


def recoverable_devices() -> list[Device]:
    return list(
        Device.objects.exclude(status=Device.Status.ACTIVE)
        .select_related("branch")
        .order_by("-revoked_at", "name")
    )


def restore(*, tenant_id: uuid.UUID, device: Device, owner: User) -> dict[str, Any]:
    """يمرّر المحجوز بخطّ PUSH بهويات العمليات الأصلية ومُدخِليها؛ الجهاز يبقى مسحوباً."""
    if not owner.is_owner:
        raise RecoveryRejected("owner_required")
    held = list(
        QuarantinedOperation.objects.filter(
            device=device.id,
            reason=QuarantinedOperation.Reason.RECOVERED,
            reviewed_at__isnull=True,
        ).order_by("received_at")
    )
    epoch = ensure_state(tenant_id).sync_epoch
    counts = {"restored": 0, "duplicate": 0, "conflicted": 0, "rejected": 0}
    for q in held:
        raw = dict(q.original) if isinstance(q.original, Mapping) else {}
        actor = q.actor_user or owner.id
        resp = push(
            device_id=device.id,
            actor_user_id=actor,
            envelope={
                "protocol_version": PROTOCOL_VERSION,
                "sync_epoch": epoch,
                "request_id": f"recovery-{q.id}",
                "operations": [raw],
            },
            branch_id=str(device.branch_id),
        )
        status = resp.results[0].status if resp.results else "rejected"
        if status in ("accepted", "duplicate"):
            counts["restored" if status == "accepted" else "duplicate"] += 1
            decision = "restored"
        elif status == "conflicted":
            counts["conflicted"] += 1
            decision = "conflict"
        else:
            counts["rejected"] += 1
            decision = "rejected:" + (resp.results[0].code if resp.results else "")
        q.reviewed_at = timezone.now()
        q.reviewed_by = owner.id
        q.decision = decision[:200]
        q.decided_by_name = owner.display_name
        q.save(update_fields=["reviewed_at", "reviewed_by", "decision", "decided_by_name"])
    return {"device_id": str(device.id), "status": device.status, **counts}


def freeze(device: Device, *, owner: User) -> Device:
    if not owner.is_owner:
        raise RecoveryRejected("owner_required")
    if device.status == Device.Status.WIPED:
        raise RecoveryRejected("device_wiped")
    device.status = Device.Status.FROZEN
    device.frozen_at = timezone.now()
    device.save(update_fields=["status", "frozen_at"])
    revoke_device_sessions(device)
    return device


def wipe(device: Device, *, owner: User, acknowledgement: str) -> Device:
    """المحو يحتاج إقراراً مكتوباً باسم المالك بأن المعلّق يُعدّ مفقوداً — يُسجَّل في سجل التدقيق."""
    if not owner.is_owner:
        raise RecoveryRejected("owner_required")
    last = _last_session(device)
    pending = (last.reported_pending or 0) if last else 0
    held = QuarantinedOperation.objects.filter(
        device=device.id, reason=QuarantinedOperation.Reason.RECOVERED, reviewed_at__isnull=True
    ).count()
    if (pending > 0 or held > 0) and not acknowledgement.strip():
        raise RecoveryRejected("acknowledgement_required")
    device.status = Device.Status.WIPED
    device.wiped_at = timezone.now()
    device.wipe_acknowledgement = acknowledgement.strip()
    device.wiped_by_name = owner.display_name
    device.save(update_fields=["status", "wiped_at", "wipe_acknowledgement", "wiped_by_name"])
    revoke_device_sessions(device)
    return device


def reconcile(*, tenant_id: uuid.UUID, operation_ids: list[str]) -> dict[str, Any]:
    """بعد تغيّر الجيل: أي الهويات نجت عند الخادم وأيها فُقدت — لا رفع ولا مسح تلقائي."""
    ids: list[uuid.UUID] = []
    for raw in operation_ids:
        try:
            ids.append(uuid.UUID(str(raw)))
        except (ValueError, TypeError):
            continue
    present = set(
        str(v)
        for v in Operation.objects.filter(operation_id__in=ids).values_list(
            "operation_id", flat=True
        )
    )
    return {
        "sync_epoch": ensure_state(tenant_id).sync_epoch,
        "present": [str(i) for i in ids if str(i) in present],
        "missing": [str(i) for i in ids if str(i) not in present],
    }
