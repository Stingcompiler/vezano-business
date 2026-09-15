"""نقاط نهاية المصادقة الدنيا للمرحلة ٠ — الواجهات الكاملة (ACC-02…09) في المرحلة ١."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError

from core.auth.tokens import AuthContext, issue_session_tokens, revoke_session, rotate_refresh
from core.models import Tenant, User
from core.tenancy import platform_context


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    tenant_id = serializers.UUIDField()
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class TokenPairSerializer(serializers.Serializer[dict[str, Any]]):
    access = serializers.CharField()
    refresh = serializers.CharField()
    session_id = serializers.UUIDField()


class RefreshSerializer(serializers.Serializer[dict[str, Any]]):
    refresh = serializers.CharField()


class LoginView(APIView):
    """دخول حساب (مالك/موظف) بمستأجر + اسم + كلمة سر؛ PIN المحلي لا يمرّ من هنا (§٩.١)."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=LoginSerializer, responses={200: TokenPairSerializer})
    def post(self, request: Request) -> Response:
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tenant_id, username, password = (
            s.validated_data["tenant_id"],
            s.validated_data["username"],
            s.validated_data["password"],
        )
        with platform_context():
            if not Tenant.unscoped.filter(id=tenant_id).exists():
                # رسالة موحدة لا تكشف وجود المستأجر (R-05 «الرفض لا يسرّب»)
                return Response(
                    {"detail": "invalid_credentials"}, status=status.HTTP_401_UNAUTHORIZED
                )
            user = User.unscoped.filter(
                tenant_id=tenant_id, username=username, is_active=True
            ).first()
            if user is None or not user.check_password(password):
                return Response(
                    {"detail": "invalid_credentials"}, status=status.HTTP_401_UNAUTHORIZED
                )
            session, refresh = issue_session_tokens(
                user, user_agent=request.META.get("HTTP_USER_AGENT", "")
            )
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "session_id": str(session.id),
            }
        )


class RefreshView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=RefreshSerializer, responses={200: TokenPairSerializer})
    def post(self, request: Request) -> Response:
        s = RefreshSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            new = rotate_refresh(s.validated_data["refresh"])
        except (TokenError, AuthenticationFailed):
            # رسالة موحدة: الرمز المعاد والجلسة الملغاة والجهاز المسحوب كلها 401 بلا تسريب
            return Response({"detail": "token_invalid"}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(
            {"access": str(new.access_token), "refresh": str(new), "session_id": str(new["sid"])}
        )


class LogoutView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        with platform_context():
            revoke_session(auth.session)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        responses={
            200: inline_serializer(
                "Me",
                {
                    "user_id": serializers.UUIDField(),
                    "session_id": serializers.UUIDField(),
                    "device_id": serializers.UUIDField(allow_null=True),
                    "tenant_id": serializers.UUIDField(allow_null=True),
                },
            )
        }
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        return Response(auth.as_dict())
