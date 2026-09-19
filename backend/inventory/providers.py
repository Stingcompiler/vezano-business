"""مساهمات المخزون: مُطبِّق حركة المخزون، أرصدة POS-01، وعدّ حركات الصنف (قفل الوحدة الأساسية)."""

from __future__ import annotations

from catalog import services as catalog_services
from inventory.services import (
    MOVEMENT_SOURCE_RESOLVERS,
    adjustment_sources,
    apply_count_line,
    apply_count_session,
    apply_goods_receipt,
    apply_goods_receipt_line,
    apply_quarantine_movement,
    apply_stock_movement,
    apply_stock_transfer,
    apply_stock_transfer_line,
    apply_transfer_receipt,
    apply_transfer_receipt_line,
    branch_balances,
    damage_sources,
    item_movement_count,
    opening_sources,
    receipt_sources,
    receipt_transfer_sources,
    transfer_sources,
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
register_applier("inventory.CountSession", apply_count_session)
register_applier("inventory.CountLine", apply_count_line)
MOVEMENT_SOURCE_RESOLVERS["inventory.StockAdjustment"] = adjustment_sources
MOVEMENT_SOURCE_RESOLVERS["inventory.DamageRecord"] = damage_sources
register_applier("inventory.StockTransfer", apply_stock_transfer)
register_applier("inventory.StockTransferLine", apply_stock_transfer_line)
MOVEMENT_SOURCE_RESOLVERS["inventory.StockTransfer"] = transfer_sources
register_applier("inventory.TransferReceipt", apply_transfer_receipt)
register_applier("inventory.TransferReceiptLine", apply_transfer_receipt_line)
MOVEMENT_SOURCE_RESOLVERS["inventory.TransferReceipt"] = receipt_transfer_sources

# PUR-03/04: ذمّة المورد من مستندات الشراء المعتمدة ناقص المرتجعات المقبولة
from inventory.purchase_docs import supplier_owed_from_purchases  # noqa: E402
from parties import services as _party_services  # noqa: E402

_party_services.SUPPLIER_OWED_PROVIDERS.append(supplier_owed_from_purchases)
