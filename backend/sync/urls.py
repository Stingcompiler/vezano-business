from django.urls import path

from sync.views import PullView, PushView

urlpatterns = [
    path("sync/push", PushView.as_view(), name="sync-push"),
    path("sync/pull", PullView.as_view(), name="sync-pull"),
]
