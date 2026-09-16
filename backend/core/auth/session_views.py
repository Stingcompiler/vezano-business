"""نقاط نهاية ACC-09 (T1.5): الجلسات النشطة وإنهاؤها — من الخادم دائماً، لا من كاش."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth import sessions as svc
from core.auth.tokens import AuthContext
from core.models import Account
from core.tenancy import platform_context


class SessionRowSerializer(serializers.Serializer[dict[str, Any]]):
    session_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["own", "device"])
    # «label» اسم محجوز في Field؛ المفتاح في الاستجابة session_label
    session_label = serializers.CharField()
    is_current = serializers.BooleanField()
    tenant_id = serializers.CharField(allow_blank=True)
    tenant_name = serializers.CharField(allow_blank=True)
    branch_name = serializers.CharField(allow_blank=True)
    device_id = serializers.CharField(allow_blank=True)
    last_seen_at = serializers.CharField(allow_blank=True)
    revoked_at = serializers.CharField(allow_blank=True)
    revoke_after_upload = serializers.BooleanField()
    reported_pending = serializers.IntegerField(allow_null=True)
    can_revoke = serializers.BooleanField()


def _account(auth: Any) -> Account | None:
    if not isinstance(auth, AuthContext) or auth.user.account_id is None:
        return None
    with platform_context():
        return Account.unscoped.filter(id=auth.user.account_id, is_active=True).first()


class SessionsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        responses={
            200: inline_serializer("Sessions", {"sessions": SessionRowSerializer(many=True)}),
            403: None,
        }
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        account = _account(auth)
        if account is None:
            return Response({"detail": "account_required"}, status=status.HTTP_403_FORBIDDEN)
        assert isinstance(auth, AuthContext)
        return Response(
            {"sessions": [r.as_dict() for r in svc.list_sessions(account, auth.session)]}
        )


class RevokeSerializer(serializers.Serializer[dict[str, Any]]):
    after_upload = serializers.BooleanField(required=False, default=False)


class RevokeSessionView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=RevokeSerializer,
        responses={200: SessionRowSerializer, 403: None, 404: None},
    )
    def post(self, request: Request, session_id: str) -> Response:
        auth = request.auth
        account = _account(auth)
        if account is None:
            return Response({"detail": "account_required"}, status=status.HTTP_403_FORBIDDEN)
        s = RevokeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            row = svc.revoke(
                account, session_id, after_upload=bool(s.validated_data["after_upload"])
            )
        except svc.SessionNotFound:
            return Response({"detail": "session_not_found"}, status=status.HTTP_404_NOT_FOUND)
        except svc.RevokeForbidden:
            return Response({"detail": "permission_denied"}, status=status.HTTP_403_FORBIDDEN)
        return Response(row.as_dict())
