"""خدمات المخزون: تطبيق حركة المخزون من PUSH وأرصدة الفرع بالوحدة الأساسية."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import Branch
from inventory.models import StockMovement


def _dt(value: Any) -> Any:
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def apply_stock_movement(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    if StockMovement.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    branch = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_id"]).first()
    if branch is None:
        return
    StockMovement.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch=branch,
        item_id=uuid.UUID(str(payload["item_id"])),
        delta_base_qty_milli=int(payload["delta_base_qty_milli"]),
        reason=str(payload.get("reason", "")),
        source_entity=str(payload.get("source_entity", "")),
        source_id=uuid.UUID(str(payload["source_id"])) if payload.get("source_id") else None,
        occurred_at=_dt(payload.get("occurred_at")),
    )


def branch_balances(branch_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """رصيد كل صنف في الفرع = مجموع حركاته؛ صنف بلا حركة لا رصيد معروف له (لا صفر مزعوم)."""
    rows = (
        StockMovement.objects.filter(branch_id=branch_id)
        .values("item_id")
        .annotate(total=Sum("delta_base_qty_milli"))
    )
    return {row["item_id"]: int(row["total"] or 0) for row in rows}


def item_movement_count(item_id: uuid.UUID) -> int:
    return StockMovement.objects.filter(item_id=item_id).count()


def apply_quarantine_movement(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """التالف إلى الحجر أو الهالك (ACC-10) — لا يمسّ المخزون الصالح للبيع."""
    from inventory.models import QuarantineMovement

    if QuarantineMovement.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    branch = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_id"]).first()
    if branch is None:
        return
    QuarantineMovement.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch=branch,
        item_id=uuid.UUID(str(payload["item_id"])),
        base_qty_milli=int(payload["base_qty_milli"]),
        reason=str(payload.get("reason", "")),
        source_entity=str(payload.get("source_entity", "")),
        source_id=uuid.UUID(str(payload["source_id"])) if payload.get("source_id") else None,
        occurred_at=_dt(payload.get("occurred_at")),
    )


def branch_quarantine(branch_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """ما في الحجر لكل صنف في الفرع — أثر ظاهر منفصل عن المتاح للبيع."""
    from inventory.models import QuarantineMovement

    rows = (
        QuarantineMovement.objects.filter(branch_id=branch_id)
        .values("item_id")
        .annotate(total=Sum("base_qty_milli"))
    )
    return {row["item_id"]: int(row["total"] or 0) for row in rows}
