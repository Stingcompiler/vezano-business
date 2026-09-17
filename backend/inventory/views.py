"""نقاط نهاية المخزون: INV-01 أرصدة فرع (كل صنف له حركة؛ السالب يُعرض لا يُصفَّر) وINV-02 سجل حركة
الصنف (كل حركة لها مصدر ومستند). المالك يرى أي فرع؛ غيره فرعه."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
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
