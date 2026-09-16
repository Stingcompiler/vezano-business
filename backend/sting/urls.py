"""مسارات الجذر: فحص الصحة ومخطط OpenAPI. مسارات الوحدات تُضاف مع كل وحدة."""

from django.urls import path
from drf_spectacular.views import SpectacularAPIView

from sting.health import healthz

urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
]
