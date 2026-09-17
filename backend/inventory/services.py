"""خدمات المخزون: تطبيق حركة المخزون من PUSH وأرصدة الفرع بالوحدة الأساسية."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
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


# ---------------------------------------------------------------------------
# INV-01 أرصدة المخزون · INV-02 سجل حركة الصنف (§٧.٧، ACC-17، R-08)
# ---------------------------------------------------------------------------

#: مصدر الحركة (`source_entity`) → {source_id: (المستند، الفاعل)} — تسجّله الوحدات (البيع، المرتجع…)
MOVEMENT_SOURCE_RESOLVERS: dict[
    str, Callable[[list[uuid.UUID]], Mapping[uuid.UUID, tuple[str, str]]]
] = {}

#: سبب الحركة → بيانها كما رُسم في 28-D21 (الاستلام والجرد والتحويل والافتتاحية مع INV-03…06)
REASON_LABELS = {
    "sale": "بيع نقطة بيع",
    "return": "مرتجع زبون",
    "reversal": "عكس بيع مكرَّر",
    "receive": "استلام بضاعة",
    "count": "تسوية جرد",
    "transfer_out": "تحويل صادر",
    "transfer_in": "تحويل وارد",
    "opening": "افتتاحية",
}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def unit_fields(u: Any) -> dict[str, Any]:
    return {"code": u.code, "name": u.name, "decimal_places": u.decimal_places}


def stock_rows(branch_id: uuid.UUID) -> list[dict[str, Any]]:
    """صفوف INV-01 للفرع: كل صنف له حركة — رصيده بوحدة البيع (الأساسية)، ووحدة الشراء (أكبر
    وحدة) بمعاملها المعلن قراءةً مساعدة لا مجموعاً (R-08)، وحد التنبيه، وآخر حركة. السالب يُعرض
    بلونه لا يُصفَّر (ACC-17). صنف بلا حركة لا رصيد معروف له فلا يُدرج."""
    from django.db.models import Max

    from catalog.models import Item

    agg = (
        StockMovement.objects.filter(branch_id=branch_id)
        .values("item_id")
        .annotate(total=Sum("delta_base_qty_milli"), last=Max("occurred_at"))
    )
    totals = {row["item_id"]: (int(row["total"] or 0), row["last"]) for row in agg}
    quarantine = branch_quarantine(branch_id)
    items = (
        Item.objects.filter(id__in=list(totals))
        .select_related("base_unit")
        .prefetch_related("units__unit")
        .order_by("name_normalized")
    )
    out: list[dict[str, Any]] = []
    for item in items:
        qty, last = totals[item.id]
        units = sorted(item.units.all(), key=lambda u: u.factor_milli, reverse=True)
        purchase = units[0] if units and units[0].factor_milli != 1000 else None
        threshold = item.alert_threshold_milli
        tag = (
            "negative"
            if qty < 0
            else ("low" if threshold is not None and qty < threshold else "ok")
        )
        out.append(
            {
                "item_id": str(item.id),
                "name": item.name,
                "qty_milli": str(qty),
                "sale_unit": unit_fields(item.base_unit),
                "purchase_unit": (
                    {**unit_fields(purchase.unit), "factor_milli": str(purchase.factor_milli)}
                    if purchase
                    else None
                ),
                "alert_threshold_milli": str(threshold) if threshold is not None else "",
                "tag": tag,
                "quarantine_milli": str(quarantine.get(item.id, 0)),
                "last_movement_at": _iso(last),
                # بلا سعر = لا يدخل تقارير القيمة (14-D9 «بيانات ناقصة»)
                "price_missing": item.sale_price_minor <= 0,
            }
        )
    return out


def item_movements(item_id: uuid.UUID, branch_id: uuid.UUID, since: Any) -> dict[str, Any]:
    """INV-02: كل حركة لها مصدر ومستند؛ الرصيد بعد كل حركة يُحسب من كل الحركات (لا رصيد جزئي)
    ثم يُقتطع المدى؛ «آخر حركة» تُذكر حين يخلو المدى منها (40-D32 «نفرّق»)."""
    qs = StockMovement.objects.filter(item_id=item_id, branch_id=branch_id).order_by(
        "occurred_at", "received_at"
    )
    by_source: dict[str, list[uuid.UUID]] = {}
    for m in qs:
        if m.source_entity and m.source_id:
            by_source.setdefault(m.source_entity, []).append(m.source_id)
    resolved: dict[str, Mapping[uuid.UUID, tuple[str, str]]] = {
        entity: MOVEMENT_SOURCE_RESOLVERS[entity](ids)
        for entity, ids in by_source.items()
        if entity in MOVEMENT_SOURCE_RESOLVERS
    }
    running = 0
    rows: list[dict[str, Any]] = []
    last_at = None
    for m in qs:
        running += m.delta_base_qty_milli
        last_at = m.occurred_at
        doc, actor = ("", "")
        if m.source_entity and m.source_id:
            doc, actor = resolved.get(m.source_entity, {}).get(m.source_id, ("", ""))
        if since is not None and m.occurred_at < since:
            continue
        rows.append(
            {
                "id": str(m.id),
                "occurred_at": _iso(m.occurred_at),
                "reason": m.reason,
                "label": REASON_LABELS.get(m.reason, m.reason),
                "actor": actor,
                "doc": doc,
                "source_entity": m.source_entity,
                "source_id": str(m.source_id) if m.source_id else "",
                "delta_milli": str(m.delta_base_qty_milli),
                "balance_after_milli": str(running),
            }
        )
    return {
        "rows": rows,
        "balance_milli": str(running),
        "total_count": qs.count(),
        "last_movement_at": _iso(last_at),
    }
