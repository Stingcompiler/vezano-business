"""CUS-01/CUS-02: الصفحة العامة (بلا جلسة) والاشتراك، ورابط/QR المحل للمالك."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home, portal
from core.auth.tokens import AuthContext
from core.models import PortalChannel
from core.tenancy import platform_context, tenant_context


def _reject(e: portal.PortalRejected) -> Response:
    return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=400)


def _channel(slug: str) -> PortalChannel | None:
    with platform_context():
        ch: PortalChannel | None = PortalChannel.unscoped.filter(slug=slug).first()
    return ch


class PortalPageView(APIView):
    """CUS-01 — الصفحة المنشورة: ما نشره التاجر بنفسه ولا شيء سواه. رابط لا وجود له = 404 بلا
    تفصيل (المتصفح يُحوَّل إلى PUB-04 من الواجهة)."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[OpenApiParameter("c", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 404: None},
    )
    def get(self, request: Request, slug: str) -> Response:
        ch = _channel(slug)
        if ch is None:
            return Response({"detail": "not_found"}, status=404)
        with tenant_context(ch.tenant_id):
            return Response(
                portal.page_payload(ch, campaign_id=str(request.query_params.get("c", "")))
            )


class PortalSubscribeView(APIView):
    """CUS-02 — اشتراك صريح بقناة هذا المحل:
    `{phone, push_permission?, push?{endpoint,p256dh,auth}}`."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=None, responses={201: None, 400: None, 404: None})
    def post(self, request: Request, slug: str) -> Response:
        ch = _channel(slug)
        if ch is None:
            return Response({"detail": "not_found"}, status=404)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        push = body.get("push") if isinstance(body.get("push"), dict) else None
        with tenant_context(ch.tenant_id):
            try:
                sub = portal.subscribe(
                    phone=str(body.get("phone", "")),
                    push_permission=str(body.get("push_permission", "")),
                    push={str(k): str(v) for k, v in (push or {}).items()},
                )
            except portal.PortalRejected as e:
                return _reject(e)
            return Response({"subscriber": portal.subscriber_payload(sub)}, status=201)


class PortalChannelView(APIView):
    """للمالك: رابط المحل ورمز QR والعنوان وساعات العمل (ما يُنشر — الحقول المنشورة فقط)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            v = home.viewer_for(auth.user, auth.device)
            if not v.is_owner:
                return Response({"detail": "owner_required"}, status=403)
            return Response(
                portal.channel_payload(
                    portal.ensure_channel(), base_url=request.build_absolute_uri("/").rstrip("/")
                )
            )

    @extend_schema(request=None, responses={200: None, 403: None})
    def put(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(auth.tenant_id):
            v = home.viewer_for(auth.user, auth.device)
            if not v.is_owner:
                return Response({"detail": "owner_required"}, status=403)
            ch = portal.update_channel(
                actor=auth.user,
                address=body.get("address") if body.get("address") is not None else None,
                hours=body.get("hours") if body.get("hours") is not None else None,
            )
            return Response(
                portal.channel_payload(ch, base_url=request.build_absolute_uri("/").rstrip("/"))
            )


# ------------------------------------------------------------------ CUS-03/04/05 (T3.2)


def _me(slug: str, request: Request) -> tuple[Any, Any]:
    """المشترك بالرمز (`?t=`) على قناة هذا المحل — رمز لا يخصّ هذا المحل أو لا وجود له = لا شيء."""
    ch = _channel(slug)
    if ch is None:
        return None, None
    tok = str(request.query_params.get("t", ""))
    with platform_context():
        sub = portal.by_token(tok)
    if sub is None or sub.tenant_id != ch.tenant_id:
        return ch, None
    return ch, sub


class PortalMeView(APIView):
    """CUS-04: حالة الاشتراك وقنواته؛ `PUT {channels:{push,sms,inbox}}`؛ `DELETE` = إلغاء هذا
    المحل وحده."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[OpenApiParameter("t", str, OpenApiParameter.QUERY, required=True)],
        responses={200: None, 404: None},
    )
    def get(self, request: Request, slug: str) -> Response:
        ch, sub = _me(slug, request)
        if ch is None or sub is None:
            return Response({"detail": "not_found"}, status=404)
        with tenant_context(ch.tenant_id):
            return Response({"subscriber": portal.me_payload(sub)})

    @extend_schema(
        parameters=[OpenApiParameter("t", str, OpenApiParameter.QUERY, required=True)],
        request=None,
        responses={200: None, 400: None, 404: None},
    )
    def put(self, request: Request, slug: str) -> Response:
        ch, sub = _me(slug, request)
        if ch is None or sub is None:
            return Response({"detail": "not_found"}, status=404)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        raw = body.get("channels")
        chs: dict[str, Any] = dict(raw) if isinstance(raw, dict) else {}
        with tenant_context(ch.tenant_id):
            try:
                portal.update_prefs(
                    sub,
                    push=bool(chs.get("push", sub.channel_push)),
                    sms=bool(chs.get("sms", sub.channel_sms)),
                    inbox=bool(chs.get("inbox", sub.channel_inbox)),
                )
            except portal.PortalRejected as e:
                return _reject(e)
            return Response({"subscriber": portal.me_payload(sub)})

    @extend_schema(
        parameters=[OpenApiParameter("t", str, OpenApiParameter.QUERY, required=True)],
        responses={200: None, 404: None},
    )
    def delete(self, request: Request, slug: str) -> Response:
        ch, sub = _me(slug, request)
        if ch is None or sub is None:
            return Response({"detail": "not_found"}, status=404)
        with tenant_context(ch.tenant_id):
            portal.unsubscribe(sub)
            return Response({"subscriber": portal.me_payload(sub)})


class PortalResubscribeView(APIView):
    """«تراجع عن الإلغاء» خلال 7 أيام."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[OpenApiParameter("t", str, OpenApiParameter.QUERY, required=True)],
        request=None,
        responses={200: None, 404: None, 410: None},
    )
    def post(self, request: Request, slug: str) -> Response:
        ch, sub = _me(slug, request)
        if ch is None or sub is None:
            return Response({"detail": "not_found"}, status=404)
        with tenant_context(ch.tenant_id):
            try:
                portal.resubscribe(sub)
            except portal.PortalRejected as e:
                return Response({"detail": e.code}, status=410)
            return Response({"subscriber": portal.me_payload(sub)})


class PortalMessagesView(APIView):
    """CUS-03: رسائل هذا المحل للمشترك بالرمز."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[OpenApiParameter("t", str, OpenApiParameter.QUERY, required=True)],
        responses={200: None, 404: None},
    )
    def get(self, request: Request, slug: str) -> Response:
        ch, sub = _me(slug, request)
        if ch is None or sub is None:
            return Response({"detail": "not_found"}, status=404)
        with tenant_context(ch.tenant_id):
            return Response(
                {"subscriber": portal.me_payload(sub), "messages": portal.messages_payload(sub)}
            )


class PortalMessageReadView(APIView):
    """فتح رسالة يعلّمها مقروءة؛ رسالة لمشترك آخر = 403 بلا محتوى ولا اسم."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[OpenApiParameter("t", str, OpenApiParameter.QUERY, required=True)],
        request=None,
        responses={200: None, 403: None, 404: None},
    )
    def post(self, request: Request, slug: str, message_id: uuid.UUID) -> Response:
        ch, sub = _me(slug, request)
        if ch is None or sub is None:
            return Response({"detail": "not_found"}, status=404)
        with tenant_context(ch.tenant_id):
            m = portal.mark_read(sub, message_id)
            if m is None:
                # موجودة لمشترك آخر أو لا وجود لها — الردّ نفسه بلا محتوى
                return Response({"detail": "permission_denied"}, status=403)
            return Response({"ok": True})
