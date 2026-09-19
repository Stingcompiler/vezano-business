"""REP-05 — الهامش والمقارنة بين الفروع (07-D3 phase_locked · 16-D11 empty · 36-D28 ready/
permission_denied؛ G-03، ACC-90؛ §٧.٧، §١٤.١): «نمتنع عن الرقم بدل تخمينه». الهامش = البيع ناقص
التكلفة، والتكلفة تحتاج سياسة معتمدة (آخر شراء أم متوسط مرجَّح) مكتوبة في رأس التقرير؛ بلا سياسة
`phase_locked` بعمود مبيعات دقيق وحده؛ وبسياسة لكن بأصناف مبيعة بلا تكلفة مسجَّلة `empty` بما ينقص
وكيف يُستكمل — لا رقم مبني على سعر افتراضي. المقارنة بين الفروع بميزة الباقة `branch_compare`."""

from __future__ import annotations

import uuid
from typing import Any

from django.db.models import Count, Sum
from django.utils import timezone

from core import home
from core.models import Branch
from core.org_settings import _settings
from core.subscription import has_feature
from inventory.models import GoodsReceiptLine
from sales.models import Sale, SaleLine
from sales.reports import Range

POLICY_LABELS = {
    "last_purchase": "آخر سعر شراء",
    "weighted_average": "المتوسط المرجَّح من مستندات الشراء",
}


def cost_policy() -> str:
    return str((_settings().inventory or {}).get("cost_policy", "") or "")


def _unit_costs(policy: str, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """تكلفة الوحدة الأساسية (بأجزاء الألف من الوحدة) لكل صنف من سطور الاستلام ذات التكلفة."""
    lines = (
        GoodsReceiptLine.objects.filter(item_id__in=item_ids, unit_cost_minor__isnull=False)
        .select_related("receipt")
        .order_by("receipt__occurred_at", "id")
    )
    out: dict[uuid.UUID, int] = {}
    acc: dict[uuid.UUID, tuple[int, int]] = {}
    for ln in lines:
        if ln.base_qty_milli <= 0 or ln.unit_cost_minor is None:
            continue
        # تكلفة الوحدة الأساسية = تكلفة وحدة الاستلام ÷ معاملها
        base_cost_milli = ln.unit_cost_minor * 1000 * 1000 // max(int(ln.factor_milli), 1)
        if policy == "last_purchase":
            out[ln.item_id] = base_cost_milli
        else:
            c, q = acc.get(ln.item_id, (0, 0))
            acc[ln.item_id] = (c + base_cost_milli * ln.base_qty_milli, q + ln.base_qty_milli)
    if policy != "last_purchase":
        for iid, (c, q) in acc.items():
            out[iid] = c // q if q else 0
    return out


def margin_report(*, viewer: home.Viewer, rng: Range) -> dict[str, Any]:
    policy = cost_policy()
    compare = has_feature("branch_compare")
    sales = Sale.objects.filter(
        business_date__gte=rng.start, business_date__lte=rng.end, reversals__isnull=True
    )
    if not compare and viewer.branch is not None:
        sales = sales.filter(branch_id=viewer.branch.id)
    by_branch = {
        str(r["branch_id"]): int(r["s"] or 0)
        for r in sales.values("branch_id").annotate(s=Sum("total_minor"))
    }
    branches = {str(b.id): b.name for b in Branch.objects.order_by("name")}
    base = {
        "scope": "all" if compare else "branch",
        "branch_compare": compare,
        "range": {
            "key": rng.key,
            "start": rng.start.isoformat(),
            "end": rng.end.isoformat(),
            "label": rng.label,
        },
        "policy": policy,
        "policy_label": POLICY_LABELS.get(policy, ""),
        "computed_at": timezone.now().isoformat().replace("+00:00", "Z"),
        "sales_by_branch": [
            {"id": bid, "name": branches.get(bid, ""), "sales_minor": str(v)}
            for bid, v in sorted(by_branch.items(), key=lambda kv: branches.get(kv[0], ""))
        ],
    }
    if policy not in POLICY_LABELS:
        return {**base, "state": "phase_locked", "rows": [], "groups": [], "missing": None}
    lines = SaleLine.objects.filter(sale__in=sales)
    sold = {
        r["item_id"]: (int(r["q"] or 0), int(r["t"] or 0), int(r["n"] or 0))
        for r in lines.values("item_id").annotate(
            q=Sum("qty_milli"), t=Sum("line_total_minor"), n=Count("id")
        )
    }
    costs = _unit_costs(policy, list(sold))
    uncosted = [iid for iid in sold if iid not in costs]
    if uncosted:
        from catalog.models import Item

        names = {i.id: i.name for i in Item.objects.filter(id__in=uncosted)}
        top = sorted(uncosted, key=lambda i: -sold[i][1])[:5]
        return {
            **base,
            "state": "empty",
            "rows": [],
            "groups": [],
            "missing": {
                "uncosted_items": len(uncosted),
                "sold_items": len(sold),
                "top_uncosted": [
                    {"item_id": str(i), "name": names.get(i, ""), "sales_minor": str(sold[i][1])}
                    for i in top
                ],
            },
        }
    # كل المبيع له تكلفة: الهامش بالفرع وبالمجموعة
    from catalog.models import Item

    groups = {
        i.id: (i.group.name if i.group_id else "بلا مجموعة")
        for i in Item.objects.filter(id__in=list(sold)).select_related("group")
    }
    per_branch: dict[str, dict[str, int]] = {}
    per_group: dict[str, dict[str, int]] = {}
    for r in lines.values("item_id", "sale__branch_id").annotate(
        q=Sum("qty_milli"), t=Sum("line_total_minor")
    ):
        iid = r["item_id"]
        q, t = int(r["q"] or 0), int(r["t"] or 0)
        cost = costs[iid] * q // 1000 // 1000
        b = per_branch.setdefault(str(r["sale__branch_id"]), {"sales": 0, "cost": 0})
        b["sales"] += t
        b["cost"] += cost
        g = per_group.setdefault(groups.get(iid, "بلا مجموعة"), {"sales": 0, "cost": 0})
        g["sales"] += t
        g["cost"] += cost

    def row(name: str, v: dict[str, int], bid: str = "") -> dict[str, Any]:
        margin = v["sales"] - v["cost"]
        pct = (margin * 10000 + v["sales"] // 2) // v["sales"] if v["sales"] else 0
        return {
            "id": bid,
            "name": name,
            "sales_minor": str(v["sales"]),
            "cost_minor": str(v["cost"]),
            "margin_minor": str(margin),
            "margin_bp": pct,  # بالنقاط الأساسية: 3250 = 32.50%
        }

    return {
        **base,
        "state": "ready",
        "rows": [
            row(branches.get(bid, ""), v, bid)
            for bid, v in sorted(per_branch.items(), key=lambda kv: branches.get(kv[0], ""))
        ],
        "groups": [
            row(name, v) for name, v in sorted(per_group.items(), key=lambda kv: -kv[1]["sales"])
        ],
        "missing": None,
    }
