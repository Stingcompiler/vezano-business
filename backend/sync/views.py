"""نقطة نهاية PUSH (§٨.٣). الجهاز والمستأجر من المصادقة لا من الحمولة (§٥.٤ بند ٢)."""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.sessions import report_pending
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from sync.models import Operation, QuarantinedOperation, SyncState
from sync.pull import pull
from sync.push import PushError, push
from sync.review import ReviewRejected, decide, detail_payload, item_payload, visible_items


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


class SyncStatusSerializer(serializers.Serializer[dict[str, Any]]):
    server_time = serializers.DateTimeField()
    sync_epoch = serializers.CharField()
    server_seq_high = serializers.CharField()
    quarantined = serializers.IntegerField()
    conflicted = serializers.IntegerField()
    last_accepted_at = serializers.DateTimeField(allow_null=True)


class SyncStatusView(APIView):
    """فحص الوصول (SYS-01؛ §١٣.٦): «هناك شبكة» ≠ «نجح الوصول» — ردٌّ مصادَق من الخادم بوقته
    ورقمه الأعلى وما لهذا الجهاز من محجور ومتعارض لم يُراجَع. لا يغيّر شيئاً."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: SyncStatusSerializer})
    def get(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.device is None or auth.tenant_id is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            state = SyncState.objects.filter(tenant_id=auth.tenant_id).first()
            pending_review = QuarantinedOperation.objects.filter(
                device=auth.device.id, reviewed_at__isnull=True
            )
            last = (
                Operation.objects.filter(device=auth.device.id)
                .order_by("-received_at")
                .values_list("received_at", flat=True)
                .first()
            )
            body = {
                "server_time": timezone.now(),
                "sync_epoch": state.sync_epoch if state else "",
                "server_seq_high": str(state.sync_counter if state else 0),
                "quarantined": pending_review.filter(
                    reason=QuarantinedOperation.Reason.REJECTED
                ).count(),
                "conflicted": pending_review.filter(
                    reason=QuarantinedOperation.Reason.CONFLICTED
                ).count(),
                "last_accepted_at": last,
            }
        return Response(SyncStatusSerializer(body).data)


class DecisionSerializer(serializers.Serializer[dict[str, Any]]):
    decision = serializers.ChoiceField(choices=("accept", "reject"))
    reason = serializers.CharField(max_length=500)


def _review_ctx(request: Request) -> tuple[AuthContext | None, Response | None]:
    auth = request.auth
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        return None, Response(
            {"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN
        )
    return auth, None


class QuarantineListView(APIView):
    """SYS-03: ما ينتظر قرار المالك مرتّباً بالأثر المالي؛ غير المالك يرى محجور جهازه ولا يحسم."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, err = _review_ctx(request)
        if err is not None or auth is None or auth.tenant_id is None:
            return err or Response(status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            items = visible_items(viewer.user, auth.device.id if auth.device is not None else None)
            return Response(
                {
                    "is_owner": viewer.is_owner,
                    "items": [item_payload(q) for q in items],
                    "as_of": timezone.now().isoformat().replace("+00:00", "Z"),
                }
            )


class QuarantineDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, item_id: uuid.UUID) -> Response:
        auth, err = _review_ctx(request)
        if err is not None or auth is None or auth.tenant_id is None:
            return err or Response(status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            q = QuarantinedOperation.objects.filter(id=item_id).first()
            if q is None or (
                not viewer.is_owner and (auth.device is None or q.device != auth.device.id)
            ):
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response({**detail_payload(q), "is_owner": viewer.is_owner})


class QuarantineDecideView(APIView):
    """قبول مخوَّل أو رفض بسبب — دون إعادة كتابة الأصل (ACC-32، ACC-49)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=DecisionSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        auth, err = _review_ctx(request)
        if err is not None or auth is None or auth.tenant_id is None:
            return err or Response(status=status.HTTP_403_FORBIDDEN)
        s = DecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            q = QuarantinedOperation.objects.filter(id=item_id).first()
            if q is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                out = decide(
                    q,
                    decision=s.validated_data["decision"],
                    reason=s.validated_data["reason"],
                    actor=viewer.user,
                )
            except ReviewRejected as e:
                code = (
                    status.HTTP_403_FORBIDDEN
                    if e.code == "owner_required"
                    else status.HTTP_400_BAD_REQUEST
                )
                return Response({"detail": e.code, "field": e.field}, status=code)
            return Response(out)
