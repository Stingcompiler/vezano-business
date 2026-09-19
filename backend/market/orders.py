"""ORD-01/ORD-02 — سلة ومسودة طلب، ومراجعة وإرسال طلب أو طلب سعر (§٧.٨، §٧.٩؛ ACC-123، ACC-124،
ACC-126، ACC-140).

المسودة محلية ولا تُثبّت سعراً (السعر يُثبت بقبول المورد لا بحفظ المشتري)؛ الإرسال يُنشئ طلباً لكل
مورد بمعرّف عملية واحد — إعادة المحاولة تعيد الطلب نفسه؛ «أُرسل» ليست «قُبل»: لا دين ولا حجز عند
الطلب. الخادم يعيد التحقق من كل بند وقت الإرسال: المنتهي لا يُرسل بسعره القديم، والسعر المتغيّر
يحتاج قبولاً صريحاً سطراً سطراً، والعملة لا تُحوَّل ضمنياً.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import audit, home, org
from core.models import Tenant, User
from core.tenancy import platform_context, require_tenant
from market.models import MarketAccount, MarketOffer, MarketOrder, MarketProfile
from market.public import _fees, tenant_name
from market.services import MarketRejected, badge_of

RESPONSE_HOURS = 72
NEAR_HOURS = 6
RESPONSIBILITIES = [
    {"who": "المورد", "items": ["صحة الوصف والسعر والوحدة، والتسليم في المهلة المعلنة"]},
    {
        "who": "أنت",
        "items": [
            "صحة العنوان وجهة الاستلام، ومن يحق له التوقيع بالاستلام",
            "فحص الكميات عند الاستلام — الفحص اللاحق يصعب إثباته",
        ],
    },
    {
        "who": "Sting",
        "items": ["نقل الطلب وحفظ نسخ الاتفاق والأدلة. لا ضمان جودة ولا طرف في الدفع"],
    },
]


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def order_limit(viewer: home.Viewer) -> int | None:
    """الإرسال توقيع على مبلغ (`purchase_approve`): المالك بلا سقف؛ المحدود بسقفه؛ «لا» = بلا
    إرسال."""
    if viewer.is_owner:
        return None
    cell = org.cell_for(viewer.role_code or "", "purchase_approve")
    if cell.value == "no":
        return 0
    return cell.limit_minor if cell.value == "limit" else None


# ------------------------------------------------------------------ التحقق من البنود (ORD-01)


def verify_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """كل بند بحاله الخادمي الآن: السعر الحالي، الوحدة، الحدّ الأدنى، الصلاحية — لا تقدير محلي."""
    out: list[dict[str, Any]] = []
    today = timezone.localdate()
    with platform_context():
        for raw in lines:
            try:
                oid = uuid.UUID(str(raw.get("offer_id", "")))
            except ValueError:
                continue
            o = MarketOffer.unscoped.filter(id=oid).first()
            qty = int(raw.get("qty") or 0)
            draft_price = str(raw.get("price_minor") or "")
            if o is None or o.status in {MarketOffer.Status.DRAFT, MarketOffer.Status.HIDDEN}:
                out.append(
                    {
                        "offer_id": str(oid),
                        "qty": qty,
                        "draft_price_minor": draft_price,
                        "status": "withdrawn",
                        "current_price_minor": "",
                        "changed": False,
                        "expired": True,
                        "unit_name": str(raw.get("unit_name") or ""),
                        "min_order_qty": None,
                        "short": 0,
                    }
                )
                continue
            seller = Tenant.unscoped.filter(id=o.tenant_id).first()
            acc = MarketAccount.unscoped.filter(tenant_id=o.tenant_id).first()
            badge, _label = badge_of(acc)
            expired = (
                o.status == MarketOffer.Status.EXPIRED
                or o.confirmed_at is None
                or (o.valid_until is not None and o.valid_until < today)
            )
            current = str(o.price_minor) if o.price_minor is not None else ""
            fees_ok, fees_label = _fees(o)
            short = max(0, (o.min_order_qty or 0) - qty)
            out.append(
                {
                    "offer_id": str(o.id),
                    "seller_tenant_id": str(o.tenant_id),
                    "seller_name": tenant_name(o.tenant_id),
                    "public_name": o.public_name,
                    "pack_label": o.pack_label,
                    "unit_name": o.unit_name,
                    "qty": qty,
                    "draft_price_minor": draft_price,
                    "current_price_minor": current,
                    "changed": bool(draft_price and current and draft_price != current),
                    "expired": expired,
                    "status": "expired" if expired else "confirmed",
                    "confirmed_at": _iso(o.confirmed_at),
                    "valid_until": o.valid_until.isoformat() if o.valid_until else "",
                    "min_order_qty": o.min_order_qty,
                    "short": short,
                    "fees_decided": fees_ok,
                    "fees_label": fees_label,
                    "currency": seller.base_currency if seller else "SDG",
                    "supplier_suspended": badge == "suspended",
                }
            )
    return out


# ------------------------------------------------------------------ الإرسال (ORD-02)


def shipped_percent(o: MarketOrder) -> int:
    """نسبة المشحون من المؤكَّد (الإصدار المتفق عليه) — 0 قبل الاتفاق."""
    if not o.agreed_version:
        return 0
    from market.order_flow import _agreed_lines

    agreed = _agreed_lines(o)
    conf = sum(
        int((agreed.get(str(ln.get("offer_id"))) or {}).get("qty_confirmed") or 0) for ln in o.lines
    )
    shipped = sum(int(ln.get("qty_shipped") or 0) for ln in o.lines)
    return int(shipped * 100 / conf) if conf else 0


def content_line(o: MarketOrder) -> str:
    """«سكر كرتونة 12×1كغ ×40 · شاي ×15» — أول سطرين ثم عدد الباقي."""
    parts = [
        f"{line.get('public_name', '')} {line.get('pack_label') or ''}".strip()
        + f" ×{line.get('qty', 0)}"
        for line in o.lines[:2]
    ]
    rest = len(o.lines) - 2
    return " · ".join(parts) + (f" · +{rest}" if rest > 0 else "")


def buyer_step(o: MarketOrder, *, no_reply: bool) -> str:
    """«الخطوة التي تنتظرك» عند المشتري — لا فراغ."""
    if no_reply:
        return "لم يُرد عليه — أعد الإرسال أو توجّه لمورد آخر"
    return {
        MarketOrder.Status.SENT: "بانتظار رد المورد",
        MarketOrder.Status.QUOTED: "قارن العرض واقبله أو ارفضه (ORD-07)",
        MarketOrder.Status.ACCEPTED: "بانتظار التجهيز",
        MarketOrder.Status.REJECTED: "مرفوض — توجّه لمورد آخر",
        MarketOrder.Status.PREPARING: "بانتظار التسليم",
        MarketOrder.Status.DELIVERED: "استلم وافحص الكميات (ORD-09)",
        MarketOrder.Status.RECEIVED: "مكتمل",
        MarketOrder.Status.CANCELLED: "أُلغي",
        MarketOrder.Status.DISPUTED: "خلاف مفتوح — تابع أدلته (ORD-12)",
    }.get(MarketOrder.Status(o.status), "")


def supplier_step(o: MarketOrder, *, no_reply: bool, near: bool) -> str:
    """الحالة والإجراء عند المورد."""
    if no_reply:
        return "لا يُقرأ رفضاً. في أرشيف «لم يُرد عليه»، وللمشتري إعادة الإرسال."
    if o.status == MarketOrder.Status.SENT:
        return (
            "الأقرب انقضاءً في الأعلى دائماً — الترتيب بالمهلة لا بالتاريخ."
            if near
            else "أعِدّ عرض سعر (ORD-06) أو اعتذر بسبب."
        )
    if o.status == MarketOrder.Status.QUOTED:
        return "عرضك بانتظار قرار المشتري. لا يتجدّد تلقائياً عند انقضائه."
    return MarketOrder.Status(o.status).label


def order_payload(o: MarketOrder) -> dict[str, Any]:
    total = sum(
        int(line.get("qty") or 0) * int(line.get("price_minor") or 0)
        for line in o.lines
        if line.get("price_minor")
    )
    deadline = o.sent_at + timedelta(hours=o.response_hours)
    now = timezone.now()
    no_reply = o.status == MarketOrder.Status.SENT and deadline <= now
    remaining_h = max(0, int((deadline - now).total_seconds() // 3600))
    near = o.status == MarketOrder.Status.SENT and not no_reply and remaining_h < NEAR_HOURS
    return {
        "id": str(o.id),
        "no_reply": no_reply,
        "near_deadline": near,
        "remaining_hours": remaining_h,
        "content_line": content_line(o),
        "buyer_step": buyer_step(o, no_reply=no_reply),
        "supplier_step": supplier_step(o, no_reply=no_reply, near=near),
        "flagged": o.status in {MarketOrder.Status.DISPUTED, MarketOrder.Status.CANCELLED},
        "list_status_label": (
            "لم يُرد عليه"
            if no_reply
            else (
                f"مشحون جزئياً — {shipped_percent(o)}%"
                if o.status == MarketOrder.Status.PREPARING and shipped_percent(o)
                else MarketOrder.Status(o.status).label
            )
        ),
        "shipped_percent": shipped_percent(o),
        "op_id": str(o.op_id),
        "number": o.number,
        "number_label": f"PO-{o.number}",
        "kind": o.kind,
        "kind_label": MarketOrder.Kind(o.kind).label,
        "status": o.status,
        "status_label": MarketOrder.Status(o.status).label,
        "version": o.version,
        "supplier_tenant_id": str(o.supplier_tenant_id),
        "supplier_name": o.supplier_name,
        "buyer_name": o.buyer_name,
        "currency": o.currency,
        "lines": list(o.lines),
        "lines_count": len(o.lines),
        "total_minor": str(total) if o.kind == MarketOrder.Kind.ORDER else "",
        "delivery_to": o.delivery_to,
        "fees_label": o.fees_label,
        "note": o.note,
        "response_hours": o.response_hours,
        "deadline_at": _iso(deadline),
        "sent_at": _iso(o.sent_at),
        "updated_at": _iso(o.updated_at),
        "responsibilities": RESPONSIBILITIES,
    }


def orders_payload(*, op_id: uuid.UUID | None = None) -> dict[str, Any]:
    qs = MarketOrder.objects.order_by("-sent_at")
    if op_id is not None:
        qs = qs.filter(op_id=op_id)
    rows = [order_payload(o) for o in qs]
    return {
        "orders": rows,
        "awaiting_count": sum(1 for r in rows if r["status"] == "sent" and not r["no_reply"]),
        "hidden_by_filter": sum(1 for r in rows if r["flagged"]),
        "fetched_at": _iso(timezone.now()),
    }


def incoming_payload() -> dict[str, Any]:
    """ORD-04: الطلبات الواردة إلى منشأتي مورداً — بالمهلة لا بالتاريخ؛ الأقرب انقضاءً أولاً."""
    me = require_tenant()
    with platform_context():
        qs = list(MarketOrder.unscoped.filter(supplier_tenant_id=me))
    rows = [order_payload(o) for o in qs]
    active = [r for r in rows if r["status"] == "sent" and not r["no_reply"]]
    active.sort(key=lambda r: r["deadline_at"])
    others = [r for r in rows if r not in active]
    others.sort(key=lambda r: r["sent_at"], reverse=True)
    ordered = active + others
    return {
        "orders": ordered,
        "counts": {
            "all": len(rows),
            "awaiting": len(active),
            "near": sum(1 for r in active if r["near_deadline"]),
            "no_reply": sum(1 for r in rows if r["no_reply"]),
        },
        "ending_today": sum(1 for r in active if r["remaining_hours"] < 24),
        "fetched_at": _iso(timezone.now()),
    }


def resend(*, actor: User, viewer: home.Viewer, order: MarketOrder) -> MarketOrder:
    """إعادة إرسال طلب لم يُرد عليه: المهلة تبدأ من جديد بإصدار جديد — لا طلب ثانٍ ولا رقم ثانٍ."""
    limit = order_limit(viewer)
    if limit == 0:
        raise MarketRejected("permission_denied")
    deadline = order.sent_at + timedelta(hours=order.response_hours)
    if order.status != MarketOrder.Status.SENT or deadline > timezone.now():
        raise MarketRejected("not_resendable", "status")
    order.sent_at = timezone.now()
    order.version += 1
    order.save(update_fields=["sent_at", "version"])
    audit.record(
        kind="market.order_resent",
        title=f"إعادة إرسال PO-{order.number} إلى {order.supplier_name}",
        actor=actor,
        detail=f"الإصدار {order.version} — المهلة من جديد.",
        ref_entity="market.MarketOrder",
        ref_id=order.id,
    )
    return order


def submit(*, actor: User, viewer: home.Viewer, body: dict[str, Any]) -> tuple[MarketOrder, bool]:
    """(الطلب، أُنشئ الآن؟): `op_id` نفسه يعيد الطلب نفسه (ACC-124)؛ طلب واحد لمورد واحد
    (ACC-126)."""
    try:
        op_id = uuid.UUID(str(body.get("op_id", "")))
        sid = uuid.UUID(str(body.get("supplier_tenant_id", "")))
    except ValueError:
        raise MarketRejected("op_id_required", "op_id") from None
    existing: MarketOrder | None = MarketOrder.objects.filter(op_id=op_id).first()
    if existing is not None:
        return existing, False
    kind = str(body.get("kind") or MarketOrder.Kind.ORDER)
    if kind not in {MarketOrder.Kind.ORDER, MarketOrder.Kind.QUOTE}:
        raise MarketRejected("kind_invalid", "kind")
    raw_lines = body.get("lines") if isinstance(body.get("lines"), list) else []
    if not raw_lines:
        raise MarketRejected("lines_required", "lines")
    me = require_tenant()
    if sid == me:
        raise MarketRejected("supplier_is_self")
    with platform_context():
        prof = MarketProfile.unscoped.filter(tenant_id=sid).first()
        acc = MarketAccount.unscoped.filter(tenant_id=sid).first()
        buyer = Tenant.unscoped.get(id=me)
        seller = Tenant.unscoped.filter(id=sid).first()
    if prof is None or seller is None or not (prof.published or {}):
        raise MarketRejected("supplier_unknown")
    if badge_of(acc)[0] == "suspended":
        raise MarketRejected("supplier_suspended")
    if buyer.base_currency != seller.base_currency:
        raise MarketRejected(
            "currency_mismatch",
            "currency",
            {"offer_currency": seller.base_currency, "buyer_currency": buyer.base_currency},
        )
    verified = verify_lines([x for x in raw_lines if isinstance(x, dict)])
    if not verified:
        raise MarketRejected("lines_required", "lines")
    foreign = [v["offer_id"] for v in verified if v.get("seller_tenant_id") != str(sid)]
    if foreign:
        raise MarketRejected("one_supplier_per_order", "lines", {"offer_ids": foreign})
    if any(int(v["qty"]) <= 0 for v in verified):
        raise MarketRejected("qty_required", "lines")
    if kind == MarketOrder.Kind.ORDER:
        expired = [v["offer_id"] for v in verified if v["expired"]]
        if expired:
            raise MarketRejected("line_expired", "lines", {"offer_ids": expired})
        changed = [
            {
                "offer_id": v["offer_id"],
                "old_minor": v["draft_price_minor"],
                "new_minor": v["current_price_minor"],
            }
            for v in verified
            if v["changed"] or not v["draft_price_minor"]
        ]
        if changed:
            raise MarketRejected("price_changed", "lines", {"offers": changed})
    short = [
        {"offer_id": v["offer_id"], "short": v["short"], "min": v["min_order_qty"]}
        for v in verified
        if v["short"]
    ]
    if short:
        raise MarketRejected("min_order_not_met", "lines", {"offers": short})
    lines = [
        {
            "offer_id": v["offer_id"],
            "public_name": v["public_name"],
            "pack_label": v["pack_label"],
            "unit_name": v["unit_name"],
            "qty": v["qty"],
            "price_minor": v["current_price_minor"] if kind == MarketOrder.Kind.ORDER else "",
            "confirmed_at": v["confirmed_at"],
            "valid_until": v["valid_until"],
        }
        for v in verified
    ]
    total = sum(int(x["qty"]) * int(x["price_minor"] or 0) for x in lines)
    limit = order_limit(viewer)
    if limit is not None and (limit == 0 or total > limit):
        raise MarketRejected(
            "permission_denied", "", {"limit_minor": str(limit), "total_minor": str(total)}
        )
    fees = sorted({str(v["fees_label"]) for v in verified})
    order: MarketOrder = MarketOrder.objects.create(
        tenant_id=me,
        number=MarketOrder.objects.count() + 1,
        op_id=op_id,
        kind=kind,
        supplier_tenant_id=sid,
        supplier_name=str((prof.published or {}).get("public_name") or seller.name),
        buyer_name=buyer.name,
        currency=seller.base_currency,
        lines=lines,
        delivery_to=str(body.get("delivery_to") or (viewer.branch.name if viewer.branch else "")),
        fees_label=" · ".join(fees),
        note=str(body.get("note") or "")[:600],
        response_hours=RESPONSE_HOURS,
        created_by_name=actor.display_name,
    )
    from market.order_flow import open_request_version

    open_request_version(order, actor_name=actor.display_name)
    audit.record(
        kind="market.order_sent",
        title=f"{MarketOrder.Kind(kind).label} PO-{order.number} إلى {order.supplier_name}",
        actor=actor,
        detail="أُرسل ليست قُبل — لا التزام مالي ولا حجز مخزون حتى يرد المورد.",
        ref_entity="market.MarketOrder",
        ref_id=order.id,
    )
    return order, True
