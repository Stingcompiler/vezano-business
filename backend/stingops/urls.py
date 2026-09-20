from django.urls import path

from stingops.views import (
    OperatorAnnouncementActionView,
    OperatorAnnouncementsView,
    OperatorAudiencePreviewView,
    OperatorChannelStateView,
    OperatorLoginView,
    OperatorOutboundView,
    OperatorProofActionView,
    OperatorProofsView,
    OperatorTenantDetailView,
    OperatorTenantsView,
    OperatorVerificationActionView,
    OperatorVerificationsView,
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
    path("platform/proofs", OperatorProofsView.as_view(), name="platform-proofs"),
    path(
        "platform/proofs/<uuid:tenant_id>/<uuid:proof_id>/<str:action>",
        OperatorProofActionView.as_view(),
        name="platform-proof-action",
    ),
    path(
        "platform/announcements",
        OperatorAnnouncementsView.as_view(),
        name="platform-announcements",
    ),
    path(
        "platform/announcements/preview",
        OperatorAudiencePreviewView.as_view(),
        name="platform-announcements-preview",
    ),
    path(
        "platform/announcements/<uuid:announcement_id>/<str:action>",
        OperatorAnnouncementActionView.as_view(),
        name="platform-announcement-action",
    ),
    path("platform/outbound", OperatorOutboundView.as_view(), name="platform-outbound"),
    path(
        "platform/outbound/channels/<str:key>",
        OperatorChannelStateView.as_view(),
        name="platform-outbound-channel",
    ),
    path(
        "platform/verifications",
        OperatorVerificationsView.as_view(),
        name="platform-verifications",
    ),
    path(
        "platform/verifications/<uuid:tenant_id>/<str:action>",
        OperatorVerificationActionView.as_view(),
        name="platform-verification-action",
    ),
]
