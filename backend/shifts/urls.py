from django.urls import path

from shifts.views import (
    CurrentShiftView,
    MovementRequestView,
    ShiftReviewActionView,
    ShiftReviewView,
    ShiftView,
)

urlpatterns = [
    path("shifts/current", CurrentShiftView.as_view(), name="shifts-current"),
    path("shifts/review", ShiftReviewView.as_view(), name="shifts-review"),
    path(
        "shifts/<uuid:shift_id>/review",
        ShiftReviewActionView.as_view(),
        name="shifts-review-action",
    ),
    path("shifts/<uuid:shift_id>", ShiftView.as_view(), name="shifts-shift"),
    path(
        "shifts/<uuid:shift_id>/requests",
        MovementRequestView.as_view(),
        name="shifts-movement-request",
    ),
]
