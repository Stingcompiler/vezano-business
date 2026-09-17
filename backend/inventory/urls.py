from django.urls import path

from inventory.views import (
    ItemMovementsView,
    OpeningApproveView,
    OpeningsView,
    StockBalancesView,
)

urlpatterns = [
    path("inventory/balances", StockBalancesView.as_view(), name="inventory-balances"),
    path("inventory/openings", OpeningsView.as_view(), name="inventory-openings"),
    path(
        "inventory/openings/<uuid:opening_id>/approve",
        OpeningApproveView.as_view(),
        name="inventory-opening-approve",
    ),
    path(
        "inventory/items/<uuid:item_id>/movements",
        ItemMovementsView.as_view(),
        name="inventory-item-movements",
    ),
]
