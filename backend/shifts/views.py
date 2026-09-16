"""نقاط نهاية الورديات: الوردية الحالية للفرع (SHIFT-01/02)، وردية بعينها، طلب سحب (SHIFT-03)،
ومراجعة الفروق والعمليات المتأخرة (SHIFT-05)."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.limits import PRICE_MAX_MINOR, FieldError, Rejected, check_integer
from core import home
from core.auth.tokens import AuthContext
from core.models import Branch
from core.tenancy import tenant_context
from shifts import services
from shifts.models import Shift


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _viewer(request: Request) -> home.Viewer:
    auth = request.auth
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


#: السحب يُخرج النقد من دورة المحل إلى خارجها — للمالك وحده (SHIFT-03 permission_denied)
def _can_withdraw(v: home.Viewer) -> bool:
    return v.is_owner


#: التسوية إقرار مالي بقبول الفارق — للمالك وحده؛ المدير يراجع ويعلّق ولا يُسوّي (SHIFT-05)
def _can_settle(v: home.Viewer) -> bool:
    return v.is_owner


class CurrentShiftView(APIView):
    """الوردية المفتوحة للفرع: من جهاز الجلسة أو `branch_id`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 400: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        raw = str(request.query_params.get("branch_id", "")) or (
            str(auth.device.branch_id) if auth.device is not None else ""
        )
        try:
            branch_id = uuid.UUID(raw)
        except ValueError:
            return Response({"detail": "branch_required"}, status=status.HTTP_400_BAD_REQUEST)
        with tenant_context(tid):
            branch = Branch.objects.filter(id=branch_id).first()
            return Response(
                {
                    "branch_id": str(branch_id),
                    "branch_name": branch.name if branch else "",
                    "device_name": auth.device.name if auth.device is not None else "",
                    "user_name": auth.user.display_name,
                    "role_name": _viewer(request).role_name,
                    "can_withdraw": _can_withdraw(_viewer(request)),
                    "owner_name": services.owner_name(),
                    **services.current_for_branch(branch_id),
                }
            )


class ShiftView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(services.shift_payload(shift))


class MovementRequestView(APIView):
    """«اطلب من المالك»: طلب سحب بالمبلغ والسبب (SHIFT-03 permission_denied)."""

    permission_classes = (IsAuthenticated,)

    class RequestSerializer(serializers.Serializer[dict[str, Any]]):
        kind = serializers.ChoiceField(choices=["withdrawal"])
        amount_minor = serializers.CharField()
        reason = serializers.CharField(allow_blank=False, trim_whitespace=False)

    @extend_schema(
        request=RequestSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.RequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            errs = check_integer("amount_minor", str(d["amount_minor"]), 1, PRICE_MAX_MINOR)
            if errs:
                return Response(Rejected(errs).as_response(), status=status.HTTP_400_BAD_REQUEST)
            v = _viewer(request)
            req = services.request_movement(
                shift,
                kind=str(d["kind"]),
                amount_minor=int(d["amount_minor"]),
                reason=str(d["reason"]),
                requested_by=v.user,
            )
            return Response(
                {
                    "id": str(req.id),
                    "shift_id": str(shift.id),
                    "kind": req.kind,
                    "amount_minor": str(req.amount_minor),
                    "reason": req.reason,
                    "status": req.status,
                    "requested_by_name": req.requested_by_name,
                    "owner_name": services.owner_name(),
                },
                status=201,
            )


class ShiftReviewView(APIView):
    """SHIFT-05: سجل ورديات الأسبوع بفوارقها والمتأخر عنها. المالك يرى كل الفروع؛ غيره يرى فرعه
    («مدير الفرع يرى فرعه») ولا يُسوّي."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request)
            scope_branch = None if v.is_owner else (v.branch.id if v.branch else None)
            if not v.is_owner and scope_branch is None:
                return Response({"detail": "branch_required"}, status=status.HTTP_403_FORBIDDEN)
            return Response(
                {
                    "scope": "all" if v.is_owner else "branch",
                    "can_settle": _can_settle(v),
                    "role_name": v.role_name,
                    "user_name": v.user.display_name,
                    "branch_name": v.branch.name if v.branch else "",
                    "window_days": services.REVIEW_WINDOW.days,
                    "shifts": services.review_rows(scope_branch),
                }
            )


class ShiftReviewActionView(APIView):
    """«إقرار المراجعة»: تسوية بقيمة الفارق باسم المالك وسببه، وتُقرّ معها الحركات المتأخرة."""

    permission_classes = (IsAuthenticated,)

    class ReviewSerializer(serializers.Serializer[dict[str, Any]]):
        reason = serializers.CharField(allow_blank=True, required=False, default="")

    @extend_schema(request=ReviewSerializer, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ReviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(tid):
            v = _viewer(request)
            if not _can_settle(v):
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            if shift.state != "closed":
                return Response({"detail": "shift_open"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                adj = services.record_review(
                    shift, approver=v.user, reason=str(s.validated_data.get("reason", ""))
                )
            except services.ReviewRejected:
                return Response(
                    Rejected([FieldError("reason", "required")]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "id": str(adj.id),
                    "shift_id": str(shift.id),
                    "signed_amount_minor": str(adj.signed_amount_minor),
                    "approved_by_name": adj.approved_by_name,
                    "reason": adj.reason,
                    "late_item_ids": adj.late_item_ids,
                    "occurred_at": services._iso(adj.occurred_at),
                    "row": services.review_row(shift),
                },
                status=201,
            )
