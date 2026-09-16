"""نقاط نهاية السيناريو — تُركَّب فقط حين STING_FAULTS_ENABLED=1 (sting/urls.py)."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.scenario import faults
from core.scenario.guard import ProductionGuard
from core.scenario.seed import reset_scenario


class ResetView(APIView):
    """إعادة ضبط السيناريو إلى الحالة الابتدائية (§١٥.٤).

    محمية بالحارس لا بالمصادقة: البيئة نفسها تجريبية.
    """

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=None, responses={200: None})
    def post(self, _request: Request) -> Response:
        try:
            result = reset_scenario()
        except ProductionGuard as e:
            return Response(
                {"detail": "production_guard", "reason": str(e)}, status=status.HTTP_403_FORBIDDEN
            )
        return Response(result.summary())


class FaultSerializer(serializers.Serializer[dict[str, Any]]):
    key = serializers.ChoiceField(choices=list(faults.ALL_FAULTS))
    on = serializers.BooleanField()


class FaultsView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, _request: Request) -> Response:
        return Response({"active": sorted(faults.active())})

    @extend_schema(request=FaultSerializer, responses={200: None})
    def post(self, request: Request) -> Response:
        s = FaultSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            active = faults.set_fault(s.validated_data["key"], s.validated_data["on"])
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"active": sorted(active)})


class VerificationCodeView(APIView):
    """آخر رمز تحقق أُرسل لمعرّف — للتطوير والاختبار فقط (لا مزوّد إرسال معتمد بعد، G-02)."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        from core.auth.verify import dev_code_for

        identifier = str(request.query_params.get("identifier", ""))
        try:
            code = dev_code_for(identifier) if identifier else None
        except ValueError:
            code = None
        if code is None:
            return Response({"detail": "no_code"}, status=status.HTTP_404_NOT_FOUND)
        return Response({"identifier": identifier, "code": code})
