"""Web Push (WEB-02): حالة الاشتراك بلا سرّ، اشتراك/إلغاء بجلسة جهاز، وإشعار تجريبي — الادّعاء لا
يُثبت والتجربة تُثبت."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import push
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context


def _device_ctx(request: Request) -> AuthContext | None:
    auth = request.auth
    if not isinstance(auth, AuthContext) or auth.tenant_id is None or auth.device is None:
        return None
    return auth


class PushStatusView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = _device_ctx(request)
        if auth is None or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            return Response(push.status_payload(auth.device))


class SubscribeSerializer(serializers.Serializer[dict[str, Any]]):
    endpoint = serializers.URLField(max_length=2000)
    p256dh = serializers.CharField(max_length=200)
    auth = serializers.CharField(max_length=100)


class PushSubscribeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SubscribeSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _device_ctx(request)
        if auth is None or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = SubscribeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(auth.tenant_id):
            push.subscribe(
                device=auth.device,
                user=auth.user,
                endpoint=str(d["endpoint"]),
                p256dh=str(d["p256dh"]),
                auth=str(d["auth"]),
                user_agent=str(request.headers.get("User-Agent", ""))[:300],
            )
            return Response(push.status_payload(auth.device))


class UnsubscribeSerializer(serializers.Serializer[dict[str, Any]]):
    endpoint = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class PushUnsubscribeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=UnsubscribeSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _device_ctx(request)
        if auth is None or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = UnsubscribeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            push.unsubscribe(device=auth.device, endpoint=str(s.validated_data.get("endpoint", "")))
            return Response(push.status_payload(auth.device))


class PushTestView(APIView):
    """إشعار تجريبي فوراً — يعيد `sent:false` بسببه إن لم تُضبط مفاتيح VAPID أو انتهى الاشتراك."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _device_ctx(request)
        if auth is None or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = push.notify_device(auth.device.id, "test")
            return Response({**out, **push.status_payload(auth.device)})
