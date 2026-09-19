"""PUR-03/PUR-04 — مستند الشراء واعتماده ومرتجع المشتريات (32-D24؛ §٧.٢، §٧.٧، §٧.٩؛ ACC-128).

الاعتماد توقيع على مبلغ: المستند يُعرض بفروقه عن الأمر، ويُعتمد باسمٍ ووقت مرة واحدة بالهوية،
فيتحرّك المخزون (استلام INV-04 بحركاته) وتتحرّك ذمّة المورد (تستحق بعد 30 يوماً)؛ رقم فاتورة المورد
إلزامي والزيادة عن الأمر تحتاج سبباً؛ حدّ الاعتماد من مصفوفة ORG-02 (`purchase_approve`) — فوقه
تُعرض الرقمان والإحالة إلى المالك تُبقي المستند مسوّدة. المرتجع يُبنى على مستند بعينه بسعره، لا
يتجاوز المستلَم ناقص ما رُدّ، بسبب لكل سطر، ويخفّض الذمّة والمخزون معاً — إشعار دائن لا نقد؛ ردّ
المورد الجزئي يُسجَّل نصاً ويبقى المرتجع مفتوحاً بالمرفوض. الاعتماد لا يُلغى — يُعكس بمستند مضادّ.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from core import audit, home, org
from core.models import User
from core.tenancy import require_tenant
from inventory.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    PurchaseDocument,
    PurchaseDocumentLine,
    PurchaseOrder,
    PurchaseReturn,
    PurchaseReturnLine,
    StockMovement,
)
from inventory.purchasing import OrderRejected, can_create


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def approval_limit(viewer: home.Viewer) -> int | None:
    """حدّ الاعتماد من المصفوفة: None = بلا حدّ (المالك)؛ 0 = ممنوع."""
    if viewer.is_owner:
        return None
    return org.limit_minor_for(viewer.role_code or "", "purchase_approve")


def _doc_number() -> str:
    return str(PurchaseDocument.objects.count() + 1)


def _ret_number() -> str:
    return str(PurchaseReturn.objects.count() + 1)


def _weighted_avg_cost(item_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """متوسط التكلفة المرجّح لوحدة الأساس (بأجزاء الألف) — للإعلان عن أثر الاعتماد."""
    acc: dict[uuid.UUID, tuple[int, int]] = {}
    for ln in GoodsReceiptLine.objects.filter(item_id__in=item_ids, unit_cost_minor__isnull=False):
        if ln.base_qty_milli <= 0 or ln.unit_cost_minor is None:
            continue
        c = ln.unit_cost_minor * 1000 * 1000 // max(int(ln.factor_milli), 1)
        a, q = acc.get(ln.item_id, (0, 0))
        acc[ln.item_id] = (a + c * ln.base_qty_milli, q + ln.base_qty_milli)
    return {i: (a // q if q else 0) for i, (a, q) in acc.items()}


# ------------------------------------------------------------------------ PUR-03 المستند


def line_payload(ln: PurchaseDocumentLine) -> dict[str, Any]:
    returned = (
        PurchaseReturnLine.objects.filter(document_line=ln).aggregate(s=Sum("qty_milli"))["s"] or 0
    )
    return {
        "id": str(ln.id),
        "item_id": str(ln.item_id),
        "item_name": ln.item_name,
        "unit_code": ln.unit_code,
        "unit_name": ln.unit_name,
        "factor_milli": str(ln.factor_milli),
        "ordered_qty_milli": str(ln.ordered_qty_milli),
        "received_qty_milli": str(ln.received_qty_milli),
        "base_qty_milli": str(ln.base_qty_milli),
        "unit_price_minor": str(ln.unit_price_minor),
        "est_unit_price_minor": str(ln.est_unit_price_minor)
        if ln.est_unit_price_minor is not None
        else "",
        "line_total_minor": str(ln.unit_price_minor * ln.received_qty_milli // 1000),
        "est_total_minor": str(ln.est_unit_price_minor * ln.ordered_qty_milli // 1000)
        if ln.est_unit_price_minor is not None
        else "",
        "excess_reason": ln.excess_reason,
        "returned_qty_milli": str(int(returned)),
        # الفرق عن الأمر: كمية أو سعر
        "diff": (
            "qty"
            if ln.received_qty_milli != ln.ordered_qty_milli
            else (
                "price"
                if ln.est_unit_price_minor is not None
                and ln.unit_price_minor != ln.est_unit_price_minor
                else ""
            )
        ),
        "line_no": ln.line_no,
    }


def document_payload(d: PurchaseDocument, viewer: home.Viewer | None = None) -> dict[str, Any]:
    lines = [line_payload(ln) for ln in d.lines.order_by("line_no")]
    est_total = sum(int(x["est_total_minor"]) for x in lines if x["est_total_minor"])
    limit = approval_limit(viewer) if viewer is not None else None
    return {
        "id": str(d.id),
        "number": d.number,
        "order_id": str(d.order_id) if d.order_id else "",
        "order_number": d.order.number if d.order is not None else "",
        "supplier_id": str(d.supplier_id),
        "supplier_name": d.supplier_name,
        "branch_id": str(d.branch_id),
        "branch_name": d.branch.name,
        "supplier_invoice_number": d.supplier_invoice_number,
        "status": d.status,
        "status_label": PurchaseDocument.Status(d.status).label,
        "total_minor": str(d.total_minor),
        "order_estimated_minor": str(est_total) if est_total else "",
        "diff_count": sum(1 for x in lines if x["diff"]),
        "due_days": d.due_days,
        "due_at": _iso(d.approved_at + timedelta(days=d.due_days)) if d.approved_at else "",
        "note": d.note,
        "lines": lines,
        "created_by_name": d.created_by_name,
        "created_at": _iso(d.created_at),
        "approved_by_name": d.approved_by_name,
        "approved_at": _iso(d.approved_at),
        "referred_to_name": d.referred_to_name,
        "referred_at": _iso(d.referred_at),
        "receipt_number": d.receipt.receipt_number if d.receipt is not None else "",
        "effects": d.effects or {},
        "blockers": blockers(d),
        "approval": {
            "viewer_name": viewer.user.display_name if viewer is not None else "",
            "limit_minor": str(limit) if limit is not None else "",
            "over_limit": limit is not None and d.total_minor > limit,
            "can_approve": viewer is not None
            and can_create(viewer)
            and (limit is None or d.total_minor <= limit),
        }
        if viewer is not None
        else {},
    }


def blockers(d: PurchaseDocument) -> list[dict[str, Any]]:
    """ما يمنع الاعتماد — الحفظ كمسوّدة متاح دائماً: رقم فاتورة المورد، وزيادة بلا سبب."""
    out: list[dict[str, Any]] = []
    if not d.supplier_invoice_number.strip():
        out.append({"code": "invoice_number_required", "title": "رقم الفاتورة"})
    for ln in d.lines.all():
        if ln.received_qty_milli > ln.ordered_qty_milli > 0 and not ln.excess_reason.strip():
            out.append(
                {
                    "code": "excess_reason_required",
                    "title": "الزيادة",
                    "line_id": str(ln.id),
                    "item_name": ln.item_name,
                    "received_qty_milli": str(ln.received_qty_milli),
                    "ordered_qty_milli": str(ln.ordered_qty_milli),
                }
            )
    return out


def draft_from_order(*, actor: User, viewer: home.Viewer, order: PurchaseOrder) -> PurchaseDocument:
    """يبدأ مستنداً من الأمر (أو يعيد مسوّدته القائمة): السطور بكمياتها المطلوبة وأسعارها
    التقديرية."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    existing: PurchaseDocument | None = order.documents.exclude(
        status=PurchaseDocument.Status.APPROVED
    ).first()
    if existing is not None:
        return existing
    with transaction.atomic():
        d: PurchaseDocument = PurchaseDocument.objects.create(
            tenant_id=require_tenant(),
            number=_doc_number(),
            order=order,
            supplier_id=order.supplier_id,
            supplier_name=order.supplier_name,
            branch=order.branch,
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
        )
        total = 0
        for i, ol in enumerate(order.lines.order_by("line_no"), start=1):
            price = ol.est_unit_price_minor or 0
            PurchaseDocumentLine.objects.create(
                tenant_id=d.tenant_id,
                document=d,
                order_line=ol,
                item_id=ol.item_id,
                item_name=ol.item_name,
                unit_code=ol.unit_code,
                unit_name=ol.unit_name,
                factor_milli=ol.factor_milli,
                ordered_qty_milli=ol.qty_milli,
                received_qty_milli=ol.qty_milli,
                base_qty_milli=ol.base_qty_milli,
                unit_price_minor=price,
                est_unit_price_minor=ol.est_unit_price_minor,
                line_no=i,
            )
            total += price * ol.qty_milli // 1000
        d.total_minor = total
        d.save(update_fields=["total_minor"])
    return d


def save_draft(
    *,
    actor: User,
    viewer: home.Viewer,
    document: PurchaseDocument,
    supplier_invoice_number: str | None,
    lines: list[dict[str, Any]],
    note: str | None,
) -> PurchaseDocument:
    """يحفظ كما كُتب — الحفظ لا يمنعه نقص؛ الاعتماد وحده يُمنع. العمل لا يضيع لأن ورقةً ناقصة."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status == PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_locked")
    with transaction.atomic():
        if supplier_invoice_number is not None:
            document.supplier_invoice_number = supplier_invoice_number.strip()
        if note is not None:
            document.note = note.strip()
        by_id = {str(ln.id): ln for ln in document.lines.all()}
        for raw in lines:
            ln = by_id.get(str(raw.get("id", "")))
            if ln is None:
                continue
            try:
                qty = int(str(raw.get("received_qty_milli", ln.received_qty_milli)))
                price = int(str(raw.get("unit_price_minor", ln.unit_price_minor)))
            except ValueError as e:
                raise OrderRejected("line_invalid", "lines", {"line_id": str(ln.id)}) from e
            if qty < 0 or price < 0:
                raise OrderRejected("line_invalid", "lines", {"line_id": str(ln.id)})
            ln.received_qty_milli = qty
            ln.base_qty_milli = qty * ln.factor_milli // 1000
            ln.unit_price_minor = price
            ln.excess_reason = str(raw.get("excess_reason", ln.excess_reason)).strip()
            ln.save()
        document.total_minor = sum(
            ln.unit_price_minor * ln.received_qty_milli // 1000 for ln in document.lines.all()
        )
        document.save()
    return document


def refer(*, actor: User, viewer: home.Viewer, document: PurchaseDocument) -> PurchaseDocument:
    """«أحِل إلى المالك» ترسل المستند كما هو وتُبقيه مسوّدة — الاعتماد يُنسب لمن وقّع."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status == PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_locked")
    owner = User.objects.filter(is_owner=True, is_active=True).first()
    document.status = PurchaseDocument.Status.REFERRED
    document.referred_to_name = owner.display_name if owner else ""
    document.referred_at = timezone.now()
    document.save(update_fields=["status", "referred_to_name", "referred_at", "updated_at"])
    from core import notifications

    notifications.emit(
        kind="purchase_referred",
        category="operational",
        title=f"مستند شراء {document.number} يحتاج اعتمادك — {document.supplier_name}",
        body=f"أحاله {actor.display_name}: الإجمالي فوق حدّ صلاحيته.",
        href=f"/purchasing/documents/{document.id}",
        screen="PUR-03",
        needs_action=True,
        owner_only=True,
        dedupe_key=f"purchase_referred:{document.id}",
    )
    audit.record(
        kind="purchase_document.referred",
        title=f"إحالة مستند الشراء {document.number} إلى {document.referred_to_name}",
        actor=actor,
        detail=f"الإجمالي {document.total_minor} فوق حدّ الاعتماد",
        ref_entity="inventory.PurchaseDocument",
        ref_id=document.id,
    )
    return document


def approve(*, actor: User, viewer: home.Viewer, document: PurchaseDocument) -> PurchaseDocument:
    """الاعتماد مرة واحدة بالهوية: استلام INV-04 بحركاته، ذمّة المورد، وأثره يُعلَن صراحةً."""
    if document.status == PurchaseDocument.Status.APPROVED:
        return document  # متكرّر الأثر — لا اعتماد ثانٍ ولا استلام ثانٍ
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    limit = approval_limit(viewer)
    if limit is not None and document.total_minor > limit:
        raise OrderRejected(
            "over_limit",
            "",
            {"limit_minor": str(limit), "total_minor": str(document.total_minor)},
        )
    blk = blockers(document)
    if blk:
        raise OrderRejected("blocked", "", {"blockers": blk})
    item_ids = list(document.lines.values_list("item_id", flat=True))
    before = _weighted_avg_cost(item_ids)
    now = timezone.now()
    with transaction.atomic():
        receipt: GoodsReceipt = GoodsReceipt.objects.create(
            tenant_id=document.tenant_id,
            branch=document.branch,
            receipt_number=f"PD-{document.number}",
            party_id=document.supplier_id,
            supplier_name=document.supplier_name,
            reference=f"فاتورة المورد {document.supplier_invoice_number}",
            device_id=viewer.device.id if viewer.device else uuid.UUID(int=0),
            user_id=actor.id,
            user_name=actor.display_name,
            note=document.note,
            business_date=timezone.localdate(),
            occurred_at=now,
        )
        stock_effects = []
        for ln in document.lines.order_by("line_no"):
            GoodsReceiptLine.objects.create(
                tenant_id=document.tenant_id,
                receipt=receipt,
                item_id=ln.item_id,
                item_name=ln.item_name,
                unit_code=ln.unit_code,
                factor_milli=ln.factor_milli,
                qty_milli=ln.received_qty_milli,
                base_qty_milli=ln.base_qty_milli,
                unit_cost_minor=ln.unit_price_minor,
            )
            if ln.base_qty_milli > 0:
                StockMovement.objects.create(
                    tenant_id=document.tenant_id,
                    branch=document.branch,
                    item_id=ln.item_id,
                    delta_base_qty_milli=ln.base_qty_milli,
                    reason="receive",
                    source_entity="inventory.GoodsReceipt",
                    source_id=receipt.id,
                    occurred_at=now,
                )
            stock_effects.append(
                {
                    "item_name": ln.item_name,
                    "qty_milli": str(ln.received_qty_milli),
                    "unit_name": ln.unit_name,
                }
            )
            ol = ln.order_line
            if ol is not None:
                ol.received_base_qty_milli += ln.base_qty_milli
                ol.save(update_fields=["received_base_qty_milli"])
        after = _weighted_avg_cost(item_ids)
        cost_effects = [
            {
                "item_name": ln.item_name,
                "before_minor": str(before.get(ln.item_id, 0) * ln.factor_milli // 1000 // 1000),
                "after_minor": str(after.get(ln.item_id, 0) * ln.factor_milli // 1000 // 1000),
                "unit_name": ln.unit_name,
            }
            for ln in document.lines.order_by("line_no")
        ]
        document.status = PurchaseDocument.Status.APPROVED
        document.approved_by_user_id = actor.id
        document.approved_by_name = actor.display_name
        document.approved_at = now
        document.receipt = receipt
        document.effects = {
            "stock": stock_effects,
            "cost": cost_effects,
            "branch_name": document.branch.name,
            "payable_minor": str(document.total_minor),
            "due_at": _iso(now + timedelta(days=document.due_days)),
        }
        document.save()
        o = document.order
        if o is not None:
            fully = all(x.received_base_qty_milli >= x.base_qty_milli for x in o.lines.all())
            o.status = PurchaseOrder.Status.RECEIVED if fully else PurchaseOrder.Status.PARTIAL
            o.save(update_fields=["status", "updated_at"])
    audit.record(
        kind="purchase_document.approved",
        title=f"اعتماد مستند الشراء {document.number} — {document.supplier_name}",
        actor=actor,
        branch=document.branch,
        detail=(
            f"الإجمالي {document.total_minor} · فاتورة المورد {document.supplier_invoice_number}"
        ),
        ref_entity="inventory.PurchaseDocument",
        ref_id=document.id,
    )
    return document


# ------------------------------------------------------------------------ PUR-04 المرتجع


def return_line_payload(ln: PurchaseReturnLine) -> dict[str, Any]:
    return {
        "id": str(ln.id),
        "document_line_id": str(ln.document_line_id),
        "item_id": str(ln.item_id),
        "item_name": ln.item_name,
        "unit_code": ln.unit_code,
        "unit_name": ln.unit_name,
        "qty_milli": str(ln.qty_milli),
        "unit_price_minor": str(ln.unit_price_minor),
        "line_total_minor": str(ln.unit_price_minor * ln.qty_milli // 1000),
        "reason": ln.reason,
        "accepted_qty_milli": str(ln.accepted_qty_milli)
        if ln.accepted_qty_milli is not None
        else "",
        "supplier_note": ln.supplier_note,
        "line_no": ln.line_no,
    }


def return_payload(r: PurchaseReturn) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "number": r.number,
        "document_id": str(r.document_id),
        "document_number": r.document.number,
        "supplier_name": r.supplier_name,
        "status": r.status,
        "status_label": PurchaseReturn.Status(r.status).label,
        "total_minor": str(r.total_minor),
        "accepted_minor": str(r.accepted_minor),
        "rejected_minor": str(r.total_minor - r.accepted_minor)
        if r.status in {PurchaseReturn.Status.PARTIAL, PurchaseReturn.Status.REJECTED}
        else "0",
        "supplier_note": r.supplier_note,
        "lines": [return_line_payload(ln) for ln in r.lines.order_by("line_no")],
        "created_by_name": r.created_by_name,
        "created_at": _iso(r.created_at),
        "responded_at": _iso(r.responded_at),
    }


def return_limits(document: PurchaseDocument) -> dict[str, int]:
    """الحدّ الأعلى لكل سطر = المستلَم ناقص ما رُدّ سابقاً على المستند نفسه."""
    out: dict[str, int] = {}
    for ln in document.lines.all():
        returned = (
            PurchaseReturnLine.objects.filter(document_line=ln).aggregate(s=Sum("qty_milli"))["s"]
            or 0
        )
        out[str(ln.id)] = max(0, ln.received_qty_milli - int(returned))
    return out


def record_return(
    *, actor: User, viewer: home.Viewer, document: PurchaseDocument, lines: list[dict[str, Any]]
) -> PurchaseReturn:
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status != PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_not_approved")
    limits = return_limits(document)
    by_id = {str(ln.id): ln for ln in document.lines.all()}
    errors: list[dict[str, Any]] = []
    resolved: list[tuple[PurchaseDocumentLine, int, str]] = []
    for raw in lines:
        lid = str(raw.get("document_line_id", ""))
        ln = by_id.get(lid)
        if ln is None:
            continue
        try:
            qty = int(str(raw.get("qty_milli", "0")))
        except ValueError:
            qty = 0
        if qty <= 0:
            continue
        reason = str(raw.get("reason", "")).strip()
        if qty > limits.get(lid, 0):
            errors.append(
                {
                    "line_id": lid,
                    "code": "exceeds_received",
                    "max_qty_milli": str(limits.get(lid, 0)),
                    "item_name": ln.item_name,
                }
            )
        if not reason:
            errors.append({"line_id": lid, "code": "reason_required", "item_name": ln.item_name})
        resolved.append((ln, qty, reason))
    if errors:
        raise OrderRejected("lines_invalid", "lines", {"errors": errors})
    if not resolved:
        raise OrderRejected("lines_required", "lines")
    now = timezone.now()
    with transaction.atomic():
        r: PurchaseReturn = PurchaseReturn.objects.create(
            tenant_id=document.tenant_id,
            number=_ret_number(),
            document=document,
            supplier_id=document.supplier_id,
            supplier_name=document.supplier_name,
            branch=document.branch,
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
        )
        total = 0
        for i, (ln, qty, reason) in enumerate(resolved, start=1):
            base = qty * ln.factor_milli // 1000
            PurchaseReturnLine.objects.create(
                tenant_id=document.tenant_id,
                purchase_return=r,
                document_line=ln,
                item_id=ln.item_id,
                item_name=ln.item_name,
                unit_code=ln.unit_code,
                unit_name=ln.unit_name,
                factor_milli=ln.factor_milli,
                qty_milli=qty,
                base_qty_milli=base,
                unit_price_minor=ln.unit_price_minor,  # مثبّت من المستند الأصلي
                reason=reason,
                line_no=i,
            )
            # خرجت الكميات من المخزون — بسعر المستند نفسه فالمتوسط المرجّح لا يتأثر
            StockMovement.objects.create(
                tenant_id=document.tenant_id,
                branch=document.branch,
                item_id=ln.item_id,
                delta_base_qty_milli=-base,
                reason="purchase_return",
                source_entity="inventory.PurchaseReturn",
                source_id=r.id,
                note=reason,
                occurred_at=now,
            )
            total += ln.unit_price_minor * qty // 1000
        r.total_minor = total
        r.accepted_minor = total  # إشعار دائن بكامله حتى يردّ المورد
        r.save(update_fields=["total_minor", "accepted_minor"])
    audit.record(
        kind="purchase_return.recorded",
        title=f"مرتجع مشتريات {r.number} على مستند {document.number}",
        actor=actor,
        branch=document.branch,
        detail=f"{total} إشعار دائن لصالح المنشأة على {document.supplier_name}",
        ref_entity="inventory.PurchaseReturn",
        ref_id=r.id,
    )
    return r


def respond(
    *,
    actor: User,
    viewer: home.Viewer,
    purchase_return: PurchaseReturn,
    lines: list[dict[str, Any]],
    note: str,
) -> PurchaseReturn:
    """ردّ المورد يُسجَّل نصاً كما قاله: المقبول وحده يُخصم؛ المرفوض لا يُخصم ولا يعود للمخزون
    قبل قرارك."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    by_id = {str(ln.id): ln for ln in purchase_return.lines.all()}
    accepted_total = 0
    with transaction.atomic():
        for raw in lines:
            ln = by_id.get(str(raw.get("id", "")))
            if ln is None:
                continue
            try:
                acc = int(str(raw.get("accepted_qty_milli", ln.qty_milli)))
            except ValueError:
                acc = ln.qty_milli
            ln.accepted_qty_milli = max(0, min(acc, ln.qty_milli))
            ln.supplier_note = str(raw.get("supplier_note", "")).strip()
            ln.save(update_fields=["accepted_qty_milli", "supplier_note"])
        for ln in purchase_return.lines.all():
            acc = ln.accepted_qty_milli if ln.accepted_qty_milli is not None else ln.qty_milli
            accepted_total += ln.unit_price_minor * acc // 1000
        purchase_return.accepted_minor = accepted_total
        purchase_return.supplier_note = note.strip()
        purchase_return.responded_at = timezone.now()
        purchase_return.status = (
            PurchaseReturn.Status.ACCEPTED
            if accepted_total == purchase_return.total_minor
            else PurchaseReturn.Status.REJECTED
            if accepted_total == 0
            else PurchaseReturn.Status.PARTIAL
        )
        purchase_return.save()
    audit.record(
        kind="purchase_return.responded",
        title=f"ردّ المورد على المرتجع {purchase_return.number}",
        actor=actor,
        detail=f"المقبول {accepted_total} من {purchase_return.total_minor} · {note.strip()}",
        ref_entity="inventory.PurchaseReturn",
        ref_id=purchase_return.id,
    )
    return purchase_return


# ------------------------------------------------------------ ذمّة المورد (PTY): مستندات − مرتجعات


def supplier_owed_from_purchases(party: Any) -> int:
    from parties.services import identity_ids

    ids = identity_ids(party)
    docs = (
        PurchaseDocument.objects.filter(
            supplier_id__in=ids, status=PurchaseDocument.Status.APPROVED
        ).aggregate(s=Sum("total_minor"))["s"]
        or 0
    )
    rets = (
        PurchaseReturn.objects.filter(supplier_id__in=ids).aggregate(s=Sum("accepted_minor"))["s"]
        or 0
    )
    return int(docs) - int(rets)
