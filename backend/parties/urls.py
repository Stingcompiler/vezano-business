from django.urls import path

from parties.views import PartiesView, PartyListView

urlpatterns = [
    path("parties", PartiesView.as_view(), name="parties"),
    path("parties/list", PartyListView.as_view(), name="parties-list"),
]
