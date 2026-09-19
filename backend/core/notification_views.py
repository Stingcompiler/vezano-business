"""NOT-01/NOT-02: الوارد، وسم القراءة، فتح الرابط بصلاحيته، التفضيلات."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home, notifications
from core.auth.tokens import AuthContext
from core.models import Notification
from core.tenancy import tenant_context


def _ctx(auth: Any) -> tuple[Any, home.Viewer | None]:
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        return None, None
    return auth.tenant_id, None


def _viewer(auth: Any) -> home.Viewer:
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


class InboxView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("category", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid, _ = _ctx(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            return Response(
                notifications.inbox(v, category=str(request.query_params.get("category", "")))
            )


class NotificationActionView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, notification_id: uuid.UUID, action: str) -> Response:
        tid, _ = _ctx(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(request.auth)
            n = Notification.objects.filter(id=notification_id).first()
            if n is None:
                return Response({"detail": "not_found"}, status=404)
            if action == "read":
                if n.owner_only and not v.is_owner:
                    return Response({"detail": "permission_denied"}, status=403)
                notifications.mark_read(n, v.user)
                return Response({"item": notifications.item_payload(n, v)})
            if action == "open":
                out = notifications.open_link(n, v, token=str(body.get("token", "")))
                code = 403 if out["status"] == "permission_denied" else 200
                return Response(out, status=code)
            return Response({"detail": "unknown_action"}, status=404)


class PreferencesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid, _ = _ctx(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            return Response(notifications.prefs_payload(v.user))

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def put(self, request: Request) -> Response:
        tid, _ = _ctx(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(request.auth)
            try:
                out = notifications.save_prefs(
                    v.user,
                    prefs=dict(body.get("prefs") or {}),
                    email=body.get("email") if "email" in body else None,
                )
            except notifications.PrefsRejected as e:
                return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=400)
            return Response(out)
