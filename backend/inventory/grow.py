"""GROW-01/GROW-02 (M4 — T3.27): اقتراح إعادة التوريد — رأيٌ يُعرَض بسببه، لا شراء نيابةً عنك؛
وتحليلات المورد — ثلاثة أرقام من مستندات حقيقية في نطاقك بلا درجة إجمالية. تُحسب ليلاً
(`manage.py grow_compute`) وتُقرأ بختمها الزمني. خلف علم `market_m4` من PLT-12."""

from __future__ import annotations

import math
import os
import uuid
from collections import defaultdict
from datetime import timedelta
from typing import Any

from django.db.models import Q, Sum
from django.utils import timezone

from catalog.models import Item
from core import audit, home
from core.models import Branch, User
from core.subscription import ensure_subscription
from core.tenancy import platform_context, require_tenant
from inventory import purchasing
from inventory.models import (
    GrowSnapshot,
    PurchaseDocument,
    PurchaseDocumentLine,
    PurchaseOrder,
    PurchaseReturn,
    StockMovement,
)
from inventory.services import branch_balances
from parties.models import Party

M4_FLAG = "market_m4"
SAFETY_DAYS = 5
SALES_WINDOW_DAYS = 30
ANALYTICS_MONTHS = 6
ON_TIME_DAYS = 3
MIN_DOCS = 5
NEXT_CHECK_LABEL = "غداً 6 ص"
NO_NEED_LINE = "لا حاجة الآن. يظهر في القائمة لأنه يشارك المورد نفسه — ضمّه يوفّر شحنة مستقلة لاحقاً."


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


class GrowRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code, self.field, self.extra = code, field, extra or {}


def m4_enabled() -> bool:
    from stingops.models import OpsFlag

    plan_code = ensure_subscription().plan_code
    env = os.environ.get("STING_ENV", "")
    with platform_context():
        return OpsFlag.objects.filter(
            Q(key=M4_FLAG, scope_kind="env", scope=env, enabled=True)
            | Q(key=M4_FLAG, scope_kind="plan", scope=plan_code, enabled=True)
        ).exists()


def require_m4() -> None:
    if not m4_enabled():
        raise GrowRejected("phase_locked", "", {"phase": "M4"})


def _default_branch(viewer: home.Viewer) -> Branch:
    if viewer.branch is not None:
        return viewer.branch
    b: Branch | None = (
        Branch.objects.filter(is_default=True).first() or Branch.objects.order_by("code").first()
    )
    if b is None:
        raise GrowRejected("branch_required")
    return b


# ------------------------------------------------------------------ GROW-01 اقتراح التوريد
def _unit_words(n: float, unit_name: str) -> str:
    q = int(n) if float(n).is_integer() else n
    return f"{q} {unit_name}"


def _days_word(d: int) -> str:
    if d <= 0:
        return "نفد"
    if d == 1:
        return "يوم"
    if d == 2:
        return "يومان"
    if d <= 10:
        return f"{d} أيام"
    return f"{d} يوماً"


def _supplier_for_items(item_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    """آخر مورد وحدة شراء وسعر لكل صنف من مستندات الشراء المعتمدة."""
    out: dict[uuid.UUID, dict[str, Any]] = {}
    for ln in (
        PurchaseDocumentLine.objects.filter(
            item_id__in=item_ids, document__status=PurchaseDocument.Status.APPROVED
        )
        .select_related("document")
        .order_by("document__approved_at", "id")
    ):
        out[ln.item_id] = {
            "supplier_id": str(ln.document.supplier_id),
            "supplier_name": ln.document.supplier_name,
            "unit_code": ln.unit_code,
            "unit_name": ln.unit_name or ln.unit_code,
            "factor_milli": int(ln.factor_milli),
            "price_minor": int(ln.unit_price_minor),
        }
    return out


def _lead_days_by_supplier() -> dict[str, float | None]:
    """مهلة التوريد = متوسط الأيام بين إرسال أمر الشراء واعتماد مستنده — من التاريخ لا من وعد."""
    samples: dict[str, list[float]] = defaultdict(list)
    for d in PurchaseDocument.objects.filter(
        status=PurchaseDocument.Status.APPROVED, order__isnull=False, order__sent_at__isnull=False
    ).select_related("order"):
        if d.approved_at and d.order and d.order.sent_at:
            samples[str(d.supplier_id)].append(
                (d.approved_at - d.order.sent_at).total_seconds() / 86400
            )
    return {k: (sum(v) / len(v)) for k, v in samples.items()}


def compute_replenish(branch: Branch) -> dict[str, Any]:
    """كل رقم في الاقتراح يقول من أين جاء: متوسط بيع 30 يوماً، مهلة من التاريخ، أمان 5 أيام."""
    now = timezone.now()
    items = list(Item.objects.filter(is_active=True).select_related("base_unit").order_by("name"))
    ids = [i.id for i in items]
    since = now - timedelta(days=SALES_WINDOW_DAYS)
    out_by_item = {
        row["item_id"]: -int(row["s"] or 0)
        for row in StockMovement.objects.filter(
            branch=branch, item_id__in=ids, occurred_at__gte=since, reason="sale"
        )
        .values("item_id")
        .annotate(s=Sum("delta_base_qty_milli"))
    }
    balances = branch_balances(branch.id)
    suppliers = _supplier_for_items(ids)
    leads = _lead_days_by_supplier()
    rows: list[dict[str, Any]] = []
    for it in items:
        daily = out_by_item.get(it.id, 0) / SALES_WINDOW_DAYS  # بالألف من وحدة الأساس
        stock = int(balances.get(it.id, 0))
        sup = suppliers.get(it.id)
        days_left = int(stock / daily) if daily > 0 and stock > 0 else (0 if stock <= 0 else None)
        lead = leads.get(sup["supplier_id"]) if sup else None
        lead_days = math.ceil(lead) if lead is not None else None
        need_base = 0
        suggested = 0
        basis = ""
        if sup is None:
            basis = (
                f"نفد منذ {_days_word(_days_since_out(branch, it.id, now))} ولا مورد مرتبط به. "
                "لا نقترح كمية لصنف لا نعرف من يورّده ولا مهلته."
                if stock <= 0
                else "لا مورد مرتبط بهذا الصنف في مستندات الشراء — لا نقترح كمية بلا مورد ومهلة."
            )
        else:
            horizon = (lead_days if lead_days is not None else 0) + SAFETY_DAYS
            need_base = max(0, int(math.ceil(daily * horizon)) - stock)
            factor = max(1, int(sup["factor_milli"]))
            suggested = math.ceil(need_base / factor) if need_base > 0 else 0
            covers = int((stock + suggested * factor) / daily) if daily > 0 else None
            daily_units = daily / 1000
            daily_txt = f"{daily_units:g}" if daily_units else "0"
            basis = (
                f"بيع {daily_txt} {it.base_unit.name} يومياً في آخر {SALES_WINDOW_DAYS} يوماً · "
                + (
                    f"مهلة {_days_word(lead_days)}"
                    if lead_days is not None
                    else "مهلة غير معروفة (لا أمر شراء سابق)"
                )
                + f" · أمان {SAFETY_DAYS} أيام."
                + (
                    f" المقترح يغطي {_days_word(covers)}."
                    if suggested and covers is not None
                    else ""
                )
            )
            if suggested == 0 and daily > 0:
                basis = NO_NEED_LINE
        rows.append(
            {
                "item_id": str(it.id),
                "item_name": it.name,
                "base_unit_name": it.base_unit.name,
                "stock_milli": str(stock),
                "stock_label": _unit_words(stock / 1000, it.base_unit.name) if stock > 0 else "نفد",
                "days_left": days_left,
                "days_left_label": _days_word(days_left) if days_left is not None else "—",
                "supplier_id": sup["supplier_id"] if sup else "",
                "supplier_name": sup["supplier_name"] if sup else "مورد غير محدَّد",
                "lead_days": lead_days,
                "supplier_line": (
                    f"{sup['supplier_name']} · مهلة {_days_word(lead_days)}"
                    if sup and lead_days is not None
                    else sup["supplier_name"]
                    if sup
                    else "مورد غير محدَّد"
                ),
                "unit_code": sup["unit_code"] if sup else "",
                "unit_name": sup["unit_name"] if sup else "",
                "factor_milli": str(sup["factor_milli"]) if sup else "1000",
                "suggested": suggested,
                "suggested_label": _unit_words(suggested, sup["unit_name"])
                if sup and suggested
                else "—",
                "need": suggested > 0,
                "basis": basis,
                "daily_milli": str(int(daily)),
            }
        )
    # الأصناف التي لا تحتاج تُعرض فقط إن شاركت مورداً يحتاج صنفٌ آخر منه (توفير شحنة)
    need_suppliers = {r["supplier_id"] for r in rows if r["need"]}
    shown = [
        r
        for r in rows
        if r["need"]
        or (r["supplier_id"] and r["supplier_id"] in need_suppliers)
        or (not r["supplier_id"] and int(r["stock_milli"]) <= 0)
    ]
    return {
        "computed_at": _iso(now),
        "branch_id": str(branch.id),
        "branch_name": branch.name,
        "checked_count": len(items),
        "rows": shown,
        "need_count": sum(1 for r in shown if r["need"]),
        "safety_days": SAFETY_DAYS,
        "next_check": NEXT_CHECK_LABEL,
    }


def _days_since_out(branch: Branch, item_id: uuid.UUID, now: Any) -> int:
    last = (
        StockMovement.objects.filter(branch=branch, item_id=item_id)
        .order_by("-occurred_at")
        .first()
    )
    return max(0, (now - last.occurred_at).days) if last else 0


def _snapshot(kind: str, branch: Branch | None) -> GrowSnapshot | None:
    qs = GrowSnapshot.objects.filter(kind=kind)
    qs = qs.filter(branch=branch) if branch is not None else qs.filter(branch__isnull=True)
    return qs.order_by("-computed_at").first()


def store_snapshot(kind: str, branch: Branch | None, payload: dict[str, Any]) -> GrowSnapshot:
    snap: GrowSnapshot = GrowSnapshot.objects.create(
        tenant_id=require_tenant(), kind=kind, branch=branch, payload=payload
    )
    GrowSnapshot.objects.filter(kind=kind, branch=branch).exclude(id=snap.id).delete()
    return snap


def replenish_payload(viewer: home.Viewer, *, compute_now: bool = False) -> dict[str, Any]:
    """أمين المخزن يرى الاقتراح — هو أدرى بما على الرفّ — ولا يحوّله (`permission_denied` بالصفوف
    والقيمة محجوبة كما في PUR-01)؛ الكاشير لا يراه أصلاً (بلا صفوف)."""
    if not purchasing.can_view(viewer):
        return {"state": "permission_denied", "role_name": viewer.role_name}
    if not m4_enabled():
        return {"state": "phase_locked"}
    branch = _default_branch(viewer)
    snap = _snapshot(GrowSnapshot.Kind.REPLENISH, branch)
    if snap is None or compute_now:
        snap = store_snapshot(GrowSnapshot.Kind.REPLENISH, branch, compute_replenish(branch))
    p = dict(snap.payload)
    can_convert = purchasing.can_create(viewer)
    state = (
        "permission_denied"
        if not can_convert
        else "empty"
        if p.get("need_count", 0) == 0
        else "ready"
    )
    return {
        "state": state,
        "computed_at": _iso(snap.computed_at),
        "can_convert": can_convert,
        "value_hidden": not can_convert,
        "ask_name": "" if can_convert else purchasing.owner_name(),
        "role_name": viewer.role_name,
        **p,
    }


def forward_suggestion(*, actor: User, viewer: home.Viewer, body: dict[str, Any]) -> dict[str, Any]:
    """«أرسل الاقتراح إلى ندى» — أمين المخزن يرسل الاقتراح بملاحظاته على الكميات موسومةً باسمه؛
    لا أمر شراء يُنشأ."""
    require_m4()
    if not purchasing.can_view(viewer):
        raise GrowRejected("permission_denied")
    branch = _default_branch(viewer)
    snap = _snapshot(GrowSnapshot.Kind.REPLENISH, branch)
    if snap is None:
        raise GrowRejected("not_computed")
    raw_lines: list[Any] = (
        list(body.get("lines") or []) if isinstance(body.get("lines"), list) else []
    )
    lines = [
        {
            "item_id": str(x.get("item_id") or ""),
            "unit_code": str(x.get("unit_code") or ""),
            "qty_milli": str(int(str(x.get("qty_milli") or "0"))),
        }
        for x in raw_lines
        if x.get("item_id")
    ]
    note = str(body.get("note") or "").strip()
    entry = {
        "by_name": actor.display_name,
        "at": _iso(timezone.now()),
        "note": note,
        "lines": lines,
        "to_name": purchasing.owner_name(),
    }
    payload = dict(snap.payload)
    payload["forwards"] = [entry, *list(payload.get("forwards") or [])][:5]
    snap.payload = payload
    snap.save(update_fields=["payload"])
    audit.record(
        kind="grow.forwarded",
        title=f"اقتراح توريد مُرسَل إلى {entry['to_name'] or 'المالك'}",
        actor=actor,
        actor_role=viewer.role_name,
        branch=branch,
        detail=f"{len(lines)} تعديلات على الكميات · {note}" if note else f"{len(lines)} تعديلات",
        ref_entity="inventory.GrowSnapshot",
        ref_id=snap.id,
    )
    return entry


def order_from_selection(
    *, actor: User, viewer: home.Viewer, body: dict[str, Any]
) -> PurchaseOrder:
    """الاقتراح يصير أمر شراء (PUR-02) باختيار صريح والكميات قابلة للتعديل — لا شيء يُطلب حتى
    تختار."""
    require_m4()
    if not purchasing.can_create(viewer):
        raise GrowRejected("permission_denied")
    raw_lines = body.get("lines") if isinstance(body.get("lines"), list) else []
    if not raw_lines:
        raise GrowRejected("lines_required", "lines")
    supplier_id = str(body.get("supplier_id") or "").strip()
    if not supplier_id:
        raise GrowRejected("supplier_required", "supplier_id")
    if not Party.objects.filter(id=supplier_id).exists():
        raise GrowRejected("supplier_unknown", "supplier_id")
    branch = _default_branch(viewer)
    try:
        return purchasing.create(
            actor=actor,
            viewer=viewer,
            branch=branch,
            supplier_id=uuid.UUID(supplier_id),
            raw_lines=[
                {
                    "item_id": str(x.get("item_id") or ""),
                    "qty_milli": str(int(str(x.get("qty_milli") or "0"))),
                    "unit_code": str(x.get("unit_code") or ""),
                }
                for x in raw_lines
            ],
            note="من اقتراح إعادة التوريد — كميات اختارها المستخدم",
            confirmed=True,
        )
    except purchasing.OrderRejected as e:
        raise GrowRejected(e.code, e.field, e.extra) from e


# ------------------------------------------------------------------ GROW-02 تحليلات المورد
def compute_suppliers() -> dict[str, Any]:
    """ثلاثة أرقام لا أكثر، من مستندات 6 أشهر: في موعده = اعتُمد خلال 3 أيام من إرسال الأمر."""
    now = timezone.now()
    since = now - timedelta(days=30 * ANALYTICS_MONTHS)
    docs = list(
        PurchaseDocument.objects.filter(
            status=PurchaseDocument.Status.APPROVED, approved_at__gte=since
        )
        .select_related("order")
        .order_by("-approved_at")
    )
    returns_by_doc: dict[str, list[PurchaseReturn]] = defaultdict(list)
    for r in PurchaseReturn.objects.filter(created_at__gte=since).select_related("document"):
        returns_by_doc[str(r.document_id)].append(r)
    by_supplier: dict[str, list[PurchaseDocument]] = defaultdict(list)
    for d in docs:
        by_supplier[str(d.supplier_id)].append(d)
    suppliers: list[dict[str, Any]] = []
    for sid, ds in by_supplier.items():
        name = ds[0].supplier_name
        with_order = [d for d in ds if d.order is not None and d.order.sent_at and d.approved_at]
        on_time = 0
        delays: list[float] = []
        rows = []
        prices: dict[tuple[uuid.UUID, str], set[int]] = defaultdict(set)
        for d in ds:
            for ln in d.lines.all():
                prices[(ln.item_id, ln.unit_code)].add(int(ln.unit_price_minor))
        moved = [k for k, v in prices.items() if len(v) > 1]
        for d in ds:
            late_days = None
            if d.order is not None and d.order.sent_at and d.approved_at:
                late_days = max(0, (d.approved_at - d.order.sent_at).days - ON_TIME_DAYS)
                if late_days == 0:
                    on_time += 1
                else:
                    delays.append(late_days)
            rets = returns_by_doc.get(str(d.id), [])
            short = (
                any(ln.received_qty_milli < ln.ordered_qty_milli for ln in d.lines.all())
                if d.order
                else False
            )
            label = "متأخر" if late_days else "مرتجع" if rets else "مطابق"
            parts = [
                (
                    f"استُلم بعد {_days_word(late_days + ON_TIME_DAYS)}"
                    if late_days
                    else "استُلم في موعده"
                )
                if late_days is not None
                else "بلا أمر شراء",
            ]
            if short:
                parts.append("نقص في الكمية")
            if rets:
                first_line = rets[0].lines.first()
                parts.append(f"مرتجع {first_line.item_name if first_line else ''}".strip())
            if not short and not rets:
                parts.append("مطابق للأمر" if d.order is not None else "مطابق")
            rows.append(
                {
                    "document_id": str(d.id),
                    "number": f"PD-{d.number}",
                    "approved_at": _iso(d.approved_at),
                    "summary": " · ".join(parts),
                    "label": label,
                }
            )
        n = len(ds)
        enough = n >= MIN_DOCS
        avg_delay = (sum(delays) / len(delays)) if delays else 0
        suppliers.append(
            {
                "supplier_id": sid,
                "supplier_name": name,
                "documents": n,
                "months": ANALYTICS_MONTHS,
                "enough": enough,
                "on_time": on_time,
                "with_order": len(with_order),
                "on_time_line": (
                    f"{on_time} من {len(with_order)} في موعدها · "
                    f"متوسط التأخير {_days_word(int(round(avg_delay)))}"
                    if delays
                    else f"{on_time} من {len(with_order)} في موعدها"
                )
                if with_order
                else "لا أوامر شراء مرسلة — لا يُقاس الالتزام",
                "returns": sum(
                    len(v) for k, v in returns_by_doc.items() if any(str(d.id) == k for d in ds)
                ),
                "returns_line": _returns_line(ds, returns_by_doc),
                "price_moves": len(moved),
                "price_line": (
                    f"{len(moved)} أصناف تحرّك سعرها · البقية ثابتة" if moved else "الأسعار ثابتة"
                ),
                "recent": rows[:5],
                "min_docs": MIN_DOCS,
            }
        )
    suppliers.sort(key=lambda s: -int(str(s["documents"])))
    return {"computed_at": _iso(now), "suppliers": suppliers}


def _returns_line(
    ds: list[PurchaseDocument], returns_by_doc: dict[str, list[PurchaseReturn]]
) -> str:
    rets = [r for d in ds for r in returns_by_doc.get(str(d.id), [])]
    if not rets:
        return "لا مرتجعات"
    reasons: dict[str, int] = defaultdict(int)
    for r in rets:
        for ln in r.lines.all():
            reasons[ln.reason or "بلا سبب"] += 1
    top = max(reasons.items(), key=lambda kv: kv[1])[0] if reasons else ""
    n = len(rets)
    word = (
        "مرتجع واحد"
        if n == 1
        else "مرتجعان"
        if n == 2
        else f"{n} مرتجعات"
        if n <= 10
        else f"{n} مرتجعاً"
    )
    return f"{word} · أغلبها «{top}»" if top else word


def suppliers_payload(viewer: home.Viewer, *, compute_now: bool = False) -> dict[str, Any]:
    if not purchasing.can_view(viewer):
        return {"state": "permission_denied", "role_name": viewer.role_name}
    if not m4_enabled():
        return {"state": "phase_locked"}
    snap = _snapshot(GrowSnapshot.Kind.SUPPLIERS, None)
    if snap is None or compute_now:
        snap = store_snapshot(GrowSnapshot.Kind.SUPPLIERS, None, compute_suppliers())
    p = dict(snap.payload)
    newer = list(
        PurchaseDocument.objects.filter(
            status=PurchaseDocument.Status.APPROVED, approved_at__gt=snap.computed_at
        ).values_list("number", flat=True)[:3]
    )
    stale = bool(newer) or (timezone.now() - snap.computed_at) > timedelta(hours=24)
    suppliers = p.get("suppliers", [])
    state = "stale" if stale else "empty" if not any(s["enough"] for s in suppliers) else "ready"
    return {
        "state": state,
        "computed_at": _iso(snap.computed_at),
        "newer_documents": [f"PD-{n}" for n in newer],
        **p,
    }


def compute_all_for_tenant(branches: list[Branch]) -> None:
    """يستدعيه الأمر الليلي `grow_compute` داخل سياق كل مستأجر."""
    for b in branches:
        store_snapshot(GrowSnapshot.Kind.REPLENISH, b, compute_replenish(b))
    store_snapshot(GrowSnapshot.Kind.SUPPLIERS, None, compute_suppliers())


def log_compute(actor: User | None, kind: str) -> None:
    if actor is not None:
        audit.record(
            kind="grow.computed",
            title=f"إعادة حساب {kind}",
            actor=actor,
            detail="عند الطلب — الحساب الاعتيادي ليلاً",
        )
