"""نقاط نهاية ACC-10 (T1.6): حالة المعالج، الصرف، والشعار — بجلسة داخل المنشأة."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import onboarding
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context


class OnboardingSerializer(serializers.Serializer[dict[str, Any]]):
    tenant_name = serializers.CharField()
    currency_name = serializers.CharField()
    branches = serializers.IntegerField()
    dismissed = serializers.BooleanField()
    steps = serializers.DictField(child=serializers.DictField())


class OnboardingPatchSerializer(serializers.Serializer[dict[str, Any]]):
    dismissed = serializers.BooleanField(required=False)
    logo_data_url = serializers.CharField(required=False, allow_blank=False)


class OnboardingView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: OnboardingSerializer, 403: None})
    def get(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            return Response(onboarding.onboarding_status(auth.tenant_id))

    @extend_schema(
        request=OnboardingPatchSerializer,
        responses={
            200: OnboardingSerializer,
            403: None,
            413: inline_serializer(
                "LogoTooLarge",
                {
                    "detail": serializers.CharField(),
                    "size": serializers.IntegerField(),
                    "max_bytes": serializers.IntegerField(),
                },
            ),
        },
    )
    def patch(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = OnboardingPatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            if "dismissed" in s.validated_data:
                onboarding.dismiss_onboarding(auth.tenant_id, bool(s.validated_data["dismissed"]))
            if "logo_data_url" in s.validated_data:
                try:
                    onboarding.set_logo(auth.tenant_id, str(s.validated_data["logo_data_url"]))
                except onboarding.LogoTooLarge as e:
                    return Response(
                        {
                            "detail": "logo_too_large",
                            "size": e.size,
                            "max_bytes": onboarding.LOGO_MAX_BYTES,
                        },
                        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    )
            return Response(onboarding.onboarding_status(auth.tenant_id))
