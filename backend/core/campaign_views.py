"""NOT-03/NOT-04: قائمة الحملات والحصة، معاينة الجمهور والتكلفة، حفظ المسودة."""

from __future__ import annotations

import uuid
from typing import Any

from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import campaigns, home
from core.auth.tokens import AuthContext
from core.models import Campaign
from core.tenancy import tenant_context


def _tenant(auth: Any) -> Any:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _viewer(auth: Any) -> home.Viewer:
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


def _reject(e: campaigns.CampaignRejected) -> Response:
    code = 403 if e.code == "permission_denied" else 400
    return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=code)


class CampaignsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not campaigns.can_create(v) and not campaigns.can_approve(v):
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name}, status=403
                )
            return Response(campaigns.list_payload(v))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            try:
                c = campaigns.save(
                    actor=auth.user,
                    viewer=v,
                    campaign=None,
                    name=str(body.get("name", "")),
                    message=str(body.get("message", "")),
                    rules=dict(body.get("audience") or {}),
                    scheduled_at=parse_datetime(str(body.get("scheduled_at") or "")) or None,
                    night_confirmed=bool(body.get("night_confirmed", False)),
                )
            except campaigns.CampaignRejected as e:
                return _reject(e)
            return Response({"campaign": campaigns.campaign_payload(c)}, status=201)


class CampaignPreviewView(APIView):
    """NOT-04: العدد يتغير أمام المستخدم مع كل شرط — الحساب خادمي دائماً."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not campaigns.can_create(v):
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name}, status=403
                )
            try:
                return Response(
                    campaigns.preview(
                        message=str(body.get("message", "")),
                        rules=dict(body.get("audience") or {}),
                        scheduled_at=parse_datetime(str(body.get("scheduled_at") or "")) or None,
                        night_confirmed=bool(body.get("night_confirmed", False)),
                    )
                )
            except campaigns.CampaignRejected as e:
                return _reject(e)


class CampaignDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, campaign_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not campaigns.can_create(v) and not campaigns.can_approve(v):
                return Response({"detail": "permission_denied"}, status=403)
            campaigns.run_due()
            c = Campaign.objects.filter(id=campaign_id).first()
            if c is None:
                return Response({"detail": "not_found"}, status=404)
            return Response({"campaign": campaigns.detail_payload(c, v)})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def put(self, request: Request, campaign_id: uuid.UUID) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            c = Campaign.objects.filter(id=campaign_id).first()
            if c is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                c = campaigns.save(
                    actor=auth.user,
                    viewer=v,
                    campaign=c,
                    name=str(body.get("name", c.name)),
                    message=str(body.get("message", c.message)),
                    rules=dict(body.get("audience") or c.audience_rules or {}),
                    scheduled_at=parse_datetime(str(body.get("scheduled_at") or "")) or None,
                    night_confirmed=bool(body.get("night_confirmed", False)),
                )
            except campaigns.CampaignRejected as e:
                return _reject(e)
            return Response({"campaign": campaigns.campaign_payload(c)})


class CampaignActionView(APIView):
    """NOT-05/06: اعتماد (جدولة أو إرسال الآن) بإعادة التحقق قبل كل محاولة، إلغاء، إعادة محاولة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, campaign_id: uuid.UUID, action: str) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            c = Campaign.objects.filter(id=campaign_id).first()
            if c is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                if action == "approve":
                    campaigns.approve(
                        actor=auth.user,
                        viewer=v,
                        campaign=c,
                        scheduled_at=parse_datetime(str(body.get("scheduled_at") or "")) or None,
                        night_confirmed=bool(body.get("night_confirmed", False)),
                        send_now=bool(body.get("send_now", False)),
                    )
                elif action == "cancel":
                    campaigns.cancel(actor=auth.user, viewer=v, campaign=c)
                elif action == "retry":
                    campaigns.retry_temporary(actor=auth.user, viewer=v, campaign=c)
                elif action == "verify":
                    out = campaigns.verify_for_send(
                        c,
                        scheduled_at=parse_datetime(str(body.get("scheduled_at") or "")) or None,
                        night_confirmed=bool(body.get("night_confirmed", False)),
                    )
                    return Response({**out, "campaign": campaigns.detail_payload(c, v)})
                else:
                    return Response({"detail": "unknown_action"}, status=404)
            except campaigns.CampaignRejected as e:
                return _reject(e)
            c.refresh_from_db()
            return Response({"campaign": campaigns.detail_payload(c, v)})
