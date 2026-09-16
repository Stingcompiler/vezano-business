from django.urls import path

from sync.views import PushView

urlpatterns = [path("sync/push", PushView.as_view(), name="sync-push")]
