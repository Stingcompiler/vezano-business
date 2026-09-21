"""PUB-01…04 — الصفحات العامة (12-D7، 21-D16، 09-D5، 37-D29؛ §١٢.٤، §١١.٩؛ ACC-114، ACC-60).

بلا جلسة ولا مستأجر: لا بيانات مستأجر في كاش عام. الباقات من `core.subscription.PLANS` (السعر
معلن قبل التسجيل)، البنية القانونية بحالة كل بند (محسوم منتجياً / بانتظار النص — G-11)، وحالة الخدمة
بمكوّناتها ووقت فحصها وإعلان الصيانة وسجلّ الأحداث — صفحة الحالة نفسها تعيش خارج هذا الخادم
وتقرأه؛ سقوطه يجعلها تقول ذلك لا «كل شيء سليم».
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

from django.db import connection
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.scenario import faults
from core.subscription import PLAN_ORDER, PLANS


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


class PublicPlansView(APIView):
    """PUB-01: الباقات بأسعارها وحدودها وما يُحجب عند الانتهاء وما لا يُحجب أبداً."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, _request: Request) -> Response:
        return Response(
            {
                "plans": [
                    {
                        "code": p.code,
                        "name": p.name,
                        "price_minor": str(p.price_minor),
                        "period": "monthly",
                        "max_branches": p.max_branches,
                        "max_devices": p.max_devices,
                        "campaign_quota": p.campaign_quota,
                        "blurb": p.blurb,
                        "trial": p.trial,
                    }
                    for p in (PLANS[c] for c in PLAN_ORDER)
                ],
                "on_expiry": {
                    "hidden": ["السوق والطلبات", "التقارير المتقدمة", "الحملات", "البيع الآجل"],
                    "never_hidden": [
                        "الدفتر كاملاً للقراءة",
                        "البيع النقدي على الأجهزة",
                        "التصدير الكامل",
                    ],
                    "grace_days": 14,
                },
            }
        )


LEGAL_SECTIONS: list[dict[str, Any]] = [
    {
        "id": "data",
        "title": "ملكية البيانات والتصدير",
        "status": "decided",
        "summary": "بياناتك تبقى لك: تصدير كامل في أي وقت، وانتهاء الاشتراك لا يحجبها.",
    },
    {
        "id": "offline",
        "title": "العمل بلا اتصال",
        "status": "decided",
        "summary": (
            "يعمل بلا إنترنت ويحفظ بيعك على الجهاز — مع شرح الفرق بين «محفوظ عندك» "
            "و«مؤكَّد عند الخادم»."
        ),
    },
    {
        "id": "market",
        "title": "حدود مسؤولية المنصة في السوق",
        "status": "pending",
        "summary": "",
    },
    {
        "id": "support",
        "title": "وصول الدعم إلى بيانات المستأجر",
        "status": "pending",
        "summary": "",
    },
    {
        "id": "retention",
        "title": "الاحتفاظ بالبيانات بعد الإلغاء",
        "status": "pending",
        "summary": "",
    },
    {
        "id": "consent",
        "title": "قناة التنبيهات وموافقة الزبون",
        "status": "pending",
        "summary": "",
    },
]


def _legal_sections() -> list[dict[str, Any]]:
    """البنود بحالتها + مسودة نصّ السودان (core.legal_text) — الاعتماد موقوف على G-11."""
    from core.legal_text import LEGAL_BODIES

    return [{**s, "body": LEGAL_BODIES.get(s["id"], [])} for s in LEGAL_SECTIONS]


class PublicLegalView(APIView):
    """PUB-02: الفهرس قبل النصّ؛ كل بند بحالته ومسودة نصّه — الاعتماد موقوف على G-11."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, _request: Request) -> Response:
        from core.legal_text import LEGAL_PREAMBLE, LEGAL_UPDATED
        from market.link import m3_env_enabled

        # شروط السوق: قفل مرحلة حتى تُفتح M3 في البيئة؛ بعدها بند «بانتظار النص» كسائر البنود (G-11)
        try:
            market_open = m3_env_enabled()
        except Exception:  # noqa: BLE001 — بلا قاعدة (صفحة عامة) = مقفلة
            market_open = False
        return Response(
            {
                "sections": _legal_sections(),
                "preamble": LEGAL_PREAMBLE,
                "updated": LEGAL_UPDATED,
                "blocked_on": "G-11",
                "market_open": market_open,
            }
        )


def _count_visit() -> None:
    """PLT-11: زيارة مجهولة تُعدّ يومياً — لا هوية ولا كوكي."""
    try:
        from stingops.growth import bump

        bump("market_visit")
    except Exception:  # noqa: BLE001 — العدّاد لا يُسقط صفحة عامة
        return


def _db_ok() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            return bool(cursor.fetchone() == (1,))
    except Exception:  # noqa: BLE001 — صفحة الحالة تقول «متعطل» لا تسقط
        return False


class PublicStatusView(APIView):
    """PUB-03: مكوّنات الخدمة بحالة كلٍّ، وقت الفحص، إعلان الصيانة (`STING_MAINTENANCE_*`)،
    وسجلّ الأحداث (`STING_STATUS_EVENTS` JSON) — لا أخضر دائماً."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None})
    def get(self, _request: Request) -> Response:
        active = faults.active()
        db = _db_ok()
        # PLT-09: حالة المزامنة من القياس الحيّ نفسه (أجهزة متأخرة → affected، عقدة متعثّرة → down)
        from stingops.health import sync_component_state

        measured = sync_component_state() if db else "down"
        # M3 مفتوحة بعلم PLT-12 في هذه البيئة؟ (0005 §٩٥) — بلا قاعدة = مقفلة
        from market.link import m3_env_enabled

        market_open = db and m3_env_enabled()
        sync_state = (
            "down"
            if not db or measured == "down"
            else "affected"
            if ("freeze_reconciliation" in active or measured == "affected")
            else "ok"
        )
        sms_state = "affected" if "sms_provider_silent" in active else "ok"
        maintenance = os.environ.get("STING_MAINTENANCE_NOTICE", "").strip() or (
            "صيانة مجدولة — محاكاة" if "maintenance" in active else ""
        )
        # PLT-04: نافذة الصيانة المجدولة من سجلّ المنصة تسبق متغيّر البيئة
        from stingops.review import public_maintenance_notice

        scheduled = public_maintenance_notice()
        if scheduled is not None:
            maintenance = f"{scheduled['title']} — {scheduled['body']}"
        events: list[dict[str, Any]] = []
        raw = os.environ.get("STING_STATUS_EVENTS", "").strip()
        if raw:
            try:
                events = [e for e in json.loads(raw) if isinstance(e, dict)]
            except ValueError:
                events = []
        now = timezone.now()
        if sync_state != "ok":
            events.insert(
                0,
                {
                    "at": _iso(now),
                    "text": "تأكيد التعطل في المزامنة. البيع المحلي غير متأثر."
                    if sync_state == "affected"
                    else "تأكيد التعطل في المزامنة والسوق. البيع المحلي غير متأثر.",
                },
            )
        return Response(
            {
                "checked_at": _iso(now),
                "interval_seconds": 60,
                "components": [
                    {
                        "id": "pos",
                        "name": "البيع على الأجهزة المثبَّتة",
                        "state": "ok",
                        "detail": "محلي — لا يعتمد على الخادم",
                    },
                    {
                        "id": "sync",
                        "name": "المزامنة",
                        "state": sync_state,
                        "detail": {
                            "ok": "الرفع والمطابقة يعملان",
                            "affected": "تأخير في الرفع",
                            "down": "الرفع متوقف · المعلّق محفوظ عندك",
                        }[sync_state],
                    },
                    {
                        "id": "market",
                        "name": "السوق والطلبات",
                        "state": (
                            ("down" if sync_state == "down" else "ok")
                            if market_open
                            else "not_launched"
                        ),
                        "detail": (
                            (
                                "الطلبات متوقفة مع المزامنة"
                                if sync_state == "down"
                                else "الاكتشاف والطلبات والربط تعمل"
                            )
                            if market_open
                            else "لم يُفتح بعد — المرحلة M3"
                        ),
                    },
                    {
                        "id": "sms",
                        "name": "بوابة الزبون والحملات",
                        "state": sms_state,
                        "detail": "الإرسال يعمل"
                        if sms_state == "ok"
                        else "الطابور متوقف · لا رسائل ضائعة",
                    },
                ],
                "maintenance": {
                    "notice": maintenance,
                    "from": os.environ.get("STING_MAINTENANCE_FROM", ""),
                    "until": os.environ.get("STING_MAINTENANCE_UNTIL", ""),
                },
                "events": events[:20],
                "overall": "down"
                if sync_state == "down"
                else "affected"
                if sync_state != "ok" or sms_state != "ok"
                else "ok",
            }
        )


class PublicMarketHomeView(APIView):
    """MP-01: رئيسية السوق بلا حساب — `?area=&q=`."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[
            OpenApiParameter("area", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("q", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> Response:
        _count_visit()
        from market import public as market_public

        return Response(
            market_public.home(
                area=str(request.query_params.get("area", "")),
                q=str(request.query_params.get("q", "")),
            )
        )


class PublicMarketDirectoryView(APIView):
    """MP-02: دليل المخازن والمتاجر — `?area=&category=`."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[
            OpenApiParameter("area", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("category", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> Response:
        from market import public as market_public

        return Response(
            market_public.directory(
                area=str(request.query_params.get("area", "")),
                category=str(request.query_params.get("category", "")),
            )
        )


class PublicSupplierView(APIView):
    """MP-03: ملف منشأة منشور — بلا حساب؛ غير المنشور 404."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(responses={200: None, 404: None})
    def get(self, _request: Request, tenant_id: uuid.UUID) -> Response:
        from market import public as market_public

        p = market_public.supplier_profile(tenant_id)
        if p is None:
            return Response({"detail": "not_found"}, status=404)
        return Response({"supplier": p})


class PublicMarketSearchView(APIView):
    """MP-04: البحث والمقارنة — `?q=&area=`."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("area", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None},
    )
    def get(self, request: Request) -> Response:
        _count_visit()
        from market import public as market_public

        return Response(
            market_public.search(
                q=str(request.query_params.get("q", "")),
                area=str(request.query_params.get("area", "")),
            )
        )


class PublicContactSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=200)
    whatsapp = serializers.CharField(max_length=40)
    email = serializers.CharField(max_length=254, allow_blank=True, required=False, default="")
    channel = serializers.ChoiceField(choices=["whatsapp", "call", "email"])
    message = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")


class PublicContactView(APIView):
    """قسم «تواصل» في PUB-01: يحفظ طلب الجولة على مستوى المنصة ويعيد رقمه القصير — بلا وعد
    بموعد ولا إرسال آلي (G-02). حدّ بسيط: 20 طلباً من العنوان نفسه في الساعة."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    @extend_schema(request=PublicContactSerializer, responses={201: None, 400: None, 429: None})
    def post(self, request: Request) -> Response:
        from datetime import timedelta

        from stingops.models import DemoRequest

        s = PublicContactSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        digits = "".join(ch for ch in str(d["whatsapp"]) if ch.isdigit() or ch == "+")
        if len(digits.lstrip("+")) < 8:
            return Response({"detail": "whatsapp_invalid"}, status=400)
        if d["email"] and "@" not in d["email"]:
            return Response({"detail": "email_invalid"}, status=400)
        ip = str(request.META.get("REMOTE_ADDR", ""))
        since = timezone.now() - timedelta(hours=1)
        if DemoRequest.objects.filter(source_path=ip, created_at__gte=since).count() >= 20:
            return Response({"detail": "too_many"}, status=429)
        req = DemoRequest.objects.create(
            name=str(d["name"]).strip(),
            whatsapp=digits,
            email=str(d["email"]).strip(),
            channel=d["channel"],
            message=str(d["message"]).strip(),
            source_path=ip,
        )
        return Response({"id": str(req.id), "reference": str(req.id)[-6:].upper()}, status=201)
