"""خدمات البيع: سقوف الخصم بحسب الدور (G-09 مؤقتاً حتى ORG-02) وتطبيق حدث تجاوز الخصم."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import User
from sales.models import DiscountOverride


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
    if is_owner:
        return DISCOUNT_CAPS["owner"]
    return DISCOUNT_CAPS.get(role_code, DEFAULT_CAPS)


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
