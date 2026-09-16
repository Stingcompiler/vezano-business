from django.urls import path

from catalog.views import (
    AliasesView,
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
    path("catalog/units", UnitsView.as_view(), name="catalog-units"),
    path("catalog/barcode", BarcodeCheckView.as_view(), name="catalog-barcode"),
    path("catalog/groups", GroupsView.as_view(), name="catalog-groups"),
]
