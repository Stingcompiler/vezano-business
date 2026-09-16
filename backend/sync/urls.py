from django.urls import path

from sync.bootstrap_views import (
    BootstrapCompleteView,
    BootstrapPageView,
    BootstrapStartView,
    DeviceVerifiersView,
    RegisterDeviceView,
    RenewDeviceView,
)
from sync.views import PullView, PushView

urlpatterns = [
    path("sync/push", PushView.as_view(), name="sync-push"),
    path("sync/pull", PullView.as_view(), name="sync-pull"),
    # ACC-05 (T1.3): تسجيل الجهاز والنسخة المادية للتهيئة الأولى (§٨.١٠)
    path("devices/register", RegisterDeviceView.as_view(), name="devices-register"),
    path("devices/renew", RenewDeviceView.as_view(), name="devices-renew"),
    path("devices/verifiers", DeviceVerifiersView.as_view(), name="devices-verifiers"),
    path("bootstrap/start", BootstrapStartView.as_view(), name="bootstrap-start"),
    path("bootstrap/<uuid:image_id>/page", BootstrapPageView.as_view(), name="bootstrap-page"),
    path(
        "bootstrap/<uuid:image_id>/complete",
        BootstrapCompleteView.as_view(),
        name="bootstrap-complete",
    ),
]
