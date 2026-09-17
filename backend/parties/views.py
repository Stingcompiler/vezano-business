"""نقاط نهاية الأطراف (POS-04، T1.15): بحث بالبادئة وإنشاء سريع بالاسم فقط مع تحذير التشابه المضلل
قبل الإنشاء (ACC-12: لا عميل وهمي للبيع النقدي)."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.limits import FieldError, Rejected
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context
from parties import services
from parties.models import Party


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


class PartiesView(APIView):
    permission_classes = (IsAuthenticated,)

    class CreateSerializer(serializers.Serializer[dict[str, Any]]):
        id = serializers.UUIDField(required=False)
        name = serializers.CharField(allow_blank=False, max_length=200, trim_whitespace=False)
        phone = serializers.CharField(allow_blank=True, required=False, default="", max_length=32)
        distinct_from_party_id = serializers.UUIDField(required=False, allow_null=True)

    @extend_schema(
        parameters=[OpenApiParameter("q", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            rows = services.search_parties(str(request.query_params.get("q", "")))
            return Response({"parties": [services.party_payload(p) for p in rows]})

    @extend_schema(request=CreateSerializer, responses={201: None, 400: None, 403: None, 409: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.CreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        name = str(d["name"])
        if not name.strip():
            return Response(
                Rejected([FieldError("name", "required")]).as_response(),
                status=status.HTTP_400_BAD_REQUEST,
            )
        with tenant_context(tid):
            distinct_id = d.get("distinct_from_party_id")
            distinct = Party.objects.filter(id=distinct_id).first() if distinct_id else None
            similar = services.find_similar(name, str(d.get("phone", "")))
            if similar.any and distinct is None:
                # التشابه المضلل يُعرض ويُسأل عنه — لا يُمنع ولا يُدمج تلقائياً (§٧.٥)
                return Response(
                    {
                        "detail": "similar_party",
                        "by_name": [services.party_payload(p) for p in similar.by_name],
                        "by_phone": [services.party_payload(p) for p in similar.by_phone],
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            party = services.create_party(
                party_id=d.get("id"),
                name=name,
                phone=str(d.get("phone", "")),
                created_by=auth.user,
                distinct_from=distinct,
            )
            return Response(services.party_payload(party), status=status.HTTP_201_CREATED)
