"""نقاط نهاية البيع: قائمة الفواتير وتفاصيلها (POS-09) ومراجعة التكرار التجاري (POS-12)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.models import Branch
from core.tenancy import tenant_context
from sales import duplicates
from sales.models import Sale


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _viewer(request: Request) -> home.Viewer:
    auth = request.auth
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


#: القرار «هذا تكرار» يُنشئ مستنداً عكسياً بأثر مالي — لمدير الفرع أو المالك (POS-12)
def _can_decide(v: home.Viewer) -> bool:
    return v.is_owner or v.role_code == "manager"


def _scope(v: home.Viewer, *, all_branches: bool) -> duplicates.ListScope:
    """المالك: فرعه أو كل الفروع بطلبه؛ المدير: فرعه؛ الكاشير: جهازه («الكاشير يرى نطاقه»)."""
    if v.is_owner:
        if all_branches:
            return duplicates.ListScope(branch_ids=None, device_id=None)
        return duplicates.ListScope(branch_ids=[v.branch.id] if v.branch else None, device_id=None)
    branch_ids = [v.branch.id] if v.branch else []
    if v.role_code == "manager":
        return duplicates.ListScope(branch_ids=branch_ids, device_id=None)
    return duplicates.ListScope(branch_ids=branch_ids, device_id=v.device.id if v.device else None)


class SalesListView(APIView):
    """POS-09: الفواتير في مدى (اليوم/الأسبوع) بنطاق المشاهد؛ المجاميع لمن يرى المال (REP-01
    بصلاحيته) — والقائمة قائمة مراجعة لحظية لا تقرير أداء."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("branch", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        rng = str(request.query_params.get("range", "today"))
        want_all = str(request.query_params.get("branch", "mine")) == "all"
        with tenant_context(tid):
            v = _viewer(request)
            if want_all and not v.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            scope = _scope(v, all_branches=want_all)
            now = timezone.now()
            today = timezone.localdate()
            start_day = timezone.make_aware(datetime(today.year, today.month, today.day))
            since = start_day - timedelta(days=6) if rng == "week" else start_day
            rows = duplicates.list_sales(scope, since=since)
            live = [r for r in rows if r["sync_state"] != "reversed"]
            last = duplicates.last_sale_at(scope)
            return Response(
                {
                    "scope": "all"
                    if scope.branch_ids is None
                    else ("device" if scope.device_id else "branch"),
                    "can_all_branches": v.is_owner,
                    "can_totals": v.can_see_finance,
                    "can_decide": _can_decide(v),
                    "role_name": v.role_name,
                    "branch_name": v.branch.name if v.branch else "",
                    "branches": [
                        {"id": str(b.id), "name": b.name} for b in Branch.objects.order_by("name")
                    ],
                    "as_of": now.isoformat(),
                    "range": "week" if rng == "week" else "today",
                    "rows": rows,
                    "totals": (
                        {
                            "count": len(live),
                            "total_minor": str(sum(int(r["total_minor"]) for r in live)),
                        }
                        if v.can_see_finance
                        else None
                    ),
                    "last_sale_at": last.isoformat() if last else "",
                }
            )


class SaleDetailView(APIView):
    """تفاصيل فاتورة بسطورها ودفعاتها ووضعها — في نطاق المشاهد."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, sale_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request)
            sale = Sale.objects.filter(id=sale_id).first()
            if sale is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            scope = _scope(v, all_branches=True)
            if scope.branch_ids is not None and sale.branch_id not in scope.branch_ids:
                return Response({"detail": "out_of_scope"}, status=status.HTTP_403_FORBIDDEN)
            if scope.device_id is not None and sale.device_id != scope.device_id:
                return Response({"detail": "out_of_scope"}, status=status.HTTP_403_FORBIDDEN)
            return Response(duplicates.sale_detail(sale))


class DuplicatesView(APIView):
    """POS-12: الأزواج المشتبه بها في نطاق المشاهد. الكاشير يرى الشاشة ويبلّغ فقط."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request)
            scope = _scope(v, all_branches=v.is_owner)
            return Response(
                {
                    "can_decide": _can_decide(v),
                    "role_name": v.role_name,
                    "user_name": v.user.display_name,
                    "window_days": duplicates.REVIEW_WINDOW.days,
                    "pairs": duplicates.suspected_pairs(scope.branch_ids),
                }
            )


class DuplicateDecideView(APIView):
    """«إلغاء المستند … بسبب» أو «الاثنان بيعان حقيقيان» — لمدير الفرع أو المالك."""

    permission_classes = (IsAuthenticated,)

    class DecideSerializer(serializers.Serializer[dict[str, Any]]):
        first_id = serializers.UUIDField()
        second_id = serializers.UUIDField()
        decision = serializers.ChoiceField(choices=("both_real", "reverse"))
        reason = serializers.CharField(allow_blank=True, required=False, default="")

    @extend_schema(request=DecideSerializer, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.DecideSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with tenant_context(tid):
            v = _viewer(request)
            if not _can_decide(v):
                return Response({"detail": "manager_required"}, status=status.HTTP_403_FORBIDDEN)
            first = Sale.objects.filter(id=d["first_id"]).first()
            second = Sale.objects.filter(id=d["second_id"]).first()
            if first is None or second is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            scope = _scope(v, all_branches=v.is_owner)
            if scope.branch_ids is not None and (
                first.branch_id not in scope.branch_ids or second.branch_id not in scope.branch_ids
            ):
                return Response({"detail": "out_of_scope"}, status=status.HTTP_403_FORBIDDEN)
            try:
                decision = duplicates.decide(
                    first,
                    second,
                    decision=str(d["decision"]),
                    reason=str(d.get("reason", "")),
                    actor=v.user,
                )
            except duplicates.DecisionRejected as e:
                return Response(
                    {
                        "detail": "validation_error",
                        "errors": [{"field": e.code, "code": "required"}],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "decision": decision.decision,
                    "decided_by_name": decision.decided_by_name,
                    "second": duplicates.sale_detail(second),
                },
                status=status.HTTP_201_CREATED,
            )


class DuplicateReportView(APIView):
    """«أبلغ عن اشتباه» — متاح للكاشير على فاتورة في نطاقه."""

    permission_classes = (IsAuthenticated,)

    class ReportSerializer(serializers.Serializer[dict[str, Any]]):
        note = serializers.CharField(allow_blank=True, required=False, default="", max_length=300)

    @extend_schema(request=ReportSerializer, responses={201: None, 403: None, 404: None})
    def post(self, request: Request, sale_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.ReportSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with tenant_context(tid):
            v = _viewer(request)
            sale = Sale.objects.filter(id=sale_id).first()
            if sale is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            scope = _scope(v, all_branches=v.is_owner)
            if scope.branch_ids is not None and sale.branch_id not in scope.branch_ids:
                return Response({"detail": "out_of_scope"}, status=status.HTTP_403_FORBIDDEN)
            rep = duplicates.report_suspicion(
                sale, reporter=v.user, note=str(ser.validated_data.get("note", ""))
            )
            return Response(
                {"id": str(rep.id), "reported_by_name": rep.reported_by_name},
                status=status.HTTP_201_CREATED,
            )
