"""مساهمات الأطراف: محلّل المراجع وقائمة النسخة المادية، ومُطبِّق حدث الإنشاء السريع."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from parties.models import OpeningBalance, Party
from parties.services import apply_party_created, opening_payload, party_payload
from sync.appliers import register_applier
from sync.reference import register_lister, register_resolver


def _resolve(_tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    return {p.id: party_payload(p) for p in Party.objects.filter(id__in=list(ids))}


def _list(_tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    return [
        {"entity": "parties.Party", "id": str(p.id), "payload": party_payload(p)}
        for p in Party.objects.order_by("name_normalized")
    ]


register_resolver("parties.Party", _resolve)
register_lister("parties", _list)
register_applier("parties.PartyCreated", apply_party_created)


def _resolve_openings(
    _tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    return {ob.id: opening_payload(ob) for ob in OpeningBalance.objects.filter(id__in=list(ids))}


register_resolver("parties.OpeningBalance", _resolve_openings)
