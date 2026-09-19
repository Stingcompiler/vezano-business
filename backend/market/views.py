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
from market import links as links_svc
from market import orders as orders_svc
from market import services
from market.models import MarketAccount, MarketInvite, MarketReport


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
    """publish · hide"""

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
