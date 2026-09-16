"""نقاط نهاية ACC-06 (T1.4): عرض الدعوة وقبولها — بهوية الحساب (جلسة أو تذكرة اختيار)."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response

from core.auth import invitations as svc
from core.auth.membership_views import TICKET_PARAM, AccountOrTicketView


class InviteSerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(
        choices=["valid", "expired", "accepted", "not_for_you", "not_found"]
    )
    tenant_name = serializers.CharField(allow_blank=True)
    inviter_name = serializers.CharField(allow_blank=True)
    role_name = serializers.CharField(allow_blank=True)
    branch_name = serializers.CharField(allow_blank=True)
    expires_at = serializers.CharField(allow_blank=True)
    tenant_id = serializers.CharField(allow_blank=True)
    user_id = serializers.CharField(allow_blank=True)


class InviteView(AccountOrTicketView):
    @extend_schema(parameters=[TICKET_PARAM], responses={200: InviteSerializer, 401: None})
    def get(self, request: Request, token: str) -> Response:
        account = self.account(request)
        if account is None:
            return Response({"detail": "unauthenticated"}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(svc.view_invitation(token, account).as_dict())


class InviteAcceptView(AccountOrTicketView):
    @extend_schema(
        parameters=[TICKET_PARAM],
        request=None,
        responses={200: InviteSerializer, 401: None, 403: InviteSerializer, 410: InviteSerializer},
    )
    def post(self, request: Request, token: str) -> Response:
        account = self.account(request)
        if account is None:
            return Response({"detail": "unauthenticated"}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            view = svc.accept_invitation(token, account)
        except svc.InviteUnavailable as e:
            code = {
                "not_for_you": status.HTTP_403_FORBIDDEN,
                "expired": status.HTTP_410_GONE,
                "not_found": status.HTTP_404_NOT_FOUND,
            }[e.status]
            return Response(svc.InviteView(e.status).as_dict(), status=code)
        return Response(view.as_dict())
