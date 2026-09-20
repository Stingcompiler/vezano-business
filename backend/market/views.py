"""MP-08/MP-09 واجهات دور البائع والصفحة المنشورة، ومراجعة المشرف عبر الـAPI حتى PLT-06."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from market import disputes as disputes_svc
from market import links as links_svc
from market import order_flow as flow_svc
from market import orders as orders_svc
from market import services
from market import settlement as settle_svc
from market.models import MarketAccount, MarketInvite, MarketOrder, MarketReport


def _ctx(request: Request) -> tuple[AuthContext | None, Any]:
    auth = request.auth
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        return None, None
    return auth, auth.tenant_id


def _reject(e: services.MarketRejected) -> Response:
    code = (
        403
        if e.code in {"owner_required", "permission_denied", "publish_permission_required"}
        else 400
    )
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


# ------------------------------------------------------------------ MP-10/MP-11 (T3.4)
from market import offers as offers_svc  # noqa: E402
from market.models import MarketOffer  # noqa: E402


class MarketOffersView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            if not offers_svc.can_edit(v):
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name}, status=403
                )
            return Response(offers_svc.list_payload(v))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                o = offers_svc.save(actor=auth.user, viewer=v, offer=None, data=body)
                if body.get("publish"):
                    offers_svc.publish(actor=auth.user, viewer=v, offer=o)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"offer": offers_svc.offer_payload(o, v)}, status=201)


class MarketOfferPreviewView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            if not offers_svc.can_edit(v):
                return Response({"detail": "permission_denied"}, status=403)
            try:
                return Response(offers_svc.preview(viewer=v, data=body))
            except services.MarketRejected as e:
                return _reject(e)


class MarketOfferDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, offer_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            if not offers_svc.can_edit(v):
                return Response({"detail": "permission_denied"}, status=403)
            o = MarketOffer.objects.filter(id=offer_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            return Response({"offer": offers_svc.offer_payload(o, v)})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def put(self, request: Request, offer_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            o = MarketOffer.objects.filter(id=offer_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                offers_svc.save(actor=auth.user, viewer=v, offer=o, data=body)
                if body.get("publish"):
                    offers_svc.publish(actor=auth.user, viewer=v, offer=o)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"offer": offers_svc.offer_payload(o, v)})


class MarketOfferActionView(APIView):
    """publish · hide · appeal (PLT-07)"""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, offer_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            o = MarketOffer.objects.filter(id=offer_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                if action == "publish":
                    offers_svc.publish(actor=auth.user, viewer=v, offer=o)
                elif action == "hide":
                    offers_svc.hide(actor=auth.user, viewer=v, offer=o)
                elif action == "appeal":
                    body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
                    offers_svc.appeal_suspension(actor=auth.user, viewer=v, offer=o, body=body)
                else:
                    return Response({"detail": "unknown_action"}, status=404)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"offer": offers_svc.offer_payload(o, v)})


# ------------------------------------------------------------------ MP-12/MP-13 (T3.5)
from market import price_lists as pl_svc  # noqa: E402
from market.models import MarketPriceList, MarketPriceListMember  # noqa: E402


class MarketRenewalsView(APIView):
    """MP-13: ما ينتهي وما انتهى — الأقرب انتهاءً أولاً."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            if not offers_svc.can_edit(v):
                return Response({"detail": "permission_denied"}, status=403)
            return Response(offers_svc.renewals_payload(v))


class MarketOfferRenewView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, offer_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            o = MarketOffer.objects.filter(id=offer_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                days = int(str(body.get("days", "0") or 0))
            except ValueError:
                days = 0
            try:
                offers_svc.renew(actor=auth.user, viewer=v, offer=o, days=days)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"offer": offers_svc.offer_payload(o, v)})


class MarketPriceListsView(APIView):
    """MP-12: القوائم الخاصة للبائع؛ `POST {offer_id, name, tiers}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            if not offers_svc.can_edit(v):
                return Response({"detail": "permission_denied"}, status=403)
            return Response(pl_svc.lists_payload(v))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                pl = pl_svc.save_list(
                    actor=auth.user,
                    viewer=v,
                    price_list=None,
                    offer_id=str(body.get("offer_id", "")),
                    name=str(body.get("name", "")),
                    tiers=body.get("tiers"),
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"list": pl_svc.list_payload(pl)}, status=201)


class MarketPriceListDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, list_id: uuid.UUID) -> Response:
        """للبائع: القائمة كاملة؛ لمشترٍ مخوَّل: الشرائح؛ لغيرهما 404 بلا تفصيل (ACC-121)."""
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            pl = MarketPriceList.objects.select_related("offer").filter(id=list_id).first()
            if pl is not None and offers_svc.can_edit(v):
                return Response({"list": pl_svc.list_payload(pl), "role": "seller"})
        visible = pl_svc.visible_list_for(buyer_tenant_id=tid, list_id=list_id)
        if visible is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"list": visible, "role": "buyer"})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def put(self, request: Request, list_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            pl = MarketPriceList.objects.select_related("offer").filter(id=list_id).first()
            if pl is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                pl_svc.save_list(
                    actor=auth.user,
                    viewer=v,
                    price_list=pl,
                    offer_id=str(body.get("offer_id", pl.offer_id)),
                    name=str(body.get("name", pl.name)),
                    tiers=body.get("tiers", pl.tiers),
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"list": pl_svc.list_payload(pl)})


class MarketPriceListMembersView(APIView):
    """`POST {buyer_tenant_id}` دعوة؛ `POST …/members/{id}/suspend|resume`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, list_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            pl = MarketPriceList.objects.filter(id=list_id).first()
            if pl is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                m = pl_svc.invite_member(
                    actor=auth.user,
                    viewer=v,
                    price_list=pl,
                    buyer_tenant_id=str(body.get("buyer_tenant_id", "")),
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"member": pl_svc.member_payload(m)}, status=201)


class MarketPriceListMemberActionView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(
        self, request: Request, list_id: uuid.UUID, member_id: uuid.UUID, action: str
    ) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            m = MarketPriceListMember.objects.filter(id=member_id, price_list_id=list_id).first()
            if m is None:
                return Response({"detail": "not_found"}, status=404)
            if action not in {"suspend", "resume"}:
                return Response({"detail": "unknown_action"}, status=404)
            try:
                pl_svc.suspend_member(viewer=v, member=m, suspend=action == "suspend")
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"member": pl_svc.member_payload(m)})


class MarketPriceListAcceptView(APIView):
    """المشتري يقبل دعوة قائمة خاصة بحسابه — دعوة لغيره أو منتهية = 404 بلا تفصيل."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, list_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        m = pl_svc.accept_invite(buyer_tenant_id=tid, list_id=list_id)
        if m is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"member": pl_svc.member_payload(m)})


# ------------------------------------------------------------------ MP-05/MP-06 (T3.8)
from rest_framework.permissions import AllowAny  # noqa: E402

from market import follows as follows_svc  # noqa: E402
from market.models import MarketFollow  # noqa: E402


class PublicOfferDetailView(APIView):
    """MP-05: العرض بشروطه كاملة — بلا حساب للعام، وبحساب المشتري للخاص/للمتابعين؛ غير المخوَّل
    والمعدوم 404 نفسه."""

    permission_classes = (AllowAny,)

    @extend_schema(responses={200: None, 404: None})
    def get(self, request: Request, offer_id: uuid.UUID) -> Response:
        auth = request.auth
        tid = auth.tenant_id if isinstance(auth, AuthContext) else None
        d = follows_svc.offer_detail(offer_id=offer_id, buyer_tenant_id=tid)
        if d is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"offer": d})


class MarketFollowingView(APIView):
    """MP-06: الموردون الذين أتابعهم؛ `POST {supplier_tenant_id}` متابعة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response(follows_svc.following_payload(v))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            sid = uuid.UUID(str(body.get("supplier_tenant_id", "")))
        except ValueError:
            return Response({"detail": "supplier_unknown"}, status=400)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                f = follows_svc.follow(actor=auth.user, viewer=v, supplier_tenant_id=sid)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"follow": follows_svc.follow_payload(f)}, status=201)


class MarketUnfollowView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, follow_id: uuid.UUID) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            f = MarketFollow.objects.filter(id=follow_id).first()
            if f is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                follows_svc.unfollow(actor=auth.user, viewer=v, f=f)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"follow": follows_svc.follow_payload(f)})


# ------------------------------------------------------------------ MP-07 / MP-14 / MP-15


def _tenant_or_403(request: Request) -> tuple[AuthContext, Any] | Response:
    auth, tid = _ctx(request)
    if auth is None:
        return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
    return auth, tid


class MarketSharePreviewView(APIView):
    """MP-07: معاينة ما سيراه المستلم — عامة دوماً ولا سعر خاص فيها (ACC-150)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("offer", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("supplier", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 404: None},
    )
    def get(self, request: Request) -> Response:
        offer = request.query_params.get("offer", "")
        supplier = request.query_params.get("supplier", "")
        try:
            oid = uuid.UUID(offer) if offer else None
            sid = uuid.UUID(supplier) if supplier else None
        except ValueError:
            return Response({"detail": "not_found"}, status=404)
        p = links_svc.share_preview(offer_id=oid, supplier_tenant_id=sid)
        if p is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"preview": p})


class MarketInvitesView(APIView):
    """MP-07: روابطي ودعواتي بعدّاداتها؛ `POST` ينشئ رابط مشاركة (`offer_id`/`supplier_tenant_id`)
    أو دعوة منشأة (`kind=invite`, `message`) أو طلب تخويل (`kind=authorization`)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response(links_svc.invites_payload(v))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        kind = str(body.get("kind") or "share")
        try:
            oid = uuid.UUID(str(body["offer_id"])) if body.get("offer_id") else None
            sid = (
                uuid.UUID(str(body["supplier_tenant_id"]))
                if body.get("supplier_tenant_id")
                else None
            )
        except ValueError:
            return Response({"detail": "target_unknown", "field": "target"}, status=400)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                if kind == "authorization":
                    if sid is None:
                        return Response({"detail": "supplier_unknown"}, status=400)
                    inv = links_svc.request_authorization(
                        actor=auth.user,
                        viewer=v,
                        supplier_tenant_id=sid,
                        message=str(body.get("message") or ""),
                    )
                    return Response({"invite": links_svc.invite_payload(inv)}, status=201)
                if kind == "invite":
                    inv, raw = links_svc.invite(
                        actor=auth.user, viewer=v, message=str(body.get("message") or "")
                    )
                else:
                    inv, raw = links_svc.share(
                        actor=auth.user, viewer=v, offer_id=oid, supplier_tenant_id=sid
                    )
            except services.MarketRejected as e:
                return _reject(e)
            return Response(
                {
                    "invite": links_svc.invite_payload(inv),
                    "token": raw,
                    "path": f"/market/i/{raw}",
                    "preview": (
                        links_svc.share_preview(offer_id=oid, supplier_tenant_id=sid)
                        if kind == "share"
                        else links_svc.share_preview(supplier_tenant_id=tid)
                    ),
                },
                status=201,
            )


class MarketInviteRevokeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, invite_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            inv = MarketInvite.objects.filter(id=invite_id).first()
            if inv is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                links_svc.revoke(actor=auth.user, viewer=v, inv=inv)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"invite": links_svc.invite_payload(inv)})


class MarketAuthorizationsIncomingView(APIView):
    """MP-07 (جهة المورد): طلبات التخويل الواصلة — من أنت لا أكثر؛ `POST {invite_id, accept}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            return Response({"requests": links_svc.incoming_authorizations()})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            iid = uuid.UUID(str(body.get("invite_id", "")))
        except ValueError:
            return Response({"detail": "invite_unknown"}, status=400)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                card = links_svc.decide_authorization(
                    actor=auth.user, viewer=v, invite_id=iid, accept=bool(body.get("accept"))
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"request": card})


class PublicInviteView(APIView):
    """MP-07: فتح رابط مشاركة/دعوة بلا حساب — عام دوماً؛ المنتهي 410 («جديدٌ لا إحياء»)."""

    permission_classes = (AllowAny,)

    @extend_schema(responses={200: None, 404: None, 410: None})
    def get(self, _request: Request, token: str) -> Response:
        state, data = links_svc.resolve(token)
        if state == "unknown":
            return Response({"detail": "not_found"}, status=404)
        if state == "expired":
            return Response({"detail": "invite_expired", **(data or {})}, status=410)
        return Response({"invite": data})


class PublicInviteAcceptView(APIView):
    """MP-07: قبول دعوة منشأة بحساب المدعوّ — لا نشر ولا اشتراك نيابةً عنه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 410: None})
    def post(self, request: Request, token: str) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            state = links_svc.accept(token=token, actor=auth.user)
        if state == "unknown":
            return Response({"detail": "not_found"}, status=404)
        if state == "expired":
            return Response({"detail": "invite_expired"}, status=410)
        if state == "self":
            return Response({"detail": "invite_is_own"}, status=400)
        return Response({"accepted": True})


class PublicSupplierStatusView(APIView):
    """MP-14: منشأة معلَّقة — ما يُمنع وما يبقى (ACC-135)؛ بلا حساب."""

    permission_classes = (AllowAny,)

    @extend_schema(responses={200: None, 404: None})
    def get(self, _request: Request, tenant_id: uuid.UUID) -> Response:
        s = links_svc.supplier_status(tenant_id)
        if s is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"supplier": s})


class MarketReportsView(APIView):
    """MP-15: بلاغاتي بأرقام متابعتها؛ `POST` بلاغ جديد (سبب ودليل)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            return Response(links_svc.reports_payload())

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            oid = uuid.UUID(str(body["offer_id"])) if body.get("offer_id") else None
            sid = (
                uuid.UUID(str(body["supplier_tenant_id"]))
                if body.get("supplier_tenant_id")
                else None
            )
        except ValueError:
            return Response({"detail": "target_unknown", "field": "target"}, status=400)
        with tenant_context(tid):
            try:
                rep = links_svc.report(
                    actor=auth.user,
                    offer_id=oid,
                    supplier_tenant_id=sid,
                    reason=str(body.get("reason") or ""),
                    note=str(body.get("note") or ""),
                    evidence_data_url=str(body.get("evidence_data_url") or ""),
                    evidence_name=str(body.get("evidence_name") or ""),
                )
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"report": links_svc.report_payload(rep)}, status=201)


class MarketReportDetailView(APIView):
    """MP-15: متابعة البلاغ لصاحبه — غير المقدِّم لا يرى البلاغ أصلاً (404 نفسه)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, report_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            rep = MarketReport.objects.filter(id=report_id).first()
            if rep is None:
                return Response({"detail": "not_found"}, status=404)
            return Response({"report": links_svc.report_payload(rep)})


# ------------------------------------------------------------------ ORD-01 / ORD-02


class MarketOrderVerifyView(APIView):
    """ORD-01: إعادة التحقق من بنود السلة خادمياً — لا تقدير محلي للسعر."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        raw = body.get("lines")
        items: list[Any] = list(raw) if isinstance(raw, list) else []
        with tenant_context(tid):
            return Response(
                {
                    "lines": orders_svc.verify_lines([x for x in items if isinstance(x, dict)]),
                    "responsibilities": orders_svc.RESPONSIBILITIES,
                    "response_hours": orders_svc.RESPONSE_HOURS,
                }
            )


class MarketOrdersView(APIView):
    """ORD-02: طلباتي؛ `?op_id=` استعلام عن حالة إرسال؛ `POST` إرسال بمعرّف عملية (متكرّر الأثر)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("op_id", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        op = request.query_params.get("op_id", "")
        try:
            op_id = uuid.UUID(op) if op else None
        except ValueError:
            return Response({"orders": []})
        with tenant_context(tid):
            return Response(orders_svc.orders_payload(op_id=op_id))

    @extend_schema(request=None, responses={200: None, 201: None, 400: None, 403: None, 409: None})
    def post(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                order, created = orders_svc.submit(actor=auth.user, viewer=v, body=body)
            except services.MarketRejected as e:
                if e.code in {"line_expired", "price_changed"}:
                    return Response(
                        {"detail": e.code, "field": e.field, "extra": e.extra}, status=409
                    )
                return _reject(e)
            return Response(
                {"order": orders_svc.order_payload(order), "created": created},
                status=201 if created else 200,
            )


class MarketOrdersIncomingView(APIView):
    """ORD-04: الطلبات الواردة إلى منشأتي مورداً — كلٌّ يرى طرفه فقط؛ بالمهلة لا بالتاريخ."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            return Response(orders_svc.incoming_payload())


class MarketOrderResendView(APIView):
    """ORD-03: إعادة إرسال طلب لم يُرد عليه — المهلة من جديد بإصدار جديد، لا طلب ثانٍ."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            o = MarketOrder.objects.filter(id=order_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                orders_svc.resend(actor=auth.user, viewer=v, order=o)
            except services.MarketRejected as e:
                return _reject(e)
            return Response({"order": orders_svc.order_payload(o)})


# ------------------------------------------------------------------ ORD-05 / ORD-06


class MarketOrderDetailView(APIView):
    """ORD-05: تفاصيل الطلب وسجلّ إصداراته — لطرفيه فقط؛ غيرهما 404 نفسه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            found = flow_svc.load_order(order_id)
            if found is None:
                return Response({"detail": "not_found"}, status=404)
            o, side = found
            return Response(flow_svc.detail_payload(o, side))


class MarketOrderQuoteView(APIView):
    """ORD-06: ما يحرّره المورد؛ `POST {lines, delivery_fee_minor, valid_until, note, send}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            try:
                o = flow_svc._supplier_order(order_id)
            except services.MarketRejected:
                return Response({"detail": "not_found"}, status=404)
            return Response(flow_svc.quote_payload(o))

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                ver = flow_svc.save_quote(
                    actor=auth.user,
                    viewer=v,
                    order_id=order_id,
                    body=body,
                    send=bool(body.get("send")),
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            o = flow_svc._supplier_order(order_id)
            return Response(
                {"version": flow_svc.version_payload(ver, o.agreed_version), "order": _brief(o)}
            )


def _brief(o: Any) -> dict[str, Any]:
    return orders_svc.order_payload(o)


class MarketOrderDeclineView(APIView):
    """ORD-06: اعتذار بسبب."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                o = flow_svc.decline(
                    actor=auth.user,
                    viewer=v,
                    order_id=order_id,
                    reason=str(body.get("reason") or ""),
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response({"order": _brief(o)})


class MarketOrderAcceptView(APIView):
    """ORD-07 (جزء الخادم): قبول المشتري إصداراً بعينه — نسخة الاتفاق المثبَّتة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            try:
                o = flow_svc.accept_version(
                    actor=auth.user, order_id=order_id, number=int(body.get("version") or 0)
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(flow_svc.detail_payload(o, "buyer"))


# ------------------------------------------------------------------ ORD-07 / ORD-08


class MarketOrderCompareView(APIView):
    """ORD-07: طلبك · عرض المورد · الفرق (`?version=` النسخة المفتوحة)؛ الأحدث يُعرض بفرقه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("version", int, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None, 404: None},
    )
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        raw = request.query_params.get("version", "")
        opened = int(raw) if raw.isdigit() else None
        with tenant_context(tid):
            found = flow_svc.load_order(order_id)
            if found is None or found[1] != "buyer":
                return Response({"detail": "not_found"}, status=404)
            return Response(flow_svc.compare_payload(found[0], opened=opened))


class MarketOrderRejectView(APIView):
    """ORD-07: رفض صريح وطلب تعديل `{version, reason}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            try:
                o = flow_svc.reject_version(
                    actor=auth.user,
                    order_id=order_id,
                    number=int(body.get("version") or 0),
                    reason=str(body.get("reason") or ""),
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(flow_svc.detail_payload(o, "buyer"))


class MarketOrderRequoteView(APIView):
    """ORD-07: انتهت الصلاحية أثناء المراجعة — «اطلب تأكيداً جديداً»."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            try:
                o = flow_svc.requote(actor=auth.user, order_id=order_id)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(flow_svc.detail_payload(o, "buyer"))


class MarketOrderShipmentsView(APIView):
    """ORD-08: الشحنات على الطلب؛ `POST {lines:[{offer_id, qty}], carrier_ref, eta_note, note}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            found = flow_svc.load_order(order_id)
            if found is None:
                return Response({"detail": "not_found"}, status=404)
            return Response({**flow_svc.shipments_payload(found[0]), "side": found[1]})

    @extend_schema(request=None, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                sh = flow_svc.ship(actor=auth.user, viewer=v, order_id=order_id, body=body)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            o = flow_svc._supplier_order(order_id)
            return Response(
                {
                    **flow_svc.shipments_payload(o),
                    "side": "supplier",
                    "shipped": f"SH-{sh.number:02d}",
                },
                status=201,
            )


# ------------------------------------------------------------------ ORD-09 / ORD-10


class MarketOrderReceiveView(APIView):
    """ORD-09: استلام شحنة بعدّ المشتري (`?shipment=`)؛ `POST {shipment_id, lines, open_dispute}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("shipment", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None, 404: None},
    )
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        raw = request.query_params.get("shipment", "")
        try:
            sid = uuid.UUID(raw) if raw else None
        except ValueError:
            sid = None
        with tenant_context(tid):
            found = flow_svc.load_order(order_id)
            if found is None or found[1] != "buyer":
                return Response({"detail": "not_found"}, status=404)
            return Response(flow_svc.receive_payload(found[0], sid))

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                o, sh, gap = flow_svc.receive(
                    actor=auth.user, viewer=v, order_id=order_id, body=body
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(
                {
                    **flow_svc.detail_payload(o, "buyer"),
                    "received": f"SH-{sh.number:02d}",
                    "gap": gap,
                    "dispute_opened": sh.dispute_opened,
                }
            )


class MarketOrderCancelRemainingView(APIView):
    """ORD-10: ما يُلغى وما لا يُلغى؛ `POST {reason}` يُقفل غير المشحون فقط؛ `request=true` طلب من
    المالك."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            found = flow_svc.load_order(order_id)
            if found is None or found[1] != "buyer":
                return Response({"detail": "not_found"}, status=404)
            v = home.viewer_for(auth.user, auth.device)
            return Response(
                {
                    **flow_svc.cancel_breakdown(found[0]),
                    "order": orders_svc.order_payload(found[0]),
                    "can_cancel": orders_svc.order_limit(v) != 0,
                }
            )

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                if body.get("request"):
                    o = flow_svc.request_cancel(actor=auth.user, order_id=order_id)
                else:
                    o = flow_svc.cancel_remaining(
                        actor=auth.user,
                        viewer=v,
                        order_id=order_id,
                        reason=str(body.get("reason") or ""),
                    )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(
                {
                    **flow_svc.cancel_breakdown(o),
                    "order": orders_svc.order_payload(o),
                    "can_cancel": orders_svc.order_limit(v) != 0,
                }
            )


# ------------------------------------------------------------------ ORD-11 / ORD-12


def _side_or_404(order_id: uuid.UUID) -> tuple[Any, str] | Response:
    found = flow_svc.load_order(order_id)
    if found is None:
        return Response({"detail": "not_found"}, status=404)
    return found


class MarketOrderReturnsView(APIView):
    """ORD-11: الكميات القابلة للإرجاع والمرتجعات؛ `POST {lines:[{offer_id, qty, reason}]}` طلب."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            found = _side_or_404(order_id)
            if isinstance(found, Response):
                return found
            return Response(disputes_svc.returns_payload(found[0], found[1]))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            try:
                ret = disputes_svc.request_return(actor=auth.user, order_id=order_id, body=body)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            found = flow_svc.load_order(order_id)
            assert found is not None
            return Response(
                {
                    **disputes_svc.returns_payload(found[0], "buyer"),
                    "created": disputes_svc.return_payload(ret),
                },
                status=201,
            )


class MarketOrderReturnDecideView(APIView):
    """ORD-11 (المورد): قرار سطراً سطراً `{lines:[{offer_id, approved_qty}], note}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID, return_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                ret = disputes_svc.decide_return(
                    actor=auth.user, viewer=v, order_id=order_id, return_id=return_id, body=body
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response({"return": disputes_svc.return_payload(ret)})


class MarketOrderDisputesView(APIView):
    """ORD-12: خلافات الطلب لطرفيه — من عليه الدور ومهلته."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            found = _side_or_404(order_id)
            if isinstance(found, Response):
                return found
            v = home.viewer_for(auth.user, auth.device)
            return Response(disputes_svc.disputes_payload(found[0], found[1], v))


class MarketOrderDisputeActionView(APIView):
    """ORD-12: `evidence` / `accept-supplier` / `close` / `mediator` على خلاف بعينه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(
        self, request: Request, order_id: uuid.UUID, dispute_id: uuid.UUID, action: str
    ) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                if action == "evidence":
                    d = disputes_svc.add_evidence(
                        actor=auth.user, order_id=order_id, dispute_id=dispute_id, body=body
                    )
                elif action == "accept-supplier":
                    d = disputes_svc.accept_supplier_figure(
                        actor=auth.user, viewer=v, order_id=order_id, dispute_id=dispute_id
                    )
                elif action == "close":
                    d = disputes_svc.close_dispute(
                        actor=auth.user,
                        viewer=v,
                        order_id=order_id,
                        dispute_id=dispute_id,
                        outcome=str(body.get("outcome") or ""),
                        ref=str(body.get("ref") or ""),
                    )
                elif action == "mediator":
                    d = disputes_svc.request_mediator(
                        actor=auth.user, order_id=order_id, dispute_id=dispute_id
                    )
                else:
                    return Response({"detail": "not_found"}, status=404)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            found = flow_svc.load_order(order_id)
            assert found is not None
            return Response(
                {
                    **disputes_svc.disputes_payload(found[0], found[1], v),
                    "dispute": disputes_svc.dispute_payload(d, found[1]),
                }
            )


# ------------------------------------------------------------------ ORD-13 / ORD-14 / ORD-15


class MarketOrderPaymentsView(APIView):
    """ORD-13: إثباتات الدفع والمستحقّ؛ `POST` يرفع إيصالاً (لا يُسدّد)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        with tenant_context(tid):
            found = _side_or_404(order_id)
            if isinstance(found, Response):
                return found
            return Response(settle_svc.payments_payload(found[0], found[1]))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            try:
                pay = settle_svc.record_payment(actor=auth.user, order_id=order_id, body=body)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            found = flow_svc.load_order(order_id)
            assert found is not None
            payload = settle_svc.payments_payload(found[0], "buyer")
            return Response({**payload, "created": settle_svc.payment_payload(pay)}, status=201)


class MarketOrderPaymentActionView(APIView):
    """ORD-13: `match` / `reject` (المورد) و`remind` (المشتري) على إيصال بعينه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(
        self, request: Request, order_id: uuid.UUID, payment_id: uuid.UUID, action: str
    ) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                if action in {"match", "reject"}:
                    pay = settle_svc.match_payment(
                        actor=auth.user,
                        viewer=v,
                        order_id=order_id,
                        payment_id=payment_id,
                        accept=action == "match",
                        note=str(body.get("note") or ""),
                    )
                elif action == "remind":
                    pay = settle_svc.remind_payment(
                        actor=auth.user, order_id=order_id, payment_id=payment_id
                    )
                else:
                    return Response({"detail": "not_found"}, status=404)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            found = flow_svc.load_order(order_id)
            assert found is not None
            return Response(
                {
                    **settle_svc.payments_payload(found[0], found[1]),
                    "payment": settle_svc.payment_payload(pay),
                }
            )


class MarketOrderProbeView(APIView):
    """ORD-14: استعلام بمفتاح العملية — لا ينشئ شيئاً؛ الحمولة المختلفة تعارض."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        _auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            op_id = uuid.UUID(str(body.get("op_id", "")))
        except ValueError:
            return Response({"detail": "op_id_required"}, status=400)
        with tenant_context(tid):
            return Response(settle_svc.probe(op_id=op_id, lines=body.get("lines")))


class MarketOrderRestoreView(APIView):
    """ORD-15: حالة المصالحة؛ `POST {restored_to}` يعلن الاستعادة (المالك)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        with tenant_context(tid):
            found = _side_or_404(order_id)
            if isinstance(found, Response):
                return found
            v = home.viewer_for(auth.user, auth.device)
            return Response(settle_svc.restore_payload(found[0], found[1], v))

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                o = settle_svc.restore(
                    actor=auth.user,
                    viewer=v,
                    order_id=order_id,
                    restored_to=str(body.get("restored_to") or ""),
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(settle_svc.restore_payload(o, "buyer", v))


class MarketOrderRestoreDecisionView(APIView):
    """ORD-15: قرار واحد لكل حدث `{decision: reapply|void, reason}` — المراجعة للمالك."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID, event_id: uuid.UUID) -> Response:
        r = _tenant_or_403(request)
        if isinstance(r, Response):
            return r
        auth, tid = r
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                o = settle_svc.decide_event(
                    actor=auth.user,
                    viewer=v,
                    order_id=order_id,
                    event_id=event_id,
                    decision=str(body.get("decision") or ""),
                    reason=str(body.get("reason") or ""),
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject(e)
            return Response(settle_svc.restore_payload(o, "buyer", v))


# ------------------------------------------------------------------ LINK-01/LINK-02 (T3.25 — M3)
from market import link as link_svc  # noqa: E402
from market.models import MarketItemMapping, MarketPartyLink  # noqa: E402


def _reject_link(e: services.MarketRejected) -> Response:
    if e.code == "phase_locked":
        return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=423)
    return _reject(e)


class MarketLinkPartiesView(APIView):
    """LINK-01: الأطراف الموردون في دفتري بحالة ربطهم؛ `?q=` يعيد المرشّحين المتشابهين بمعرّفاتهم."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("q", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            q = str(request.query_params.get("q") or "")
            if q:
                return Response({"candidates": link_svc.candidates(q=q)})
            return Response(link_svc.links_payload(v))


class MarketLinkPartyActionView(APIView):
    """LINK-01: `request` (`{counterparty_tenant_id}` — بلا اختيار = المرشّحون) / `cancel`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 201: None, 400: None, 403: None, 423: None})
    def post(self, request: Request, party_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                if action == "request":
                    link = link_svc.request_link(
                        actor=auth.user, viewer=v, party_id=party_id, body=body
                    )
                    return Response({"link": link_svc.link_payload(link)}, status=201)
                if action == "cancel":
                    cur = MarketPartyLink.objects.filter(
                        party_id=party_id,
                        status__in=[
                            MarketPartyLink.Status.REQUESTED,
                            MarketPartyLink.Status.ACCEPTED,
                        ],
                    ).first()
                    if cur is None:
                        return Response({"detail": "not_found"}, status=404)
                    link = link_svc.cancel_link(actor=auth.user, viewer=v, link=cur)
                    return Response({"link": link_svc.link_payload(link)})
            except services.MarketRejected as e:
                return _reject_link(e)
            return Response({"detail": "unknown_action"}, status=404)


class MarketLinkIncomingView(APIView):
    """LINK-01 (الطرف الآخر): طلبات الربط الواردة إلى منشأتي."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response(link_svc.incoming_payload(v))


class MarketLinkIncomingActionView(APIView):
    """LINK-01 (الطرف الآخر): `accept` / `reject` — المالك وحده."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 423: None})
    def post(self, request: Request, link_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        if action not in {"accept", "reject"}:
            return Response({"detail": "unknown_action"}, status=404)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                link = link_svc.decide_incoming(
                    actor=auth.user, viewer=v, link_id=link_id, accept=action == "accept"
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject_link(e)
            return Response({"link": link_svc.link_payload(link)})


class MarketLinkItemsView(APIView):
    """LINK-02: المطابقات لمنشأة مربوطة (`?counterparty=`)؛ `POST` يحفظ مطابقة بمعامل صريح."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("counterparty", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        raw = str(request.query_params.get("counterparty") or "")
        cid: uuid.UUID | None = None
        if raw:
            try:
                cid = uuid.UUID(raw)
            except ValueError:
                return Response({"detail": "counterparty_invalid"}, status=400)
        with tenant_context(tid):
            return Response(link_svc.mappings_payload(counterparty_tenant_id=cid))

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 423: None})
    def post(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                m = link_svc.save_mapping(actor=auth.user, viewer=v, body=body)
            except services.MarketRejected as e:
                return _reject_link(e)
            return Response({"mapping": link_svc.mapping_payload(m)})


class MarketLinkItemActionView(APIView):
    """LINK-02: `confirm` (بعد تغيّر تعريف المورد) / `remove`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 423: None})
    def post(self, request: Request, mapping_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            m = MarketItemMapping.objects.filter(id=mapping_id).first()
            if m is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                if action == "confirm":
                    m = link_svc.confirm_mapping(actor=auth.user, viewer=v, m=m)
                    return Response({"mapping": link_svc.mapping_payload(m)})
                if action == "remove":
                    link_svc.remove_mapping(viewer=v, m=m)
                    return Response({"removed": True})
            except services.MarketRejected as e:
                return _reject_link(e)
            return Response({"detail": "unknown_action"}, status=404)


# ------------------------------------------------------------------ LINK-03/04/05 (T3.26 — M3)
from market import link_docs as link_docs_svc  # noqa: E402


class MarketLinkReceiptsView(APIView):
    """LINK-03: الشحنات المستلَمة من منشآت مربوطة بحالة تحويلها."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response(link_docs_svc.receipts_payload(v))


class MarketLinkReceiptActionView(APIView):
    """LINK-03: `preview` (GET) / `convert` (POST — `{branch_id?, attach_receipt_id?,
    distinct_receipt_ids?}`)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 400: None, 403: None, 404: None, 423: None})
    def get(self, request: Request, shipment_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        if action != "preview":
            return Response({"detail": "unknown_action"}, status=404)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                return Response(link_docs_svc.preview(viewer=v, shipment_id=shipment_id))
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject_link(e)

    @extend_schema(
        request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None, 423: None}
    )
    def post(self, request: Request, shipment_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        if action != "convert":
            return Response({"detail": "unknown_action"}, status=404)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                link = link_docs_svc.convert(
                    actor=auth.user, viewer=v, shipment_id=shipment_id, body=body
                )
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                if e.code == "duplicate_receipt":
                    return Response(
                        {"detail": e.code, "field": e.field, "extra": e.extra}, status=409
                    )
                return _reject_link(e)
            return Response({"link": link_docs_svc._doc_link_payload(link)}, status=201)


class MarketLinkDocumentsView(APIView):
    """LINK-04: روابط المستندات والفروق وإثباتات الدفع بلا مقابل."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response(link_docs_svc.documents_payload(v))


class MarketLinkDocumentActionView(APIView):
    """LINK-04: `settle` (`{path: dispute|agreement, note}`) — صلاحية من له حدّ مالي."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 423: None})
    def post(self, request: Request, link_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        if action != "settle":
            return Response({"detail": "unknown_action"}, status=404)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                link = link_docs_svc.settle(actor=auth.user, viewer=v, link_id=link_id, body=body)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject_link(e)
            return Response({"link": link_docs_svc._doc_link_payload(link)})


class MarketLinkReturnsView(APIView):
    """LINK-05: مرتجعات السوق المحسومة بحالة مستندها العكسي."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            return Response(link_docs_svc.returns_payload(v))


class MarketLinkReturnActionView(APIView):
    """LINK-05: `convert` — مستند عكسي بالكمية المتفَق عليها فقط."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={201: None, 400: None, 403: None, 404: None, 423: None})
    def post(self, request: Request, return_id: uuid.UUID, action: str) -> Response:
        auth, tid = _ctx(request)
        if auth is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        if action != "convert":
            return Response({"detail": "unknown_action"}, status=404)
        with tenant_context(tid):
            v = home.viewer_for(auth.user, auth.device)
            try:
                link = link_docs_svc.convert_return(actor=auth.user, viewer=v, return_id=return_id)
            except services.MarketRejected as e:
                if e.code == "not_found":
                    return Response({"detail": "not_found"}, status=404)
                return _reject_link(e)
            return Response({"link": link_docs_svc._doc_link_payload(link)}, status=201)
