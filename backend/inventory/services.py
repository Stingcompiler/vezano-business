"""خدمات المخزون: تطبيق حركة المخزون من PUSH وأرصدة الفرع بالوحدة الأساسية."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from datetime import timedelta
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
    "quarantine": "حجر — قابل للمراجعة",
    "write_off": "هالك — خروج نهائي",
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
    transit = in_transit_out(branch_id)
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
                "in_transit_milli": str(transit.get(item.id, 0)),
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
        if m.note:
            actor = f"{actor} · سبب: {m.note}".strip(" ·")
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


# ---------------------------------------------------------------------------
# INV-04 استلام بضاعة (PUSH `stock_receipt`) · INV-03 افتتاحيات المخزون (أونلاين، اعتماد المالك)
# ---------------------------------------------------------------------------


def apply_goods_receipt(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from django.utils.dateparse import parse_date

    from core.models import User
    from inventory.models import GoodsReceipt

    if GoodsReceipt.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    branch = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_id"]).first()
    if branch is None:
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    GoodsReceipt.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch=branch,
        receipt_number=str(payload["receipt_number"]),
        party_id=uuid.UUID(str(payload["party_id"])) if payload.get("party_id") else None,
        supplier_name=str(payload["supplier_name"]),
        reference=str(payload["reference"]),
        device_id=device_id,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        note=str(payload.get("note", "")),
        business_date=parse_date(str(payload["business_date"])) or timezone.localdate(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def apply_goods_receipt_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from inventory.models import GoodsReceipt, GoodsReceiptLine

    if GoodsReceiptLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    receipt = GoodsReceipt.unscoped.filter(tenant_id=tenant_id, id=payload["receipt_id"]).first()
    if receipt is None:
        return
    cost = payload.get("unit_cost_minor")
    GoodsReceiptLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        receipt=receipt,
        item_id=uuid.UUID(str(payload["item_id"])),
        item_name=str(payload.get("item_name", "")),
        unit_code=str(payload.get("unit_code", "")),
        factor_milli=int(payload["factor_milli"]),
        qty_milli=int(payload["qty_milli"]),
        base_qty_milli=int(payload["base_qty_milli"]),
        unit_cost_minor=int(cost) if cost not in (None, "") else None,
    )


def receipt_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    """INV-02: «هبة · فاتورة 8841» — الفاعل ومرجع المورد، والمستند رقم الاستلام."""
    from inventory.models import GoodsReceipt

    return {
        r.id: (r.receipt_number, f"{r.user_name} · {r.reference}".strip(" ·"))
        for r in GoodsReceipt.objects.filter(id__in=ids)
    }


class OpeningRejected(Exception):
    """أخطاء الافتتاحية كلها معاً: (رقم السطر، الحقل، الرمز)."""

    def __init__(self, errors: list[tuple[int, str, str]]) -> None:
        super().__init__("opening_rejected")
        self.errors = errors


def opened_items(branch_id: uuid.UUID) -> set[uuid.UUID]:
    from inventory.models import StockOpeningLine

    return {
        ln.item_id
        for ln in StockOpeningLine.objects.filter(
            opening__branch_id=branch_id, opening__status="approved"
        )
    }


def create_opening(
    *,
    branch: Branch,
    lines: list[Mapping[str, Any]],
    actor: Any,
    approve: bool,
) -> Any:
    """مستند افتتاحية واحد يجمع الأصناف (لا حركات متفرّقة): كل سطر بصنف قائم ووحدة معرَّفة بمعامل
    موجب وكمية رقمية موجبة؛ الافتتاحي مرة واحدة لكل صنف وقبل أول حركة (كما PTY-04). المالك يعتمد
    فوراً؛ غيره يُرسل للاعتماد."""
    from catalog.models import Item
    from inventory.models import StockOpening, StockOpeningLine

    if not lines:
        raise OpeningRejected([(0, "lines", "required")])
    errors: list[tuple[int, str, str]] = []
    moved = set(branch_balances(branch.id))
    already = opened_items(branch.id)
    seen: set[uuid.UUID] = set()
    prepared: list[dict[str, Any]] = []
    for i, ln in enumerate(lines):
        try:
            item_id = uuid.UUID(str(ln.get("item_id", "")))
        except ValueError:
            errors.append((i, "item_id", "invalid"))
            continue
        item = Item.objects.filter(id=item_id).select_related("base_unit").first()
        if item is None:
            errors.append((i, "item_id", "not_found"))
            continue
        if item_id in seen:
            errors.append((i, "item_id", "duplicate"))
            continue
        seen.add(item_id)
        if item_id in moved:
            errors.append((i, "item_id", "has_movements"))
        if item_id in already:
            errors.append((i, "item_id", "already_opened"))
        try:
            qty = int(str(ln.get("qty_milli", "")))
            factor = int(str(ln.get("factor_milli", "1000")))
        except ValueError:
            errors.append((i, "qty_milli", "invalid"))
            continue
        if qty <= 0:
            errors.append((i, "qty_milli", "min"))
        if factor <= 0:
            errors.append((i, "factor_milli", "undefined"))
        cost_raw = ln.get("unit_cost_minor")
        cost: int | None = None
        if cost_raw not in (None, ""):
            try:
                cost = int(str(cost_raw))
            except ValueError:
                errors.append((i, "unit_cost_minor", "invalid"))
            else:
                if cost < 0:
                    errors.append((i, "unit_cost_minor", "min"))
        unit_code = str(ln.get("unit_code", "")) or item.base_unit.code
        unit_name = str(ln.get("unit_name", "")) or item.base_unit.name
        prepared.append(
            {
                "item": item,
                "unit_code": unit_code,
                "unit_name": unit_name,
                "factor_milli": factor,
                "qty_milli": qty,
                "base_qty_milli": qty * factor // 1000 if factor > 0 else 0,
                "unit_cost_minor": cost,
            }
        )
    if errors:
        raise OpeningRejected(errors)
    from django.db import transaction

    from core.tenancy import require_tenant
    from sync.reference import log_reference

    with transaction.atomic():
        opening: StockOpening = StockOpening.objects.create(
            tenant_id=require_tenant(),
            branch=branch,
            status="approved" if approve else "submitted",
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
            approved_by_user_id=actor.id if approve else None,
            approved_by_name=actor.display_name if approve else "",
            approved_at=timezone.now() if approve else None,
        )
        for n, p in enumerate(prepared):
            StockOpeningLine.objects.create(
                tenant_id=require_tenant(),
                opening=opening,
                line_no=n,
                item_id=p["item"].id,
                item_name=p["item"].name,
                unit_code=p["unit_code"],
                unit_name=p["unit_name"],
                factor_milli=p["factor_milli"],
                qty_milli=p["qty_milli"],
                base_qty_milli=p["base_qty_milli"],
                unit_cost_minor=p["unit_cost_minor"],
            )
        if approve:
            _post_opening(opening)
        log_reference(require_tenant(), "inventory.StockOpening", opening.id)
    return opening


def _post_opening(opening: Any) -> None:
    """الاعتماد يُنشئ الرصيد: حركة `opening` لكل سطر بالوحدة الأساسية — مستند واحد مصدرها."""
    from core.tenancy import require_tenant

    for ln in opening.lines.all():
        StockMovement.objects.create(
            tenant_id=require_tenant(),
            branch=opening.branch,
            item_id=ln.item_id,
            delta_base_qty_milli=ln.base_qty_milli,
            reason="opening",
            source_entity="inventory.StockOpening",
            source_id=opening.id,
            occurred_at=opening.approved_at or timezone.now(),
        )


def approve_opening(opening: Any, *, actor: Any) -> Any:
    """اعتماد مستند مُرسل: يُعاد فحص «مرة واحدة لكل صنف وقبل أول حركة» لحظة الاعتماد."""
    from django.db import transaction

    from core.tenancy import require_tenant
    from sync.reference import log_reference

    if opening.status == "approved":
        raise OpeningRejected([(0, "status", "already_approved")])
    moved = set(branch_balances(opening.branch_id))
    already = opened_items(opening.branch_id)
    errors = []
    for i, ln in enumerate(opening.lines.order_by("line_no", "id")):
        if ln.item_id in moved:
            errors.append((i, "item_id", "has_movements"))
        if ln.item_id in already:
            errors.append((i, "item_id", "already_opened"))
    if errors:
        raise OpeningRejected(errors)
    with transaction.atomic():
        opening.status = "approved"
        opening.approved_by_user_id = actor.id
        opening.approved_by_name = actor.display_name
        opening.approved_at = timezone.now()
        opening.save(
            update_fields=["status", "approved_by_user_id", "approved_by_name", "approved_at"]
        )
        _post_opening(opening)
        log_reference(require_tenant(), "inventory.StockOpening", opening.id)
    return opening


def opening_payload(o: Any) -> dict[str, Any]:
    lines = [
        {
            "id": str(ln.id),
            "item_id": str(ln.item_id),
            "item_name": ln.item_name,
            "unit_code": ln.unit_code,
            "unit_name": ln.unit_name,
            "factor_milli": str(ln.factor_milli),
            "qty_milli": str(ln.qty_milli),
            "base_qty_milli": str(ln.base_qty_milli),
            "unit_cost_minor": str(ln.unit_cost_minor) if ln.unit_cost_minor is not None else "",
        }
        for ln in o.lines.order_by("line_no", "id")
    ]
    value = sum(
        (ln.unit_cost_minor or 0) * ln.qty_milli // 1000
        for ln in o.lines.all()
        if ln.unit_cost_minor is not None
    )
    return {
        "id": str(o.id),
        "branch_id": str(o.branch_id),
        "status": o.status,
        "created_by_name": o.created_by_name,
        "approved_by_name": o.approved_by_name,
        "approved_at": _iso(o.approved_at),
        "created_at": _iso(o.created_at),
        "lines": lines,
        "line_count": len(lines),
        "value_minor": str(value),
    }


def opening_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    """INV-02: «عثمان · اعتماد أولي» — المعتمد، والمستند رقم الافتتاحية المختصر."""
    from inventory.models import StockOpening

    return {
        o.id: (f"OP-{str(o.id)[-4:].upper()}", f"{o.approved_by_name} · اعتماد أولي".strip(" ·"))
        for o in StockOpening.objects.filter(id__in=ids)
    }


# ---------------------------------------------------------------------------
# INV-05 جلسة جرد (PUSH `count_session`) · INV-06 مراجعة الفروق والتسوية (أونلاين، صلاحية مالية)
# ---------------------------------------------------------------------------

#: أسباب مقترحة للفرق (28-D21) — مع حقل حرّ؛ «تسوية جرد» سبباً عامّاً لا يُقبل
SUGGESTED_REASONS = ("تالف", "سرقة", "خطأ عدّ", "خطأ استلام")


def apply_count_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from core.models import User
    from inventory.models import CountSession

    if CountSession.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    branch = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_id"]).first()
    if branch is None:
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    total = payload.get("total_items")
    CountSession.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch=branch,
        session_number=str(payload["session_number"]),
        device_id=device_id,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        total_items=int(total) if total not in (None, "") else 0,
        started_at=_dt(payload.get("started_at")),
        closed_at=_dt(payload.get("closed_at")),
    )


def apply_count_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from inventory.models import CountLine, CountSession

    if CountLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    session = CountSession.unscoped.filter(tenant_id=tenant_id, id=payload["session_id"]).first()
    if session is None:
        return
    sys_raw = payload.get("system_qty_milli")
    CountLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        session=session,
        item_id=uuid.UUID(str(payload["item_id"])),
        item_name=str(payload.get("item_name", "")),
        unit_name=str(payload.get("unit_name", "")),
        counted_qty_milli=int(payload["counted_qty_milli"]),
        system_qty_milli=int(sys_raw) if sys_raw not in (None, "") else None,
        counted_at=_dt(payload.get("counted_at")),
    )


def _sale_price(item_id: uuid.UUID) -> int:
    from catalog.models import Item

    it = Item.objects.filter(id=item_id).only("sale_price_minor").first()
    return int(it.sale_price_minor) if it else 0


def session_variances(session: Any) -> dict[str, Any]:
    """INV-06: الدفتري لحظة المراجعة (رصيد الفرع الآن) مقابل المعدود كما أُدخل؛ فرقٌ ≠ 0 يحتاج
    سبباً؛ حركة وقعت على جهاز آخر أثناء الجرد تُكتشف بمقارنة لقطة العدّ بالدفتري الآن (ACC-07).
    الأثر المالي بسعر البيع (افتراض حتى تُبنى التكلفة)."""
    balances = branch_balances(session.branch_id)
    rows: list[dict[str, Any]] = []
    effect = 0
    variances = 0
    for ln in session.lines.order_by("counted_at", "id"):
        book = balances.get(ln.item_id, 0)
        delta = ln.counted_qty_milli - book
        price = _sale_price(ln.item_id)
        value = delta * price // 1000
        if delta != 0:
            variances += 1
            effect += value
        rows.append(
            {
                "line_id": str(ln.id),
                "item_id": str(ln.item_id),
                "item_name": ln.item_name,
                "unit_name": ln.unit_name,
                "book_milli": str(book),
                "counted_milli": str(ln.counted_qty_milli),
                "system_at_count_milli": (
                    str(ln.system_qty_milli) if ln.system_qty_milli is not None else ""
                ),
                "delta_milli": str(delta),
                "value_minor": str(value),
                "moved_since_count": ln.system_qty_milli is not None
                and ln.system_qty_milli != book,
            }
        )
    adj = session.adjustments.order_by("-occurred_at").first()
    return {
        "session": {
            "id": str(session.id),
            "session_number": session.session_number,
            "branch_id": str(session.branch_id),
            "branch_name": session.branch.name,
            "status": session.status,
            "user_name": session.user_name,
            "total_items": session.total_items,
            "counted_items": len(rows),
            "started_at": _iso(session.started_at),
            "closed_at": _iso(session.closed_at),
        },
        "rows": rows,
        "variance_count": variances,
        "effect_minor": str(effect),
        "suggested_reasons": list(SUGGESTED_REASONS),
        "adjustment": adjustment_payload(adj) if adj else None,
    }


class AdjustmentRejected(Exception):
    def __init__(self, errors: list[tuple[str, str, str]]) -> None:
        super().__init__("adjustment_rejected")
        #: (item_id، الحقل، الرمز)
        self.errors = errors


def _next_adjustment_number() -> str:
    from inventory.models import StockAdjustment

    return f"TS-{StockAdjustment.objects.count() + 1:04d}"


def adjust_session(session: Any, *, reasons: Mapping[str, str], actor: Any) -> Any:
    """التسوية: لكل فرق ≠ 0 سبب مكتوب لا عامّ («تسوية جرد» مرفوض)؛ حركة `count` بمستند وفاعل
    وسبب لكل صف؛ العدّ الأصلي لا يُعاد كتابته؛ لا «قبول الكل»."""
    from django.db import transaction

    from core.tenancy import require_tenant
    from inventory.models import StockAdjustment, StockAdjustmentLine
    from sync.reference import log_reference

    if session.status == "adjusted":
        raise AdjustmentRejected([("", "status", "already_adjusted")])
    data = session_variances(session)
    diffs = [r for r in data["rows"] if r["delta_milli"] != "0"]
    errors: list[tuple[str, str, str]] = []
    for r in diffs:
        reason = str(reasons.get(r["item_id"], "")).strip()
        if not reason:
            errors.append((r["item_id"], "reason", "required"))
        elif reason == "تسوية جرد":
            errors.append((r["item_id"], "reason", "generic"))
    if errors:
        raise AdjustmentRejected(errors)
    with transaction.atomic():
        adj: StockAdjustment = StockAdjustment.objects.create(
            tenant_id=require_tenant(),
            session=session,
            branch=session.branch,
            adjustment_number=_next_adjustment_number(),
            decided_by_user_id=actor.id,
            decided_by_name=actor.display_name,
        )
        for r in diffs:
            reason = str(reasons[r["item_id"]]).strip()
            StockAdjustmentLine.objects.create(
                tenant_id=require_tenant(),
                adjustment=adj,
                item_id=uuid.UUID(r["item_id"]),
                item_name=r["item_name"],
                book_qty_milli=int(r["book_milli"]),
                counted_qty_milli=int(r["counted_milli"]),
                delta_milli=int(r["delta_milli"]),
                reason=reason,
            )
            StockMovement.objects.create(
                tenant_id=require_tenant(),
                branch=session.branch,
                item_id=uuid.UUID(r["item_id"]),
                delta_base_qty_milli=int(r["delta_milli"]),
                reason="count",
                source_entity="inventory.StockAdjustment",
                source_id=adj.id,
                note=reason,
                occurred_at=adj.occurred_at,
            )
        session.status = "adjusted"
        session.save(update_fields=["status"])
        log_reference(require_tenant(), "inventory.StockAdjustment", adj.id)
    return adj


def adjustment_payload(adj: Any) -> dict[str, Any]:
    lines = list(adj.lines.order_by("id"))
    return {
        "id": str(adj.id),
        "adjustment_number": adj.adjustment_number,
        "decided_by_name": adj.decided_by_name,
        "occurred_at": _iso(adj.occurred_at),
        "line_count": len(lines),
        "lines": [
            {
                "item_id": str(ln.item_id),
                "item_name": ln.item_name,
                "delta_milli": str(ln.delta_milli),
                "reason": ln.reason,
            }
            for ln in lines
        ],
    }


def adjustment_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    """INV-02: «عثمان · سبب: تالف» — الفاعل، والسبب يُلحق من الحركة نفسها (`note`)."""
    from inventory.models import StockAdjustment

    return {
        a.id: (a.adjustment_number, a.decided_by_name)
        for a in StockAdjustment.objects.filter(id__in=ids)
    }


# ---------------------------------------------------------------------------
# INV-07 هالك وحجر تالف (أونلاين؛ ACC-10)
# ---------------------------------------------------------------------------

#: حدّ الهالك المالي لغير المالك — مؤقت حتى ORG-02 (افتراض كما سقوف G-09): 500.00
WRITE_OFF_CAP_MINOR = 50000


class DamageRejected(Exception):
    def __init__(self, code: str, field: str = "", **extra: Any) -> None:
        super().__init__(code)
        self.code = code
        self.field = field
        self.extra = extra


def _next_damage_number() -> str:
    from inventory.models import DamageRecord

    return f"DMG-{DamageRecord.objects.count() + 1:04d}"


def record_damage(
    *,
    branch: Branch,
    item: Any,
    unit_code: str,
    unit_name: str,
    factor_milli: int,
    qty_milli: int,
    destination: str,
    reason: str,
    actor: Any,
    is_owner: bool,
) -> Any:
    """التالف لا يدخل المتاح للبيع (ACC-10): الحجر يخرج من المتاح ويدخل الحجر؛ الهالك يخرج نهائياً.
    الحدّ من الرصيد — ولو كان الرصيد خاطئاً (تصحيحه بالجرد لا بالهالك)؛ الهالك بحدٍّ مالي لغير
    المالك؛ السبب إلزامي."""
    from django.db import transaction

    from core.tenancy import require_tenant
    from inventory.models import DamageRecord, QuarantineMovement
    from sync.reference import log_reference

    if destination not in ("quarantine", "write_off"):
        raise DamageRejected("invalid", "destination")
    if qty_milli <= 0:
        raise DamageRejected("min", "qty_milli")
    if factor_milli <= 0:
        raise DamageRejected("undefined", "factor_milli")
    if not reason.strip():
        raise DamageRejected("required", "reason")
    base = qty_milli * factor_milli // 1000
    balance = branch_balances(branch.id).get(item.id, 0)
    if base > balance:
        raise DamageRejected("exceeds_balance", "qty_milli", balance_milli=str(balance))
    value = base * int(item.sale_price_minor) // 1000
    if destination == "write_off" and not is_owner and value > WRITE_OFF_CAP_MINOR:
        raise DamageRejected(
            "owner_required",
            "destination",
            cap_minor=str(WRITE_OFF_CAP_MINOR),
            value_minor=str(value),
        )
    with transaction.atomic():
        rec: DamageRecord = DamageRecord.objects.create(
            tenant_id=require_tenant(),
            branch=branch,
            damage_number=_next_damage_number(),
            item_id=item.id,
            item_name=item.name,
            unit_code=unit_code or item.base_unit.code,
            unit_name=unit_name or item.base_unit.name,
            factor_milli=factor_milli,
            qty_milli=qty_milli,
            base_qty_milli=base,
            destination=destination,
            reason=reason.strip(),
            value_minor=value,
            decided_by_user_id=actor.id,
            decided_by_name=actor.display_name,
        )
        StockMovement.objects.create(
            tenant_id=require_tenant(),
            branch=branch,
            item_id=item.id,
            delta_base_qty_milli=-base,
            reason=destination,
            source_entity="inventory.DamageRecord",
            source_id=rec.id,
            note=reason.strip(),
            occurred_at=rec.occurred_at,
        )
        if destination == "quarantine":
            QuarantineMovement.objects.create(
                tenant_id=require_tenant(),
                branch=branch,
                item_id=item.id,
                base_qty_milli=base,
                reason="damaged",
                source_entity="inventory.DamageRecord",
                source_id=rec.id,
                occurred_at=rec.occurred_at,
            )
        log_reference(require_tenant(), "inventory.DamageRecord", rec.id)
    return rec


def damage_payload(rec: Any) -> dict[str, Any]:
    return {
        "id": str(rec.id),
        "damage_number": rec.damage_number,
        "item_id": str(rec.item_id),
        "item_name": rec.item_name,
        "unit_name": rec.unit_name,
        "qty_milli": str(rec.qty_milli),
        "base_qty_milli": str(rec.base_qty_milli),
        "destination": rec.destination,
        "reason": rec.reason,
        "value_minor": str(rec.value_minor),
        "decided_by_name": rec.decided_by_name,
        "occurred_at": _iso(rec.occurred_at),
    }


def damage_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    from inventory.models import DamageRecord

    return {
        r.id: (r.damage_number, r.decided_by_name) for r in DamageRecord.objects.filter(id__in=ids)
    }


# ---------------------------------------------------------------------------
# INV-08 قائمة التحويلات · INV-09 إنشاء وإرسال تحويل (PUSH `stock_transfer`؛ §١٠.٢، §٨.٦)
# ---------------------------------------------------------------------------

#: تأخّر الاستلام الذي يُنبَّه عليه المالك — «تأخر لا اتهام» (14-D9)
TRANSFER_LATE_HOURS = 72


def apply_stock_transfer(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from core.models import User
    from inventory.models import StockTransfer

    if StockTransfer.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    b_from = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_from_id"]).first()
    b_to = Branch.unscoped.filter(tenant_id=tenant_id, id=payload["branch_to_id"]).first()
    if b_from is None or b_to is None:
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    StockTransfer.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch_from=b_from,
        branch_to=b_to,
        transfer_number=str(payload["transfer_number"]),
        device_id=device_id,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        note=str(payload.get("note", "")),
        sent_at=_dt(payload.get("sent_at")),
    )


def apply_stock_transfer_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from catalog.models import Item
    from inventory.models import StockTransfer, StockTransferLine

    if StockTransferLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    transfer = StockTransfer.unscoped.filter(tenant_id=tenant_id, id=payload["transfer_id"]).first()
    if transfer is None:
        return
    item_id = uuid.UUID(str(payload["item_id"]))
    item = Item.unscoped.filter(tenant_id=tenant_id, id=item_id).first()
    base = int(payload["base_qty_milli"])
    StockTransferLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        transfer=transfer,
        line_no=transfer.lines.count(),
        item_id=item_id,
        item_name=str(payload.get("item_name", "")) or (item.name if item else ""),
        unit_code=str(payload.get("unit_code", "")),
        unit_name=str(payload.get("unit_name", "")),
        factor_milli=int(payload["factor_milli"]),
        qty_milli=int(payload["qty_milli"]),
        base_qty_milli=base,
        value_minor=(base * int(item.sale_price_minor) // 1000) if item else 0,
    )


def transfer_payload(t: Any) -> dict[str, Any]:
    lines = list(t.lines.order_by("line_no", "id"))
    in_transit = sum(max(0, ln.base_qty_milli - ln.received_base_milli) for ln in lines)
    in_transit_value = sum(
        (
            max(0, ln.base_qty_milli - ln.received_base_milli) * ln.value_minor // ln.base_qty_milli
            if ln.base_qty_milli
            else 0
        )
        for ln in lines
    )
    late = (
        t.status in ("sent", "partially_received")
        and t.sent_at + timedelta(hours=TRANSFER_LATE_HOURS) < timezone.now()
    )
    return {
        "id": str(t.id),
        "transfer_number": t.transfer_number,
        "branch_from_id": str(t.branch_from_id),
        "branch_from_name": t.branch_from.name,
        "branch_to_id": str(t.branch_to_id),
        "branch_to_name": t.branch_to.name,
        "status": t.status,
        "user_name": t.user_name,
        "note": t.note,
        "sent_at": _iso(t.sent_at),
        "received_at": _iso(t.received_at),
        "cancelled_at": _iso(t.cancelled_at),
        "late": late,
        "in_transit_milli": str(in_transit),
        "in_transit_value_minor": str(in_transit_value),
        "line_count": len(lines),
        "lines": [
            {
                "id": str(ln.id),
                "item_id": str(ln.item_id),
                "item_name": ln.item_name,
                "unit_name": ln.unit_name,
                "factor_milli": str(ln.factor_milli),
                "qty_milli": str(ln.qty_milli),
                "base_qty_milli": str(ln.base_qty_milli),
                "received_base_milli": str(ln.received_base_milli),
                "value_minor": str(ln.value_minor),
            }
            for ln in lines
        ],
    }


def visible_transfers(viewer: Any, branch_id: uuid.UUID | None) -> Any:
    """مخوَّل للفرعين والمالك فقط (§٨.٦): غير المالك يرى ما يخصّ فرعه طرفاً — لا فرعاً ثالثاً."""
    from django.db.models import Q

    from inventory.models import StockTransfer

    qs = StockTransfer.objects.select_related("branch_from", "branch_to").order_by("-sent_at")
    if viewer.is_owner:
        if branch_id is not None:
            qs = qs.filter(Q(branch_from_id=branch_id) | Q(branch_to_id=branch_id))
        return qs
    own = viewer.branch.id if viewer.branch is not None else None
    if own is None:
        return qs.none()
    return qs.filter(Q(branch_from_id=own) | Q(branch_to_id=own))


class TransferRejected(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def cancel_transfer(t: Any, *, actor: Any) -> Any:
    """«إلغاء التحويل — يرجع للمرسِل»: المتبقّي في الطريق يعود إلى رصيد المصدر بحركة `transfer_in`
    بمستند التحويل نفسه؛ لا إلغاء بعد الاستلام الكامل."""
    from django.db import transaction

    from core.tenancy import require_tenant
    from sync.reference import log_reference

    if t.status in ("received", "cancelled"):
        raise TransferRejected(f"already_{t.status}")
    with transaction.atomic():
        for ln in t.lines.all():
            remaining = ln.base_qty_milli - ln.received_base_milli
            if remaining <= 0:
                continue
            StockMovement.objects.create(
                tenant_id=require_tenant(),
                branch=t.branch_from,
                item_id=ln.item_id,
                delta_base_qty_milli=remaining,
                reason="transfer_in",
                source_entity="inventory.StockTransfer",
                source_id=t.id,
                note="إلغاء التحويل — يرجع للمرسِل",
            )
            ln.received_base_milli = ln.base_qty_milli
            ln.save(update_fields=["received_base_milli"])
        t.status = "cancelled"
        t.cancelled_at = timezone.now()
        t.cancelled_by_name = actor.display_name
        t.save(update_fields=["status", "cancelled_at", "cancelled_by_name"])
        log_reference(require_tenant(), "inventory.StockTransfer", t.id)
    return t


def in_transit_out(branch_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """ما خرج من الفرع ولم يُستلم بعد — لكل صنف (INV-01 «في الطريق»)."""
    from inventory.models import StockTransferLine

    out: dict[uuid.UUID, int] = {}
    for ln in StockTransferLine.objects.filter(
        transfer__branch_from_id=branch_id, transfer__status__in=("sent", "partially_received")
    ):
        remaining = ln.base_qty_milli - ln.received_base_milli
        if remaining > 0:
            out[ln.item_id] = out.get(ln.item_id, 0) + remaining
    return out


def transfer_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    """INV-02: «إلى فرع بحري» / «من المخزن الرئيسي» — الحركة تحمل اتجاهها في بيانها."""
    from inventory.models import StockTransfer

    return {
        t.id: (t.transfer_number, f"إلى {t.branch_to.name}")
        for t in StockTransfer.objects.filter(id__in=ids).select_related("branch_to")
    }
