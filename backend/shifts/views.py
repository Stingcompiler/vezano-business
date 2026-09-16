"""نقاط نهاية SHIFT-01/02 (T1.11): الوردية الحالية للفرع (إسقاط خادمي للمطابقة) ووردية بعينها."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth.tokens import AuthContext
from core.models import Branch
from core.tenancy import tenant_context
from shifts import services
from shifts.models import Shift


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


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
