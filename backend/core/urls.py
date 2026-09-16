from django.urls import path

from core.auth.account_views import (
    AccountLoginView,
    HealthView,
    VerifyConfirmView,
    VerifyManualView,
    VerifyRequestView,
)
from core.auth.membership_views import (
    CreateTenantView,
    CreationStatusView,
    MembershipsView,
    SectorsView,
    SelectView,
)
from core.auth.views import LoginView, LogoutView, MeView, RefreshView

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/refresh", RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("auth/me", MeView.as_view(), name="auth-me"),
    # ACC-02 (T1.1): حساب بعدة عضويات ورمز تحقق محايد القناة (0005 §٤)
    path("auth/account/login", AccountLoginView.as_view(), name="auth-account-login"),
    path("auth/verify/request", VerifyRequestView.as_view(), name="auth-verify-request"),
    path("auth/verify/confirm", VerifyConfirmView.as_view(), name="auth-verify-confirm"),
    path("auth/verify/manual", VerifyManualView.as_view(), name="auth-verify-manual"),
    # ACC-03/ACC-04 (T1.2): العضويات والاختيار وإنشاء المنشأة بوصفة القطاع
    path("account/memberships", MembershipsView.as_view(), name="account-memberships"),
    path("account/select", SelectView.as_view(), name="account-select"),
    path("tenants/sectors", SectorsView.as_view(), name="tenants-sectors"),
    path("tenants", CreateTenantView.as_view(), name="tenants-create"),
    path(
        "tenants/creation/<uuid:client_request_id>",
        CreationStatusView.as_view(),
        name="tenants-creation-status",
    ),
]
