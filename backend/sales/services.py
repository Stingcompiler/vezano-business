"""خدمات البيع: سقوف الخصم بحسب الدور (G-09 مؤقتاً حتى ORG-02) وتطبيق حدث تجاوز الخصم."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import User
from sales.models import DiscountOverride
from sync.appliers import BusinessConflict


@dataclass(frozen=True)
class DiscountCaps:
    """حدّ العملية وحدّ اليوم بالوحدة الصغرى ونسبة مئوية؛ صفر = بلا حدّ (المالك)."""

    per_op_minor: int
    daily_minor: int
    percent: int


#: «القيم تجريبية — تُضبط في ORG-02 مصفوفة الأدوار» (03-D2 POS-03؛ G-09)
DISCOUNT_CAPS: dict[str, DiscountCaps] = {
    "owner": DiscountCaps(0, 0, 0),
    "manager": DiscountCaps(per_op_minor=50000, daily_minor=250000, percent=25),
    "cashier": DiscountCaps(per_op_minor=1000, daily_minor=5000, percent=10),
}
DEFAULT_CAPS = DISCOUNT_CAPS["cashier"]

#: «المستخدَم اليوم» — مجموع خصومات المستخدم اليوم؛ تسجّله POS-05 من مبيعاته (حتى ذلك الحين صفر)
DISCOUNT_USAGE_PROVIDERS: list[Callable[[uuid.UUID], int]] = []


def caps_for(role_code: str, is_owner: bool) -> DiscountCaps:
    """حدّ العملية من مصفوفة الأدوار (ORG-02 · «خصم وتجاوز سعر» — G-09)؛ حدّ اليوم والنسبة يبقيان
    قيماً تجريبية حتى تُحرَّر مدىً يومياً في المصفوفة (خلية «يومياً» تحلّ محلّ اليومي)."""
    if is_owner:
        return DISCOUNT_CAPS["owner"]
    base = DISCOUNT_CAPS.get(role_code, DEFAULT_CAPS)
    from core.org import cell_for

    cell = cell_for(role_code, "discount")
    # «لا» = الدور لا يخصم أصلاً (ولا يبيع في الإطار) — يبقى الحدّ التجريبي؛ الصفر محجوز لـ«بلا حدّ»
    if cell.value == "unlimited":
        return DISCOUNT_CAPS["owner"]
    if cell.value == "limit" and cell.limit_minor is not None:
        if cell.period == "daily":
            return DiscountCaps(base.per_op_minor, cell.limit_minor, base.percent)
        return DiscountCaps(cell.limit_minor, base.daily_minor, base.percent)
    return base


def used_today_minor(user_id: uuid.UUID) -> int:
    return sum(p(user_id) for p in DISCOUNT_USAGE_PROVIDERS)


def caps_payload(role_code: str, is_owner: bool, user_id: uuid.UUID) -> dict[str, Any]:
    c = caps_for(role_code, is_owner)
    return {
        "per_op_minor": str(c.per_op_minor),
        "daily_minor": str(c.daily_minor),
        "percent": c.percent,
        "used_today_minor": str(used_today_minor(user_id)),
    }


def apply_discount_override(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    if DiscountOverride.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    actor = User.unscoped.filter(id=actor_user_id).first()
    occurred = parse_datetime(str(payload.get("occurred_at", ""))) or timezone.now()
    if not timezone.is_aware(occurred):
        occurred = timezone.make_aware(occurred)
    DiscountOverride.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch_id=uuid.UUID(str(payload["branch_id"])),
        device_id=device_id,
        requested_by_user_id=actor_user_id,
        requested_by_name=actor.display_name if actor else "",
        mode=str(payload["mode"]),
        value=str(payload["value"]),
        cap=str(payload.get("cap", "")),
        reason=str(payload.get("reason", "")).strip(),
        cart_total_minor=int(payload.get("cart_total_minor", 0)),
        occurred_at=occurred,
    )


# ---------------------------------------------------------------- إسقاط البيع (T1.16)


def _dt(value: Any) -> Any:
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def apply_sale(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """رأس البيع (متكرّر الأثر)؛ السطور والدفعات أعضاء منفصلة تصل بمُطبِّقاتها في العملية نفسها."""
    from sales.models import Sale

    if Sale.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    Sale.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch_id=uuid.UUID(str(payload["branch_id"])),
        device_id=device_id,
        shift_id=uuid.UUID(str(payload["shift_id"])) if payload.get("shift_id") else None,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        party_id=uuid.UUID(str(payload["party_id"])) if payload.get("party_id") else None,
        invoice_number=str(payload["invoice_number"]),
        subtotal_minor=int(payload["subtotal_minor"]),
        discount_mode=str(payload.get("discount_mode", "") or ""),
        discount_value=str(payload.get("discount_value", "") or ""),
        discount_minor=int(payload.get("discount_minor", 0) or 0),
        discount_reason=str(payload.get("discount_reason", "") or ""),
        total_minor=int(payload["total_minor"]),
        business_date=parse_date(str(payload["business_date"])) or timezone.localdate(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def apply_sale_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from sales.models import Sale, SaleLine

    if SaleLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    sale = Sale.unscoped.filter(tenant_id=tenant_id, id=payload["sale_id"]).first()
    if sale is None:
        return
    SaleLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale=sale,
        item_id=uuid.UUID(str(payload["item_id"])),
        item_name=str(payload.get("item_name", "")),
        unit_id=uuid.UUID(str(payload["unit_id"])),
        unit_code=str(payload.get("unit_code", "")),
        factor_milli=int(payload["factor_milli"]),
        qty_milli=int(payload["qty_milli"]),
        unit_price_minor=int(payload["unit_price_minor"]),
        line_total_minor=int(payload["line_total_minor"]),
        manual_price=bool(payload.get("manual_price", False)),
        sort_order=int(payload.get("sort_order", 0) or 0),
    )


def apply_payment(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from sales.models import Payment, Sale

    if Payment.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    sale = Sale.unscoped.filter(tenant_id=tenant_id, id=payload["sale_id"]).first()
    if sale is None:
        return
    amount = int(payload["amount_minor"])
    method = str(payload["method"])
    Payment.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale=sale,
        method=method,
        amount_minor=amount,
        received_minor=int(payload["received_minor"]) if payload.get("received_minor") else None,
        change_minor=int(payload["change_minor"]) if payload.get("change_minor") else None,
        reference=str(payload.get("reference", "") or ""),
    )
    # مجاميع التسوية على الرأس (§٧.٤: النقد وحده يدخل الصندوق)
    field = {"cash": "cash_minor", "bank": "bank_minor", "credit": "credit_minor"}[method]
    setattr(sale, field, getattr(sale, field) + amount)
    sale.save(update_fields=[field])


def apply_credit_override(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from sales.models import CreditOverride

    if CreditOverride.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    actor = User.unscoped.filter(id=actor_user_id).first()
    CreditOverride.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale_id=uuid.UUID(str(payload["sale_id"])),
        party_id=uuid.UUID(str(payload["party_id"])),
        branch_id=uuid.UUID(str(payload["branch_id"])),
        device_id=device_id,
        requested_by_user_id=actor_user_id,
        requested_by_name=actor.display_name if actor else "",
        credit_limit_minor=int(payload["credit_limit_minor"]),
        balance_after_minor=int(payload["balance_after_minor"]),
        reason=str(payload["reason"]).strip(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


# ---------------------------------------------------------------- المرتجع (T1.20؛ POS-10)


def apply_sale_return(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """رأس المرتجع: مستند مستقل يشير إلى أصله (ACC-09)؛ الردّ إلى الوجهة المعلنة بقيمته كاملة."""
    from sales.models import Sale, SaleReturn

    if SaleReturn.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    sale = Sale.unscoped.filter(tenant_id=tenant_id, id=payload["sale_id"]).first()
    if sale is None:
        # مرتجع بلا أصل معروف لا يُقبل صامتاً ولا يُسقط: يُحجر بنسخته إلى المراجعة (0005 §١٣٠)
        raise BusinessConflict("return_sale_unknown", str(payload["sale_id"]))
    user = User.unscoped.filter(id=payload["user_id"]).first()
    total = int(payload["total_minor"])
    destination = str(payload["destination"])
    SaleReturn.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale=sale,
        return_number=str(payload["return_number"]),
        branch_id=uuid.UUID(str(payload["branch_id"])),
        device_id=device_id,
        shift_id=uuid.UUID(str(payload["shift_id"])) if payload.get("shift_id") else None,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        party_id=uuid.UUID(str(payload["party_id"])) if payload.get("party_id") else None,
        condition=str(payload["condition"]),
        destination=destination,
        total_minor=total,
        cash_minor=total if destination == "cash" else 0,
        credit_minor=total if destination == "credit" else 0,
        business_date=parse_date(str(payload["business_date"])) or timezone.localdate(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def apply_sale_return_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """سطر المرتجع: السقف تراكمي عبر كل مرتجعات الفاتورة (ACC-11) — التجاوز لا يُرفض بل يُكشف
    مركزياً ويُوسم على المستند (§٧.٣: «تُحفظ الواقعة ومسار تسويتها دون تعديل الأصل»)."""
    from django.db.models import Sum

    from sales.models import SaleLine, SaleReturn, SaleReturnLine

    if SaleReturnLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    ret = SaleReturn.unscoped.filter(tenant_id=tenant_id, id=payload["return_id"]).first()
    line = SaleLine.unscoped.filter(tenant_id=tenant_id, id=payload["sale_line_id"]).first()
    if ret is None or line is None or line.sale_id != ret.sale_id:
        raise BusinessConflict("return_line_not_in_sale", str(payload["sale_line_id"]))
    qty = int(payload["qty_milli"])
    already = (
        SaleReturnLine.unscoped.filter(tenant_id=tenant_id, sale_line=line).aggregate(
            q=Sum("qty_milli")
        )["q"]
        or 0
    )
    SaleReturnLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale_return=ret,
        sale_line=line,
        item_id=uuid.UUID(str(payload["item_id"])),
        factor_milli=int(payload["factor_milli"]),
        qty_milli=qty,
        unit_price_minor=int(payload["unit_price_minor"]),
        line_total_minor=int(payload["line_total_minor"]),
    )
    if int(already) + qty > line.qty_milli and not ret.exceeds_original:
        ret.exceeds_original = True
        ret.save(update_fields=["exceeds_original"])
