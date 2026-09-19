from django.urls import path

from market.views import (
    MarketAccountView,
    MarketAuthorizationsIncomingView,
    MarketFollowingView,
    MarketInviteRevokeView,
    MarketInvitesView,
    MarketOfferActionView,
    MarketOfferDetailView,
    MarketOfferPreviewView,
    MarketOfferRenewView,
    MarketOffersView,
    MarketOrderAcceptView,
    MarketOrderDeclineView,
    MarketOrderDetailView,
    MarketOrderQuoteView,
    MarketOrderResendView,
    MarketOrdersIncomingView,
    MarketOrdersView,
    MarketOrderVerifyView,
    MarketPriceListAcceptView,
    MarketPriceListDetailView,
    MarketPriceListMemberActionView,
    MarketPriceListMembersView,
    MarketPriceListsView,
    MarketProfileView,
    MarketRenewalsView,
    MarketReportDetailView,
    MarketReportsView,
    MarketSharePreviewView,
    MarketUnfollowView,
    MarketVerificationSubmitView,
    PlatformMarketVerificationReviewView,
    PublicInviteAcceptView,
    PublicInviteView,
    PublicOfferDetailView,
    PublicSupplierStatusView,
)

urlpatterns = [
    # MP-08 (T3.3): دور البائع وطلب التحقق
    path("market/account", MarketAccountView.as_view(), name="market-account"),
    path(
        "market/account/verification/submit",
        MarketVerificationSubmitView.as_view(),
        name="market-verification-submit",
    ),
    # MP-09 (T3.3): صفحة المنشأة المنشورة
    path("market/profile", MarketProfileView.as_view(), name="market-profile"),
    # MP-10/11 (T3.4): عروض البائع
    path("market/offers", MarketOffersView.as_view(), name="market-offers"),
    path("market/offers/preview", MarketOfferPreviewView.as_view(), name="market-offer-preview"),
    path("market/offers/<uuid:offer_id>", MarketOfferDetailView.as_view(), name="market-offer"),
    path(
        "market/offers/<uuid:offer_id>/renew",
        MarketOfferRenewView.as_view(),
        name="market-offer-renew",
    ),
    path(
        "market/offers/<uuid:offer_id>/<str:action>",
        MarketOfferActionView.as_view(),
        name="market-offer-action",
    ),
    # MP-12/13 (T3.5): القوائم الخاصة والتجديد
    path("market/renewals", MarketRenewalsView.as_view(), name="market-renewals"),
    path("market/lists", MarketPriceListsView.as_view(), name="market-lists"),
    path("market/lists/<uuid:list_id>", MarketPriceListDetailView.as_view(), name="market-list"),
    path(
        "market/lists/<uuid:list_id>/members",
        MarketPriceListMembersView.as_view(),
        name="market-list-members",
    ),
    path(
        "market/lists/<uuid:list_id>/members/<uuid:member_id>/<str:action>",
        MarketPriceListMemberActionView.as_view(),
        name="market-list-member-action",
    ),
    path(
        "market/lists/<uuid:list_id>/accept",
        MarketPriceListAcceptView.as_view(),
        name="market-list-accept",
    ),
    # MP-05/06 (T3.8): تفاصيل العرض (عام/مخوَّل) والمتابعة
    path(
        "market/offers/public/<uuid:offer_id>",
        PublicOfferDetailView.as_view(),
        name="market-offer-public",
    ),
    path("market/following", MarketFollowingView.as_view(), name="market-following"),
    path(
        "market/following/<uuid:follow_id>/unfollow",
        MarketUnfollowView.as_view(),
        name="market-unfollow",
    ),
    # PLT-06 (T3.20 لاحقاً): مراجعة مشرف السوق عبر الـAPI
    path(
        "platform/tenants/<uuid:tenant_id>/market-verification/review",
        PlatformMarketVerificationReviewView.as_view(),
        name="platform-market-verification-review",
    ),
    path("market/share/preview", MarketSharePreviewView.as_view(), name="market-share-preview"),
    path("market/invites", MarketInvitesView.as_view(), name="market-invites"),
    path(
        "market/invites/<uuid:invite_id>/revoke",
        MarketInviteRevokeView.as_view(),
        name="market-invite-revoke",
    ),
    path(
        "market/authorizations/incoming",
        MarketAuthorizationsIncomingView.as_view(),
        name="market-authorizations-incoming",
    ),
    path("public/market/invite/<str:token>", PublicInviteView.as_view(), name="market-invite-open"),
    path(
        "market/invite/<str:token>/accept",
        PublicInviteAcceptView.as_view(),
        name="market-invite-accept",
    ),
    path(
        "public/market/suppliers/<uuid:tenant_id>/status",
        PublicSupplierStatusView.as_view(),
        name="market-supplier-status",
    ),
    path("market/reports", MarketReportsView.as_view(), name="market-reports"),
    path(
        "market/reports/<uuid:report_id>",
        MarketReportDetailView.as_view(),
        name="market-report-detail",
    ),
    path("market/orders", MarketOrdersView.as_view(), name="market-orders"),
    path("market/orders/verify", MarketOrderVerifyView.as_view(), name="market-orders-verify"),
    path(
        "market/orders/incoming", MarketOrdersIncomingView.as_view(), name="market-orders-incoming"
    ),
    path(
        "market/orders/<uuid:order_id>/resend",
        MarketOrderResendView.as_view(),
        name="market-order-resend",
    ),
    path("market/orders/<uuid:order_id>", MarketOrderDetailView.as_view(), name="market-order"),
    path(
        "market/orders/<uuid:order_id>/quote",
        MarketOrderQuoteView.as_view(),
        name="market-order-quote",
    ),
    path(
        "market/orders/<uuid:order_id>/decline",
        MarketOrderDeclineView.as_view(),
        name="market-order-decline",
    ),
    path(
        "market/orders/<uuid:order_id>/accept",
        MarketOrderAcceptView.as_view(),
        name="market-order-accept",
    ),
]
