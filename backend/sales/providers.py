"""مساهمات البيع: مُطبِّق حدث تجاوز الخصم (POS-03)."""

from __future__ import annotations

from sales.services import apply_discount_override
from sync.appliers import register_applier

register_applier("sales.DiscountOverride", apply_discount_override)
