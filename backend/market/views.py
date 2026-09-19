"""MP-08/MP-09 واجهات دور البائع والصفحة المنشورة، ومراجعة المشرف عبر الـAPI حتى PLT-06."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from market import services
from market.models import MarketAccount


def _ctx(request: Request) -> tuple[AuthContext | None, Any]:
    auth = request.auth
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        return None, None
    return auth, auth.tenant_id


def _reject(e: services.MarketRejected) -> Response:
    code = 403 if e.code in {"owner_required", "permission_denied"} else 400
    return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=code)


class MarketAccountView(APIView):
    """MP-08: حالة دور البائع وقائمة التحقق؛ `PUT` يحفظ ما اكتمل (مسوّدة)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response({"account": services.account_payload(services.ensure_account(), v)})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def put(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        doc = body.get("registry_doc") if isinstance(body.get("registry_doc"), dict) else None
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                acc = services.save_verification(
                    actor=auth.user,
                    viewer=v,
                    business_address=body.get("business_address"),
                    service_area_note=body.get("service_area_note"),
                    accept_terms=bool(body.get("accept_terms")) if "accept_terms" in body else None,
                    registry_doc={str(k): str(val) for k, val in (doc or {}).items()}
                    if doc
                    else None,
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"account": services.account_payload(acc, v)})


class MarketVerificationSubmitView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                acc = services.submit_verification(actor=auth.user, viewer=v)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"account": services.account_payload(acc, v)})


class MarketProfileView(APIView):
    """MP-09: المسوّدة والمعاينة العامة؛ `PUT {…, publish}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response({"profile": services.profile_payload(services.ensure_profile(), v)})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def put(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                p = services.save_profile(
                    actor=auth.user, viewer=v, data=body, publish=bool(body.get("publish"))
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"profile": services.profile_payload(p, v)})


class PlatformMarketVerificationReviewView(APIView):
    """PLT-06 عبر الـAPI: `{decision: verified|needs_more|rejected, reasons?: {field: text}}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, tenant_id: uuid.UUID) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or not auth.user.is_platform_staff:
            return Response({"detail": "platform_staff_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        raw = body.get("reasons")
        reasons = {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else None
        with tenant_context(tenant_id):
            acc = MarketAccount.objects.first()
            if acc is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                services.review_verification(
                    acc,
                    reviewer_name=auth.user.display_name,
                    decision=str(body.get("decision", "")),
                    reasons=reasons,
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response(
                {"verification": acc.verification, "review_reasons": acc.review_reasons}
            )
