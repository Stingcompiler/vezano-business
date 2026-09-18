"""نقطة نهاية PUSH (§٨.٣). الجهاز والمستأجر من المصادقة لا من الحمولة (§٥.٤ بند ٢)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.sessions import report_pending
from core.auth.tokens import AuthContext, RecoveryAuthentication
from core.models import Device
from core.tenancy import tenant_context
from sync.models import BackupCopy, Operation, QuarantinedOperation, SupportReport, SyncState
from sync.pull import pull
from sync.push import PushError, push
from sync.recovery import (
    RecoveryRejected,
    device_payload,
    freeze,
    handover,
    reconcile,
    recoverable_devices,
    restore,
    wipe,
)
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


# ما يُسمح له بالدخول في تقرير الدعم (SYS-11؛ ACC-87): بنية تقنية فقط — لا أسماء ولا مبالغ ولا رموز
SUPPORT_ALLOWED_KEYS = frozenset(
    {"generated_at", "app", "device", "storage", "sync", "errors", "print_failures", "screens"}
)
SUPPORT_FORBIDDEN_FRAGMENTS = (
    "name",
    "phone",
    "amount",
    "minor",
    "price",
    "token",
    "secret",
    "password",
    "pin",
    "party",
    "customer",
    "invoice_number",
)


def _scan_keys(value: Any, path: str = "") -> str | None:
    """يرفض أي مفتاح يوحي ببيانات عميل أو مبالغ أو أسرار — في أي عمق."""
    if isinstance(value, dict):
        for k, v in value.items():
            key = str(k).lower()
            if any(f in key for f in SUPPORT_FORBIDDEN_FRAGMENTS):
                return f"{path}{k}"
            bad = _scan_keys(v, f"{path}{k}.")
            if bad:
                return bad
    elif isinstance(value, list):
        for i, v in enumerate(value):
            bad = _scan_keys(v, f"{path}{i}.")
            if bad:
                return bad
    return None


class SupportReportSerializer(serializers.Serializer[dict[str, Any]]):
    app_version = serializers.CharField(max_length=40, allow_blank=True, required=False)
    note = serializers.CharField(max_length=500, allow_blank=True, required=False)
    payload = serializers.DictField()


class SupportReportView(APIView):
    """SYS-11: التقرير معروض قبل الإرسال؛ الإرسال قرار المالك؛ الحمولة بنية تقنية فقط."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SupportReportSerializer, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = SupportReportSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        payload = s.validated_data["payload"]
        unknown = sorted(set(payload) - SUPPORT_ALLOWED_KEYS)
        if unknown:
            return Response(
                {"detail": "payload_key_not_allowed", "key": unknown[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        bad = _scan_keys(payload)
        if bad:
            return Response(
                {"detail": "payload_key_not_allowed", "key": bad},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            now = timezone.now()
            seq = SupportReport.objects.filter(tenant_id=auth.tenant_id).count() + 1
            report = SupportReport.objects.create(
                tenant_id=auth.tenant_id,
                reference=f"SUP-{now:%y%m%d}-{seq:04d}",
                device=auth.device.id,
                user=auth.user.id,
                user_name=auth.user.display_name,
                app_version=s.validated_data.get("app_version", ""),
                payload=payload,
                note=s.validated_data.get("note", ""),
            )
        return Response(
            {
                "reference": report.reference,
                "created_at": report.created_at.isoformat().replace("+00:00", "Z"),
                "sent_keys": sorted(payload),
            },
            status=status.HTTP_201_CREATED,
        )


BACKUP_MAX_BYTES = 15 * 1024 * 1024


class BackupCopySerializer(serializers.Serializer[dict[str, Any]]):
    file_name = serializers.CharField(max_length=200)
    envelope = serializers.CharField()


class BackupCopyView(APIView):
    """SYS-05: رفع الغلاف المشفّر إلى تخزين المنشأة — الخادم لا يفكّ التشفير. الملف المحلي يبقى
    سليماً إن فشل الرفع (الحالة `server_error` في الشاشة)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=BackupCopySerializer, responses={201: None, 400: None, 403: None, 413: None}
    )
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = BackupCopySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        raw = s.validated_data["envelope"]
        if len(raw.encode("utf-8")) > BACKUP_MAX_BYTES:
            return Response(
                {"detail": "too_large"}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            )
        try:
            env = json.loads(raw)
        except ValueError:
            return Response({"detail": "corrupt"}, status=status.HTTP_400_BAD_REQUEST)
        if (
            not isinstance(env, dict)
            or env.get("format") != "sting-backup"
            or str(env.get("tenant_id")) != str(auth.tenant_id)
            or "ciphertext" not in env
        ):
            return Response({"detail": "invalid_envelope"}, status=status.HTTP_400_BAD_REQUEST)
        exported_at = parse_datetime(str(env.get("exported_at", ""))) or timezone.now()
        with tenant_context(auth.tenant_id):
            copy = BackupCopy.objects.create(
                tenant_id=auth.tenant_id,
                device=auth.device.id,
                user=auth.user.id,
                file_name=s.validated_data["file_name"],
                exported_at=exported_at,
                size_bytes=len(raw.encode("utf-8")),
                counts=env.get("counts") or {},
                envelope=raw,
            )
        return Response(
            {"id": str(copy.id), "created_at": copy.created_at.isoformat().replace("+00:00", "Z")},
            status=status.HTTP_201_CREATED,
        )


class HandoverSerializer(serializers.Serializer[dict[str, Any]]):
    operations = serializers.ListField(child=serializers.DictField(), allow_empty=False)


class RecoveryHandoverView(APIView):
    """SYS-07 (§٩.٣): جهاز مسحوب/مجمَّد يسلّم عمله إلى الحجر باعتماد مقيّد (رمز التجديد + سجل
    الجلسة) — لا يُطبَّق شيء ولا يُعاد وصول."""

    authentication_classes = (RecoveryAuthentication,)
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=HandoverSerializer, responses={200: None, 403: None, 409: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = HandoverSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            try:
                results = handover(
                    tenant_id=auth.tenant_id,
                    device=auth.device,
                    actor=auth.user,
                    operations=list(s.validated_data["operations"]),
                )
            except RecoveryRejected as e:
                return Response({"detail": e.code}, status=status.HTTP_409_CONFLICT)
        return Response({"device_status": auth.device.status, "results": results})


class RecoveryListView(APIView):
    """ما على الأجهزة المسحوبة: المالك يرى التفصيل، ومدير الفرع العدد والقيمة فقط."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, err = _review_ctx(request)
        if err is not None or auth is None or auth.tenant_id is None:
            return err or Response(status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            devices = [device_payload(d, detailed=viewer.is_owner) for d in recoverable_devices()]
            return Response({"is_owner": viewer.is_owner, "devices": devices})


class DecisionActionSerializer(serializers.Serializer[dict[str, Any]]):
    acknowledgement = serializers.CharField(max_length=1000, allow_blank=True, required=False)


class RecoveryDeviceView(APIView):
    """`restore` / `freeze` / `wipe` — للمالك؛ المحو بإقرار مكتوب يبقى في سجل التدقيق."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=DecisionActionSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, device_id: uuid.UUID, action: str) -> Response:
        auth, err = _review_ctx(request)
        if err is not None or auth is None or auth.tenant_id is None:
            return err or Response(status=status.HTTP_403_FORBIDDEN)
        s = DecisionActionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            viewer = home.viewer_for(auth.user, auth.device)
            device = Device.objects.filter(id=device_id).select_related("branch").first()
            if device is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                if action == "restore":
                    out = restore(tenant_id=auth.tenant_id, device=device, owner=viewer.user)
                elif action == "freeze":
                    out = device_payload(freeze(device, owner=viewer.user), detailed=True)
                elif action == "wipe":
                    out = device_payload(
                        wipe(
                            device,
                            owner=viewer.user,
                            acknowledgement=s.validated_data.get("acknowledgement", ""),
                        ),
                        detailed=True,
                    )
                else:
                    return Response(
                        {"detail": "unknown_action"}, status=status.HTTP_400_BAD_REQUEST
                    )
            except RecoveryRejected as e:
                code = (
                    status.HTTP_403_FORBIDDEN
                    if e.code == "owner_required"
                    else status.HTTP_400_BAD_REQUEST
                )
                return Response({"detail": e.code}, status=code)
        return Response(out)


class ReconcileSerializer(serializers.Serializer[dict[str, Any]]):
    operation_ids = serializers.ListField(child=serializers.CharField(), allow_empty=True)


class ReconcileView(APIView):
    """SYS-08 (§٨.١٢): بعد تغيّر الجيل تُقارَن الهويات الأصلية — ما نجا يُترك وما فُقد يُرفع."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=ReconcileSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None or auth.device is None:
            return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = ReconcileSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            out = reconcile(
                tenant_id=auth.tenant_id, operation_ids=list(s.validated_data["operation_ids"])
            )
        return Response(out)
