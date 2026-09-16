from django.urls import path

from catalog.views import AliasesView, GroupsView, ItemActiveView, ItemsView

urlpatterns = [
    path("catalog/items", ItemsView.as_view(), name="catalog-items"),
    path(
        "catalog/items/<uuid:item_id>/active", ItemActiveView.as_view(), name="catalog-item-active"
    ),
    path(
        "catalog/items/<uuid:item_id>/aliases", AliasesView.as_view(), name="catalog-item-aliases"
    ),
    path("catalog/groups", GroupsView.as_view(), name="catalog-groups"),
]
