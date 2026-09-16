from django.urls import path

from shifts.views import CurrentShiftView, MovementRequestView, ShiftView

urlpatterns = [
    path("shifts/current", CurrentShiftView.as_view(), name="shifts-current"),
    path("shifts/<uuid:shift_id>", ShiftView.as_view(), name="shifts-shift"),
    path(
        "shifts/<uuid:shift_id>/requests",
        MovementRequestView.as_view(),
        name="shifts-movement-request",
    ),
]
