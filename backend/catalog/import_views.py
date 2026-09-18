"""استيراد بيانات بمعاينة (SYS-10): معاينة بمطابقة أعمدة → قرارات المكرر → تطبيق على دفعات
قابلة للاستئناف → تراجع خلال 24 ساعة → ملف المرفوضات. المالك ومدير الفرع فقط."""

from __future__ import annotations

import uuid
from typing import Any

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog import imports
from catalog.limits import Rejected
from catalog.models import DataImportBatch
from catalog.price_views import _viewer
from catalog.views import _tenant
from core.scenario import faults
from core.tenancy import tenant_context


def _guard(request: Request) -> Response | None:
    v = _viewer(request)
    if not (v.is_owner or v.role_code == "manager"):
        return Response(
            {"detail": "import_owner_or_manager", "role_name": v.role_name},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


class DataImportPreviewSerializer(serializers.Serializer[dict[str, Any]]):
    kind = serializers.ChoiceField(choices=("items", "parties"))
    file_name = serializers.CharField()
    content = serializers.CharField(allow_blank=True, trim_whitespace=False)
    mapping = serializers.DictField(child=serializers.IntegerField(), required=False)


class DataImportPreviewView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=DataImportPreviewSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = DataImportPreviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            denied = _guard(request)
            if denied is not None:
                return denied
            b, headers, suggested = imports.preview(
                kind=str(d["kind"]),
                file_name=str(d["file_name"]),
                content=str(d["content"]),
                mapping=dict(d["mapping"]) if d.get("mapping") else None,
                created_by=_viewer(request).user,
            )
            return Response(
                {**imports.batch_payload(b), "headers": headers, "suggested_mapping": suggested}
            )


class DataImportBatchView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            b = DataImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(imports.batch_payload(b))


class DataImportDecideSerializer(serializers.Serializer[dict[str, Any]]):
    decisions = serializers.DictField(child=serializers.ChoiceField(choices=("keep", "skip")))


class DataImportDecideView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=DataImportDecideSerializer, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = DataImportDecideSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(tid):
            denied = _guard(request)
            if denied is not None:
                return denied
            b = DataImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(
                imports.batch_payload(imports.decide(b, dict(s.validated_data["decisions"])))
            )


class DataImportApplySerializer(serializers.Serializer[dict[str, Any]]):
    stop_after = serializers.IntegerField(required=False)


class DataImportApplyView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=DataImportApplySerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = DataImportApplySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(tid):
            denied = _guard(request)
            if denied is not None:
                return denied
            b = DataImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            stop_after = s.validated_data.get("stop_after")
            # `stop_after` لمحاكاة الانقطاع في الاختبار فقط (خلف حارس السيناريو)
            stop = int(stop_after) if stop_after is not None and faults.enabled() else None
            try:
                b = imports.apply(b, applied_by=_viewer(request).user, stop_after=stop)
            except Rejected:
                return Response({"detail": "decisions_pending"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(imports.batch_payload(b))


class DataImportRevertView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, batch_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            denied = _guard(request)
            if denied is not None:
                return denied
            b = DataImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return Response({"detail": "batch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                b = imports.revert(b, reverted_by=_viewer(request).user)
            except imports.RevertRefused as e:
                return Response({"detail": e.reason, **e.extra}, status=status.HTTP_409_CONFLICT)
            return Response(imports.batch_payload(b))


class DataImportRejectedView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={(200, "text/csv"): None, 403: None, 404: None})
    def get(self, request: Request, batch_id: uuid.UUID) -> HttpResponse:
        tid = _tenant(request.auth)
        if tid is None:
            return HttpResponse(status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            b = DataImportBatch.objects.filter(id=batch_id).first()
            if b is None:
                return HttpResponse(status=status.HTTP_404_NOT_FOUND)
            body = imports.rejected_csv(b)
        resp = HttpResponse(body, content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="rejected-{b.id}.csv"'
        return resp
