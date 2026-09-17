"""مسارات الجذر: فحص الصحة ومخطط OpenAPI. مسارات الوحدات تُضاف مع كل وحدة."""

import os

from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView

from sting.health import healthz

urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/", include("core.urls")),
    path("api/", include("sync.urls")),
    path("api/", include("catalog.urls")),
    path("api/", include("shifts.urls")),
    path("api/", include("parties.urls")),
    path("api/", include("sales.urls")),
]

# نقاط السيناريو (إعادة الضبط ومفاتيح الأعطال) لا تُركَّب إلا في بيئة تجريبية مفعّلة صراحة (§١٥.٤)
if os.environ.get("STING_FAULTS_ENABLED") == "1":
    from core.scenario.views import FaultsView, ResetView, VerificationCodeView

    urlpatterns += [
        path("api/scenario/reset", ResetView.as_view(), name="scenario-reset"),
        path("api/scenario/faults", FaultsView.as_view(), name="scenario-faults"),
        path(
            "api/scenario/verification-code",
            VerificationCodeView.as_view(),
            name="scenario-verification-code",
        ),
    ]
