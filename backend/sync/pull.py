"""PULL (§٨.٦–٨.٧): صفحة واحدة من معاملة `REPEATABLE READ` واحدة.

- مفاتيح القراءة من صلاحيات الجهاز (الفروع المصرح بها) لا من الطلب؛ مؤشر يطلب مفتاحاً لا يحق
  له يُرفض `cursor_forbidden`.
- الصفحة: الفهرس (`sync_log`) ثم محتوى الأعضاء وإيصالات العمليات — في اللقطة نفسها.
- `has_more` عند بلوغ الحد؛ المؤشرات المعادة مطلقة ولا تتراجع.
- `operation_projections`: لكل عملية ظهر منها عضو في الصفحة، قائمة أعضائها **المخوَّلة للجهاز**
  وشهادة اكتمال الجزء المخول (§٨.٧: لا انتظار أعضاء لا يحق له تنزيلهم).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from django.db import InternalError, connection, transaction

from core.tenancy import require_tenant
from sync.counter import ensure_state
from sync.models import Member, Operation
from sync.models_log import AccessManifest, Snapshot, SyncLog
from sync.push import PROTOCOL_VERSION, PushError
from sync.reference import resolve
from sync.scopes import CursorKey, readable_keys


@contextmanager
def repeatable_read() -> Iterator[None]:
    """معاملة قراءة بعزل REPEATABLE READ (§٨.٧).

    سياق المستأجر يفتح معاملة وينفّذ فيها استعلامات، وSET TRANSACTION يجب أن يسبق أول استعلام؛
    لذلك نحاول ضبط العزل داخل savepoint: إن رُفض (معاملة جارية باستعلامات) تراجعنا عن الـsavepoint
    واعتمدنا لقطة المعاملة الجارية نفسها — وهي معاملة واحدة أيضاً فيتحقق «الفهرس والمحتوى من
    لقطة واحدة» ما دام العزل REPEATABLE READ مضبوطاً في مسار الإنتاج (DATABASES OPTIONS).
    """
    with transaction.atomic():
        try:
            with transaction.atomic():  # savepoint
                with connection.cursor() as cur:
                    cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        except InternalError:
            pass  # استعلام سابق في المعاملة — نعتمد لقطتها
        yield


DEFAULT_PAGE_LIMIT = 200
MAX_PAGE_LIMIT = 1000


@dataclass
class PullPage:
    protocol_version: int
    sync_epoch: str
    request_id: str
    entities: list[dict[str, Any]] = field(default_factory=list)
    operation_projections: list[dict[str, Any]] = field(default_factory=list)
    tombstones: list[dict[str, Any]] = field(default_factory=list)
    access_manifest_version: str = "0"
    cursors: list[dict[str, str]] = field(default_factory=list)
    has_more: bool = False
    snapshot_candidates: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def _parse_cursors(raw: Any, allowed: list[CursorKey]) -> dict[CursorKey, int]:
    allowed_set = {(k.scope, k.entity_group, k.scope_id) for k in allowed}
    out: dict[CursorKey, int] = {k: 0 for k in allowed}
    for c in raw or []:
        if not isinstance(c, Mapping):
            raise PushError("cursor_invalid")
        scope = str(c.get("scope", ""))
        group = str(c.get("entity_group", ""))
        scope_id = str(c.get("scope_id", ""))
        if (scope, group, scope_id) not in allowed_set:
            raise PushError("cursor_forbidden", f"{scope}/{group}")
        key = next(
            k for k in allowed if (k.scope, k.entity_group, k.scope_id) == (scope, group, scope_id)
        )
        seq = str(c.get("server_seq", "0"))
        if not seq.isdigit():
            raise PushError("cursor_invalid", seq)
        out[key] = int(seq)
    return out


def _manifest(tenant_id: uuid.UUID, device_id: uuid.UUID, branch_ids: list[str]) -> AccessManifest:
    """يُصدر قائمة وصول جديدة إن تغيّرت فروع الجهاز؛ وإلا يعيد الحالية."""
    latest = (
        AccessManifest.unscoped.filter(tenant_id=tenant_id, device=device_id)
        .order_by("-version")
        .first()
    )
    if latest is not None and sorted(latest.branch_ids) == sorted(branch_ids):
        assert isinstance(latest, AccessManifest)
        return latest
    created = AccessManifest.unscoped.create(
        tenant_id=tenant_id,
        device=device_id,
        version=(latest.version + 1 if latest else 1),
        branch_ids=sorted(branch_ids),
    )
    assert isinstance(created, AccessManifest)
    return created


def pull(*, device_id: uuid.UUID, branch_ids: list[str], envelope: Mapping[str, Any]) -> PullPage:
    tenant_id = require_tenant()
    if envelope.get("protocol_version") != PROTOCOL_VERSION:
        raise PushError("protocol_version_unsupported")
    state = ensure_state(tenant_id)
    epoch = str(envelope.get("sync_epoch", ""))
    if epoch != state.sync_epoch:
        raise PushError("epoch_mismatch", state.sync_epoch)
    limit = min(
        int(envelope.get("limit", DEFAULT_PAGE_LIMIT) or DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT
    )
    allowed = readable_keys(branch_ids=branch_ids)
    cursors = _parse_cursors(envelope.get("cursors"), allowed)
    page = PullPage(PROTOCOL_VERSION, state.sync_epoch, str(envelope.get("request_id", "")))

    # معاملة قراءة واحدة بعزل REPEATABLE READ: الفهرس والمحتوى من لقطة واحدة (§٨.٧)
    with repeatable_read():
        manifest = _manifest(tenant_id, device_id, branch_ids)
        page.access_manifest_version = str(manifest.version)

        rows: list[tuple[CursorKey, SyncLog]] = []
        for key, after in cursors.items():
            qs = SyncLog.unscoped.filter(
                tenant_id=tenant_id,
                scope=key.scope,
                scope_id=key.scope_id,
                entity_group=key.entity_group,
                server_seq__gt=after,
            ).order_by("server_seq")[: limit + 1]
            rows.extend((key, r) for r in qs)
        rows.sort(key=lambda kr: kr[1].server_seq)
        page.has_more = len(rows) > limit
        rows = rows[:limit]

        new_cursors = dict(cursors)
        member_ids = [r.entity_id for _, r in rows if not r.tombstone]
        members = {
            m.entity_id: m
            for m in Member.unscoped.filter(
                tenant_id=tenant_id, entity_id__in=member_ids
            ).select_related("operation")
        }
        # المرجعيات المكتوبة خادمياً (كتالوج، أطراف…) تُحلّ من محلّلاتها لا من الأحداث
        references = resolve(
            tenant_id,
            [
                (r.entity, r.entity_id)
                for _, r in rows
                if not r.tombstone and r.entity_id not in members
            ],
        )
        for key, r in rows:
            new_cursors[key] = max(new_cursors[key], r.server_seq)
            if r.tombstone:
                page.tombstones.append(
                    {"entity": r.entity, "id": str(r.entity_id), "server_seq": str(r.server_seq)}
                )
                continue
            m = members.get(r.entity_id)
            if m is None:
                payload = references.get(r.entity_id)
                if payload is not None:
                    page.entities.append(
                        {
                            "entity": r.entity,
                            "id": str(r.entity_id),
                            "schema_version": 1,
                            "payload": payload,
                            "server_seq": str(r.server_seq),
                            "operation_id": "",
                        }
                    )
                continue
            page.entities.append(
                {
                    "entity": m.entity,
                    "id": str(m.entity_id),
                    "schema_version": m.schema_version,
                    "payload": m.payload,
                    "server_seq": str(m.server_seq),
                    "operation_id": str(m.operation.operation_id),
                }
            )

        # إسقاطات العمليات: الجزء المخوَّل للجهاز من كل عملية ظهرت في الصفحة
        op_ids = {m.operation_id for m in members.values()}
        allowed_scopes = {(k.scope, k.entity_group, k.scope_id) for k in allowed}
        for op in Operation.unscoped.filter(tenant_id=tenant_id, id__in=op_ids).prefetch_related(
            "members"
        ):
            all_members = list(op.members.all())
            logs = {
                row.entity_id: row
                for row in SyncLog.unscoped.filter(
                    tenant_id=tenant_id, entity_id__in=[m.entity_id for m in all_members]
                )
            }
            authorized = [
                m
                for m in all_members
                if (lg := logs.get(m.entity_id))
                and (lg.scope, lg.entity_group, lg.scope_id) in allowed_scopes
            ]
            page.operation_projections.append(
                {
                    "operation_id": str(op.operation_id),
                    "kind": op.kind,
                    "op_version": op.op_version,
                    "members": [{"entity": m.entity, "id": str(m.entity_id)} for m in authorized],
                    "authorized_complete": True,
                    "members_hash": op.members_hash,
                }
            )

        page.cursors = [{**k.as_dict(), "server_seq": str(v)} for k, v in new_cursors.items()]
        latest_snapshot = (
            Snapshot.unscoped.filter(tenant_id=tenant_id, sync_epoch=state.sync_epoch)
            .order_by("-cutoff_server_seq")
            .first()
        )
        if latest_snapshot is not None:
            page.snapshot_candidates.append(latest_snapshot.envelope())
    return page
