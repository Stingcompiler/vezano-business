"""نقطة نهاية PUSH (§٨.٣). الجهاز والمستأجر من المصادقة لا من الحمولة (§٥.٤ بند ٢)."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth.sessions import report_pending
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from sync.pull import pull
from sync.push import PushError, push


class PushEnvelopeSerializer(serializers.Serializer[dict[str, Any]]):
    protocol_version = serializers.IntegerField()
    sync_epoch = serializers.CharField()
    request_id = serializers.CharField(max_length=128)
    operations = serializers.ListField(child=serializers.DictField(), allow_empty=True)
    # ما يبقى في طابور الجهاز بعد هذا النقل — يُبلَّغ للجلسات (ACC-09) ويُنفّذ الإنهاء المجدول
    pending_after = serializers.IntegerField(required=False, min_value=0)


class PushView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PushEnvelopeSerializer, responses={200: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.device is None or auth.tenant_id is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = PushEnvelopeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            with tenant_context(auth.tenant_id):
                response = push(
                    device_id=auth.device.id, actor_user_id=auth.user.id, envelope=s.validated_data
                )
        except PushError as e:
            code = (
                status.HTTP_409_CONFLICT
                if e.code == "epoch_mismatch"
                else status.HTTP_400_BAD_REQUEST
            )
            return Response(
                {"detail": e.code, "sync_epoch": e.detail if e.code == "epoch_mismatch" else None},
                status=code,
            )
        pending_after = s.validated_data.get("pending_after")
        if pending_after is not None:
            report_pending(auth.session, pending_after)
        return Response(response.as_dict())


class PullEnvelopeSerializer(serializers.Serializer[dict[str, Any]]):
    protocol_version = serializers.IntegerField()
    sync_epoch = serializers.CharField()
    request_id = serializers.CharField(max_length=128)
    cursors = serializers.ListField(child=serializers.DictField(), required=False, allow_empty=True)
    limit = serializers.IntegerField(required=False, min_value=1)


class PullView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PullEnvelopeSerializer, responses={200: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.device is None or auth.tenant_id is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = PullEnvelopeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        # الفروع المصرح بها للجهاز: فرع تسجيله (تعدد الفروع لجهاز واحد يُفتح مع باقة السلسلة §١٠.١)
        branch_ids = [str(auth.device.branch_id)]
        try:
            with tenant_context(auth.tenant_id):
                page = pull(
                    device_id=auth.device.id, branch_ids=branch_ids, envelope=s.validated_data
                )
        except PushError as e:
            code = (
                status.HTTP_409_CONFLICT
                if e.code == "epoch_mismatch"
                else status.HTTP_400_BAD_REQUEST
            )
            return Response(
                {"detail": e.code, "sync_epoch": e.detail if e.code == "epoch_mismatch" else None},
                status=code,
            )
        return Response(page.as_dict())
