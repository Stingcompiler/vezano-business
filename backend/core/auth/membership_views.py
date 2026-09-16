"""نقاط نهاية ACC-03/ACC-04 (T1.2): العضويات، الاختيار، وصفات القطاع، إنشاء المنشأة، حالة الإنشاء.

الهوية إمّا جلسة (Bearer) وإمّا تذكرة اختيار `X-Select-Ticket` الصادرة عن الدخول —
لا معرّف حساب في الحمولة.
"""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth import memberships as svc
from core.auth.tokens import AuthContext, SessionAuthentication
from core.models import Account
from core.recipes import CURRENCIES, RECIPES
from core.tenancy import platform_context

TICKET_HEADER = "HTTP_X_SELECT_TICKET"
TICKET_PARAM = OpenApiParameter(
    "X-Select-Ticket", str, OpenApiParameter.HEADER, description="تذكرة الاختيار من الدخول"
)


class AccountOrTicketView(APIView):
    """يستخلص الحساب من الجلسة أو من التذكرة؛ 401 موحّد عند غيابهما."""

    permission_classes = (AllowAny,)
    authentication_classes = (SessionAuthentication,)

    def account(self, request: Request) -> Account | None:
        auth = request.auth
        if isinstance(auth, AuthContext):
            if auth.user.account_id is None:
                return None
            with platform_context():
                return Account.unscoped.filter(id=auth.user.account_id, is_active=True).first()
        raw = request.META.get(TICKET_HEADER, "")
        if not raw:
            return None
        try:
            return svc.account_from_ticket(raw)
        except svc.TicketInvalid:
            return None


class MembershipRowSerializer(serializers.Serializer[dict[str, Any]]):
    user_id = serializers.UUIDField()
    tenant_id = serializers.UUIDField()
    tenant_name = serializers.CharField()
    role_name = serializers.CharField()
    scope = serializers.CharField()
    status = serializers.ChoiceField(choices=["active", "suspended"])


class MembershipsView(AccountOrTicketView):
    @extend_schema(
        parameters=[TICKET_PARAM],
        responses={
            200: inline_serializer(
                "Memberships",
                {
                    "memberships": MembershipRowSerializer(many=True),
                    "fetched_at": serializers.DateTimeField(),
                },
            ),
            401: None,
        },
    )
    def get(self, request: Request) -> Response:
        from django.utils import timezone

        account = self.account(request)
        if account is None:
            return Response({"detail": "unauthenticated"}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(
            {
                "memberships": [m.as_dict() for m in svc.memberships_of(account)],
                "fetched_at": timezone.now(),
            }
        )


class SelectSerializer(serializers.Serializer[dict[str, Any]]):
    tenant_id = serializers.UUIDField()


class SelectResponseSerializer(serializers.Serializer[dict[str, Any]]):
    access = serializers.CharField()
    refresh = serializers.CharField()
    session_id = serializers.UUIDField()
    tenant_id = serializers.UUIDField()
    user_id = serializers.UUIDField()


class SelectView(AccountOrTicketView):
    @extend_schema(
        parameters=[TICKET_PARAM],
        request=SelectSerializer,
        responses={
            200: SelectResponseSerializer,
            401: None,
            403: inline_serializer("Suspended", {"detail": serializers.CharField()}),
            404: None,
        },
    )
    def post(self, request: Request) -> Response:
        account = self.account(request)
        if account is None:
            return Response({"detail": "unauthenticated"}, status=status.HTTP_401_UNAUTHORIZED)
        s = SelectSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            out = svc.select_membership(
                account,
                str(s.validated_data["tenant_id"]),
                user_agent=request.META.get("HTTP_USER_AGENT", ""),
            )
        except svc.MembershipNotFound:
            return Response({"detail": "membership_not_found"}, status=status.HTTP_404_NOT_FOUND)
        except svc.MembershipSuspended:
            return Response({"detail": "membership_suspended"}, status=status.HTTP_403_FORBIDDEN)
        return Response(out)


class SectorsView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        responses={
            200: inline_serializer(
                "Sectors",
                {
                    "sectors": inline_serializer(
                        "Sector",
                        {"code": serializers.CharField(), "name": serializers.CharField()},
                        many=True,
                    ),
                    "currencies": inline_serializer(
                        "Currency",
                        {
                            "code": serializers.CharField(),
                            "name": serializers.CharField(),
                            "exponent": serializers.IntegerField(),
                        },
                        many=True,
                    ),
                },
            )
        }
    )
    def get(self, _request: Request) -> Response:
        return Response(
            {
                "sectors": [{"code": r.code, "name": r.name} for r in RECIPES.values()],
                "currencies": [
                    {"code": c, "name": n, "exponent": e} for c, (n, e) in CURRENCIES.items()
                ],
            }
        )


class CreateTenantSerializer(serializers.Serializer[dict[str, Any]]):
    client_request_id = serializers.UUIDField()
    name = serializers.CharField(max_length=200, allow_blank=True)
    sector = serializers.CharField(max_length=40, allow_blank=True)
    currency = serializers.CharField(max_length=3)
    first_branch_name = serializers.CharField(max_length=200, allow_blank=True, required=False)


class CreatedCountsSerializer(serializers.Serializer[dict[str, Any]]):
    items = serializers.IntegerField()
    groups = serializers.IntegerField()
    branches = serializers.IntegerField()
    units = serializers.IntegerField()
    payment_methods = serializers.IntegerField()
    roles = serializers.IntegerField()


class CreationSerializer(serializers.Serializer[dict[str, Any]]):
    client_request_id = serializers.UUIDField()
    tenant_id = serializers.UUIDField()
    tenant_name = serializers.CharField()
    branch_id = serializers.UUIDField()
    user_id = serializers.UUIDField()
    sector = serializers.CharField()
    created = CreatedCountsSerializer()
    access = serializers.CharField()
    refresh = serializers.CharField()
    session_id = serializers.UUIDField()


class CreationErrorSerializer(serializers.Serializer[dict[str, Any]]):
    detail = serializers.ChoiceField(choices=["validation_error"])
    # «fields» اسم محجوز في Serializer
    invalid_fields = serializers.DictField(child=serializers.CharField())


def _with_session(account: Account, result: svc.CreationResult, user_agent: str) -> dict[str, Any]:
    out = result.as_dict()
    out.update(svc.select_membership(account, out["tenant_id"], user_agent=user_agent))
    return out


class CreateTenantView(AccountOrTicketView):
    """POST ينشئ بهوية طلب (متكرّر الأثر)؛ GET بالهوية يستعلم عن الحالة قبل أي إعادة (34-D26)."""

    @extend_schema(
        parameters=[TICKET_PARAM],
        request=CreateTenantSerializer,
        responses={
            201: CreationSerializer,
            200: CreationSerializer,
            400: CreationErrorSerializer,
            401: None,
        },
    )
    def post(self, request: Request) -> Response:
        account = self.account(request)
        if account is None:
            return Response({"detail": "unauthenticated"}, status=status.HTTP_401_UNAUTHORIZED)
        s = CreateTenantSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            result = svc.create_tenant(
                account,
                client_request_id=d["client_request_id"],
                name=d["name"],
                sector=d["sector"],
                currency=d["currency"],
                first_branch_name=str(d.get("first_branch_name", "")),
            )
        except svc.ValidationFailed as e:
            return Response(
                {"detail": "validation_error", "invalid_fields": e.fields},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ua = request.META.get("HTTP_USER_AGENT", "")
        return Response(
            _with_session(account, result, ua),
            status=status.HTTP_200_OK if result.already_existed else status.HTTP_201_CREATED,
        )


class CreationStatusView(AccountOrTicketView):
    @extend_schema(
        parameters=[TICKET_PARAM],
        responses={200: CreationSerializer, 401: None, 404: None},
    )
    def get(self, request: Request, client_request_id: uuid.UUID) -> Response:
        account = self.account(request)
        if account is None:
            return Response({"detail": "unauthenticated"}, status=status.HTTP_401_UNAUTHORIZED)
        creation = svc.creation_for(account, client_request_id)
        if creation is None:
            return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        ua = request.META.get("HTTP_USER_AGENT", "")
        return Response(_with_session(account, svc.CreationResult(creation, True), ua))
