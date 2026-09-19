"""ACC-05 (T1.3): تسجيل الجهاز ثم النسخة المادية للتهيئة الأولى بصفحات تُستأنف (§٨.١٠، §٩.١)."""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth.devices import register_device, renew_with_registration
from core.auth.pin import verifiers_for_device
from core.auth.tokens import AuthContext
from core.models import Branch, Device, UserBranchAccess
from core.tenancy import tenant_context
from sync import bootstrap
from sync.models_log import BootstrapImage


class RegisterDeviceSerializer(serializers.Serializer[dict[str, Any]]):
    branch_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=200)


class RegisteredDeviceSerializer(serializers.Serializer[dict[str, Any]]):
    device_id = serializers.UUIDField()
    prefix = serializers.CharField()
    branch_id = serializers.UUIDField()
    branch_code = serializers.CharField()
    registration_secret = serializers.CharField()
    access = serializers.CharField()
    refresh = serializers.CharField()


class RegisterDeviceView(APIView):
    """يسجل هذا الجهاز في فرع يخوَّل فيه المستخدم؛ يعيد اعتماد التسجيل مرة واحدة وجلسة نقل."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=RegisterDeviceSerializer,
        responses={201: RegisteredDeviceSerializer, 403: None, 404: None},
    )
    def post(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = RegisterDeviceSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            branch_id = s.validated_data.get("branch_id")
            branch = (
                Branch.objects.filter(id=branch_id).first()
                if branch_id
                else Branch.objects.filter(is_default=True).first()
                or Branch.objects.order_by("created_at").first()
            )
            if branch is None:
                return Response({"detail": "branch_not_found"}, status=status.HTTP_404_NOT_FOUND)
            from core.subscription import can_register_device

            allowed, why = can_register_device()
            if not allowed:
                # عند بلوغ الحدّ لا نمنع البيع — نمنع إضافة جهاز جديد ونشرح البديل (ORG-06)
                return Response({"detail": why}, status=status.HTTP_403_FORBIDDEN)
            try:
                reg = register_device(
                    user=auth.user,
                    branch=branch,
                    name=s.validated_data["name"],
                    user_agent=request.META.get("HTTP_USER_AGENT", ""),
                )
            except PermissionDenied as e:
                return Response({"detail": str(e.detail)}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            {
                "device_id": str(reg.device.id),
                "prefix": reg.device.prefix,
                "branch_id": str(branch.id),
                "branch_code": branch.code,
                "registration_secret": reg.registration_secret,
                "access": reg.access,
                "refresh": reg.refresh,
            },
            status=status.HTTP_201_CREATED,
        )


class RenewDeviceSerializer(serializers.Serializer[dict[str, Any]]):
    device_id = serializers.UUIDField()
    registration_secret = serializers.CharField()


class RenewDeviceView(APIView):
    """يجدد جلسة نقل لجهاز مسجَّل باعتماد التسجيل — بعد إعادة تحميل الصفحة أو دخول جديد (§٩.١)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=RenewDeviceSerializer,
        responses={
            200: inline_serializer(
                "RenewedDevice",
                {
                    "device_id": serializers.UUIDField(),
                    "prefix": serializers.CharField(),
                    "branch_id": serializers.UUIDField(),
                    "branch_code": serializers.CharField(),
                    "access": serializers.CharField(),
                    "refresh": serializers.CharField(),
                },
            ),
            401: None,
            403: None,
            404: None,
        },
    )
    def post(self, request: Request) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        if auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = RenewDeviceSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            device = Device.objects.filter(id=s.validated_data["device_id"]).first()
            if device is None:
                return Response({"detail": "device_not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                refresh, access = renew_with_registration(
                    device=device,
                    registration_secret=s.validated_data["registration_secret"],
                    user=auth.user,
                    user_agent=request.META.get("HTTP_USER_AGENT", ""),
                )
            except AuthenticationFailed as e:
                return Response({"detail": str(e.detail)}, status=status.HTTP_401_UNAUTHORIZED)
            except PermissionDenied as e:
                return Response({"detail": str(e.detail)}, status=status.HTTP_403_FORBIDDEN)
            return Response(
                {
                    "device_id": str(device.id),
                    "prefix": device.prefix,
                    "branch_id": str(device.branch_id),
                    "branch_code": device.branch.code,
                    "access": access,
                    "refresh": refresh,
                }
            )


class ScopeSerializer(serializers.Serializer[dict[str, Any]]):
    group = serializers.CharField()
    total = serializers.IntegerField()
    pages = serializers.IntegerField()


class ImageSerializer(serializers.Serializer[dict[str, Any]]):
    image_id = serializers.UUIDField()
    sync_epoch = serializers.CharField()
    snapshot_id = serializers.UUIDField()
    cutoff_server_seq = serializers.CharField()
    schema_version = serializers.IntegerField()
    as_of = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    page_size = serializers.IntegerField()
    scopes = ScopeSerializer(many=True)
    balances = serializers.ListField(child=serializers.DictField())


def _device_or_403(auth: Any) -> Response | None:
    if not isinstance(auth, AuthContext) or auth.device is None or auth.tenant_id is None:
        return Response({"detail": "device_session_required"}, status=status.HTTP_403_FORBIDDEN)
    return None


class BootstrapStartView(APIView):
    """نسخة مادية جديدة عند القطع الحالي — تُستدعى في أول تهيئة أو بعد انتهاء نسخة قديمة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={201: ImageSerializer, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if (denied := _device_or_403(auth)) is not None:
            return denied
        assert isinstance(auth, AuthContext) and auth.device is not None and auth.tenant_id
        with tenant_context(auth.tenant_id):
            image = bootstrap.create_image(auth.device)
            return Response(bootstrap.image_envelope(image), status=status.HTTP_201_CREATED)


class PageSerializer(serializers.Serializer[dict[str, Any]]):
    image_id = serializers.UUIDField()
    group = serializers.CharField()
    page_no = serializers.IntegerField()
    pages = serializers.IntegerField()
    entities = serializers.ListField(child=serializers.DictField())


class BootstrapPageView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("group", str, OpenApiParameter.QUERY, required=True),
            OpenApiParameter("page", int, OpenApiParameter.QUERY, required=True),
        ],
        responses={200: PageSerializer, 403: None, 404: None, 410: None},
    )
    def get(self, request: Request, image_id: uuid.UUID) -> Response:
        auth = request.auth
        if (denied := _device_or_403(auth)) is not None:
            return denied
        assert isinstance(auth, AuthContext) and auth.device is not None and auth.tenant_id
        group = str(request.query_params.get("group", ""))
        try:
            page_no = int(str(request.query_params.get("page", "1")))
        except ValueError:
            return Response({"detail": "page_invalid"}, status=status.HTTP_400_BAD_REQUEST)
        with tenant_context(auth.tenant_id):
            image = BootstrapImage.objects.filter(id=image_id, device=auth.device).first()
            if image is None:
                return Response({"detail": "image_not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                page = bootstrap.get_page(image, group, page_no)
            except bootstrap.ImageExpired:
                # انتهاء الصلاحية يبدأ مرشحاً جديداً دون محو العمليات المحلية (§٨.١٠)
                return Response({"detail": "image_expired"}, status=status.HTTP_410_GONE)
            except bootstrap.PageNotFound:
                return Response({"detail": "page_not_found"}, status=status.HTTP_404_NOT_FOUND)
            pages = next((s["pages"] for s in image.scopes if s["group"] == group), 1)
            return Response(
                {
                    "image_id": str(image.id),
                    "group": group,
                    "page_no": page_no,
                    "pages": pages,
                    "entities": page.entities,
                }
            )


class BootstrapCompleteView(APIView):
    """الجهاز فعّل النسخة محلياً بعد اكتمالها والتحقق منها — يُسجَّل ذلك على النسخة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=None,
        responses={
            200: inline_serializer(
                "BootstrapCompleted",
                {"image_id": serializers.UUIDField(), "completed_at": serializers.DateTimeField()},
            ),
            403: None,
            404: None,
            410: None,
        },
    )
    def post(self, request: Request, image_id: uuid.UUID) -> Response:
        auth = request.auth
        if (denied := _device_or_403(auth)) is not None:
            return denied
        assert isinstance(auth, AuthContext) and auth.device is not None and auth.tenant_id
        with tenant_context(auth.tenant_id):
            image = BootstrapImage.objects.filter(id=image_id, device=auth.device).first()
            if image is None:
                return Response({"detail": "image_not_found"}, status=status.HTTP_404_NOT_FOUND)
            if image.expires_at <= timezone.now() and image.completed_at is None:
                return Response({"detail": "image_expired"}, status=status.HTTP_410_GONE)
            if image.completed_at is None:
                image.completed_at = timezone.now()
                image.save(update_fields=["completed_at"])
            return Response({"image_id": str(image.id), "completed_at": image.completed_at})


class VerifierSerializer(serializers.Serializer[dict[str, Any]]):
    user_id = serializers.UUIDField()
    display_name = serializers.CharField()
    role_name = serializers.CharField()
    branch_name = serializers.CharField()
    encoded = serializers.CharField()
    version = serializers.IntegerField()


class DeviceVerifiersView(APIView):
    """متحققات PIN لمستخدمي فرع الجهاز المخوَّلين (§٨.٦، §٩.١) — تنزل إلى أجهزة أصحابها فقط.

    قائمة كاملة كل مرة: من غاب عنها سُحب تخويله، فيُطبَّق السحب عند أول اتصال (34-D26 ACC-07).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        responses={
            200: inline_serializer(
                "DeviceVerifiers",
                {
                    "device_id": serializers.UUIDField(),
                    "prefix": serializers.CharField(),
                    "branch_name": serializers.CharField(),
                    "pin_length": serializers.IntegerField(),
                    "verifiers": VerifierSerializer(many=True),
                },
            ),
            403: None,
        }
    )
    def get(self, request: Request) -> Response:
        auth = request.auth
        if (denied := _device_or_403(auth)) is not None:
            return denied
        assert isinstance(auth, AuthContext) and auth.device is not None and auth.tenant_id
        with tenant_context(auth.tenant_id):
            device = auth.device
            branch = Branch.objects.get(id=device.branch_id)
            roles = {
                a.user_id: a.role.name
                for a in UserBranchAccess.objects.filter(
                    branch=branch, revoked_at__isnull=True
                ).select_related("role")
            }
            rows = [
                {
                    "user_id": str(v.user_id),
                    "display_name": v.user.display_name,
                    "role_name": "مالك" if v.user.is_owner else roles.get(v.user_id, ""),
                    "branch_name": branch.name,
                    "encoded": v.encoded,
                    "version": v.version,
                }
                for v in verifiers_for_device(device)
            ]
            return Response(
                {
                    "device_id": str(device.id),
                    "prefix": device.prefix,
                    "branch_name": branch.name,
                    "pin_length": 6,
                    "verifiers": rows,
                }
            )
