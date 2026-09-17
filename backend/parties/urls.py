from django.urls import path

from parties.views import PartiesView

urlpatterns = [
    path("parties", PartiesView.as_view(), name="parties"),
]
