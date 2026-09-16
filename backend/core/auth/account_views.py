"""نقاط نهاية ACC-01/ACC-02 (T1.1): صحة الخادم، دخول الحساب، رمز التحقق وبديله اليدوي.

كل استجابة تحمل ما تحتاجه الواجهة لعرض الحالة بعدّادها (0005 §٢) — لا ثوابت مكرّرة في العميل.
"""

from __future__ import annotations

from typing import Any

from django.db import connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth import verify
from core.auth.accounts import InvalidCredentials, LoginLocked, login_account
from core.models import VerificationCode

PURPOSES = [c[0] for c in VerificationCode.Purpose.choices]


class HealthView(APIView):
    """ACC-01 يفرّق «بلا شبكة» عن «الخادم لا يردّ»: نجاح هنا = خادم وقاعدة يعملان (§١٣.٦)."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: inline_serializer("Health", {"ok": serializers.BooleanField()})})
    def get(self, _request: Request) -> Response:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            ok = cursor.fetchone() == (1,)
        return Response({"ok": ok}, status=200 if ok else status.HTTP_503_SERVICE_UNAVAILABLE)


class AccountLoginSerializer(serializers.Serializer[dict[str, Any]]):
    identifier = serializers.CharField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class MembershipSerializer(serializers.Serializer[dict[str, Any]]):
    user_id = serializers.UUIDField()
    tenant_id = serializers.UUIDField()
    tenant_name = serializers.CharField()
    is_owner = serializers.BooleanField()


class AccountLoginResponseSerializer(serializers.Serializer[dict[str, Any]]):
    """عضوية واحدة → access/refresh/session_id؛ أكثر → memberships + select_ticket."""

    access = serializers.CharField(required=False)
    refresh = serializers.CharField(required=False)
    session_id = serializers.UUIDField(required=False)
    memberships = MembershipSerializer(many=True, required=False)
    select_ticket = serializers.CharField(required=False)


class LoginErrorSerializer(serializers.Serializer[dict[str, Any]]):
    detail = serializers.ChoiceField(choices=["invalid_credentials", "retry_after"])
    retry_after_seconds = serializers.IntegerField(required=False)
    failed_logins = serializers.IntegerField(required=False)


class AccountLoginView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        request=AccountLoginSerializer,
        responses={
            200: AccountLoginResponseSerializer,
            401: LoginErrorSerializer,
            429: LoginErrorSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        s = AccountLoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            out = login_account(
                s.validated_data["identifier"],
                s.validated_data["password"],
                user_agent=request.META.get("HTTP_USER_AGENT", ""),
            )
        except InvalidCredentials:
            return Response({"detail": "invalid_credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        except LoginLocked as e:
            return Response(
                {
                    "detail": "retry_after",
                    "retry_after_seconds": e.retry_after_seconds,
                    "failed_logins": e.failed_logins,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(e.retry_after_seconds)},
            )
        if out.session is not None:
            return Response(
                {"access": out.access, "refresh": out.refresh, "session_id": str(out.session.id)}
            )
        return Response(
            {
                "memberships": [m.as_dict() for m in out.memberships],
                "select_ticket": out.select_ticket,
            }
        )


class VerifyRequestSerializer(serializers.Serializer[dict[str, Any]]):
    identifier = serializers.CharField(max_length=254)
    purpose = serializers.ChoiceField(choices=PURPOSES)


class VerifyPolicySerializer(serializers.Serializer[dict[str, Any]]):
    code_length = serializers.IntegerField()
    code_ttl_seconds = serializers.IntegerField()
    resend_after_seconds = serializers.IntegerField()
    max_resends = serializers.IntegerField()
    max_send_failures = serializers.IntegerField()
    max_confirm_attempts = serializers.IntegerField()


class VerifyRequestResponseSerializer(serializers.Serializer[dict[str, Any]]):
    expires_at = serializers.DateTimeField()
    resend_after_seconds = serializers.IntegerField()
    resends_left = serializers.IntegerField()
    sends = serializers.IntegerField()
    policy = VerifyPolicySerializer()


class VerifyErrorSerializer(serializers.Serializer[dict[str, Any]]):
    detail = serializers.ChoiceField(
        choices=[
            "identifier_invalid",
            "resend_too_soon",
            "resend_limit",
            "send_failed",
            "code_expired",
            "code_invalid",
        ]
    )
    retry_after_seconds = serializers.IntegerField(required=False)
    send_failures = serializers.IntegerField(required=False)
    manual_suggested = serializers.BooleanField(required=False)
    attempts_left = serializers.IntegerField(required=False)
    policy = VerifyPolicySerializer(required=False)


class VerifyRequestView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        request=VerifyRequestSerializer,
        responses={
            202: VerifyRequestResponseSerializer,
            400: VerifyErrorSerializer,
            429: VerifyErrorSerializer,
            503: VerifyErrorSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        s = VerifyRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        policy = verify.POLICY.as_dict()
        try:
            r = verify.request_code(s.validated_data["identifier"], s.validated_data["purpose"])
        except ValueError:
            return Response({"detail": "identifier_invalid", "policy": policy}, status=400)
        except verify.ResendTooSoon as e:
            return Response(
                {
                    "detail": "resend_too_soon",
                    "retry_after_seconds": e.retry_after_seconds,
                    "policy": policy,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(e.retry_after_seconds)},
            )
        except verify.ResendLimit:
            return Response(
                {"detail": "resend_limit", "manual_suggested": True, "policy": policy},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except verify.SendUnavailable as e:
            return Response(
                {
                    "detail": "send_failed",
                    "send_failures": e.failures,
                    "manual_suggested": e.manual_suggested,
                    "policy": policy,
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(
            {
                "expires_at": r.expires_at,
                "resend_after_seconds": r.resend_after_seconds,
                "resends_left": r.resends_left,
                "sends": r.sends,
                "policy": policy,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class VerifyConfirmSerializer(serializers.Serializer[dict[str, Any]]):
    identifier = serializers.CharField(max_length=254)
    purpose = serializers.ChoiceField(choices=PURPOSES)
    code = serializers.CharField(max_length=12)


class VerifyConfirmView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        request=VerifyConfirmSerializer,
        responses={
            200: inline_serializer("Verified", {"verified_ticket": serializers.CharField()}),
            400: VerifyErrorSerializer,
            410: VerifyErrorSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        s = VerifyConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            ticket = verify.confirm_code(
                s.validated_data["identifier"],
                s.validated_data["purpose"],
                s.validated_data["code"],
            )
        except ValueError:
            return Response({"detail": "identifier_invalid"}, status=400)
        except verify.CodeExpired:
            return Response({"detail": "code_expired"}, status=status.HTTP_410_GONE)
        except verify.CodeInvalid as e:
            return Response(
                {"detail": "code_invalid", "attempts_left": e.attempts_left}, status=400
            )
        return Response({"verified_ticket": ticket})


class ManualRequestSerializer(serializers.Serializer[dict[str, Any]]):
    identifier = serializers.CharField(max_length=254)
    purpose = serializers.ChoiceField(choices=PURPOSES)
    # يجمعه الدعم إن لم يُذكر — الإطار لا يرسم حقلاً له (0005 §٣)
    tenant_name = serializers.CharField(
        max_length=200, allow_blank=True, required=False, default=""
    )


class VerifyManualView(APIView):
    """«فتح طلب تحقق يدوي» (13-D8): مسار مكتمل؛ الدعم يراجع الهوية ومستند المنشأة."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        request=ManualRequestSerializer,
        responses={
            201: inline_serializer(
                "ManualRequestOpened",
                {"request_id": serializers.UUIDField(), "status": serializers.CharField()},
            ),
            400: VerifyErrorSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        s = ManualRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            req = verify.open_manual_request(
                s.validated_data["identifier"],
                s.validated_data["purpose"],
                str(s.validated_data.get("tenant_name", "")),
            )
        except ValueError:
            return Response({"detail": "identifier_invalid"}, status=400)
        return Response({"request_id": str(req.id), "status": req.status}, status=201)
