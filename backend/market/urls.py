from django.urls import path

from market.views import (
    MarketAccountView,
    MarketProfileView,
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
    # PLT-06 (T3.20 لاحقاً): مراجعة مشرف السوق عبر الـAPI
    path(
        "platform/tenants/<uuid:tenant_id>/market-verification/review",
        PlatformMarketVerificationReviewView.as_view(),
        name="platform-market-verification-review",
    ),
]
