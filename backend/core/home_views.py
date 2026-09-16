"""نقاط نهاية HOME (T1.7): الرئيسية (مالك/موظف)، البحث العام، الإشعارات السريعة."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context


def _viewer(auth: Any) -> home.Viewer | None:
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        return None
    return home.viewer_for(auth.user, auth.device)


class HomeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("period", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={
            200: inline_serializer("HomeSummary", {"kind": serializers.CharField()}),
            403: None,
        },
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        period = str(request.query_params.get("period", "today"))
        branch_id = str(request.query_params.get("branch_id", ""))
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            return Response(
                home.home_summary(auth.tenant_id, viewer, period=period, branch_id=branch_id)
            )


class SearchView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("q", str, OpenApiParameter.QUERY, required=True)],
        responses={
            200: inline_serializer("SearchResult", {"query": serializers.CharField()}),
            403: None,
        },
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        q = str(request.query_params.get("q", "")).strip()
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            return Response(home.search(viewer, q))


class NoticesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        responses={
            200: inline_serializer("Notices", {"needs_action": serializers.IntegerField()}),
            403: None,
        }
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            return Response(home.notices(auth.tenant_id, viewer))
