from django.urls import path

from parties.views import (
    MergeUndoView,
    OpeningBalanceView,
    PartiesView,
    PartyCardView,
    PartyDistinctView,
    PartyListView,
    PartyMergeView,
    PartyStatementView,
    ReceiptCorrectionView,
    ReceiptMatchView,
)

urlpatterns = [
    path("parties", PartiesView.as_view(), name="parties"),
    path("parties/list", PartyListView.as_view(), name="parties-list"),
    path("parties/<uuid:party_id>", PartyCardView.as_view(), name="parties-card"),
    path("parties/<uuid:party_id>/distinct", PartyDistinctView.as_view(), name="parties-distinct"),
    path(
        "parties/<uuid:party_id>/statement",
        PartyStatementView.as_view(),
        name="parties-statement",
    ),
    path("parties/<uuid:party_id>/merge", PartyMergeView.as_view(), name="parties-merge"),
    path("parties/merges/<uuid:merge_id>/undo", MergeUndoView.as_view(), name="parties-merge-undo"),
    path(
        "parties/receipts/<uuid:receipt_id>/correct",
        ReceiptCorrectionView.as_view(),
        name="parties-receipt-correct",
    ),
    path(
        "parties/receipts/<uuid:receipt_id>/match",
        ReceiptMatchView.as_view(),
        name="parties-receipt-match",
    ),
    path(
        "parties/<uuid:party_id>/opening-balance",
        OpeningBalanceView.as_view(),
        name="parties-opening",
    ),
]
