"""PLT-01/PLT-02 — واجهات المشغّل: دخول منفصل بتحقّق ثنائي، وقائمة المستأجرين بحدود وصول."""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home
from core.auth.tokens import AuthContext
from core.models import Tenant
from core.tenancy import platform_context, tenant_context
from stingops import services
from stingops.models import OperatorAccessLog


def _operator(request: Request) -> AuthContext | None:
    auth = request.auth
    if not isinstance(auth, AuthContext) or not auth.user.is_platform_staff:
        return None
    return auth


class OperatorLoginView(APIView):
    """PLT-01: بريد المشغّل وكلمة المرور والرمز الثنائي — لا دخول بنصف تحقّق."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            out = services.login(
                email=str(body.get("email") or ""),
                password=str(body.get("password") or ""),
                otp=str(body.get("otp") or ""),
                user_agent=str(request.headers.get("User-Agent", ""))[:300],
            )
        except services.OperatorLoginRejected as e:
            return Response({"detail": e.code}, status=e.status)
        return Response(
            {
                "access": out.access,
                "refresh": out.refresh,
                "session_id": out.session_id,
                "display_name": out.display_name,
            }
        )


class OperatorTenantsView(APIView):
    """PLT-02: المستأجرون — الاستحقاق والحالة التقنية ووصول الدعم؛ لا عمود للمبيعات ولن يوجد."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("filter", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            services.tenants_payload(
                q=str(request.query_params.get("q", "")),
                filter_code=str(request.query_params.get("filter", "all")),
            )
        )


class OperatorTenantDetailView(APIView):
    """PLT-02/detail: تفاصيل الاستحقاق — كل فتح يُدقَّق."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, tenant_id: uuid.UUID) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        d = services.tenant_detail(operator=auth.user, tenant_id=tenant_id)
        if d is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"tenant": d})


class OperatorSubscriptionView(APIView):
    """PLT-13: تصرّف المشغّل في اشتراك مستأجر — تمديد/تغيير باقة/إيقاف/استئناف/ملاحظة بسبب مسجَّل."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, tenant_id: uuid.UUID) -> Response:
        from stingops import subscriptions as sub_ops

        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with platform_context():
            tenant = Tenant.unscoped.filter(id=tenant_id).first()
        if tenant is None:
            return Response({"detail": "not_found"}, status=404)
        action = str(body.get("action") or "")
        try:
            result = sub_ops.apply(tenant, action=action, body=body, by_name=auth.user.display_name)
        except sub_ops.SubscriptionOpRejected as e:
            return Response({"detail": e.code}, status=e.status)
        with platform_context():
            OperatorAccessLog.objects.create(
                operator=auth.user,
                tenant=tenant,
                action=f"subscription.{action}",
                detail=str(body.get("reason") or "")[:200],
            )
        d = services.tenant_detail(operator=auth.user, tenant_id=tenant_id)
        return Response({"result": result, "tenant": d})


class SupportGrantView(APIView):
    """المالك يمنح وصول دعم مقيّداً بتذكرة ونطاق زمني وسبب (ACC-60)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(auth.tenant_id):
            v = home.viewer_for(auth.user, auth.device)
            if not v.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
        ticket = str(body.get("ticket_ref") or "").strip()
        reason = str(body.get("reason") or "").strip()
        if not ticket or not reason:
            return Response({"detail": "ticket_and_reason_required"}, status=400)
        with platform_context():
            tenant = Tenant.unscoped.get(id=auth.tenant_id)
            g = services.grant_support(
                tenant=tenant,
                ticket_ref=ticket,
                reason=reason,
                hours=int(body.get("hours") or 48),
                by_name=auth.user.display_name,
            )
        from core import audit

        with tenant_context(auth.tenant_id):
            audit.record(
                kind="support.access_granted",
                title=f"وصول دعم مقيّد — تذكرة {g.ticket_ref}",
                actor=auth.user,
                detail=f"{g.hours} ساعة · {g.reason}",
            )
        return Response(
            {
                "grant": {
                    "ticket_ref": g.ticket_ref,
                    "hours": g.hours,
                    "expires_at": g.expires_at.isoformat().replace("+00:00", "Z"),
                }
            },
            status=201,
        )


# ------------------------------------------------------------------ PLT-03 / PLT-04

from stingops import review as review_svc  # noqa: E402


def _reject(e: review_svc.ReviewRejected) -> Response:
    return Response({"detail": e.code, "extra": e.extra}, status=e.status)


class OperatorProofsView(APIView):
    """PLT-03: إيصالات بانتظار المراجعة عبر المستأجرين (`?status=`)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("status", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            review_svc.proofs_payload(
                viewer=auth.user, status=str(request.query_params.get("status", "pending"))
            )
        )


class OperatorProofActionView(APIView):
    """PLT-03: `open` (يحجز 15 دقيقة) / `image` / `handover` / `approve` / `reject {reason}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(
        self, request: Request, tenant_id: uuid.UUID, proof_id: uuid.UUID, action: str
    ) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            if action == "open":
                out = review_svc.open_proof(
                    viewer=auth.user, tenant_id=tenant_id, proof_id=proof_id
                )
            elif action == "image":
                out = review_svc.proof_image(
                    viewer=auth.user, tenant_id=tenant_id, proof_id=proof_id
                )
            elif action == "handover":
                out = review_svc.request_handover(
                    viewer=auth.user, tenant_id=tenant_id, proof_id=proof_id
                )
            elif action in {"approve", "reject"}:
                out = review_svc.review(
                    viewer=auth.user,
                    tenant_id=tenant_id,
                    proof_id=proof_id,
                    approve=action == "approve",
                    reason=str(body.get("reason") or ""),
                )
            else:
                return Response({"detail": "not_found"}, status=404)
        except review_svc.ReviewRejected as e:
            return _reject(e)
        return Response({"proof": out} if action != "image" else out)


class OperatorAnnouncementsView(APIView):
    """PLT-04: الإعلانات؛ `POST` يحفظ مسودة (لا يجدول)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(review_svc.announcements_payload())

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            a = review_svc.save_announcement(viewer=auth.user, body=body)
        except review_svc.ReviewRejected as e:
            return _reject(e)
        return Response({"announcement": review_svc.announcement_payload(a)})


class OperatorAudiencePreviewView(APIView):
    """PLT-04: الجمهور المتأثّر قبل الجدولة — `{audience, body, kind}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        return Response(
            review_svc.audience_preview(
                audience=str(body.get("audience") or "market"),
                body=str(body.get("body") or ""),
                kind=str(body.get("kind") or "maintenance"),
            )
        )


class OperatorAnnouncementActionView(APIView):
    """PLT-04: `schedule` / `cancel`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, announcement_id: uuid.UUID, action: str) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        try:
            if action == "schedule":
                a = review_svc.schedule_announcement(
                    viewer=auth.user, announcement_id=announcement_id
                )
            elif action == "cancel":
                a = review_svc.cancel_announcement(
                    viewer=auth.user, announcement_id=announcement_id
                )
            else:
                return Response({"detail": "not_found"}, status=404)
        except review_svc.ReviewRejected as e:
            return _reject(e)
        return Response({"announcement": review_svc.announcement_payload(a)})


# ------------------------------------------------------------------ PLT-05/PLT-06 (T3.20)
from stingops import ops as ops_svc  # noqa: E402


class OperatorOutboundView(APIView):
    """PLT-05: لوحة الإرسال — قنوات وحصص وطابور دون كشف مفاتيح أو أسرار مزوّدين."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(ops_svc.outbound_payload())


class OperatorChannelStateView(APIView):
    """PLT-05: إعلان تعطّل/عودة قناة (`{state: up|down, note}`) — يُسجَّل باسم من نفّذه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request, key: str) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            return Response(
                ops_svc.set_channel_state(
                    viewer=auth.user,
                    key=key,
                    state=str(body.get("state") or ""),
                    note=str(body.get("note") or ""),
                )
            )
        except review_svc.ReviewRejected as e:
            return _reject(e)


class OperatorVerificationsView(APIView):
    """PLT-06: طلبات تحقق منشآت السوق — الأقدم أولاً ومتوسط المراجعة كمقياس."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(ops_svc.verifications_payload())


class OperatorVerificationActionView(APIView):
    """PLT-06: `document` (مشاهدة مسجَّلة) / `decide` (`{decision, reasons?}`)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, tenant_id: uuid.UUID, action: str) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        raw = body.get("reasons")
        reasons = {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else None
        try:
            if action == "document":
                return Response(
                    ops_svc.verification_document(viewer=auth.user, tenant_id=tenant_id)
                )
            if action == "decide":
                return Response(
                    ops_svc.decide_verification(
                        viewer=auth.user,
                        tenant_id=tenant_id,
                        decision=str(body.get("decision") or ""),
                        reasons=reasons,
                    )
                )
            return Response({"detail": "not_found"}, status=404)
        except review_svc.ReviewRejected as e:
            return _reject(e)


# ------------------------------------------------------------------ PLT-07/PLT-08 (T3.21)
from stingops import moderation as mod_svc  # noqa: E402


class OperatorReportsView(APIView):
    """PLT-07: البلاغات (`?status=under_review|all`) والاعتراضات المفتوحة وقائمة الأسباب."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("status", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            mod_svc.reports_payload(
                status=str(request.query_params.get("status") or "under_review")
            )
        )


class OperatorReportActionView(APIView):
    """PLT-07: `decide` (`{decision: suspend|close|ledger, reason_code, reason_text}`)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, tenant_id: uuid.UUID, report_id: uuid.UUID) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            return Response(
                {
                    "report": mod_svc.decide_report(
                        viewer=auth.user,
                        tenant_id=tenant_id,
                        report_id=report_id,
                        decision=str(body.get("decision") or ""),
                        reason_code=str(body.get("reason_code") or ""),
                        reason_text=str(body.get("reason_text") or ""),
                    )
                }
            )
        except review_svc.ReviewRejected as e:
            return _reject(e)


class OperatorAppealActionView(APIView):
    """PLT-07: حسم الاعتراض (`{decision: uphold|reverse, note}`) — بمراجِع غير من علّق."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, tenant_id: uuid.UUID, offer_id: uuid.UUID) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            return Response(
                {
                    "appeal": mod_svc.decide_appeal(
                        viewer=auth.user,
                        tenant_id=tenant_id,
                        offer_id=offer_id,
                        decision=str(body.get("decision") or ""),
                        note=str(body.get("note") or ""),
                    )
                }
            )
        except review_svc.ReviewRejected as e:
            return _reject(e)


class OperatorDisputesView(APIView):
    """PLT-08: الخلافات المفتوحة بزمن الاستجابة المتبقّي وحدّ التدخّل."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(mod_svc.disputes_payload())


class OperatorDisputeActionView(APIView):
    """PLT-08: `suggest` (`{note}`) / `refer` — لا تحريك رصيد."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(
        self, request: Request, tenant_id: uuid.UUID, dispute_id: uuid.UUID, action: str
    ) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            if action == "suggest":
                row = mod_svc.suggest_path(
                    viewer=auth.user,
                    tenant_id=tenant_id,
                    dispute_id=dispute_id,
                    note=str(body.get("note") or ""),
                )
            elif action == "refer":
                row = mod_svc.refer_external(
                    viewer=auth.user, tenant_id=tenant_id, dispute_id=dispute_id
                )
            else:
                return Response({"detail": "not_found"}, status=404)
        except review_svc.ReviewRejected as e:
            return _reject(e)
        return Response({"dispute": row})


# ------------------------------------------------------------------ PLT-09/PLT-10 (T3.22)
from stingops import health as health_svc  # noqa: E402


class OperatorHealthView(APIView):
    """PLT-09: مؤشرات حيّة لا مخزّنة — عدّادات وأطوار وأزمنة، لا محتوى معاملة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(health_svc.health_payload())


class OperatorBackupsView(APIView):
    """PLT-10: النسخ الخادمية وتجارب الاستعادة — RPO/RTO المحقَّقان من آخر تجربة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(health_svc.backups_payload())


class OperatorBackupActionView(APIView):
    """PLT-10: `drill` (تجربة معزولة) / `live` (`{environment, second_approver}`) — يُسجَّل لا يُنفَّذ."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, backup_id: uuid.UUID, action: str) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            if action == "drill":
                return Response(
                    health_svc.run_isolated_drill(viewer=auth.user, backup_id=backup_id)
                )
            if action == "live":
                return Response(
                    health_svc.request_live_restore(
                        viewer=auth.user,
                        backup_id=backup_id,
                        environment=str(body.get("environment") or ""),
                        second_approver=str(body.get("second_approver") or ""),
                    ),
                    status=202,
                )
            return Response({"detail": "not_found"}, status=404)
        except review_svc.ReviewRejected as e:
            return _reject(e)


# ------------------------------------------------------------------ PLT-11/PLT-12 (T3.23)
from stingops import growth as growth_svc  # noqa: E402


class OperatorM0View(APIView):
    """PLT-11: التجميع الشهري بختمه الزمني (`?month=YYYY-MM`)؛ `POST` يحسبه الآن."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("month", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        month = str(request.query_params.get("month") or timezone.localdate().strftime("%Y-%m"))
        return Response(growth_svc.m0_payload(month=month))

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        month = str(body.get("month") or timezone.localdate().strftime("%Y-%m"))
        growth_svc.compute_m0(month=month, viewer=auth.user)
        return Response(growth_svc.m0_payload(month=month))


class OperatorEntitlementsView(APIView):
    """PLT-12: استحقاقات الباقات وأعلام التشغيل؛ `POST` يغيّر استحقاقاً على مستوى الباقة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(growth_svc.entitlements_payload())

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            return Response(growth_svc.set_entitlement(viewer=auth.user, body=body))
        except review_svc.ReviewRejected as e:
            return _reject(e)


class OperatorFlagsView(APIView):
    """PLT-12: علم تشغيل بنطاق صريح — `{key, scope_kind: plan|env, scope, enabled, note}`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            return Response(growth_svc.set_flag(viewer=auth.user, body=body))
        except review_svc.ReviewRejected as e:
            return _reject(e)


# ------------------------------------------------------------------ PLT-14 طلبات الجولة


class OperatorDemoRequestsView(APIView):
    """PLT-14: طلبات الجولة من الهبوط بحالتها — لا إرسال آلي (G-02)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("status", str, OpenApiParameter.QUERY)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        from stingops import demo

        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            demo.payload(status_filter=str(request.query_params.get("status") or "open"))
        )


class OperatorDemoRequestActionView(APIView):
    """PLT-14: تغيير حالة طلب جولة و/أو ملاحظة — باسم المشغّل ووقته."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, request_id: uuid.UUID) -> Response:
        from stingops import demo

        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            row = demo.update(
                request_id,
                status=str(body.get("status") or ""),
                note=str(body.get("note") or ""),
                by_name=auth.user.display_name,
            )
        except demo.DemoRejected as e:
            return Response({"detail": e.code}, status=e.status)
        with platform_context():
            OperatorAccessLog.objects.create(
                operator=auth.user, tenant=None, action="demo.update", detail=f"{row['status']}"
            )
        return Response({"request": row})


# ------------------------------------------------------------------ PLT-00 النظرة العامة


class OperatorOverviewView(APIView):
    """PLT-00: لوحة النظرة العامة — عدّادات ما ينتظر بروابط شاشاتها."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        from stingops import overview

        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(overview.overview_payload())


# ------------------------------------------------------------------ PLT-15 المشغّلون


class OperatorOperatorsView(APIView):
    """PLT-15: قائمة المشغّلين وإنشاء مشغّل."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        from stingops import operators

        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(operators.list_payload(me=auth.user.id))

    @extend_schema(request=None, responses={201: None, 400: None, 403: None, 409: None})
    def post(self, request: Request) -> Response:
        from stingops import operators

        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        try:
            row = operators.create(
                email=str(body.get("email") or ""),
                password=str(body.get("password") or ""),
                name=str(body.get("name") or ""),
                actor=auth.user,
            )
        except operators.OperatorOpRejected as e:
            return Response({"detail": e.code}, status=e.status)
        return Response({"operator": row}, status=201)


class OperatorOperatorActionView(APIView):
    """PLT-15: تعطيل/تفعيل/إعادة تعيين كلمة المرور لمشغّل — باسم من قام به."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None, 409: None})
    def post(self, request: Request, operator_id: uuid.UUID, action: str) -> Response:
        from stingops import operators

        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        try:
            if action == "disable":
                row = operators.set_active(operator_id, active=False, actor=auth.user)
            elif action == "enable":
                row = operators.set_active(operator_id, active=True, actor=auth.user)
            elif action == "reset_password":
                body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
                row = operators.reset_password(
                    operator_id, password=str(body.get("password") or ""), actor=auth.user
                )
            else:
                return Response({"detail": "unknown_action"}, status=400)
        except operators.OperatorOpRejected as e:
            return Response({"detail": e.code}, status=e.status)
        return Response({"operator": row})
