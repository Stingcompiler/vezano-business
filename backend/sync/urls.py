from django.urls import path

from sync.bootstrap_views import (
    BootstrapCompleteView,
    BootstrapPageView,
    BootstrapStartView,
    DeviceVerifiersView,
    RegisterDeviceView,
    RenewDeviceView,
)
from sync.views import (
    BackupCopyView,
    PullView,
    PushView,
    QuarantineDecideView,
    QuarantineDetailView,
    QuarantineListView,
    ReconcileView,
    RecoveryDeviceView,
    RecoveryHandoverView,
    RecoveryListView,
    SupportReportView,
    SyncStatusView,
)

urlpatterns = [
    path("sync/push", PushView.as_view(), name="sync-push"),
    path("sync/pull", PullView.as_view(), name="sync-pull"),
    path("sync/status", SyncStatusView.as_view(), name="sync-status"),
    path("sync/quarantine", QuarantineListView.as_view(), name="sync-quarantine"),
    path("sync/reconcile", ReconcileView.as_view(), name="sync-reconcile"),
    path("sync/recovery", RecoveryListView.as_view(), name="sync-recovery"),
    path("sync/recovery/handover", RecoveryHandoverView.as_view(), name="sync-recovery-handover"),
    path(
        "sync/recovery/<uuid:device_id>/<str:action>",
        RecoveryDeviceView.as_view(),
        name="sync-recovery-device",
    ),
    path("support/reports", SupportReportView.as_view(), name="support-reports"),
    path("support/backups", BackupCopyView.as_view(), name="support-backups"),
    path(
        "sync/quarantine/<uuid:item_id>",
        QuarantineDetailView.as_view(),
        name="sync-quarantine-detail",
    ),
    path(
        "sync/quarantine/<uuid:item_id>/decide",
        QuarantineDecideView.as_view(),
        name="sync-quarantine-decide",
    ),
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
