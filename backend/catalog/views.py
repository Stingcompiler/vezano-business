"""نقاط نهاية CAT-01/CAT-06 (T1.8): قائمة الأصناف والبحث، المجموعات، الأسماء البديلة."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog import services
from catalog.models import Item, ItemGroup
from core.auth.tokens import AuthContext
from core.models import Unit
from core.tenancy import tenant_context


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


class ItemsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("group_id", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("include_inactive", bool, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("offset", int, OpenApiParameter.QUERY, required=False),
        ],
        responses={
            200: inline_serializer("ItemList", {"total": serializers.IntegerField()}),
            403: None,
        },
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        p = request.query_params
        query = services.ItemQuery(
            q=str(p.get("q", "")),
            group_id=str(p.get("group_id", "")),
            include_inactive=str(p.get("include_inactive", "")).lower() in {"1", "true"},
        )
        try:
            offset = int(str(p.get("offset", "0")))
        except ValueError:
            offset = 0
        with tenant_context(tid):
            items, total = services.search_items(query, offset=offset)
            groups = [
                {"id": str(g.id), "name": g.name}
                for g in ItemGroup.objects.order_by("sort_order", "name")
            ]
            return Response(
                {
                    "items": [{"id": str(i.id), **services.item_payload(i)} for i in items],
                    "total": total,
                    "all_total": Item.objects.count(),
                    "groups": groups,
                    "offset": offset,
                }
            )

    class CreateSerializer(serializers.Serializer[dict[str, Any]]):
        name = serializers.CharField(max_length=200)
        base_unit_id = serializers.UUIDField()
        group_id = serializers.UUIDField(required=False, allow_null=True)
        barcode = serializers.CharField(max_length=64, required=False, allow_blank=True)
        sale_price_minor = serializers.IntegerField(required=False, min_value=0)
        aliases = serializers.ListField(child=serializers.CharField(max_length=120), required=False)

    @extend_schema(request=CreateSerializer, responses={201: None, 400: None, 403: None, 409: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.CreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            unit = Unit.objects.filter(id=d["base_unit_id"]).first()
            if unit is None:
                return Response({"detail": "unit_not_found"}, status=status.HTTP_400_BAD_REQUEST)
            group = (
                ItemGroup.objects.filter(id=d["group_id"]).first() if d.get("group_id") else None
            )
            try:
                item = services.create_item(
                    name=d["name"],
                    base_unit=unit,
                    group=group,
                    barcode=str(d.get("barcode", "")),
                    sale_price_minor=int(d.get("sale_price_minor", 0)),
                    aliases=list(d.get("aliases", [])),
                )
            except services.AliasTaken as e:
                return Response(_alias_taken(e), status=status.HTTP_409_CONFLICT)
            return Response({"id": str(item.id), **services.item_payload(item)}, status=201)


def _alias_taken(e: services.AliasTaken) -> dict[str, Any]:
    return {
        "detail": "alias_taken",
        "alias": e.alias,
        "owner_item_id": str(e.owner.id),
        "owner_item_name": e.owner.name,
    }


class ItemActiveView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=inline_serializer("ItemActive", {"is_active": serializers.BooleanField()}),
        responses={200: None, 403: None, 404: None},
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            body = request.data if isinstance(request.data, dict) else {}
            active = bool(body.get("is_active", False))
            item = services.reactivate_item(item) if active else services.deactivate_item(item)
            return Response({"id": str(item.id), **services.item_payload(item)})


class GroupsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        responses={
            200: inline_serializer("GroupList", {"total_items": serializers.IntegerField()}),
            403: None,
        }
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            rows = services.groups_overview()
            return Response(
                {
                    "groups": rows,
                    "group_count": ItemGroup.objects.count(),
                    "total_items": Item.objects.filter(is_active=True).count(),
                }
            )

    class CreateSerializer(serializers.Serializer[dict[str, Any]]):
        name = serializers.CharField(max_length=120)
        parent_id = serializers.UUIDField(required=False, allow_null=True)
        note = serializers.CharField(max_length=300, required=False, allow_blank=True)

    @extend_schema(request=CreateSerializer, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.CreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            parent = (
                ItemGroup.objects.filter(id=d["parent_id"]).first() if d.get("parent_id") else None
            )
            if ItemGroup.objects.filter(name=d["name"].strip()).exists():
                return Response({"detail": "group_exists"}, status=status.HTTP_409_CONFLICT)
            g = services.create_group(name=d["name"], parent=parent, note=str(d.get("note", "")))
            return Response({"id": str(g.id), **services.group_payload(g)}, status=201)


class AliasesView(APIView):
    """أسماء بديلة للصنف: الإضافة تُرفض بـ409 إن كان الاسم مسجّلاً على صنف آخر — نسمّيه ونضع رابطاً."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=inline_serializer(
            "AliasAdd", {"aliases": serializers.ListField(child=serializers.CharField())}
        ),
        responses={200: None, 400: None, 403: None, 404: None, 409: None},
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body = request.data if isinstance(request.data, dict) else {}
        raw = body.get("aliases", [])
        aliases = [str(a) for a in raw] if isinstance(raw, list) else []
        if not aliases:
            return Response({"detail": "aliases_required"}, status=status.HTTP_400_BAD_REQUEST)
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            added: list[str] = []
            for alias in aliases:
                try:
                    services.add_alias(item, alias)
                    added.append(alias)
                except ValueError:
                    return Response({"detail": "alias_empty"}, status=status.HTTP_400_BAD_REQUEST)
                except services.AliasTaken as e:
                    return Response(
                        {**_alias_taken(e), "added": added}, status=status.HTTP_409_CONFLICT
                    )
            return Response({"id": str(item.id), "added": added, **services.item_payload(item)})

    @extend_schema(
        request=inline_serializer("AliasRemove", {"alias_id": serializers.UUIDField()}),
        responses={200: None, 403: None, 404: None},
    )
    def delete(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            body = request.data if isinstance(request.data, dict) else {}
            try:
                alias_id = uuid.UUID(str(body.get("alias_id", "")))
            except ValueError:
                return Response({"detail": "alias_id_invalid"}, status=status.HTTP_400_BAD_REQUEST)
            if not services.remove_alias(item, alias_id):
                return Response({"detail": "alias_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response({"id": str(item.id), **services.item_payload(item)})
