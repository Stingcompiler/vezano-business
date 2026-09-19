"""REP-03 — تقرير المخزون والحركات: «ما في المخزن وكيف وصل إليه» (19-D14؛ §١٠.٣، R-08). كل كمية
بوحدة البيع الأساسية ولا «إجمالي قطع» عبر الأصناف؛ أول المدة والوارد والصادر والرصيد لكل صنف مع
المستند المفسِّر؛ السالب لا يُخفى ولا يُصفَّر (ACC-17) ويظهر بسببه المحتمل؛ الوقت مع كل رصيد لا في
رأس الصفحة وحده. الأرقام تطابق INV-01 (نفس `StockMovement`)."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import datetime, time, timedelta
from typing import Any

from django.db.models import Case, IntegerField, Max, Sum, When
from django.utils import timezone

from core import home
from core.models import Branch
from inventory.models import StockMovement
from inventory.services import (
    MOVEMENT_SOURCE_RESOLVERS,
    REASON_LABELS,
    _iso,
    transfer_in_sources,
    unit_fields,
)
from sales.reports import Range, _completeness


def _bounds(rng: Range) -> tuple[datetime, datetime]:
    tz = timezone.get_current_timezone()
    start = datetime.combine(rng.start, time.min, tzinfo=tz)
    end = datetime.combine(rng.end + timedelta(days=1), time.min, tzinfo=tz)
    return start, end


def _doc_for(m: StockMovement, resolved: Mapping[str, Mapping[uuid.UUID, tuple[str, str]]]) -> str:
    doc = ""
    if m.source_entity and m.source_id:
        doc, _actor = resolved.get(m.source_entity, {}).get(m.source_id, ("", ""))
        if m.source_entity == "inventory.StockTransfer" and m.reason == "transfer_in":
            doc, _actor = transfer_in_sources([m.source_id]).get(m.source_id, (doc, ""))
    label = REASON_LABELS.get(m.reason, m.reason)
    out = f"{label} {doc}".strip()
    if m.note:
        out = f"{out} بسبب مكتوب: {m.note}"
    return out


def stock_report(*, viewer: home.Viewer, rng: Range, branch_id: Any = None) -> dict[str, Any]:
    """صف لكل صنف له حركة في الفرع حتى نهاية المدى: أول المدة (قبل المدى)، وارد/صادر (داخله)،
    الرصيد (حتى نهايته)، وآخر مستند فسّر الرصيد."""
    branch: Branch | None
    if viewer.is_owner:
        branch = None
        if branch_id:
            try:
                branch = Branch.objects.filter(id=uuid.UUID(str(branch_id))).first()
            except ValueError:
                branch = None
        if branch is None:
            branch = viewer.branch or Branch.objects.order_by("name").first()
    else:
        branch = viewer.branch
    if branch is None:
        return {
            "scope": "branch",
            "branch": None,
            "range": {
                "key": rng.key,
                "start": rng.start.isoformat(),
                "end": rng.end.isoformat(),
                "label": rng.label,
            },
            "rows": [],
            "negatives": 0,
            "completeness": _completeness([]),
            "branches": [],
            "computed_at": _iso(timezone.now()),
            "last_movement_date": "",
        }
    start, end = _bounds(rng)
    base = StockMovement.objects.filter(branch_id=branch.id, occurred_at__lt=end)
    agg = base.values("item_id").annotate(
        opening=Sum(
            Case(
                When(occurred_at__lt=start, then="delta_base_qty_milli"),
                default=0,
                output_field=IntegerField(),
            )
        ),
        inbound=Sum(
            Case(
                When(
                    occurred_at__gte=start, delta_base_qty_milli__gt=0, then="delta_base_qty_milli"
                ),
                default=0,
                output_field=IntegerField(),
            )
        ),
        outbound=Sum(
            Case(
                When(
                    occurred_at__gte=start, delta_base_qty_milli__lt=0, then="delta_base_qty_milli"
                ),
                default=0,
                output_field=IntegerField(),
            )
        ),
        closing=Sum("delta_base_qty_milli"),
        last=Max("occurred_at"),
        moved=Sum(
            Case(When(occurred_at__gte=start, then=1), default=0, output_field=IntegerField())
        ),
    )
    totals = {row["item_id"]: row for row in agg}
    from catalog.models import Item

    items = (
        Item.objects.filter(id__in=list(totals))
        .select_related("base_unit")
        .order_by("name_normalized")
    )
    # آخر حركة لكل صنف (المستند المفسِّر) — دفعة واحدة
    last_by_item: dict[uuid.UUID, StockMovement] = {}
    for m in base.order_by("item_id", "-occurred_at", "-received_at"):
        if m.item_id not in last_by_item:
            last_by_item[m.item_id] = m
    by_source: dict[str, list[uuid.UUID]] = {}
    for m in last_by_item.values():
        if m.source_entity and m.source_id:
            by_source.setdefault(m.source_entity, []).append(m.source_id)
    resolved = {
        entity: MOVEMENT_SOURCE_RESOLVERS[entity](ids)
        for entity, ids in by_source.items()
        if entity in MOVEMENT_SOURCE_RESOLVERS
    }
    rows: list[dict[str, Any]] = []
    negatives = 0
    for item in items:
        t = totals[item.id]
        closing = int(t["closing"] or 0)
        last = last_by_item.get(item.id)
        doc = _doc_for(last, resolved) if last else ""
        if closing < 0:
            negatives += 1
            # بِيع أكثر مما دخل مسجَّلاً — السبب غالباً إدخال شراء لم يُسجَّل بعد
            explain = "لا يوجد إدخال شراء مقابل"
        elif closing == 0 and last is not None:
            explain = "نفد"
        else:
            explain = ""
        rows.append(
            {
                "item_id": str(item.id),
                "name": item.name,
                "unit": unit_fields(item.base_unit),
                "opening_milli": str(int(t["opening"] or 0)),
                "in_milli": str(int(t["inbound"] or 0)),
                "out_milli": str(-int(t["outbound"] or 0)),
                "closing_milli": str(closing),
                "moved_in_range": int(t["moved"] or 0),
                "tag": "negative" if closing < 0 else ("empty" if closing == 0 else "ok"),
                "doc": doc,
                "explain": explain,
                "last_movement_at": _iso(t["last"]),
            }
        )
    last_any = StockMovement.objects.filter(branch_id=branch.id).aggregate(m=Max("occurred_at"))[
        "m"
    ]
    return {
        "scope": "all" if viewer.is_owner else "branch",
        "branch": {"id": str(branch.id), "name": branch.name},
        "range": {
            "key": rng.key,
            "start": rng.start.isoformat(),
            "end": rng.end.isoformat(),
            "label": rng.label,
        },
        "rows": rows,
        "moved_rows": sum(1 for r in rows if r["moved_in_range"]),
        "negatives": negatives,
        "completeness": _completeness([branch.id]),
        "branches": [{"id": str(b.id), "name": b.name} for b in Branch.objects.order_by("name")]
        if viewer.is_owner
        else [],
        "computed_at": _iso(timezone.now()),
        "last_movement_date": timezone.localtime(last_any).date().isoformat() if last_any else "",
    }


def export_csv(payload: dict[str, Any]) -> str:
    c = payload["completeness"]
    b = payload["branch"]["name"] if payload["branch"] else ""
    head = (
        f"# تقرير المخزون والحركات · {b} · {payload['range']['label']} · "
        f"حُسب في {payload['computed_at']} · "
        + ("مكتمل" if c["complete"] else f"ناقص {c['pending_ops']} حركات معلّقة")
    )
    lines = [head, "item,unit,opening_milli,in_milli,out_milli,closing_milli,doc,as_of"]
    for r in payload["rows"]:
        lines.append(
            ",".join(
                [
                    str(r["name"]).replace(",", " "),
                    str(r["unit"].get("name", "")).replace(",", " "),
                    r["opening_milli"],
                    r["in_milli"],
                    r["out_milli"],
                    r["closing_milli"],
                    str(r["doc"]).replace(",", " "),
                    r["last_movement_at"],
                ]
            )
        )
    return "\n".join(lines) + "\n"
