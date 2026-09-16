"""نقاط نهاية CAT-04 (سعر صنف وتاريخه) وCAT-05 (استيراد أو تعديل أسعار متعدد) — T1.10.

- `GET/POST catalog/items/{id}/price`: السعر وتاريخه؛ التغيير للمالك (403 `price_owner_only`)؛
  سعر دون التكلفة → 409 `below_cost` بالهامش حتى يُؤكَّد (لمن يرى التكلفة فقط).
- `POST catalog/items/{id}/price-request`: «اطلب تغييراً» لمن لا يغيّر.
- `POST catalog/prices/import/preview` ثم `.../{batch}/apply|revert`، و`GET .../{batch}`
  و`.../rejected.csv`.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog import prices
from catalog.limits import Rejected
from catalog.models import Item, PriceImportBatch
from catalog.views import _rejected, _tenant
from core import home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context


def _viewer(request: Request) -> home.Viewer:
    auth = request.auth
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


def _can_change(v: home.Viewer) -> bool:
    return v.is_owner or v.role_code in prices.PRICE_ROLES


def _can_see_cost(v: home.Viewer) -> bool:
    return v.is_owner or v.role_code in prices.COST_ROLES


class ItemPriceView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            v = _viewer(request)
            return Response(
                prices.price_view(item, can_change=_can_change(v), can_see_cost=_can_see_cost(v))
            )

    class PriceSetSerializer(serializers.Serializer[dict[str, Any]]):
        price_minor = serializers.CharField()
        confirm_below_cost = serializers.BooleanField(required=False, default=False)

    @extend_schema(
        request=PriceSetSerializer,
        responses={200: None, 400: None, 403: None, 404: None, 409: None},
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.PriceSetSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            v = _viewer(request)
            if not _can_change(v):
                return Response(
                    {"detail": "price_owner_only", "role_name": v.role_name},
                    status=status.HTTP_403_FORBIDDEN,
                )
            try:
                row = prices.set_price(
                    item,
                    str(d["price_minor"]),
                    changed_by=v.user,
                    confirm_below_cost=bool(d.get("confirm_below_cost")),
                    can_see_cost=_can_see_cost(v),
                )
            except Rejected as e:
                return _rejected(e)
            except prices.BelowCost as e:
                return Response(
                    {
                        "detail": "below_cost",
                        "average_cost_minor": str(e.cost_minor),
                        "price_minor": str(e.price_minor),
                        "margin_minor": str(e.margin_minor),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            out = prices.price_view(item, can_change=True, can_see_cost=_can_see_cost(v))
            out["changed"] = row is not None
            return Response(out)


class PriceRequestView(APIView):
    permission_classes = (IsAuthenticated,)

    class PriceRequestSerializer(serializers.Serializer[dict[str, Any]]):
        proposed_price_minor = serializers.CharField()
        reason = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    @extend_schema(
        request=PriceRequestSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.PriceRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            v = _viewer(request)
            try:
                req = prices.request_change(
                    item,
                    str(d["proposed_price_minor"]),
                    str(d.get("reason", "")),
                    requested_by=v.user,
                )
            except Rejected as e:
                return _rejected(e)
            return Response(
                {
                    "id": str(req.id),
                    "item_id": str(item.id),
                    "proposed_price_minor": str(req.proposed_price_minor),
                    "reason": req.reason,
                    "status": req.status,
                    "requested_at": req.requested_at.isoformat().replace("+00:00", "Z"),
                },
                status=201,
            )


def _bulk_guard(request: Request, tid: uuid.UUID) -> Response | None:
    v = _viewer(request)
    if not _can_change(v):
        return Response(
            {"detail": "price_owner_only", "role_name": v.role_name},
            status=status.HTTP_403_FORBIDDEN,
        )
    if prices.bulk_pricing_blocked(tid):
        return Response({"detail": "bulk_pricing_blocked"}, status=status.HTTP_403_FORBIDDEN)
    return None


class ImportPreviewView(APIView):
    """المعاينة تقرأ كاملاً ولا تكتب شيئاً؛ الملف نفسه يعيد دفعته."""

    permission_classes = (IsAuthenticated,)

    class ImportPreviewSerializer(serializers.Serializer[dict[str, Any]]):
        file_name = serializers.CharField()
        content = serializers.CharField(allow_blank=True, trim_whitespace=False)

    @extend_schema(request=ImportPreviewSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ImportPreviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            denied = _bulk_guard(request, tid)
            if denied is not None:
                return denied
            b = prices.preview_batch(
                file_name=str(d["file_name"]),
                content=str(d["content"]),
                created_by=_viewer(request).user,
            )
            return Response(prices.batch_payload(b))


class ImportBatchView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            b = PriceImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(prices.batch_payload(b))


class ImportApplyView(APIView):
    """يطبّق على دفعات صغيرة؛ الاستدعاء مرة أخرى يستأنف بلا تكرار."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=inline_serializer(
            "ImportApply", {"stop_after": serializers.IntegerField(required=False)}
        ),
        responses={200: None, 403: None, 404: None},
    )
    def post(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            denied = _bulk_guard(request, tid)
            if denied is not None:
                return denied
            b = PriceImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            body = request.data if isinstance(request.data, dict) else {}
            stop_after = body.get("stop_after")
            # `stop_after` لمحاكاة الانقطاع في الاختبار فقط (خلف حارس السيناريو)
            from core.scenario import faults

            stop = int(stop_after) if stop_after is not None and faults.enabled() else None
            b = prices.apply_batch(b, applied_by=_viewer(request).user, stop_after=stop)
            return Response(prices.batch_payload(b))


class ImportRevertView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            denied = _bulk_guard(request, tid)
            if denied is not None:
                return denied
            b = PriceImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                b = prices.revert_batch(b, reverted_by=_viewer(request).user)
            except prices.RevertRefused as e:
                return Response(
                    {"detail": "revert_refused", "reason": e.reason, **e.extra},
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(prices.batch_payload(b))


class ImportRejectedView(APIView):
    """المرفوض بسببه ورقم سطره — يُنزَّل ليُصحَّح ويُعاد (R-06)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={(200, "text/csv"): None, 403: None, 404: None})
    def get(self, request: Request, batch_id: uuid.UUID) -> HttpResponse:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            b = PriceImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            resp = HttpResponse(prices.rejected_csv(b), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = 'attachment; filename="rejected.csv"'
            return resp
