from django.urls import path

from inventory.views import (
    CountSessionReviewView,
    CountSessionsView,
    ItemDamageView,
    ItemMovementsView,
    OpeningApproveView,
    OpeningsView,
    StockBalancesView,
)

urlpatterns = [
    path("inventory/balances", StockBalancesView.as_view(), name="inventory-balances"),
    path("inventory/openings", OpeningsView.as_view(), name="inventory-openings"),
    path("inventory/count-sessions", CountSessionsView.as_view(), name="inventory-counts"),
    path(
        "inventory/count-sessions/<uuid:session_id>",
        CountSessionReviewView.as_view(),
        name="inventory-count-review",
    ),
    path(
        "inventory/openings/<uuid:opening_id>/approve",
        OpeningApproveView.as_view(),
        name="inventory-opening-approve",
    ),
    path(
        "inventory/items/<uuid:item_id>/damage",
        ItemDamageView.as_view(),
        name="inventory-item-damage",
    ),
    path(
        "inventory/items/<uuid:item_id>/movements",
        ItemMovementsView.as_view(),
        name="inventory-item-movements",
    ),
]
