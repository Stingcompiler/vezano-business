"""LINK-03/04/05 (M3 — T3.26): تحويل استلام شحنة سوق إلى مستند شراء في دفتري بمعاينة الأثر
ومصدر واحد لا تكرار (ACC-130)؛ روابط المستندات والفرق بين دفترين مستقلّين بلا «رقم صحيح»؛
والمرتجع إلى مستند عكسي بالكمية المتفَق عليها فقط (ACC-132). خلف علم `market_m3`."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from catalog.models import Item, ItemUnit
from core import audit, home
from core.models import Branch, User
from core.tenancy import platform_context, require_tenant
from inventory import purchase_docs
from inventory.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    PurchaseDocument,
    PurchaseDocumentLine,
)
from inventory.purchasing import OrderRejected, can_create
from market.link import linked_counterparties, m3_enabled, mapping_for, require_m3
from market.models import (
    MarketDocumentLink,
    MarketPartyLink,
    MarketPayment,
    MarketReturn,
    MarketShipment,
    MarketShipmentDistinct,
)
from market.order_flow import _agreed_lines
from market.services import MarketRejected

DUPLICATE_WINDOW_DAYS = 3
PAYMENT_PATH = (
    "أثبتت دفعاً لم يسجّله المورد بعد. الإيصال لا يعني تحصيلاً — يبقى معلّقاً للمطابقة بلا خصم من ذمّتك."
)


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _link_for_supplier(supplier_tenant_id: Any) -> MarketPartyLink | None:
    return MarketPartyLink.objects.filter(
        counterparty_tenant_id=supplier_tenant_id, status=MarketPartyLink.Status.ACCEPTED
    ).first()


def _my_unit_factor(item: Item, unit_code: str) -> int:
    if unit_code == item.base_unit.code:
        return 1000
    iu = ItemUnit.objects.filter(item=item, unit__code=unit_code).first()
    return int(iu.factor_milli) if iu else 1000


def _default_branch(viewer: home.Viewer) -> Branch:
    if viewer.branch is not None:
        return viewer.branch
    b: Branch | None = (
        Branch.objects.filter(is_default=True).first() or Branch.objects.order_by("code").first()
    )
    if b is None:
        raise MarketRejected("branch_required")
    return b


# ------------------------------------------------------------------ LINK-03 التحويل
def _shipment_rows(sh: MarketShipment) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """سطور الشحنة المستلَمة بمطابقتها: (السطور المطابَقة، الأصناف بلا مطابقة)."""
    o = sh.order
    agreed = _agreed_lines(o)
    rows: list[dict[str, Any]] = []
    unmapped: list[dict[str, Any]] = []
    for ln in sh.received_lines:
        oid = str(ln.get("offer_id"))
        received = int(
            ln.get("received") if ln.get("received") is not None else ln.get("qty_received") or 0
        )
        if received <= 0:
            continue
        a = agreed.get(oid) or {}
        base_line: dict[str, Any] = next((x for x in o.lines if str(x.get("offer_id")) == oid), {})
        price = int(a.get("price_minor") or base_line.get("price_minor") or 0)
        name = str(
            base_line.get("public_name") or a.get("public_name") or ln.get("public_name") or ""
        )
        supplier_unit = str(base_line.get("unit_name") or a.get("unit_name") or "")
        m = mapping_for(o.supplier_tenant_id, oid)
        if m is None:
            unmapped.append(
                {"offer_id": oid, "name": name, "unit_name": supplier_unit, "qty": received}
            )
            continue
        item = Item.objects.filter(id=m.item_id).select_related("base_unit").first()
        if item is None:
            unmapped.append(
                {"offer_id": oid, "name": name, "unit_name": supplier_unit, "qty": received}
            )
            continue
        my_factor = _my_unit_factor(item, m.unit_code)
        base_per_supplier_unit = m.factor_milli * my_factor // 1000  # بالألف من وحدة الأساس
        rows.append(
            {
                "offer_id": oid,
                "offer_name": name,
                "supplier_unit": supplier_unit or m.offer_unit_name,
                "received": received,
                "shipped": int(
                    next((x.get("qty") for x in sh.lines if str(x.get("offer_id")) == oid), 0) or 0
                ),
                "price_minor": price,
                "item_id": str(item.id),
                "item_name": item.name,
                "unit_code": m.unit_code,
                "unit_name": m.unit_name,
                "factor_milli": m.factor_milli,
                "base_per_supplier_unit_milli": base_per_supplier_unit,
                "my_qty_milli": received * m.factor_milli,
                "base_qty_milli": received * base_per_supplier_unit,
                "value_minor": received * price,
            }
        )
    return rows, unmapped


def _duplicate_receipts(sh: MarketShipment, rows: list[dict[str, Any]]) -> list[GoodsReceipt]:
    """استلام يدوي بنفس الكميات (بوحدة الأساس) وتاريخ قريب — نوقف ونعرض المستندين."""
    if not rows or sh.received_at is None:
        return []
    window = (
        sh.received_at - timedelta(days=DUPLICATE_WINDOW_DAYS),
        sh.received_at + timedelta(days=DUPLICATE_WINDOW_DAYS),
    )
    wanted = {r["item_id"]: r["base_qty_milli"] for r in rows}
    dismissed = set(
        str(x)
        for x in MarketShipmentDistinct.objects.filter(shipment=sh).values_list(
            "receipt_id", flat=True
        )
    )
    linked_ids = set(
        str(x)
        for x in MarketDocumentLink.objects.filter(
            local_entity="inventory.GoodsReceipt"
        ).values_list("local_id", flat=True)
    )
    out = []
    for rc in GoodsReceipt.objects.filter(occurred_at__range=window).exclude(
        receipt_number__startswith="PD-"
    ):
        if str(rc.id) in dismissed or str(rc.id) in linked_ids:
            continue
        got = {
            str(x.item_id): int(x.base_qty_milli)
            for x in GoodsReceiptLine.objects.filter(receipt=rc)
        }
        if all(got.get(k) == v for k, v in wanted.items()):
            out.append(rc)
    return out


def receipt_row(sh: MarketShipment, link: MarketDocumentLink | None) -> dict[str, Any]:
    o = sh.order
    return {
        "shipment_id": str(sh.id),
        "ref_label": f"SH-{sh.number:02d}",
        "order_id": str(o.id),
        "order_label": f"ORD-{o.number}",
        "supplier_name": o.supplier_name,
        "received_at": _iso(sh.received_at),
        "received_by_name": sh.received_by_name,
        "converted": link is not None,
        "local_number": link.local_number if link else "",
        "mode": link.mode if link else "",
    }


def receipts_payload(viewer: home.Viewer) -> dict[str, Any]:
    """الشحنات المستلَمة من منشآت مربوطة، بحالة تحويلها."""
    cps = {str(x.counterparty_tenant_id) for x in linked_counterparties()}
    me = require_tenant()
    with platform_context():
        ships = list(
            MarketShipment.unscoped.filter(tenant_id=me, received_at__isnull=False)
            .select_related("order")
            .order_by("-received_at")
        )
    ships = [s for s in ships if str(s.order.supplier_tenant_id) in cps]
    links = {str(x.shipment_id): x for x in MarketDocumentLink.objects.filter(kind="receipt")}
    rows = [receipt_row(s, links.get(str(s.id))) for s in ships]
    return {
        "state": "ready" if m3_enabled() else "phase_locked",
        "can_convert": can_create(viewer),
        "shipments": rows,
        "pending_count": sum(1 for r in rows if not r["converted"]),
    }


def _shipment(shipment_id: uuid.UUID) -> MarketShipment:
    me = require_tenant()
    with platform_context():
        found: MarketShipment | None = (
            MarketShipment.unscoped.filter(id=shipment_id, tenant_id=me)
            .select_related("order")
            .first()
        )
    if found is None:
        raise MarketRejected("not_found")
    if found.received_at is None:
        raise MarketRejected("not_received", "shipment_id")
    sh: MarketShipment = found
    return sh


def preview(*, viewer: home.Viewer, shipment_id: uuid.UUID) -> dict[str, Any]:
    """معاينة الأثر قبل التحويل — لا شيء يحدث قبل الإقرار؛ صنف بلا مطابقة يوقف (لا نُنشئ تلقائياً)."""
    require_m3()
    sh = _shipment(shipment_id)
    o = sh.order
    link = MarketDocumentLink.objects.filter(shipment=sh).first()
    party_link = _link_for_supplier(o.supplier_tenant_id)
    rows, unmapped = _shipment_rows(sh)
    branch = _default_branch(viewer)
    dups = _duplicate_receipts(sh, rows) if not link else []
    return {
        "shipment": receipt_row(sh, link),
        "party_linked": party_link is not None,
        "party_name": party_link.party_name if party_link else "",
        "branch_id": str(branch.id),
        "branch_name": branch.name,
        "lines": rows,
        "unmapped": unmapped,
        "payable_minor": str(sum(r["value_minor"] for r in rows)),
        "state": "converted"
        if link
        else "unmapped"
        if unmapped
        else "duplicate"
        if dups
        else "ready",
        "duplicates": [
            {
                "receipt_id": str(rc.id),
                "receipt_number": rc.receipt_number,
                "occurred_at": _iso(rc.occurred_at),
                "user_name": rc.user_name,
                "lines": [
                    {
                        "item_name": x.item_name,
                        "qty_milli": str(x.qty_milli),
                        "unit_code": x.unit_code,
                    }
                    for x in GoodsReceiptLine.objects.filter(receipt=rc)
                ],
            }
            for rc in dups
        ],
        "link": _doc_link_payload(link) if link else None,
    }


def _doc_link_payload(link: MarketDocumentLink) -> dict[str, Any]:
    return {
        "id": str(link.id),
        "kind": link.kind,
        "kind_label": MarketDocumentLink.Kind(link.kind).label,
        "mode": link.mode,
        "order_id": str(link.order_id),
        "order_label": f"ORD-{link.order.number}",
        "shipment_id": str(link.shipment_id) if link.shipment_id else "",
        "shipment_label": f"SH-{link.shipment.number:02d}" if link.shipment else "",
        "return_id": str(link.market_return_id) if link.market_return_id else "",
        "local_entity": link.local_entity,
        "local_id": str(link.local_id),
        "local_number": link.local_number,
        "my_value_minor": str(link.my_value_minor),
        "their_value_minor": str(link.their_value_minor),
        "created_by_name": link.created_by_name,
        "created_at": _iso(link.created_at),
        "settled_at": _iso(link.settled_at),
        "settled_by_name": link.settled_by_name,
        "settlement_path": link.settlement_path,
        "settlement_note": link.settlement_note,
    }


def convert(
    *, actor: User, viewer: home.Viewer, shipment_id: uuid.UUID, body: dict[str, Any]
) -> MarketDocumentLink:
    """يُنشئ مستند شراء معتمداً من الشحنة المستلَمة — مرة واحدة ولو أُعيد التحويل (ACC-130)؛ أو يربط
    بمستند يدوي قائم (`attach_receipt_id`) فيبقى مستند واحد؛ أو يؤكّد أنهما شحنتان مختلفتان
    (`distinct_receipt_ids`)."""
    require_m3()
    if not can_create(viewer):
        raise MarketRejected("permission_denied")
    sh = _shipment(shipment_id)
    o = sh.order
    existing: MarketDocumentLink | None = (
        MarketDocumentLink.objects.filter(shipment=sh).select_related("order", "shipment").first()
    )
    if existing is not None:
        return existing  # لا أثر مزدوج — الرابط هو الحارس
    party_link = _link_for_supplier(o.supplier_tenant_id)
    if party_link is None:
        raise MarketRejected("party_not_linked", "shipment_id")
    rows, unmapped = _shipment_rows(sh)
    if unmapped:
        raise MarketRejected("unmapped_items", "lines", {"unmapped": unmapped})
    if not rows:
        raise MarketRejected("nothing_received", "shipment_id")
    attach = str(body.get("attach_receipt_id") or "").strip()
    for rid in body.get("distinct_receipt_ids") or []:
        try:
            MarketShipmentDistinct.objects.get_or_create(
                tenant_id=require_tenant(),
                shipment=sh,
                receipt_id=uuid.UUID(str(rid)),
                defaults={"confirmed_by_name": actor.display_name},
            )
        except ValueError as e:
            raise MarketRejected("receipt_invalid", "distinct_receipt_ids") from e
    their_value = sum(
        int(
            next((x.get("qty") for x in sh.lines if str(x.get("offer_id")) == r["offer_id"]), 0)
            or 0
        )
        * r["price_minor"]
        for r in rows
    )
    if attach:
        rc = GoodsReceipt.objects.filter(id=attach).first()
        if rc is None:
            raise MarketRejected("receipt_not_found", "attach_receipt_id")
        link: MarketDocumentLink = MarketDocumentLink.objects.create(
            tenant_id=require_tenant(),
            kind=MarketDocumentLink.Kind.RECEIPT,
            order=o,
            shipment=sh,
            mode=MarketDocumentLink.Mode.ATTACHED,
            local_entity="inventory.GoodsReceipt",
            local_id=rc.id,
            local_number=rc.receipt_number,
            my_value_minor=sum(
                int(x.base_qty_milli) * int(x.unit_cost_minor or 0) // max(1, int(x.factor_milli))
                for x in GoodsReceiptLine.objects.filter(receipt=rc)
            ),
            their_value_minor=their_value,
            created_by_name=actor.display_name,
        )
        audit.record(
            kind="market.shipment_attached",
            title=f"ربط شحنة السوق SH-{sh.number:02d} بمستند الاستلام {rc.receipt_number}",
            actor=actor,
            detail="مستند واحد — لا يُنشأ ثانٍ",
            ref_entity="market.MarketDocumentLink",
            ref_id=link.id,
        )
        return link
    dups = _duplicate_receipts(sh, rows)
    if dups:
        raise MarketRejected(
            "duplicate_receipt",
            "shipment_id",
            {
                "receipts": [
                    {"receipt_id": str(rc.id), "receipt_number": rc.receipt_number} for rc in dups
                ]
            },
        )
    branch = _default_branch(viewer)
    raw_branch = str(body.get("branch_id") or "").strip()
    if raw_branch:
        b = Branch.objects.filter(id=raw_branch).first()
        if b is None:
            raise MarketRejected("branch_not_found", "branch_id")
        branch = b
    with transaction.atomic():
        doc: PurchaseDocument = PurchaseDocument.objects.create(
            tenant_id=require_tenant(),
            number=purchase_docs._doc_number(),
            supplier_id=party_link.party_id,
            supplier_name=party_link.party_name,
            branch=branch,
            supplier_invoice_number=f"SH-{sh.number:02d} / ORD-{o.number}",
            note=f"من شحنة السوق SH-{sh.number:02d} — مصدر واحد معلَن",
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
            total_minor=sum(r["value_minor"] for r in rows),
        )
        for i, r in enumerate(rows, start=1):
            PurchaseDocumentLine.objects.create(
                tenant_id=require_tenant(),
                document=doc,
                item_id=uuid.UUID(r["item_id"]),
                item_name=r["item_name"],
                unit_code=f"mkt:{r['offer_id'][:8]}",
                unit_name=r["supplier_unit"] or "وحدة المورد",
                factor_milli=r["base_per_supplier_unit_milli"],
                ordered_qty_milli=r["shipped"] * 1000,
                received_qty_milli=r["received"] * 1000,
                base_qty_milli=r["base_qty_milli"],
                unit_price_minor=r["price_minor"],
                line_no=i,
            )
        purchase_docs.approve(actor=actor, viewer=viewer, document=doc)
        link = MarketDocumentLink.objects.create(
            tenant_id=require_tenant(),
            kind=MarketDocumentLink.Kind.RECEIPT,
            order=o,
            shipment=sh,
            mode=MarketDocumentLink.Mode.CREATED,
            local_entity="inventory.PurchaseDocument",
            local_id=doc.id,
            local_number=f"PD-{doc.number}",
            my_value_minor=doc.total_minor,
            their_value_minor=their_value,
            created_by_name=actor.display_name,
        )
    audit.record(
        kind="market.shipment_converted",
        title=f"تحويل شحنة السوق SH-{sh.number:02d} إلى مستند الشراء PD-{doc.number}",
        actor=actor,
        detail=f"{o.supplier_name} · {doc.total_minor}",
        ref_entity="market.MarketDocumentLink",
        ref_id=link.id,
    )
    return link


# ------------------------------------------------------------------ LINK-04 الروابط والفروق
def _diff_row(link: MarketDocumentLink) -> dict[str, Any]:
    diff = link.their_value_minor - link.my_value_minor
    if link.kind == MarketDocumentLink.Kind.RETURN:
        path = (
            "متطابق — لا إجراء." if diff == 0 else "المستند العكسي بالمقبول وحده؛ الباقي بند معلّق."
        )
    elif diff == 0:
        path = "متطابق — لا إجراء."
    else:
        path = (
            "فرق كمية. نعرض الرقمين ولا نرجّح أحدهما: قد يكون نقصاً في الشحنة أو خطأ عدّ عندك. "
            "المسار: فتح خلاف موثَّق أو اتفاق مكتوب."
        )
    return {
        **_doc_link_payload(link),
        "diff_minor": str(diff),
        "path": path,
        "settled": link.settled_at is not None,
    }


def documents_payload(viewer: home.Viewer) -> dict[str, Any]:
    """كل رابط برقمي ورقمه والفرق؛ وإثباتات الدفع بلا مقابل معلّقة بلا خصم."""
    links = list(
        MarketDocumentLink.objects.select_related("order", "shipment").order_by("-created_at")
    )
    rows = [_diff_row(x) for x in links]
    me = require_tenant()
    with platform_context():
        pending_payments = list(
            MarketPayment.unscoped.filter(
                tenant_id=me, status=MarketPayment.Status.RECORDED
            ).select_related("order")
        )
    payments = [
        {
            "id": str(p.id),
            "ref_label": f"PAY-{p.number}",
            "order_label": f"ORD-{p.order.number}",
            "amount_minor": str(p.amount_minor),
            "path": PAYMENT_PATH,
        }
        for p in pending_payments
    ]
    diffs = [r for r in rows if r["diff_minor"] != "0" and not r["settled"]]
    return {
        "state": "ready" if m3_enabled() else "phase_locked",
        "can_settle": viewer.can_see_finance,
        "links": rows,
        "payments": payments,
        "linked_count": len(rows),
        "diff_count": len(diffs) + len(payments),
    }


def settle(
    *, actor: User, viewer: home.Viewer, link_id: uuid.UUID, body: dict[str, Any]
) -> MarketDocumentLink:
    """التسوية إجراء مخوَّل يكتبه أحد الطرفين في دفتره وحده — هنا يُسجَّل المسار (خلاف موثَّق أو
    اتفاق مكتوب) باسم من قرّره؛ لا يُحرّك رصيداً. لمن دون الحدّ المالي: يُسجَّل الفرق ويُحال للمالك."""
    require_m3()
    link: MarketDocumentLink | None = (
        MarketDocumentLink.objects.filter(id=link_id).select_related("order", "shipment").first()
    )
    if link is None:
        raise MarketRejected("not_found")
    if not viewer.can_see_finance:
        raise MarketRejected("permission_denied", "", {"referred": True})
    path = str(body.get("path") or "").strip()
    if path not in {"dispute", "agreement"}:
        raise MarketRejected("path_required", "path")
    note = str(body.get("note") or "").strip()
    if path == "agreement" and not note:
        raise MarketRejected("note_required", "note")
    link.settled_at = timezone.now()
    link.settled_by_name = actor.display_name
    link.settlement_path = path
    link.settlement_note = note[:400]
    link.save(update_fields=["settled_at", "settled_by_name", "settlement_path", "settlement_note"])
    audit.record(
        kind="market.link_settled",
        title=f"تسوية الفرق على {link.local_number}",
        actor=actor,
        detail=f"{path} · {note[:200]}",
        ref_entity="market.MarketDocumentLink",
        ref_id=link.id,
    )
    return link


# ------------------------------------------------------------------ LINK-05 المرتجع إلى مستند عكسي
def _return_rows(r: MarketReturn) -> list[dict[str, Any]]:
    o = r.order
    agreed = _agreed_lines(o)
    rows = []
    for ln in r.lines:
        oid = str(ln.get("offer_id"))
        requested = int(ln.get("qty") or ln.get("qty_requested") or 0)
        approved = ln.get("approved_qty")
        approved_n = int(approved) if approved is not None else 0
        a = agreed.get(oid) or {}
        base_line: dict[str, Any] = next((x for x in o.lines if str(x.get("offer_id")) == oid), {})
        rows.append(
            {
                "offer_id": oid,
                "name": str(
                    base_line.get("public_name")
                    or a.get("public_name")
                    or ln.get("public_name")
                    or ""
                ),
                "unit_name": str(base_line.get("unit_name") or ""),
                "requested": requested,
                "approved": approved_n,
                "pending": max(0, requested - approved_n),
                "reason": str(ln.get("reason") or ""),
                "price_minor": int(a.get("price_minor") or base_line.get("price_minor") or 0),
            }
        )
    return rows


def return_row(r: MarketReturn, link: MarketDocumentLink | None) -> dict[str, Any]:
    o = r.order
    return {
        "return_id": str(r.id),
        "ref_label": f"RT-{r.number:02d}",
        "order_id": str(o.id),
        "order_label": f"ORD-{o.number}",
        "supplier_name": o.supplier_name,
        "status": r.status,
        "status_label": MarketReturn.Status(r.status).label,
        "decision_note": r.decision_note,
        "lines": _return_rows(r),
        "converted": link is not None,
        "local_number": link.local_number if link else "",
        "reverse_partial": bool(link) and any(x["pending"] > 0 for x in _return_rows(r)),
    }


def returns_payload(viewer: home.Viewer) -> dict[str, Any]:
    cps = {str(x.counterparty_tenant_id) for x in linked_counterparties()}
    me = require_tenant()
    with platform_context():
        rets = list(
            MarketReturn.unscoped.filter(tenant_id=me)
            .exclude(status=MarketReturn.Status.REQUESTED)
            .select_related("order")
            .order_by("-decided_at")
        )
    rets = [r for r in rets if str(r.order.supplier_tenant_id) in cps]
    links = {str(x.market_return_id): x for x in MarketDocumentLink.objects.filter(kind="return")}
    rows = [return_row(r, links.get(str(r.id))) for r in rets]
    return {
        "state": "ready" if m3_enabled() else "phase_locked",
        "can_convert": can_create(viewer),
        "returns": rows,
        "pending_count": sum(1 for r in rows if not r["converted"] and r["status"] != "rejected"),
    }


def convert_return(*, actor: User, viewer: home.Viewer, return_id: uuid.UUID) -> MarketDocumentLink:
    """المستند العكسي يُكتب بالكمية المتفَق عليها فقط؛ ما لم يوافق عليه المورد يظل بنداً معلّقاً؛
    الحدّ من دفتري لا من دفتر الطرف الآخر (ACC-132)؛ مرة واحدة ولو أُعيد."""
    require_m3()
    if not can_create(viewer):
        raise MarketRejected("permission_denied")
    me = require_tenant()
    with platform_context():
        r = MarketReturn.unscoped.filter(id=return_id, tenant_id=me).select_related("order").first()
    if r is None:
        raise MarketRejected("not_found")
    existing: MarketDocumentLink | None = (
        MarketDocumentLink.objects.filter(market_return=r).select_related("order").first()
    )
    if existing is not None:
        return existing
    if r.status == MarketReturn.Status.REJECTED:
        raise MarketRejected("return_rejected", "status")
    if r.status == MarketReturn.Status.REQUESTED:
        raise MarketRejected("return_undecided", "status")
    rows = [x for x in _return_rows(r) if x["approved"] > 0]
    if not rows:
        raise MarketRejected("nothing_approved", "lines")
    # المستند الأصلي: أحدث مستند شراء مرتبط بشحنة من الطلب نفسه
    src = (
        MarketDocumentLink.objects.filter(
            order=r.order,
            kind=MarketDocumentLink.Kind.RECEIPT,
            local_entity="inventory.PurchaseDocument",
        )
        .order_by("-created_at")
        .first()
    )
    if src is None:
        raise MarketRejected("receipt_not_converted", "order_id")
    doc = PurchaseDocument.objects.filter(id=src.local_id).first()
    if doc is None:
        raise MarketRejected("receipt_not_converted", "order_id")
    limits = purchase_docs.return_limits(doc)
    lines_body = []
    errors = []
    for x in rows:
        ln = doc.lines.filter(unit_code=f"mkt:{x['offer_id'][:8]}").first()
        if ln is None:
            errors.append({"offer_id": x["offer_id"], "code": "not_in_ledger", "name": x["name"]})
            continue
        qty_milli = x["approved"] * 1000
        if qty_milli > limits.get(str(ln.id), 0):
            errors.append(
                {
                    "offer_id": x["offer_id"],
                    "code": "exceeds_received",
                    "name": x["name"],
                    "max_qty_milli": str(limits.get(str(ln.id), 0)),
                }
            )
            continue
        lines_body.append(
            {
                "document_line_id": str(ln.id),
                "qty_milli": str(qty_milli),
                "reason": x["reason"] or r.decision_note or "مرتجع سوق",
            }
        )
    if errors:
        raise MarketRejected("exceeds_received", "lines", {"errors": errors})
    with transaction.atomic():
        try:
            pr = purchase_docs.record_return(
                actor=actor, viewer=viewer, document=doc, lines=lines_body
            )
        except OrderRejected as e:
            raise MarketRejected(e.code, e.field, e.extra) from e
        # المورد وافق في السوق أصلاً: نثبّت ردّه كما قاله
        purchase_docs.respond(
            actor=actor,
            viewer=viewer,
            purchase_return=pr,
            lines=[
                {"id": str(ln.id), "accepted_qty_milli": str(ln.qty_milli)} for ln in pr.lines.all()
            ],
            note=r.decision_note or "موافقة المورد من السوق",
        )
        link: MarketDocumentLink = MarketDocumentLink.objects.create(
            tenant_id=require_tenant(),
            kind=MarketDocumentLink.Kind.RETURN,
            order=r.order,
            market_return=r,
            mode=MarketDocumentLink.Mode.CREATED,
            local_entity="inventory.PurchaseReturn",
            local_id=pr.id,
            local_number=f"RV-{pr.number}",
            my_value_minor=pr.accepted_minor,
            their_value_minor=sum(x["requested"] * x["price_minor"] for x in _return_rows(r)),
            created_by_name=actor.display_name,
        )
    audit.record(
        kind="market.return_converted",
        title=f"مستند عكسي RV-{pr.number} من مرتجع السوق RT-{r.number:02d}",
        actor=actor,
        detail="بالكمية المتفَق عليها فقط — الباقي بند معلّق",
        ref_entity="market.MarketDocumentLink",
        ref_id=link.id,
    )
    return link
