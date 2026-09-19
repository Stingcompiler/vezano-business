"""نقاط نهاية السيناريو — تُركَّب فقط حين STING_FAULTS_ENABLED=1 (sting/urls.py)."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.scenario import faults
from core.scenario.guard import ProductionGuard, assert_non_production
from core.scenario.seed import reset_scenario


class ResetView(APIView):
    """إعادة ضبط السيناريو إلى الحالة الابتدائية (§١٥.٤).

    محمية بالحارس لا بالمصادقة: البيئة نفسها تجريبية.
    """

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=None, responses={200: None})
    def post(self, _request: Request) -> Response:
        try:
            result = reset_scenario()
        except ProductionGuard as e:
            return Response(
                {"detail": "production_guard", "reason": str(e)}, status=status.HTTP_403_FORBIDDEN
            )
        return Response(result.summary())


class FaultSerializer(serializers.Serializer[dict[str, Any]]):
    key = serializers.ChoiceField(choices=list(faults.ALL_FAULTS))
    on = serializers.BooleanField()


class FaultsView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, _request: Request) -> Response:
        return Response({"active": sorted(faults.active())})

    @extend_schema(request=FaultSerializer, responses={200: None})
    def post(self, request: Request) -> Response:
        s = FaultSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            active = faults.set_fault(s.validated_data["key"], s.validated_data["on"])
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"active": sorted(active)})


class VerificationCodeView(APIView):
    """آخر رمز تحقق أُرسل لمعرّف — للتطوير والاختبار فقط (لا مزوّد إرسال معتمد بعد، G-02)."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        from core.auth.verify import dev_code_for

        identifier = str(request.query_params.get("identifier", ""))
        try:
            code = dev_code_for(identifier) if identifier else None
        except ValueError:
            code = None
        if code is None:
            return Response({"detail": "no_code"}, status=status.HTTP_404_NOT_FOUND)
        return Response({"identifier": identifier, "code": code})


class SubscriptionSerializer(serializers.Serializer[dict[str, Any]]):
    state = serializers.ChoiceField(choices=("trial", "active", "expired"))
    days_since_expiry = serializers.IntegerField(required=False, min_value=0, default=0)
    plan_code = serializers.ChoiceField(
        choices=("single", "dual", "trial"), required=False, default="single"
    )


class SubscriptionView(APIView):
    """يضبط اشتراك منشأة السيناريو (بوابة ORG-06/08 — ACC-80–82) — خلف حارس الأعطال."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=SubscriptionSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        from core.scenario.seed import FIXED
        from core.subscription import set_for_scenario
        from core.tenancy import tenant_context

        try:
            assert_non_production()
        except ProductionGuard as e:
            return Response({"detail": "production_guard", "reason": str(e)}, status=403)
        s = SubscriptionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(FIXED["tenant_a"]):
            sub = set_for_scenario(
                state=s.validated_data["state"],
                days_since_expiry=int(s.validated_data.get("days_since_expiry", 0)),
                plan_code=str(s.validated_data.get("plan_code", "single")),
            )
            return Response(
                {"plan_code": sub.plan_code, "state": sub.state, "expires_at": sub.expires_at}
            )


class MarketingSerializer(serializers.Serializer[dict[str, Any]]):
    tenant = serializers.ChoiceField(choices=("a", "b"), required=False, default="a")
    name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=32)
    consent = serializers.BooleanField(required=False, default=True)


class MarketingView(APIView):
    """يسجّل إذن التسويق أو إيقافه لطرف في منشأة السيناريو (بوابة NOT — ACC-105/109) — خلف حارس
    الأعطال؛ ينوب عن رابط الاشتراك/QR وإلغائه حتى يُبنى (PUB)."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=MarketingSerializer, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        from django.utils import timezone

        from core.scenario.seed import FIXED
        from core.tenancy import tenant_context
        from parties.models import Party
        from parties.services import create_party
        from sync.counter import ensure_state

        try:
            assert_non_production()
        except ProductionGuard as e:
            return Response({"detail": "production_guard", "reason": str(e)}, status=403)
        s = MarketingSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        tid = FIXED["tenant_b" if d["tenant"] == "b" else "tenant_a"]
        with tenant_context(tid):
            ensure_state(tid)
            from core.models import User

            owner = User.objects.filter(is_owner=True).first()
            party = Party.objects.filter(name=d["name"]).first()
            if party is None:
                party = create_party(
                    party_id=None,
                    name=d["name"],
                    phone=d["phone"],
                    created_by=owner,
                    distinct_from=None,
                )
            now = timezone.now()
            if d["consent"]:
                party.marketing_consent_at = party.marketing_consent_at or now
                party.marketing_opt_out_at = None
            else:
                party.marketing_opt_out_at = now
            party.save(update_fields=["marketing_consent_at", "marketing_opt_out_at"])
            return Response(
                {
                    "id": str(party.id),
                    "consent": party.marketing_opt_out_at is None
                    and party.marketing_consent_at is not None,
                }
            )
