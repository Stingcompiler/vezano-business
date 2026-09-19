"""REP-01/REP-02 — تقرير المبيعات وتقرير الذمم: القراءة لمن يرى المال (المالك ومدير الفرع)؛
الكاشير يرى رصيد الطرف الذي يبيع له وقت البيع لا التقرير كاملاً. التصدير CSV يحمل سطر الاكتمال."""

from __future__ import annotations

from typing import Any

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from parties import reports as party_reports
from sales import reports as sales_reports


def _tenant(auth: Any) -> Any:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _viewer(auth: Any) -> home.Viewer:
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


def _csv(body: str, name: str) -> HttpResponse:
    resp = HttpResponse(body, content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    return resp


class SalesReportView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("start", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("end", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("method", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("export", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response | HttpResponse:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        q = request.query_params
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not v.can_see_finance:
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name},
                    status=status.HTTP_403_FORBIDDEN,
                )
            rng = sales_reports.parse_range(
                str(q.get("range", "today")), start=q.get("start"), end=q.get("end")
            )
            payload = sales_reports.sales_report(
                viewer=v,
                rng=rng,
                branch_id=q.get("branch_id") or None,
                method=str(q.get("method", "all")),
            )
            if q.get("export") == "csv":
                return _csv(sales_reports.export_csv(payload), "sales-report.csv")
            return Response(payload)


class ReceivablesReportView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("side", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("export", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response | HttpResponse:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        q = request.query_params
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not v.can_see_finance:
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name},
                    status=status.HTTP_403_FORBIDDEN,
                )
            payload = party_reports.receivables_report(
                viewer=v, side=str(q.get("side", "customers"))
            )
            if q.get("export") == "csv":
                return _csv(party_reports.export_csv(payload), "receivables-report.csv")
            return Response(payload)
