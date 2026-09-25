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


# «قرارات تنتظرك» في الرئيسية: مستندات شراء تنتظر الاعتماد، وأصناف نفد رصيدها
from typing import Any  # noqa: E402

from core import home as _home  # noqa: E402


def _home_decisions(viewer: _home.Viewer, out: dict[str, Any]) -> None:
    if not viewer.can_see_finance:
        return
    from catalog.models import Item
    from core.models import Branch
    from inventory.models import PurchaseDocument
    from inventory.services import branch_balances

    docs = PurchaseDocument.objects.filter(
        status__in=[PurchaseDocument.Status.DRAFT, PurchaseDocument.Status.REFERRED]
    ).order_by("created_at")
    if not viewer.is_owner and viewer.branch is not None:
        docs = docs.filter(branch_id=viewer.branch.id)
    for d in docs[:3]:
        out["decisions"].append(
            {
                "id": f"purchase-doc:{d.id}",
                "title": f"مستند شراء {d.number} ينتظر اعتمادك",
                "detail": f"{d.supplier_name} · {_home.money_short(d.total_minor)}",
                "action": "راجع واعتمد",
                "href": f"/purchasing/documents/{d.id}",
                "severity": "warn",
            }
        )
    branches = (
        [viewer.branch]
        if not viewer.is_owner and viewer.branch is not None
        else list(Branch.objects.filter(is_active=True))
    )
    active = dict(Item.objects.filter(is_active=True).values_list("id", "name"))
    out_ids: dict[Any, str] = {}
    for b in branches:
        for item_id, bal in branch_balances(b.id).items():
            if item_id in active and bal <= 0:
                out_ids[item_id] = active[item_id]
    if out_ids:
        names = sorted(out_ids.values())
        more = f" و{len(names) - 2} غيرها" if len(names) > 2 else ""
        out["decisions"].append(
            {
                "id": "stock-out",
                "title": _home.counted(
                    len(names), "صنف نفد", "صنفان نفدا", "أصناف نفدت", "صنفاً نفد"
                ),
                "detail": "، ".join(names[:2]) + more,
                "action": "أنشئ أمر شراء",
                "href": "/purchasing/orders/new",
                "severity": "warn",
            }
        )


_home.HOME_PROVIDERS.append(_home_decisions)
