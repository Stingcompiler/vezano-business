"""مساهمات المخزون: مُطبِّق حركة المخزون، أرصدة POS-01، وعدّ حركات الصنف (قفل الوحدة الأساسية)."""

from __future__ import annotations

from catalog import services as catalog_services
from inventory.services import (
    MOVEMENT_SOURCE_RESOLVERS,
    apply_goods_receipt,
    apply_goods_receipt_line,
    apply_quarantine_movement,
    apply_stock_movement,
    branch_balances,
    item_movement_count,
    opening_sources,
    receipt_sources,
)
from sync.appliers import register_applier

register_applier("inventory.StockMovement", apply_stock_movement)
catalog_services.BALANCE_PROVIDERS.append(branch_balances)
catalog_services.ITEM_MOVEMENT_PROVIDERS.append(lambda item: item_movement_count(item.id))
register_applier("inventory.QuarantineMovement", apply_quarantine_movement)
register_applier("inventory.GoodsReceipt", apply_goods_receipt)
register_applier("inventory.GoodsReceiptLine", apply_goods_receipt_line)
MOVEMENT_SOURCE_RESOLVERS["inventory.GoodsReceipt"] = receipt_sources
MOVEMENT_SOURCE_RESOLVERS["inventory.StockOpening"] = opening_sources
