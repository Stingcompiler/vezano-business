"""نقاط نهاية المخزون: INV-01 أرصدة فرع (كل صنف له حركة؛ السالب يُعرض لا يُصفَّر) وINV-02 سجل حركة
الصنف (كل حركة لها مصدر ومستند). المالك يرى أي فرع؛ غيره فرعه."""

from __future__ import annotations

import uuid
from datetime import timedelta
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
from inventory import services


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except (ValueError, TypeError):
        return None


def _resolve_branch(
    request: Request, viewer: home.Viewer
) -> tuple[uuid.UUID | None, Response | None]:
    """فرع الطلب: `branch_id` للمالك، وفرع الجلسة لغيره (فرع آخر → 403)."""
    raw = str(request.query_params.get("branch_id", ""))
    own = viewer.branch.id if viewer.branch is not None else None
    wanted = _uuid(raw) or own
    if wanted is None:
        return None, Response({"detail": "branch_required"}, status=status.HTTP_400_BAD_REQUEST)
    if not viewer.is_owner and wanted != own:
        return None, Response({"detail": "branch_forbidden"}, status=status.HTTP_403_FORBIDDEN)
    if not Branch.objects.filter(id=wanted).exists():
        return None, Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
    return wanted, None


class StockBalancesView(APIView):
    """INV-01: أرصدة فرع بالوحدة الأساسية مع وحدة الشراء ومعاملها قراءةً مساعدة (R-08) — لا
    مجموع كمّي عبر وحدات مختلفة؛ لكل رصيد تغطية زمنية `as_of`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 400: None, 403: None, 404: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            branch_id, err = _resolve_branch(request, viewer)
            if err is not None or branch_id is None:
                return err or Response(status=status.HTTP_400_BAD_REQUEST)
            branches = (
                Branch.objects.all().order_by("name")
                if viewer.is_owner
                else Branch.objects.filter(id=branch_id)
            )
            return Response(
                {
                    "branch_id": str(branch_id),
                    "branches": [{"id": str(b.id), "name": b.name} for b in branches],
                    "as_of": timezone.now().isoformat().replace("+00:00", "Z"),
                    "rows": services.stock_rows(branch_id),
                }
            )


class ItemMovementsView(APIView):
    """INV-02: سجل حركة الصنف في فرع — الرصيد بعد كل حركة من كل الحركات ثم يُقتطع المدى."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 400: None, 403: None, 404: None},
    )
    def get(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        rng = str(request.query_params.get("range", "30"))
        with tenant_context(tid):
            from catalog.models import Item

            viewer = home.viewer_for(auth.user, auth.device)
            branch_id, err = _resolve_branch(request, viewer)
            if err is not None or branch_id is None:
                return err or Response(status=status.HTTP_400_BAD_REQUEST)
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            since = None if rng == "all" else timezone.now() - timedelta(days=30)
            body = services.item_movements(item_id, branch_id, since)
            body["item"] = {
                "id": str(item.id),
                "name": item.name,
                "sale_unit": services.unit_fields(item.base_unit),
            }
            body["branch_id"] = str(branch_id)
            body["branch_name"] = Branch.objects.get(id=branch_id).name
            body["range"] = "all" if rng == "all" else "30"
            body["as_of"] = timezone.now().isoformat().replace("+00:00", "Z")
            return Response(body)


class OpeningsView(APIView):
    """INV-03: افتتاحيات المخزون — مستند واحد يُراجَع قبل الاعتماد. المالك يعتمد فوراً؛ غيره يُرسل
    للاعتماد («أُرسلت للاعتماد» لا زرّ رمادي بلا تفسير)."""

    permission_classes = (IsAuthenticated,)

    class StockOpeningLineSerializer(serializers.Serializer[dict[str, Any]]):
        item_id = serializers.CharField()
        unit_code = serializers.CharField(required=False, allow_blank=True, default="")
        unit_name = serializers.CharField(required=False, allow_blank=True, default="")
        factor_milli = serializers.CharField(required=False, allow_blank=True, default="1000")
        qty_milli = serializers.CharField()
        unit_cost_minor = serializers.CharField(required=False, allow_blank=True, default="")

    class StockOpeningSerializer(serializers.Serializer[dict[str, Any]]):
        branch_id = serializers.CharField(required=False, allow_blank=True, default="")
        lines = serializers.ListField(child=serializers.DictField(), allow_empty=True)

    @extend_schema(
        parameters=[OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 400: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            from inventory.models import StockOpening

            viewer = home.viewer_for(auth.user, auth.device)
            branch_id, err = _resolve_branch(request, viewer)
            if err is not None or branch_id is None:
                return err or Response(status=status.HTTP_400_BAD_REQUEST)
            rows = StockOpening.objects.filter(branch_id=branch_id).order_by("-created_at")
            return Response(
                {
                    "branch_id": str(branch_id),
                    "can_approve": viewer.is_owner,
                    "openings": [services.opening_payload(o) for o in rows],
                    "opened_item_ids": [str(i) for i in services.opened_items(branch_id)],
                    "moved_item_ids": [str(i) for i in services.branch_balances(branch_id)],
                }
            )

    @extend_schema(
        request=StockOpeningSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.StockOpeningSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            own = viewer.branch.id if viewer.branch is not None else None
            wanted = _uuid(d.get("branch_id")) or own
            if wanted is None:
                return Response({"detail": "branch_required"}, status=status.HTTP_400_BAD_REQUEST)
            if not viewer.is_owner and wanted != own:
                return Response({"detail": "branch_forbidden"}, status=status.HTTP_403_FORBIDDEN)
            branch = Branch.objects.filter(id=wanted).first()
            if branch is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                opening = services.create_opening(
                    branch=branch,
                    lines=list(d["lines"]),
                    actor=viewer.user,
                    approve=viewer.is_owner,
                )
            except services.OpeningRejected as e:
                return Response(
                    {
                        "detail": "validation_error",
                        "errors": [{"line": i, "field": f, "code": c} for i, f, c in e.errors],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {"opening": services.opening_payload(opening)}, status=status.HTTP_201_CREATED
            )


class OpeningApproveView(APIView):
    """اعتماد افتتاحية مُرسلة — صلاحية المالك أو من فوّضه؛ يُنشئ الرصيد."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, opening_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            from inventory.models import StockOpening

            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            opening = StockOpening.objects.filter(id=opening_id).select_related("branch").first()
            if opening is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                services.approve_opening(opening, actor=viewer.user)
            except services.OpeningRejected as e:
                return Response(
                    {
                        "detail": "validation_error",
                        "errors": [{"line": i, "field": f, "code": c} for i, f, c in e.errors],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response({"opening": services.opening_payload(opening)})


class CountSessionsView(APIView):
    """جلسات الجرد المغلقة للفرع (INV-06 يُفتح على واحدة منها)."""

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
        with tenant_context(tid):
            from inventory.models import CountSession

            viewer = home.viewer_for(auth.user, auth.device)
            branch_id, err = _resolve_branch(request, viewer)
            if err is not None or branch_id is None:
                return err or Response(status=status.HTTP_400_BAD_REQUEST)
            rows = CountSession.objects.filter(branch_id=branch_id).order_by("-closed_at")[:20]
            return Response(
                {
                    "branch_id": str(branch_id),
                    "can_adjust": viewer.can_see_finance,
                    "sessions": [
                        {
                            "id": str(s.id),
                            "session_number": s.session_number,
                            "status": s.status,
                            "user_name": s.user_name,
                            "counted_items": s.lines.count(),
                            "total_items": s.total_items,
                            "closed_at": s.closed_at.isoformat().replace("+00:00", "Z"),
                        }
                        for s in rows
                    ],
                }
            )


class CountSessionReviewView(APIView):
    """INV-06: مراجعة فروق الجرد وتسوية — لا فرق يُمرَّر بلا سبب مكتوب؛ التسوية تحتاج صلاحية مالية
    («من يعدّ ليس من يسوّي»)؛ العدّ الأصلي محفوظ كما أُدخل ولا يُعاد كتابته."""

    permission_classes = (IsAuthenticated,)

    class AdjustSerializer(serializers.Serializer[dict[str, Any]]):
        reasons = serializers.DictField(child=serializers.CharField(allow_blank=True))

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, session_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            from inventory.models import CountSession

            viewer = home.viewer_for(auth.user, auth.device)
            session = CountSession.objects.filter(id=session_id).select_related("branch").first()
            if session is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            own = viewer.branch.id if viewer.branch is not None else None
            if not viewer.is_owner and session.branch_id != own:
                return Response({"detail": "branch_forbidden"}, status=status.HTTP_403_FORBIDDEN)
            body = services.session_variances(session)
            body["can_adjust"] = viewer.can_see_finance
            return Response(body)

    @extend_schema(request=AdjustSerializer, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, session_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.AdjustSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        reasons = {str(k): str(v) for k, v in dict(ser.validated_data["reasons"]).items()}
        with tenant_context(tid):
            from inventory.models import CountSession

            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.can_see_finance:
                return Response({"detail": "finance_required"}, status=status.HTTP_403_FORBIDDEN)
            session = CountSession.objects.filter(id=session_id).select_related("branch").first()
            if session is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                adj = services.adjust_session(session, reasons=reasons, actor=viewer.user)
            except services.AdjustmentRejected as e:
                return Response(
                    {
                        "detail": "validation_error",
                        "errors": [{"item_id": i, "field": f, "code": c} for i, f, c in e.errors],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            body = services.session_variances(session)
            body["adjustment"] = services.adjustment_payload(adj)
            body["can_adjust"] = True
            return Response(body, status=status.HTTP_201_CREATED)
