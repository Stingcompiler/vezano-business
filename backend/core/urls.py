from django.urls import path

from core.auth.account_views import (
    AccountLoginView,
    AccountRegisterView,
    AppUpdateView,
    HealthView,
    VerifyConfirmView,
    VerifyManualView,
    VerifyRequestView,
)
from core.auth.invitation_views import InviteAcceptView, InviteView
from core.auth.membership_views import (
    CreateTenantView,
    CreationStatusView,
    MembershipsView,
    SectorsView,
    SelectView,
)
from core.auth.session_views import RevokeSessionView, SessionsView
from core.auth.views import LoginView, LogoutView, MeView, RefreshView
from core.campaign_views import (
    CampaignActionView,
    CampaignDetailView,
    CampaignPreviewView,
    CampaignsView,
)
from core.home_views import HomeView, NoticesView, SearchView
from core.notification_views import InboxView, NotificationActionView, PreferencesView
from core.onboarding_views import OnboardingView
from core.org_views import (
    AuditView,
    BranchActionView,
    BranchesView,
    DevicesView,
    InvitationActionView,
    InvitationsView,
    OwnershipActionView,
    OwnershipView,
    PlatformProofReviewView,
    RolesView,
    SettingsView,
    SubscriptionExpiryView,
    SubscriptionProofImageView,
    SubscriptionProofsView,
    SubscriptionView,
    UserRevocationView,
    UsersView,
)
from core.portal_views import (
    PortalChannelView,
    PortalMessageReadView,
    PortalMessagesView,
    PortalMeView,
    PortalPageView,
    PortalResubscribeView,
    PortalSubscribeView,
)
from core.public_views import (
    PublicLegalView,
    PublicMarketDirectoryView,
    PublicMarketHomeView,
    PublicMarketSearchView,
    PublicPlansView,
    PublicStatusView,
    PublicSupplierView,
)
from core.push_views import PushStatusView, PushSubscribeView, PushTestView, PushUnsubscribeView
from core.report_views import (
    CashReportView,
    MarginReportView,
    ReceivablesReportView,
    ReportExportDocumentView,
    ReportExportLimitRequestView,
    ReportExportPreviewView,
    ReportExportsView,
    SalesReportView,
    StockReportView,
)

urlpatterns = [
    # PUB-01…03 (T2.16): بلا جلسة
    path("public/plans", PublicPlansView.as_view(), name="public-plans"),
    path("public/legal", PublicLegalView.as_view(), name="public-legal"),
    path("public/status", PublicStatusView.as_view(), name="public-status"),
    # MP-01/02 (T3.6): السوق العام بلا حساب
    path("public/market", PublicMarketHomeView.as_view(), name="public-market"),
    path(
        "public/market/directory",
        PublicMarketDirectoryView.as_view(),
        name="public-market-directory",
    ),
    # MP-03/04 (T3.7)
    path("public/market/search", PublicMarketSearchView.as_view(), name="public-market-search"),
    path(
        "public/market/suppliers/<uuid:tenant_id>",
        PublicSupplierView.as_view(),
        name="public-supplier",
    ),
    # CUS-01/02 (T3.1): بوابة زبون المحل — عامة بلا جلسة، والرابط/QR للمالك
    path("portal/<str:slug>", PortalPageView.as_view(), name="portal-page"),
    path("portal/<str:slug>/subscribe", PortalSubscribeView.as_view(), name="portal-subscribe"),
    path("portal/<str:slug>/me", PortalMeView.as_view(), name="portal-me"),
    path("portal/<str:slug>/resubscribe", PortalResubscribeView.as_view(), name="portal-resub"),
    path("portal/<str:slug>/messages", PortalMessagesView.as_view(), name="portal-messages"),
    path(
        "portal/<str:slug>/messages/<uuid:message_id>/read",
        PortalMessageReadView.as_view(),
        name="portal-message-read",
    ),
    path("org/portal", PortalChannelView.as_view(), name="org-portal"),
    path("health", HealthView.as_view(), name="health"),
    path("app/update", AppUpdateView.as_view(), name="app-update"),
    path("push/status", PushStatusView.as_view(), name="push-status"),
    path("push/subscribe", PushSubscribeView.as_view(), name="push-subscribe"),
    path("push/unsubscribe", PushUnsubscribeView.as_view(), name="push-unsubscribe"),
    path("push/test", PushTestView.as_view(), name="push-test"),
    # NOT-01/02 (T2.10)
    path("notifications", InboxView.as_view(), name="notifications"),
    path(
        "notifications/<uuid:notification_id>/<str:action>",
        NotificationActionView.as_view(),
        name="notification-action",
    ),
    path("notifications/preferences", PreferencesView.as_view(), name="notification-prefs"),
    # NOT-03/04 (T2.11)
    path("campaigns", CampaignsView.as_view(), name="campaigns"),
    path("campaigns/preview", CampaignPreviewView.as_view(), name="campaign-preview"),
    path("campaigns/<uuid:campaign_id>", CampaignDetailView.as_view(), name="campaign-detail"),
    path(
        "campaigns/<uuid:campaign_id>/<str:action>",
        CampaignActionView.as_view(),
        name="campaign-action",
    ),
    path("org/users", UsersView.as_view(), name="org-users"),
    path("org/invitations", InvitationsView.as_view(), name="org-invitations"),
    path(
        "org/invitations/<uuid:invitation_id>/<str:action>",
        InvitationActionView.as_view(),
        name="org-invitation-action",
    ),
    path("org/roles", RolesView.as_view(), name="org-roles"),
    path("org/branches", BranchesView.as_view(), name="org-branches"),
    path(
        "org/branches/<uuid:branch_id>/<str:action>",
        BranchActionView.as_view(),
        name="org-branch-action",
    ),
    path("org/devices", DevicesView.as_view(), name="org-devices"),
    path("org/settings", SettingsView.as_view(), name="org-settings"),
    path("org/audit", AuditView.as_view(), name="org-audit"),
    path("org/ownership", OwnershipView.as_view(), name="org-ownership"),
    path(
        "org/ownership/<uuid:transfer_id>/<str:action>",
        OwnershipActionView.as_view(),
        name="org-ownership-action",
    ),
    path("org/subscription", SubscriptionView.as_view(), name="org-subscription"),
    # REP-01/02 (T2.7)
    path("reports/sales", SalesReportView.as_view(), name="reports-sales"),
    path("reports/receivables", ReceivablesReportView.as_view(), name="reports-receivables"),
    path("reports/stock", StockReportView.as_view(), name="reports-stock"),
    path("reports/cash", CashReportView.as_view(), name="reports-cash"),
    path("reports/margin", MarginReportView.as_view(), name="reports-margin"),
    path(
        "reports/export/preview", ReportExportPreviewView.as_view(), name="reports-export-preview"
    ),
    path("reports/exports", ReportExportsView.as_view(), name="reports-exports"),
    path(
        "reports/exports/limit-request",
        ReportExportLimitRequestView.as_view(),
        name="reports-export-limit-request",
    ),
    path(
        "reports/exports/<str:token>", ReportExportDocumentView.as_view(), name="reports-export-doc"
    ),
    path(
        "org/subscription/expiry", SubscriptionExpiryView.as_view(), name="org-subscription-expiry"
    ),
    path(
        "org/subscription/proofs", SubscriptionProofsView.as_view(), name="org-subscription-proofs"
    ),
    path(
        "org/subscription/proofs/<uuid:proof_id>/image",
        SubscriptionProofImageView.as_view(),
        name="org-subscription-proof-image",
    ),
    path(
        "platform/tenants/<uuid:tenant_id>/subscription-proofs/<uuid:proof_id>/review",
        PlatformProofReviewView.as_view(),
        name="platform-proof-review",
    ),
    path(
        "org/users/<uuid:user_id>/revocation",
        UserRevocationView.as_view(),
        name="org-user-revocation",
    ),
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/refresh", RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("auth/me", MeView.as_view(), name="auth-me"),
    # ACC-02 (T1.1): حساب بعدة عضويات ورمز تحقق محايد القناة (0005 §٤)
    path("auth/account/login", AccountLoginView.as_view(), name="auth-account-login"),
    path("auth/account/register", AccountRegisterView.as_view(), name="auth-account-register"),
    path("auth/verify/request", VerifyRequestView.as_view(), name="auth-verify-request"),
    path("auth/verify/confirm", VerifyConfirmView.as_view(), name="auth-verify-confirm"),
    path("auth/verify/manual", VerifyManualView.as_view(), name="auth-verify-manual"),
    # ACC-03/ACC-04 (T1.2): العضويات والاختيار وإنشاء المنشأة بوصفة القطاع
    path("account/memberships", MembershipsView.as_view(), name="account-memberships"),
    path("account/select", SelectView.as_view(), name="account-select"),
    path("tenants/sectors", SectorsView.as_view(), name="tenants-sectors"),
    path("tenants", CreateTenantView.as_view(), name="tenants-create"),
    # ACC-09 (T1.5): الجلسات النشطة وإنهاؤها
    path("account/sessions", SessionsView.as_view(), name="account-sessions"),
    path(
        "account/sessions/<uuid:session_id>/revoke",
        RevokeSessionView.as_view(),
        name="account-session-revoke",
    ),
    # HOME (T1.7): الرئيسية والبحث العام والإشعارات
    path("home", HomeView.as_view(), name="home"),
    path("search", SearchView.as_view(), name="search"),
    path("notices", NoticesView.as_view(), name="notices"),
    # ACC-10 (T1.6): معالج بدء الاستخدام
    path("tenants/onboarding", OnboardingView.as_view(), name="tenants-onboarding"),
    # ACC-06 (T1.4): قبول الدعوة بهوية الحساب
    path("invites/<str:token>", InviteView.as_view(), name="invite-view"),
    path("invites/<str:token>/accept", InviteAcceptView.as_view(), name="invite-accept"),
    path(
        "tenants/creation/<uuid:client_request_id>",
        CreationStatusView.as_view(),
        name="tenants-creation-status",
    ),
]
