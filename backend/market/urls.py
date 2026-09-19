from django.urls import path

from market.views import (
    MarketAccountView,
    MarketOfferActionView,
    MarketOfferDetailView,
    MarketOfferPreviewView,
    MarketOfferRenewView,
    MarketOffersView,
    MarketPriceListAcceptView,
    MarketPriceListDetailView,
    MarketPriceListMemberActionView,
    MarketPriceListMembersView,
    MarketPriceListsView,
    MarketProfileView,
    MarketRenewalsView,
    MarketVerificationSubmitView,
    PlatformMarketVerificationReviewView,
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
    # PLT-06 (T3.20 لاحقاً): مراجعة مشرف السوق عبر الـAPI
    path(
        "platform/tenants/<uuid:tenant_id>/market-verification/review",
        PlatformMarketVerificationReviewView.as_view(),
        name="platform-market-verification-review",
    ),
]
