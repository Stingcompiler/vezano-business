from django.urls import path

from sales import views

urlpatterns = [
    path("sales", views.SalesListView.as_view(), name="sales-list"),
    path("sales/duplicates", views.DuplicatesView.as_view(), name="sales-duplicates"),
    path(
        "sales/duplicates/decide",
        views.DuplicateDecideView.as_view(),
        name="sales-duplicates-decide",
    ),
    path("sales/<uuid:sale_id>", views.SaleDetailView.as_view(), name="sales-detail"),
    path(
        "sales/<uuid:sale_id>/duplicate-report",
        views.DuplicateReportView.as_view(),
        name="sales-duplicate-report",
    ),
]
