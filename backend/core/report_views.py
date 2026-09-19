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


class StockReportView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("start", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("end", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("export", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response | HttpResponse:
        from inventory import reports as stock_reports

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
                str(q.get("range", "30d")), start=q.get("start"), end=q.get("end")
            )
            payload = stock_reports.stock_report(
                viewer=v, rng=rng, branch_id=q.get("branch_id") or None
            )
            if q.get("export") == "csv":
                return _csv(stock_reports.export_csv(payload), "stock-report.csv")
            return Response(payload)


class CashReportView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("start", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("end", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("export", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response | HttpResponse:
        from shifts import reports as cash_reports

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
                str(q.get("range", "7d")), start=q.get("start"), end=q.get("end")
            )
            payload = cash_reports.cash_report(
                viewer=v, rng=rng, branch_id=q.get("branch_id") or None
            )
            if q.get("export") == "csv":
                return _csv(cash_reports.export_csv(payload), "cash-report.csv")
            return Response(payload)


class MarginReportView(APIView):
    """REP-05: للمالك وحده — «من يرى الهامش يرى التكلفة بالطرح، فالحجب الجزئي وهم»؛ الشاشة كلها
    محجوبة لغيره (تبقى في القائمة بقفل ظاهر)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("start", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("end", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        from sales import margin

        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        q = request.query_params
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not v.is_owner:
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name},
                    status=status.HTTP_403_FORBIDDEN,
                )
            rng = sales_reports.parse_range(
                str(q.get("range", "30d")), start=q.get("start"), end=q.get("end")
            )
            return Response(margin.margin_report(viewer=v, rng=rng))


def _export_error(e: Any) -> Response:
    return Response({"detail": e.code, "extra": e.extra}, status=400)


class ReportExportPreviewView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("report", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("start", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("end", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("format", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 400: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        from core import report_export

        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        q = request.query_params
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not v.can_see_finance:
                return Response({"detail": "permission_denied"}, status=status.HTTP_403_FORBIDDEN)
            rng = sales_reports.parse_range(
                str(q.get("range", "30d")), start=q.get("start"), end=q.get("end")
            )
            try:
                return Response(
                    report_export.preview(
                        viewer=v,
                        report=str(q.get("report", "sales")),
                        rng=rng,
                        fmt=str(q.get("format", "html")),
                        branch_id=q.get("branch_id") or None,
                        monthly=q.get("summary") == "monthly",
                    )
                )
            except report_export.ExportRejected as e:
                return _export_error(e)


class ReportExportsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        from core import report_export
        from core.models import ReportExport

        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not v.can_see_finance:
                return Response({"detail": "permission_denied"}, status=status.HTTP_403_FORBIDDEN)
            rows = ReportExport.objects.order_by("-generated_at")[:20]
            return Response(
                {
                    "exports": [report_export.export_payload(e) for e in rows],
                    "quota": report_export.quota(),
                    "months_limit": report_export.MONTHS_LIMIT,
                }
            )

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        from core import report_export

        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            if not v.can_see_finance:
                return Response({"detail": "permission_denied"}, status=status.HTTP_403_FORBIDDEN)
            rng = sales_reports.parse_range(
                str(body.get("range", "30d")), start=body.get("start"), end=body.get("end")
            )
            try:
                e = report_export.generate(
                    actor=auth.user,
                    viewer=v,
                    report=str(body.get("report", "sales")),
                    rng=rng,
                    fmt=str(body.get("format", "html")),
                    branch_id=body.get("branch_id") or None,
                    monthly=body.get("summary") == "monthly",
                )
            except report_export.ExportRejected as ex:
                return _export_error(ex)
            return Response({"export": report_export.export_payload(e)}, status=201)


class ReportExportDocumentView(APIView):
    """التنزيل بالرابط المخوَّل: المستند كما وُلِّد حرفياً — لا يُعاد الحساب."""

    permission_classes = ()
    authentication_classes = ()

    @extend_schema(responses={200: None, 404: None})
    def get(self, request: Request, token: str) -> HttpResponse:
        from core import report_export

        e = report_export.open_export(token)
        if e is None:
            return HttpResponse("لا يوجد", status=404, content_type="text/plain; charset=utf-8")
        ctype = "text/csv; charset=utf-8" if e.fmt == "csv" else "text/html; charset=utf-8"
        resp = HttpResponse(e.body, content_type=ctype)
        if e.fmt == "csv" or request.query_params.get("download") == "1":
            resp["Content-Disposition"] = f'attachment; filename="{e.file_name}"'
        return resp


class ReportExportLimitRequestView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        from core import report_export

        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            if not v.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            try:
                months = int(body.get("months", 0))
            except (TypeError, ValueError):
                months = 0
            return Response(report_export.request_wider_limit(actor=auth.user, months=months))
