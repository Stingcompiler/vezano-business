"""نقاط نهاية الكتالوج: CAT-01/CAT-06 (T1.8) قائمة الأصناف والبحث والمجموعات والأسماء البديلة؛
CAT-02/CAT-03 (T1.9) بطاقة الصنف وتعديلها وصورتها، الوحدات ومعاملاتها وباركوداتها، وفحص الباركود.

الرفض المضبوط (ACC-25): 400 `{"detail":"validation_error","errors":[{field,code,limit,actual}]}` بكل
الأخطاء معاً؛ الواجهة تصوغ النص الكامل من الرمز والحدّ.
"""

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
from catalog.limits import IMAGE_MAX_BYTES, Rejected
from catalog.models import Item, ItemGroup, ItemUnit
from core.auth.tokens import AuthContext
from core.models import Unit
from core.tenancy import tenant_context


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _rejected(e: Rejected) -> Response:
    return Response(e.as_response(), status=status.HTTP_400_BAD_REQUEST)


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


class UnitsView(APIView):
    """وحدات المنشأة (§١١.٤) لاختيار الوحدة الأساسية والوحدات الأكبر — CAT-02/CAT-03."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            return Response(
                {
                    "units": [
                        services.unit_payload(u)
                        for u in Unit.objects.order_by("created_at", "code")
                    ]
                }
            )


class BarcodeCheckView(APIView):
    """«تحقّق من تفرّد الباركود» (CAT-02 saving) — من يحمل هذا الباركود الآن؟"""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("value", str, OpenApiParameter.QUERY, required=True),
            OpenApiParameter("exclude_item_id", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        value = str(request.query_params.get("value", ""))
        with tenant_context(tid):
            exclude = None
            ex_id = _uuid(request.query_params.get("exclude_item_id", ""))
            if ex_id:
                exclude = Item.objects.filter(id=ex_id).first()
            owner = services.barcode_owner(value, exclude_item=exclude)
            return Response(
                {
                    "barcode": value.strip(),
                    "taken": owner is not None,
                    "owner_item_id": str(owner.item.id) if owner else "",
                    "owner_item_name": owner.item.name if owner else "",
                    "owner_unit_name": owner.unit_name if owner else "",
                }
            )


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
        """الحدود تُفحص في الخدمة لتُعاد كل الأخطاء معاً — لا `max_length` هنا (ACC-25)."""

        name = serializers.CharField(allow_blank=True, trim_whitespace=False)
        base_unit_id = serializers.CharField(required=False, allow_blank=True)
        group_id = serializers.UUIDField(required=False, allow_null=True)
        barcode = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
        sale_price_minor = serializers.CharField(required=False, allow_blank=True)
        larger_unit_id = serializers.CharField(required=False, allow_blank=True)
        larger_factor_milli = serializers.CharField(required=False, allow_blank=True)
        larger_barcode = serializers.CharField(required=False, allow_blank=True)
        aliases = serializers.ListField(child=serializers.CharField(), required=False)

    @extend_schema(request=CreateSerializer, responses={201: None, 400: None, 403: None, 409: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.CreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            unit_id = _uuid(d.get("base_unit_id", ""))
            unit = Unit.objects.filter(id=unit_id).first() if unit_id else None
            group = (
                ItemGroup.objects.filter(id=d["group_id"]).first() if d.get("group_id") else None
            )
            units: list[tuple[Unit, int | str]] = []
            unit_barcodes: dict[uuid.UUID, str] = {}
            larger_id = _uuid(d.get("larger_unit_id", ""))
            if larger_id:
                larger = Unit.objects.filter(id=larger_id).first()
                if larger is None:
                    return Response(
                        {
                            "detail": "validation_error",
                            "errors": [{"field": "units", "code": "unit_not_found"}],
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                units.append((larger, d.get("larger_factor_milli", "") or "0"))
                unit_barcodes[larger.id] = str(d.get("larger_barcode", ""))
            try:
                item = services.create_item(
                    name=d["name"],
                    base_unit=unit,
                    group=group,
                    barcode=str(d.get("barcode", "")),
                    sale_price_minor=str(d.get("sale_price_minor", "") or "0"),
                    units=units,
                    unit_barcodes=unit_barcodes,
                    aliases=list(d.get("aliases", [])),
                )
            except Rejected as e:
                return _rejected(e)
            except services.AliasTaken as e:
                return Response(_alias_taken(e), status=status.HTTP_409_CONFLICT)
            return Response(services.item_card_payload(item), status=201)


class ItemDetailView(APIView):
    """بطاقة الصنف (CAT-02): قراءة وتعديل أونلاين؛ الوحدة الأساسية مقفلة بعد أول حركة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            item = (
                Item.objects.filter(id=item_id)
                .select_related("group", "base_unit")
                .prefetch_related("aliases", "units__unit", "units__changes")
                .first()
            )
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(services.item_card_payload(item))

    class ItemPatchSerializer(serializers.Serializer[dict[str, Any]]):
        name = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
        base_unit_id = serializers.CharField(required=False, allow_blank=True)
        group_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
        barcode = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
        sale_price_minor = serializers.CharField(required=False, allow_blank=True)

    @extend_schema(
        request=ItemPatchSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def patch(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ItemPatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            group: ItemGroup | None | bool = False
            if "group_id" in d:
                gid = _uuid(d.get("group_id") or "")
                group = ItemGroup.objects.filter(id=gid).first() if gid else None
            base_unit = None
            if d.get("base_unit_id"):
                base_unit = Unit.objects.filter(id=_uuid(d["base_unit_id"])).first()
                if base_unit is None:
                    return Response(
                        {
                            "detail": "validation_error",
                            "errors": [{"field": "base_unit_id", "code": "unit_not_found"}],
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            try:
                item = services.update_item(
                    item,
                    name=d.get("name"),
                    group=group,
                    base_unit=base_unit,
                    barcode=d.get("barcode"),
                    sale_price_minor=d.get("sale_price_minor") or None,
                    changed_by=auth.user if isinstance(auth := request.auth, AuthContext) else None,
                )
            except Rejected as e:
                return _rejected(e)
            return Response(services.item_card_payload(item))


class ItemImageView(APIView):
    """الصورة ترفع بعد الصنف لا قبله (CAT-02 saving): لو انقطع الرفع بقي الصنف محفوظاً بلا صورة."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=inline_serializer("ItemImage", {"image_data_url": serializers.CharField()}),
        responses={200: None, 400: None, 403: None, 404: None, 413: None},
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body = request.data if isinstance(request.data, dict) else {}
        data_url = str(body.get("image_data_url", ""))
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                item = services.set_item_image(item, data_url)
            except services.ImageTooLarge as e:
                return Response(
                    {"detail": "image_too_large", "size": e.size, "max_bytes": IMAGE_MAX_BYTES},
                    status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                )
            except Rejected as e:
                return _rejected(e)
            return Response(services.item_card_payload(item))


class ItemUnitsView(APIView):
    """وحدة أكبر بمعاملها وباركودها (CAT-03 «إضافة وحدة»)."""

    permission_classes = (IsAuthenticated,)

    class ItemUnitAddSerializer(serializers.Serializer[dict[str, Any]]):
        unit_id = serializers.CharField(required=False, allow_blank=True)
        factor_milli = serializers.CharField(required=False, allow_blank=True)
        barcode = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    @extend_schema(
        request=ItemUnitAddSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, item_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ItemUnitAddSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            item = Item.objects.filter(id=item_id).select_related("base_unit").first()
            if item is None:
                return Response({"detail": "item_not_found"}, status=status.HTTP_404_NOT_FOUND)
            uid = _uuid(d.get("unit_id", ""))
            unit = Unit.objects.filter(id=uid).first() if uid else None
            if uid and unit is None:
                return Response(
                    {
                        "detail": "validation_error",
                        "errors": [{"field": "unit_id", "code": "unit_not_found"}],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                services.add_item_unit(
                    item,
                    unit=unit,
                    factor_milli=d.get("factor_milli", "") or "0",
                    barcode=str(d.get("barcode", "")),
                )
            except Rejected as e:
                return _rejected(e)
            return Response(services.item_card_payload(item), status=201)


class ItemUnitDetailView(APIView):
    """تغيير معامل مستعمل أو باركود وحدة (CAT-03): يسري من الآن، والماضي يحفظ معامله (ACC-19)."""

    permission_classes = (IsAuthenticated,)

    class ItemUnitPatchSerializer(serializers.Serializer[dict[str, Any]]):
        factor_milli = serializers.CharField(required=False, allow_blank=True)
        barcode = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    @extend_schema(
        request=ItemUnitPatchSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def patch(self, request: Request, item_id: uuid.UUID, item_unit_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ItemUnitPatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            iu = (
                ItemUnit.objects.filter(id=item_unit_id, item_id=item_id)
                .select_related("item__base_unit", "unit")
                .first()
            )
            if iu is None:
                return Response({"detail": "unit_not_found"}, status=status.HTTP_404_NOT_FOUND)
            auth = request.auth
            user = auth.user if isinstance(auth, AuthContext) else None
            try:
                services.change_item_unit(
                    iu,
                    factor_milli=d.get("factor_milli") or None,
                    barcode=d.get("barcode"),
                    changed_by=user,
                )
            except Rejected as e:
                return _rejected(e)
            return Response(services.item_card_payload(iu.item))


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
