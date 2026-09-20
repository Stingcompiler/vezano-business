from django.urls import path

from stingops.views import (
    OperatorLoginView,
    OperatorTenantDetailView,
    OperatorTenantsView,
    SupportGrantView,
)

urlpatterns = [
    path("platform/login", OperatorLoginView.as_view(), name="platform-login"),
    path("platform/tenants", OperatorTenantsView.as_view(), name="platform-tenants"),
    path(
        "platform/tenants/<uuid:tenant_id>",
        OperatorTenantDetailView.as_view(),
        name="platform-tenant-detail",
    ),
    path("org/support-access", SupportGrantView.as_view(), name="org-support-access"),
]
