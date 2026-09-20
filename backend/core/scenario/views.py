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
            # الحالة الابتدائية تشمل مفاتيح الأعطال: تجربة فاشلة لا تُورّث عطلها للتالية
            faults.clear()
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


class MarketScenarioView(APIView):
    """بوابة المرحلة ٣ (§١٥.٥): يهيّئ السوق على منشآت السيناريو — «ب» بائع بقائمة تحقق مكتملة
    بانتظار المراجعة (MK-4) وباقة تفتح النشر، ومسودّتا عرض (عام، وخاص بقائمة أسعار عضوها «أ»)،
    «أ» و«ج» مشتريان، مالك نشط للثالثة «ج»، ومشغّل منصة — خلف حارس الأعطال؛ يعيد الرموز لا
    الأسرار."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, _request: Request) -> Response:
        from datetime import timedelta

        from django.utils import timezone

        from core.auth.accounts import create_account
        from core.auth.tokens import issue_session_tokens
        from core.models import Account, Tenant, User
        from core.scenario.seed import DEMO_PASSWORD, FIXED, SCENARIO_TAG
        from core.subscription import set_for_scenario
        from core.tenancy import platform_context, tenant_context
        from market.models import (
            MarketAccount,
            MarketOffer,
            MarketPriceList,
            MarketPriceListMember,
            MarketProfile,
        )
        from stingops.services import ensure_operator
        from sync.counter import ensure_state

        try:
            assert_non_production()
        except ProductionGuard as e:
            return Response({"detail": "production_guard", "reason": str(e)}, status=403)
        now = timezone.now()
        today = timezone.localdate()
        a_id, b_id, c_id = FIXED["tenant_a"], FIXED["tenant_b"], FIXED["tenant_c"]
        with platform_context():
            a = Tenant.unscoped.get(id=a_id)
            b = Tenant.unscoped.get(id=b_id)
            c = Tenant.unscoped.get(id=c_id)
            for t in (a, b, c):
                ensure_state(t.id)
            # «ب»: بائع مكتمل القائمة بانتظار المراجعة — النشر يُمنع حتى يحسم المشغّل (MK-4)
            MarketAccount.unscoped.filter(tenant=b).delete()
            MarketAccount.unscoped.create(
                tenant=b,
                role="both",
                verification="pending",
                business_address="الخرطوم بحري — السوق المركزي",
                service_area_note="استلام من المخزن وتوصيل داخل المنطقة",
                terms_accepted_at=now,
                registry_doc_data_url="data:image/png;base64,AAAA",
                registry_doc_name="registry.png",
                submitted_at=now,
            )
            MarketProfile.unscoped.filter(tenant=b).delete()
            MarketProfile.unscoped.create(
                tenant=b,
                public_name=f"مخزن البركة — {SCENARIO_TAG}",
                published={
                    "public_name": f"مخزن البركة — {SCENARIO_TAG}",
                    "category_line": "جملة مواد غذائية",
                    "categories": ["سكر", "أرز"],
                    "service_areas": ["بحري"],
                    "fulfilment": ["توصيل"],
                },
                published_at=now,
            )
            for t in (a, c):
                MarketAccount.unscoped.filter(tenant=t).delete()
                MarketAccount.unscoped.create(tenant=t, role="buyer", verification="none")
            MarketOffer.unscoped.filter(tenant=b).delete()

            def mk(name: str, price: int, audience: str) -> MarketOffer:
                o: MarketOffer = MarketOffer.unscoped.create(
                    tenant=b,
                    public_name=name,
                    unit_code="ctn",
                    unit_name="كرتونة",
                    pack_label="كرتونة 12×1كغ",
                    price_minor=price,
                    min_order_qty=5,
                    status="draft",
                    audience=audience,
                    valid_until=today + timedelta(days=7),
                    delivery_fee_minor=0,
                    availability="available",
                )
                return o

            public_offer = mk("سكر أبيض", 118000, "public")
            private_offer = mk("أرز بسمتي", 154000, "private")
            pl = MarketPriceList.unscoped.create(
                tenant=b,
                name="موزّعون",
                offer=private_offer,
                tiers=[{"min": 5, "max": None, "price_minor": 140000}],
            )
            MarketPriceListMember.unscoped.create(
                tenant=b,
                price_list=pl,
                buyer_tenant_id=a.id,
                buyer_name=a.name,
                status="active",
                authorized_at=now,
            )
            # مالك نشط للمنشأة الثالثة «ج» — لا يرى شيئاً من «أ» و«ب»
            owner_c = User.unscoped.filter(tenant=c, username="owner_c").first()
            if owner_c is None:
                owner_c = User.objects.create_user(
                    tenant=c,
                    username="owner_c",
                    display_name=f"سعاد — {SCENARIO_TAG}",
                    is_owner=True,
                )
            owner_c.set_password(DEMO_PASSWORD)
            owner_c.save(update_fields=["password"])
            c_identifier = "+249912447003"
            acc_c = Account.unscoped.filter(identifier=c_identifier).first() or create_account(
                c_identifier, DEMO_PASSWORD, owner_c.display_name
            )
            User.unscoped.filter(id=owner_c.id).update(account=acc_c)
            # مشغّل المنصة — رمز جلسة مباشر للبوابة (الدخول بالرمز الثنائي مغطّى في T3.18)
            op = User.unscoped.filter(tenant=None, username="gate_operator").first()
            if op is None:
                op = User.unscoped.create(
                    tenant=None,
                    username="gate_operator",
                    display_name="طيب — تشغيل",
                    is_platform_staff=True,
                )
            ensure_operator(op)
            _s, op_tokens = issue_session_tokens(op)
        with tenant_context(b.id):
            set_for_scenario(state="active", plan_code="dual")
        with tenant_context(a.id):
            set_for_scenario(state="active", plan_code="single")
        return Response(
            {
                "tenant_a": str(a.id),
                "tenant_b": str(b.id),
                "tenant_c": str(c.id),
                "public_offer_id": str(public_offer.id),
                "private_offer_id": str(private_offer.id),
                "price_list_id": str(pl.id),
                "third_party": {"identifier": c_identifier, "password": DEMO_PASSWORD},
                "operator_access": str(op_tokens.access_token),
            }
        )
