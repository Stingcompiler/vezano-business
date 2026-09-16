from django.urls import path

from catalog.price_views import (
    ImportApplyView,
    ImportBatchView,
    ImportPreviewView,
    ImportRejectedView,
    ImportRevertView,
    ItemPriceView,
    PriceRequestView,
)
from catalog.views import (
    AliasesView,
    BalancesView,
    BarcodeCheckView,
    GroupsView,
    ItemActiveView,
    ItemDetailView,
    ItemImageView,
    ItemsView,
    ItemUnitDetailView,
    ItemUnitsView,
    UnitsView,
)

urlpatterns = [
    path("catalog/items", ItemsView.as_view(), name="catalog-items"),
    path("catalog/items/<uuid:item_id>", ItemDetailView.as_view(), name="catalog-item"),
    path(
        "catalog/items/<uuid:item_id>/active", ItemActiveView.as_view(), name="catalog-item-active"
    ),
    path(
        "catalog/items/<uuid:item_id>/aliases", AliasesView.as_view(), name="catalog-item-aliases"
    ),
    path("catalog/items/<uuid:item_id>/image", ItemImageView.as_view(), name="catalog-item-image"),
    path("catalog/items/<uuid:item_id>/units", ItemUnitsView.as_view(), name="catalog-item-units"),
    path(
        "catalog/items/<uuid:item_id>/units/<uuid:item_unit_id>",
        ItemUnitDetailView.as_view(),
        name="catalog-item-unit",
    ),
    path("catalog/items/<uuid:item_id>/price", ItemPriceView.as_view(), name="catalog-item-price"),
    path(
        "catalog/items/<uuid:item_id>/price-request",
        PriceRequestView.as_view(),
        name="catalog-item-price-request",
    ),
    path(
        "catalog/prices/import/preview", ImportPreviewView.as_view(), name="catalog-import-preview"
    ),
    path("catalog/prices/import/<uuid:batch_id>", ImportBatchView.as_view(), name="catalog-import"),
    path(
        "catalog/prices/import/<uuid:batch_id>/apply",
        ImportApplyView.as_view(),
        name="catalog-import-apply",
    ),
    path(
        "catalog/prices/import/<uuid:batch_id>/revert",
        ImportRevertView.as_view(),
        name="catalog-import-revert",
    ),
    path(
        "catalog/prices/import/<uuid:batch_id>/rejected.csv",
        ImportRejectedView.as_view(),
        name="catalog-import-rejected",
    ),
    path("catalog/units", UnitsView.as_view(), name="catalog-units"),
    path("catalog/barcode", BarcodeCheckView.as_view(), name="catalog-barcode"),
    path("catalog/balances", BalancesView.as_view(), name="catalog-balances"),
    path("catalog/groups", GroupsView.as_view(), name="catalog-groups"),
]
