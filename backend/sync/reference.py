"""كيانات المرجعيات المكتوبة خادمياً (كتالوج، أطراف، إعدادات): تُسجَّل في sync_log وتُحلّ في PULL
والنسخة المادية عبر محلّلات مسجَّلة — «التعطيل يصل بشاهد صريح لا بالاختفاء» (ACC-45).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable
from typing import Any

from django.db import transaction

from sync.counter import lock_and_reserve
from sync.models_log import SyncLog
from sync.scopes import scope_for

Resolver = Callable[[uuid.UUID, Iterable[uuid.UUID]], dict[uuid.UUID, dict[str, Any]]]
Lister = Callable[[uuid.UUID], list[dict[str, Any]]]

#: entity → محلّل يعيد {id: payload} لمعرّفات مطلوبة (PULL)
RESOLVERS: dict[str, Resolver] = {}
#: entity_group → قائمة كل الكيانات الحيّة (النسخة المادية)
LISTERS: dict[str, list[Lister]] = {}


def register_resolver(entity: str, fn: Resolver) -> None:
    RESOLVERS[entity] = fn


def register_lister(group: str, fn: Lister) -> None:
    LISTERS.setdefault(group, []).append(fn)


def log_reference(tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID) -> int:
    """يحجز رقماً تحت قفل المستأجر ويرفع علامة الكيان في sync_log (upsert). داخل معاملة."""
    with transaction.atomic():
        _, seq = lock_and_reserve(tenant_id, 1)
        scope, group = scope_for(entity)
        SyncLog.unscoped.update_or_create(
            tenant_id=tenant_id,
            entity=entity,
            entity_id=entity_id,
            defaults={
                "scope": scope,
                "scope_id": "",
                "entity_group": group,
                "server_seq": seq,
                "tombstone": False,
            },
        )
    return seq


def resolve(
    tenant_id: uuid.UUID, rows: Iterable[tuple[str, uuid.UUID]]
) -> dict[uuid.UUID, dict[str, Any]]:
    """يحلّ محتوى كيانات مرجعية بحسب نوعها."""
    by_entity: dict[str, list[uuid.UUID]] = {}
    for entity, eid in rows:
        by_entity.setdefault(entity, []).append(eid)
    out: dict[uuid.UUID, dict[str, Any]] = {}
    for entity, ids in by_entity.items():
        fn = RESOLVERS.get(entity)
        if fn:
            out.update(fn(tenant_id, ids))
    return out


def list_group(tenant_id: uuid.UUID, group: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for fn in LISTERS.get(group, []):
        out.extend(fn(tenant_id))
    return out
