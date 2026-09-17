"""مساهمات المخزون: مُطبِّق حركة المخزون، أرصدة POS-01، وعدّ حركات الصنف (قفل الوحدة الأساسية)."""

from __future__ import annotations

from catalog import services as catalog_services
from inventory.services import (
    apply_quarantine_movement,
    apply_stock_movement,
    branch_balances,
    item_movement_count,
)
from sync.appliers import register_applier

register_applier("inventory.StockMovement", apply_stock_movement)
catalog_services.BALANCE_PROVIDERS.append(branch_balances)
catalog_services.ITEM_MOVEMENT_PROVIDERS.append(lambda item: item_movement_count(item.id))
register_applier("inventory.QuarantineMovement", apply_quarantine_movement)
