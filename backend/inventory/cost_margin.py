"""PUR-05 — التكلفة والهامش: الرقم الذي لا يُعرض إلا لمن يملكه (32-D24؛ §٧.٧؛ ACC-90).

التكلفة تتبع مستندات الشراء (سطور الاستلام ذات التكلفة — مستندات PUR-03 واستلامات INV-04 بتكلفة)
بالمتوسط المرجّح أو آخر سعر شراء بحسب سياسة G-03، وتتغيّر مع كل استلام؛ الهامش مشتقٌّ منها ومن سعر
البيع فصلاحيتهما واحدة (`cost_margin_view` في ORG-02) — الشاشة كلها تُحجب لا عمود منها، لأن
التكلفة = السعر ÷ (1 + الهامش). لا هامش من وحدتين مختلفتين (شرطة وطلب ضبط التحويل)؛ الهامش السالب
يُعرض بلونه ولا يُحكم عليه؛ بلا مستند شراء «لا تكلفة بعد» بأعمدة فارغة وبسبب معلَن ومخرج (تكلفة
افتتاحية يدوية تُوسم «يدوية» وتُستبدل بأول مستند حقيقي)؛ وبلا تفعيل وحدة الشراء الداخلي
`phase_locked` بمفتاح في يد المالك الآن ولقطة موسومة «مثال».
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from django.utils import timezone

from catalog.models import Item, ItemUnit
from core import audit, home, org
from core.models import User
from core.org_settings import _settings
from inventory.models import GoodsReceiptLine, PurchaseDocument
from inventory.purchasing import OrderRejected
from sales.margin import cost_policy

SAMPLE_ROWS: list[dict[str, Any]] = [
    {
        "item_name": "سكر ناعم — كيس 1 كجم",
        "method_label": "متوسط مرجّح · 3 مستندات",
        "cost_minor": "5300",
        "sale_price_minor": "6500",
        "margin_bps": 1846,
        "note": "example",
    },
    {
        "item_name": "أرز بسمتي 5 كجم",
        "method_label": "متوسط مرجّح · 5 مستندات",
        "cost_minor": "3600",
        "sale_price_minor": "4200",
        "margin_bps": 1429,
        "note": "example",
    },
    {
        "item_name": "خبز صامولي",
        "method_label": "آخر سعر شراء",
        "cost_minor": "110",
        "sale_price_minor": "100",
        "margin_bps": -1000,
        "note": "example",
    },
]


def can_view(viewer: home.Viewer) -> bool:
    if viewer.is_owner:
        return True
    return org.cell_for(viewer.role_code or "", "cost_margin_view").value == "yes"


def enabled() -> bool:
    """وحدة الشراء الداخلي مفعّلة بمفتاح المالك، أو ضمناً بأول مستند شراء معتمد."""
    st = _settings()
    if bool((st.inventory or {}).get("purchasing_enabled", False)):
        return True
    return PurchaseDocument.objects.filter(status=PurchaseDocument.Status.APPROVED).exists()


def enable(*, actor: User, viewer: home.Viewer) -> None:
    """«فعّل الشراء الداخلي» — زرٌّ حاضر في يد المالك، لا «تواصل مع المبيعات»."""
    if not viewer.is_owner:
        raise OrderRejected("owner_required")
    st = _settings()
    inv = dict(st.inventory or {})
    if inv.get("purchasing_enabled"):
        return
    inv["purchasing_enabled"] = True
    st.inventory = inv
    st.save(update_fields=["inventory", "updated_at"])
    audit.record(
        kind="settings.purchasing_enabled",
        title="تفعيل وحدة الشراء الداخلي",
        actor=actor,
        ref_entity="core.TenantSettings",
    )


def set_manual_cost(*, actor: User, viewer: home.Viewer, item: Item, unit_cost_minor: int) -> None:
    """تكلفة افتتاحية يدوية للوحدة الأساسية — تُوسم «يدوية» وتُستبدل بأول مستند حقيقي."""
    if not can_view(viewer):
        raise OrderRejected("permission_denied")
    if unit_cost_minor < 0:
        raise OrderRejected("cost_invalid", "unit_cost_minor")
    st = _settings()
    inv = dict(st.inventory or {})
    manual = dict(inv.get("manual_costs") or {})
    manual[str(item.id)] = int(unit_cost_minor)
    inv["manual_costs"] = manual
    st.inventory = inv
    st.save(update_fields=["inventory", "updated_at"])
    audit.record(
        kind="inventory.manual_cost",
        title=f"تكلفة افتتاحية يدوية — {item.name}",
        actor=actor,
        detail=str(unit_cost_minor),
        ref_entity="catalog.Item",
        ref_id=item.id,
    )


def _bps(price: int, cost: int) -> int | None:
    if price <= 0:
        return None
    return int((price - cost) * 10000 // price)


def _months_between(a: date, b: date) -> int:
    return max(0, (b.year - a.year) * 12 + (b.month - a.month))


def report(viewer: home.Viewer) -> dict[str, Any]:
    if not can_view(viewer):
        raise OrderRejected("permission_denied", extra={"role_name": viewer.role_name})
    policy = cost_policy() or "weighted_average"
    if not enabled():
        return {
            "state": "phase_locked",
            "policy": policy,
            "can_enable": viewer.is_owner,
            "rows": SAMPLE_ROWS,
            "items_count": 0,
        }
    st = _settings()
    manual: dict[str, Any] = dict((st.inventory or {}).get("manual_costs") or {})
    items = list(
        Item.objects.filter(is_active=True).select_related("base_unit").order_by("name_normalized")
    )
    item_ids = [i.id for i in items]
    units_by_item: dict[uuid.UUID, dict[str, int]] = {}
    for iu in ItemUnit.objects.filter(item_id__in=item_ids).select_related("unit"):
        units_by_item.setdefault(iu.item_id, {})[iu.unit.code] = int(iu.factor_milli)
    lines = list(
        GoodsReceiptLine.objects.filter(
            item_id__in=item_ids, unit_cost_minor__isnull=False, base_qty_milli__gt=0
        )
        .select_related("receipt")
        .order_by("receipt__occurred_at", "receipt__received_at", "id")
    )
    by_item: dict[uuid.UUID, list[GoodsReceiptLine]] = {}
    for ln in lines:
        by_item.setdefault(ln.item_id, []).append(ln)
    doc_numbers = {
        d.receipt_id: d.number
        for d in PurchaseDocument.objects.filter(
            status=PurchaseDocument.Status.APPROVED, receipt_id__isnull=False
        )
    }
    today = timezone.localdate()
    rows: list[dict[str, Any]] = []
    any_cost = False
    for it in items:
        price = int(it.sale_price_minor)
        lns = by_item.get(it.id, [])
        row: dict[str, Any] = {
            "item_id": str(it.id),
            "item_name": it.name,
            "base_unit_name": it.base_unit.name,
            "sale_price_minor": str(price),
            "cost_minor": "",
            "cost_unit_name": it.base_unit.name,
            "method_label": "",
            "docs_count": 0,
            "margin_bps": None,
            "note": "",
            "note_extra": {},
        }
        if not lns:
            m = manual.get(str(it.id))
            if m is not None:
                any_cost = True
                cost = int(m)
                row.update(
                    {
                        "cost_minor": str(cost),
                        "method_label": "يدوية",
                        "margin_bps": _bps(price, cost),
                        "note": "manual",
                    }
                )
                if (row["margin_bps"] or 0) < 0:
                    row["note"] = "negative"
            rows.append(row)
            continue
        any_cost = True
        # وحدة الاستلام معروفة التحويل؟ وإلا لا هامش من وحدتين
        known = {it.base_unit.code, *units_by_item.get(it.id, {}).keys()}
        last = lns[-1]
        if last.unit_code and last.unit_code not in known:
            row.update(
                {
                    "cost_minor": str(last.unit_cost_minor),
                    "cost_unit_name": last.unit_code,
                    "method_label": _method_label(policy, len(lns)),
                    "docs_count": len(lns),
                    "note": "unit_mismatch",
                }
            )
            rows.append(row)
            continue

        def base_cost(ln: GoodsReceiptLine) -> int:
            return int(ln.unit_cost_minor or 0) * 1000 // max(int(ln.factor_milli), 1)

        def avg(subset: list[GoodsReceiptLine]) -> int:
            if policy == "last_purchase":
                return base_cost(subset[-1])
            c = sum(base_cost(x) * x.base_qty_milli for x in subset)
            q = sum(x.base_qty_milli for x in subset)
            return c // q if q else 0

        cost = avg(lns)
        bps = _bps(price, cost)
        row.update(
            {
                "cost_minor": str(cost),
                "method_label": _method_label(policy, len(lns)),
                "docs_count": len(lns),
                "margin_bps": bps,
            }
        )
        if len(lns) == 1:
            row["note"] = "single_doc"
        elif bps is not None and bps < 0:
            row["note"] = "negative"
        else:
            prev = avg(lns[:-1])
            if cost > prev:
                row["note"] = "cost_rose"
                row["note_extra"] = {
                    "price_moved": bool(
                        it.price_updated_at and it.price_updated_at >= last.receipt.received_at
                    ),
                    "document_number": doc_numbers.get(
                        last.receipt_id, last.receipt.receipt_number
                    ),
                    "previous_margin_bps": _bps(price, prev),
                    "since": last.receipt.occurred_at.isoformat().replace("+00:00", "Z"),
                }
            else:
                # مستقرّ منذ آخر تغيّر في التكلفة
                changed_at = lns[0].receipt.occurred_at
                for i in range(len(lns) - 1, 0, -1):
                    if base_cost(lns[i]) != base_cost(lns[i - 1]):
                        changed_at = lns[i].receipt.occurred_at
                        break
                row["note"] = "stable"
                row["note_extra"] = {
                    "months": _months_between(timezone.localtime(changed_at).date(), today)
                }
        rows.append(row)
    return {
        "state": "ready" if any_cost else "empty",
        "policy": policy,
        "can_enable": viewer.is_owner,
        "rows": rows,
        "items_count": len(rows),
    }


def _method_label(policy: str, n: int) -> str:
    if n == 1:
        return "مستند واحد"
    if policy == "last_purchase":
        return "آخر سعر شراء"
    return f"متوسط مرجّح · {n} مستندات"
