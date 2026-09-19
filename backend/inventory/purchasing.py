"""PUR-01/PUR-02 — أوامر الشراء الداخلية (32-D24؛ §٧.٧، §٣.٣): «الأمر وعدٌ لا التزام» — لا يحرّك
مخزوناً ولا مالاً قبل مستند الشراء (PUR-03). يُكتب بوحدة الشراء ويُعرض معه المكافئ بوحدة البيع؛
القيمة تقديرية من آخر سعر شراء معروف موسومةً في العنوان؛ صنف بلا وحدة شراء أو مورد لا يورّده يُسأل
عنه قبل الحفظ لا بعده والسطر الخاطئ وحده يُعلَّم؛ الحفظ والإرسال فعلان منفصلان؛ الملغى يبقى بسببه.
أمين المخزن يرى القائمة (يستلم بناءً عليها) بلا عمود القيمة ولا إنشاء؛ الإنشاء والإلغاء للمالك
ومدير الفرع — التزام مالي."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from core import audit, home
from core.models import Branch, User
from core.scenario import faults
from core.tenancy import require_tenant
from inventory.models import GoodsReceiptLine, PurchaseOrder, PurchaseOrderLine
from inventory.services import branch_balances

OPEN_STATUSES = {
    PurchaseOrder.Status.OPEN,
    PurchaseOrder.Status.SENT,
    PurchaseOrder.Status.UNSENT,
    PurchaseOrder.Status.PARTIAL,
}
STATUS_HINTS = {
    "open": "محفوظ ولم يُرسل بعد. لا يتحرّك مخزون قبل الاستلام.",
    "sent": "ردّ المورد على الكميات. لا يتحرّك مخزون قبل الاستلام.",
    "unsent": "الأمر محفوظ ومُعلَّم «لم يُرسل» — أعد الإرسال.",
    "partial": "وصل جزء. مستند الشراء يغطّي ما وصل، والباقي ينتظر أو يُلغى.",
    "received": "مستند الشراء معتمد.",
    "cancelled": "الأمر يبقى في السجل ولا يُحذف.",
    "closed": "مغلق.",
}


class OrderRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field
        self.extra = extra or {}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def can_create(viewer: home.Viewer) -> bool:
    """الإنشاء والإلغاء التزام مالي: المالك ومدير الفرع (المحاسب)."""
    return viewer.is_owner or viewer.role_code == "manager"


def owner_name() -> str:
    o = User.objects.filter(is_owner=True, is_active=True).first()
    return o.display_name if o else ""


def can_view(viewer: home.Viewer) -> bool:
    """أمين المخزن يرى ليستلم؛ الكاشير لا شأن له."""
    return can_create(viewer) or viewer.role_code == "storekeeper"


def next_number() -> str:
    """رقم الأمر متسلسل بالأرقام وحدها كما في الإطار («الأمر 122») — لا بادئة."""
    return str(PurchaseOrder.objects.count() + 1)


def last_purchase_prices(item_ids: list[uuid.UUID]) -> dict[tuple[uuid.UUID, str], int]:
    """آخر سعر شراء معروف لكل (صنف، وحدة شراء) من سطور الاستلام ذات التكلفة."""
    out: dict[tuple[uuid.UUID, str], int] = {}
    for ln in (
        GoodsReceiptLine.objects.filter(item_id__in=item_ids, unit_cost_minor__isnull=False)
        .select_related("receipt")
        .order_by("receipt__occurred_at", "id")
    ):
        if ln.unit_cost_minor is not None:
            out[(ln.item_id, ln.unit_code)] = int(ln.unit_cost_minor)
    return out


def supplier_items(supplier_id: uuid.UUID) -> set[uuid.UUID]:
    """ما يورّده المورد بحسب مستندات الاستلام السابقة — لا نمنع غيره، نسأل."""
    return set(
        GoodsReceiptLine.objects.filter(receipt__party_id=supplier_id).values_list(
            "item_id", flat=True
        )
    )


def days_of_stock(branch_id: uuid.UUID, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, int | None]:
    """«يكفي N أيام» = الرصيد ÷ متوسط الصادر اليومي خلال 30 يوماً؛ بلا صادر = لا تقدير."""
    from inventory.models import StockMovement

    since = timezone.now() - timedelta(days=30)
    out_by_item = {
        row["item_id"]: -int(row["s"] or 0)
        for row in StockMovement.objects.filter(
            branch_id=branch_id, item_id__in=item_ids, occurred_at__gte=since, reason="sale"
        )
        .values("item_id")
        .annotate(s=Sum("delta_base_qty_milli"))
    }
    balances = branch_balances(branch_id)
    result: dict[uuid.UUID, int | None] = {}
    for iid in item_ids:
        daily = out_by_item.get(iid, 0) / 30
        bal = balances.get(iid)
        result[iid] = int(bal / daily) if daily > 0 and bal is not None and bal > 0 else None
    return result


def line_payload(ln: PurchaseOrderLine) -> dict[str, Any]:
    return {
        "id": str(ln.id),
        "item_id": str(ln.item_id),
        "item_name": ln.item_name,
        "unit_code": ln.unit_code,
        "unit_name": ln.unit_name,
        "factor_milli": str(ln.factor_milli),
        "qty_milli": str(ln.qty_milli),
        "base_qty_milli": str(ln.base_qty_milli),
        "est_unit_price_minor": str(ln.est_unit_price_minor)
        if ln.est_unit_price_minor is not None
        else "",
        "est_total_minor": str(ln.est_unit_price_minor * ln.qty_milli // 1000)
        if ln.est_unit_price_minor is not None
        else "",
        "received_base_qty_milli": str(ln.received_base_qty_milli),
        "line_no": ln.line_no,
    }


def order_payload(o: PurchaseOrder, *, show_value: bool = True) -> dict[str, Any]:
    lines = list(o.lines.order_by("line_no"))
    names = [ln.item_name for ln in lines]
    return {
        "id": str(o.id),
        "number": o.number,
        "supplier_id": str(o.supplier_id),
        "supplier_name": o.supplier_name,
        "branch_id": str(o.branch_id),
        "status": o.status,
        "status_label": PurchaseOrder.Status(o.status).label,
        "status_hint": STATUS_HINTS.get(o.status, ""),
        "items_summary": ("، ".join(names[:3]) + (" …" if len(names) > 3 else "")),
        "lines_count": o.lines_count,
        "estimated_total_minor": (
            str(o.estimated_total_minor)
            if show_value and o.estimated_total_minor is not None
            else ""
        ),
        "value_hidden": not show_value,
        "note": o.note,
        "created_by_name": o.created_by_name,
        "created_at": _iso(o.created_at),
        "sent_at": _iso(o.sent_at),
        "send_error": o.send_error,
        "cancelled_at": _iso(o.cancelled_at),
        "cancelled_reason": o.cancelled_reason,
        "lines": [line_payload(ln) for ln in lines]
        if show_value
        else [
            {k: v for k, v in line_payload(ln).items() if not k.startswith("est_")} for ln in lines
        ],
    }


def list_payload(
    viewer: home.Viewer, *, scope: str = "open", supplier_id: str = ""
) -> dict[str, Any]:
    from parties.models import Party

    qs = PurchaseOrder.objects.order_by("-created_at")
    if scope == "open":
        qs = qs.filter(status__in=[s.value for s in OPEN_STATUSES])
    if supplier_id:
        try:
            qs = qs.filter(supplier_id=uuid.UUID(supplier_id))
        except ValueError:
            pass
    show_value = can_create(viewer)
    last_closed = (
        PurchaseOrder.objects.exclude(status__in=[s.value for s in OPEN_STATUSES])
        .order_by("-updated_at")
        .first()
    )
    owner = User.objects.filter(is_active=True, is_owner=True).first()
    return {
        "orders": [order_payload(o, show_value=show_value) for o in qs[:100]],
        "open_count": PurchaseOrder.objects.filter(
            status__in=[s.value for s in OPEN_STATUSES]
        ).count(),
        "closed_count": PurchaseOrder.objects.exclude(
            status__in=[s.value for s in OPEN_STATUSES]
        ).count(),
        "scope": scope,
        "supplier_id": supplier_id,
        "suppliers": [
            {"id": str(p.id), "name": p.name}
            for p in Party.objects.filter(
                is_supplier=True, is_active=True, merged_into__isnull=True
            ).order_by("name_normalized")
        ],
        "can_create": can_create(viewer),
        "value_hidden": not show_value,
        "ask_name": (owner.display_name if owner else "") if not show_value else "",
        "last_closed": {
            "number": last_closed.number,
            "status_label": PurchaseOrder.Status(last_closed.status).label,
            "at": _iso(last_closed.updated_at),
        }
        if last_closed
        else None,
        "as_of": _iso(timezone.now()),
    }


def _validate_lines(
    *,
    supplier_id: uuid.UUID,
    branch_id: uuid.UUID,
    raw_lines: list[dict[str, Any]],
    confirmed: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """يعيد السطور المحلولة أو قائمة أخطاء لكل سطر — السطر الخاطئ وحده يُعلَّم."""
    from catalog.models import Item

    errors: list[dict[str, Any]] = []
    resolved: list[dict[str, Any]] = []
    ids: list[uuid.UUID] = []
    for i, raw in enumerate(raw_lines):
        try:
            ids.append(uuid.UUID(str(raw.get("item_id"))))
        except ValueError:
            errors.append({"line": i, "code": "item_invalid"})
    items = {
        it.id: it
        for it in Item.objects.filter(id__in=ids)
        .select_related("base_unit")
        .prefetch_related("units__unit")
    }
    known = supplier_items(supplier_id)
    prices = last_purchase_prices(ids)
    for i, raw in enumerate(raw_lines):
        try:
            iid = uuid.UUID(str(raw.get("item_id")))
        except ValueError:
            continue
        item = items.get(iid)
        if item is None:
            errors.append({"line": i, "code": "item_unknown"})
            continue
        try:
            qty = int(str(raw.get("qty_milli", "0")))
        except ValueError:
            qty = 0
        if qty <= 0:
            errors.append({"line": i, "code": "qty_required", "item_name": item.name})
            continue
        unit_code = str(raw.get("unit_code", "") or "")
        units = {u.unit.code: u for u in item.units.all()}
        if not unit_code:
            # 12 ماذا: كيساً أم كرتوناً — الفرق عشرة أضعاف ويظهر يوم الاستلام لا اليوم
            errors.append(
                {"line": i, "code": "unit_required", "item_name": item.name, "qty_milli": str(qty)}
            )
            continue
        if unit_code == item.base_unit.code:
            factor, unit_name = 1000, item.base_unit.name
        elif unit_code in units:
            factor, unit_name = int(units[unit_code].factor_milli), units[unit_code].unit.name
        else:
            errors.append({"line": i, "code": "unit_unknown", "item_name": item.name})
            continue
        if known and iid not in known and not confirmed:
            errors.append(
                {
                    "line": i,
                    "code": "supplier_mismatch",
                    "item_name": item.name,
                    "confirmable": True,
                }
            )
            continue
        price = prices.get((iid, unit_code))
        resolved.append(
            {
                "item": item,
                "unit_code": unit_code,
                "unit_name": unit_name,
                "factor_milli": factor,
                "qty_milli": qty,
                "base_qty_milli": qty * factor // 1000,
                "est_unit_price_minor": price,
            }
        )
    return resolved, errors


def preview(
    *, branch_id: uuid.UUID, supplier_id: Any, raw_lines: list[dict[str, Any]], confirmed: bool
) -> dict[str, Any]:
    """المكافئ بوحدة البيع والرصيد و«يكفي N أيام» والسعر التقديري مع كل تغيير — قبل الحفظ."""
    from parties.models import Party

    try:
        sid = uuid.UUID(str(supplier_id))
    except ValueError as e:
        raise OrderRejected("supplier_required", "supplier_id") from e
    supplier = Party.objects.filter(id=sid, is_supplier=True).first()
    if supplier is None:
        raise OrderRejected("supplier_required", "supplier_id")
    resolved, errors = _validate_lines(
        supplier_id=sid, branch_id=branch_id, raw_lines=raw_lines, confirmed=confirmed
    )
    ids = [r["item"].id for r in resolved]
    balances = branch_balances(branch_id)
    days = days_of_stock(branch_id, ids)
    total = 0
    unknown_price = False
    rows = []
    for r in resolved:
        it = r["item"]
        price = r["est_unit_price_minor"]
        if price is None:
            unknown_price = True
        else:
            total += price * r["qty_milli"] // 1000
        rows.append(
            {
                "item_id": str(it.id),
                "item_name": it.name,
                "unit_code": r["unit_code"],
                "unit_name": r["unit_name"],
                "factor_milli": str(r["factor_milli"]),
                "qty_milli": str(r["qty_milli"]),
                "base_qty_milli": str(r["base_qty_milli"]),
                "base_unit_name": it.base_unit.name,
                "base_decimal_places": it.base_unit.decimal_places,
                "balance_milli": str(balances[it.id]) if it.id in balances else "",
                "days_of_stock": days.get(it.id),
                "est_unit_price_minor": str(price) if price is not None else "",
                "est_total_minor": str(price * r["qty_milli"] // 1000) if price is not None else "",
            }
        )
    return {
        "supplier": {"id": str(supplier.id), "name": supplier.name},
        "lines": rows,
        "errors": errors,
        "estimated_total_minor": str(total) if rows and not unknown_price else "",
        "estimated_partial": unknown_price,
        "supplier_known_items": len(supplier_items(sid)),
    }


def create(
    *,
    actor: User,
    viewer: home.Viewer,
    branch: Branch,
    supplier_id: Any,
    raw_lines: list[dict[str, Any]],
    note: str,
    confirmed: bool,
) -> PurchaseOrder:
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    pv = preview(
        branch_id=branch.id, supplier_id=supplier_id, raw_lines=raw_lines, confirmed=confirmed
    )
    if pv["errors"]:
        raise OrderRejected("lines_invalid", "lines", {"errors": pv["errors"]})
    if not pv["lines"]:
        raise OrderRejected("lines_required", "lines")
    with transaction.atomic():
        o: PurchaseOrder = PurchaseOrder.objects.create(
            tenant_id=require_tenant(),
            number=next_number(),
            supplier_id=uuid.UUID(pv["supplier"]["id"]),
            supplier_name=pv["supplier"]["name"],
            branch=branch,
            status=PurchaseOrder.Status.OPEN,
            note=note.strip(),
            estimated_total_minor=int(pv["estimated_total_minor"])
            if pv["estimated_total_minor"]
            else None,
            lines_count=len(pv["lines"]),
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
        )
        for i, ln in enumerate(pv["lines"], start=1):
            PurchaseOrderLine.objects.create(
                tenant_id=o.tenant_id,
                order=o,
                item_id=uuid.UUID(ln["item_id"]),
                item_name=ln["item_name"],
                unit_code=ln["unit_code"],
                unit_name=ln["unit_name"],
                factor_milli=int(ln["factor_milli"]),
                qty_milli=int(ln["qty_milli"]),
                base_qty_milli=int(ln["base_qty_milli"]),
                est_unit_price_minor=int(ln["est_unit_price_minor"])
                if ln["est_unit_price_minor"]
                else None,
                line_no=i,
            )
    audit.record(
        kind="purchase_order.created",
        title=f"أمر شراء {o.number} — {o.supplier_name}",
        actor=actor,
        branch=branch,
        detail=(
            f"{o.lines_count} أصناف · قيمة تقديرية "
            f"{o.estimated_total_minor if o.estimated_total_minor is not None else '—'}"
        ),
        ref_entity="inventory.PurchaseOrder",
        ref_id=o.id,
    )
    return o


def send(*, actor: User, viewer: home.Viewer, order: PurchaseOrder) -> PurchaseOrder:
    """الإرسال فعل منفصل عن الحفظ: لا قناة مورد بعد — يُعلَّم «مُرسل»، ولو فشل يبقى محفوظاً
    ومُعلَّماً «لم يُرسل» مع إعادة."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if order.status not in {PurchaseOrder.Status.OPEN, PurchaseOrder.Status.UNSENT}:
        raise OrderRejected("order_locked")
    if "po_send_fail" in faults.active():
        order.status = PurchaseOrder.Status.UNSENT
        order.send_error = "supplier_channel_failed"
        order.save(update_fields=["status", "send_error", "updated_at"])
        raise OrderRejected("send_failed", "", {"order": order_payload(order)})
    order.status = PurchaseOrder.Status.SENT
    order.sent_at = timezone.now()
    order.send_error = ""
    order.save(update_fields=["status", "sent_at", "send_error", "updated_at"])
    audit.record(
        kind="purchase_order.sent",
        title=f"إرسال أمر الشراء {order.number} إلى {order.supplier_name}",
        actor=actor,
        ref_entity="inventory.PurchaseOrder",
        ref_id=order.id,
    )
    return order


def cancel(*, actor: User, viewer: home.Viewer, order: PurchaseOrder, reason: str) -> PurchaseOrder:
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if order.status not in OPEN_STATUSES:
        raise OrderRejected("order_locked")
    if not reason.strip():
        raise OrderRejected("reason_required", "reason")
    order.status = PurchaseOrder.Status.CANCELLED
    order.cancelled_at = timezone.now()
    order.cancelled_reason = reason.strip()
    order.cancelled_by_name = actor.display_name
    order.save(
        update_fields=[
            "status",
            "cancelled_at",
            "cancelled_reason",
            "cancelled_by_name",
            "updated_at",
        ]
    )
    audit.record(
        kind="purchase_order.cancelled",
        title=f"إلغاء أمر الشراء {order.number}",
        actor=actor,
        reason=order.cancelled_reason,
        ref_entity="inventory.PurchaseOrder",
        ref_id=order.id,
    )
    return order
