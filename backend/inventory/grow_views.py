"""GROW-01/02 (M4 — T3.27): اقتراح إعادة التوريد وتحليلات المورد — خلف علم `market_m4`."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from inventory import grow, purchasing


def _reject(e: grow.GrowRejected) -> Response:
    code = 403 if e.code == "permission_denied" else 423 if e.code == "phase_locked" else 400
    return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=code)


class GrowReplenishView(APIView):
    """GROW-01: الاقتراح بختمه الزمني (`?compute=1` يعيد الحساب الآن)؛ `POST` يحوّل المختار إلى
    أمر شراء (PUR-02)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("compute", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            v = home.viewer_for(auth.user, auth.device)
            try:
                p = grow.replenish_payload(
                    v, compute_now=str(request.query_params.get("compute") or "") == "1"
                )
            except grow.GrowRejected as e:
                return _reject(e)
            if p.get("state") == "permission_denied" and "rows" not in p:
                return Response({"detail": "permission_denied", **p}, status=403)
            return Response(p)

    @extend_schema(request=None, responses={200: None, 201: None, 400: None, 403: None, 423: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(auth.tenant_id):
            v = home.viewer_for(auth.user, auth.device)
            try:
                if str(body.get("action") or "") == "forward":
                    f = grow.forward_suggestion(actor=auth.user, viewer=v, body=body)
                    return Response({"forwarded": f}, status=200)
                o = grow.order_from_selection(actor=auth.user, viewer=v, body=body)
            except grow.GrowRejected as e:
                return _reject(e)
            return Response({"order": purchasing.order_payload(o)}, status=201)


class GrowSuppliersView(APIView):
    """GROW-02: تحليلات المورد بختمها الزمني (`?compute=1` يعيد الحساب الآن)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("compute", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            v = home.viewer_for(auth.user, auth.device)
            p = grow.suppliers_payload(
                v, compute_now=str(request.query_params.get("compute") or "") == "1"
            )
            if p.get("state") == "permission_denied":
                return Response({"detail": "permission_denied", **p}, status=403)
            return Response(p)
