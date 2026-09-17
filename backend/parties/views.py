"""نقاط نهاية الأطراف (POS-04، T1.15): بحث بالبادئة وإنشاء سريع بالاسم فقط مع تحذير التشابه المضلل
قبل الإنشاء (ACC-12: لا عميل وهمي للبيع النقدي)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.limits import FieldError, Rejected
from core import home
from core.auth.tokens import AuthContext
from core.models import Branch
from core.tenancy import tenant_context
from parties import services
from parties.models import Party, PartyMerge, PaymentReceipt


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


class PartyListView(APIView):
    """PTY-01/02: قائمة العملاء «من عليه» أو الموردين. القائمة الكاملة صورةٌ مالية للمنشأة: العملاء
    بأرصدتهم لمن يرى المال فقط (الكاشير يرى من يبيع له في POS-04)؛ الموردون أسماءً للجميع والمستحقّ
    لمن يرى المال."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("kind", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        kind = "suppliers" if request.query_params.get("kind") == "suppliers" else "customers"
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            finance = viewer.can_see_finance
            if kind == "customers" and not finance:
                return Response({"detail": "finance_required"}, status=status.HTTP_403_FORBIDDEN)
            # المدموج يختفي من القوائم ويبقى في السجل (ACC-78)
            qs = Party.objects.filter(is_active=True, merged_into__isnull=True)
            qs = qs.filter(is_supplier=True) if kind == "suppliers" else qs.filter(is_customer=True)
            rows = [
                services.list_payload(p, with_balances=finance)
                for p in qs.order_by("name_normalized")
            ]
            total_due = sum(
                int(r["balance_minor"])
                for r in rows
                if r["balance_minor"] and int(r["balance_minor"]) > 0
            )
            total_owed = sum(int(r["supplier_owed_minor"] or 0) for r in rows)
            return Response(
                {
                    "kind": kind,
                    "can_see_balances": finance,
                    "role_name": viewer.role_name,
                    "as_of": timezone.now().isoformat(),
                    "rows": rows,
                    "summary": {
                        "count": len(rows),
                        "total_due_minor": str(total_due),
                        "total_owed_minor": str(total_owed),
                    },
                }
            )


#: تعديل البطاقة يمسّ طرفاً له دفتر — لمدير الفرع أو المالك؛ الكاشير يُنشئ ولا يعدّل (PTY-03)
def _can_edit(v: home.Viewer) -> bool:
    return v.is_owner or v.role_code == "manager"


class PartyCardView(APIView):
    """PTY-03: بطاقة الطرف بصفتيه ورصيديه المنفصلين (ACC-28) واحتمال التكرار (لا دمج بالاسم)؛
    التعديل لمن يملكه."""

    permission_classes = (IsAuthenticated,)

    class UpdateSerializer(serializers.Serializer[dict[str, Any]]):
        name = serializers.CharField(allow_blank=True, max_length=200, trim_whitespace=False)
        phone = serializers.CharField(allow_blank=True, required=False, default="", max_length=32)
        aliases = serializers.ListField(
            child=serializers.CharField(max_length=200), required=False, default=list
        )
        credit_limit_minor = serializers.CharField(required=False, default="0")
        is_customer = serializers.BooleanField(required=False, default=True)
        is_supplier = serializers.BooleanField(required=False, default=False)
        note = serializers.CharField(allow_blank=True, required=False, default="", max_length=300)

    def _card(self, party: Party, viewer: home.Viewer) -> dict[str, Any]:
        row = services.list_payload(party, with_balances=viewer.can_see_finance)
        row["can_edit"] = _can_edit(viewer)
        row["can_open_balance"] = viewer.is_owner
        row["has_movements"] = services.has_movements(party)
        row["opening_balances"] = [
            services.opening_payload(ob) for ob in party.opening_balances.order_by("occurred_at")
        ]
        row["potential_duplicates"] = [
            services.party_payload(p) for p in services.potential_duplicates(party)
        ]
        return row

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, party_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            party = Party.objects.filter(id=party_id).first()
            if party is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(self._card(party, home.viewer_for(auth.user, auth.device)))

    @extend_schema(request=UpdateSerializer, responses={200: None, 400: None, 403: None, 404: None})
    def patch(self, request: Request, party_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.UpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not _can_edit(viewer):
                return Response({"detail": "manager_required"}, status=status.HTTP_403_FORBIDDEN)
            party = Party.objects.filter(id=party_id).first()
            if party is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                limit = int(str(d.get("credit_limit_minor", "0")) or "0")
            except ValueError:
                return Response(
                    Rejected([FieldError("credit_limit_minor", "invalid")]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                services.update_party(
                    party,
                    name=str(d["name"]),
                    phone=str(d.get("phone", "")),
                    aliases=[str(a) for a in d.get("aliases", [])],
                    credit_limit_minor=limit,
                    is_customer=bool(d.get("is_customer", True)),
                    is_supplier=bool(d.get("is_supplier", False)),
                    note=str(d.get("note", "")),
                )
            except services.CardRejected as e:
                return Response(
                    Rejected([FieldError(e.field or "card", e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(self._card(party, viewer))


class PartyDistinctView(APIView):
    """«وسمهما مراجَعان ومنفصلان» — قرار هوية صريح لا دمج (ACC-131)."""

    permission_classes = (IsAuthenticated,)

    class DistinctSerializer(serializers.Serializer[dict[str, Any]]):
        other_id = serializers.UUIDField()

    @extend_schema(request=DistinctSerializer, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, party_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.DistinctSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not _can_edit(viewer):
                return Response({"detail": "manager_required"}, status=status.HTTP_403_FORBIDDEN)
            party = Party.objects.filter(id=party_id).first()
            other = Party.objects.filter(id=ser.validated_data["other_id"]).first()
            if party is None or other is None or party.id == other.id:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            services.mark_distinct(party, other)
            return Response({"distinct_from_id": str(other.id)})


class OpeningBalanceView(APIView):
    """PTY-04: الرصيد الافتتاحي للمالك وحده — مرة واحدة لكل صفة وقبل أول حركة، بسبب إلزامي."""

    permission_classes = (IsAuthenticated,)

    class OpeningSerializer(serializers.Serializer[dict[str, Any]]):
        side = serializers.ChoiceField(choices=("customer_due", "supplier_owed"))
        amount_minor = serializers.CharField()
        reason = serializers.CharField(allow_blank=True, required=False, default="", max_length=300)
        reference = serializers.CharField(
            allow_blank=True, required=False, default="", max_length=120
        )
        business_date = serializers.DateField(required=False, allow_null=True)

    @extend_schema(
        request=OpeningSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, party_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.OpeningSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            party = Party.objects.filter(id=party_id).first()
            if party is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                amount = int(str(d["amount_minor"]))
            except ValueError:
                return Response(
                    Rejected([FieldError("amount_minor", "invalid")]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                ob = services.record_opening_balance(
                    party,
                    side=str(d["side"]),
                    amount_minor=amount,
                    reason=str(d.get("reason", "")),
                    reference=str(d.get("reference", "")),
                    business_date=d.get("business_date"),
                    actor=viewer.user,
                )
            except services.CardRejected as e:
                return Response(
                    Rejected([FieldError(e.field or "opening", e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "opening": services.opening_payload(ob),
                    "party": services.list_payload(party, with_balances=True),
                },
                status=status.HTTP_201_CREATED,
            )


class PartyStatementView(APIView):
    """PTY-05: كشف الحساب — الشاشة المحورية. لمن يرى المال؛ مدير الفرع يرى سطور فرعه والرصيد
    المؤسسي كاملاً (ACC-46)؛ الكاشير يرى رصيد من أمامه وقت البيع فقط (403)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("range", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 403: None, 404: None},
    )
    def get(self, request: Request, party_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        rng = str(request.query_params.get("range", "30"))
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.can_see_finance:
                return Response({"detail": "finance_required"}, status=status.HTTP_403_FORBIDDEN)
            party = Party.objects.filter(id=party_id).first()
            if party is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            visible = None if viewer.is_owner else ([viewer.branch.id] if viewer.branch else [])
            since = None if rng == "all" else timezone.now() - timedelta(days=30)
            body = services.statement_payload(party, visible_branch_ids=visible, since=since)
            body["scope"] = "all" if visible is None else "branch"
            body["branch_names"] = {str(b.id): b.name for b in Branch.objects.all()}
            body["range"] = "all" if rng == "all" else "30"
            return Response(body)


class ReceiptMatchView(APIView):
    """«مطابق»: تأكيد وصول التحويل من كشف البنك بفعل صريح — للمالك (ACC-133)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, receipt_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            receipt = PaymentReceipt.objects.filter(id=receipt_id).first()
            if receipt is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                services.match_receipt(receipt, actor=viewer.user)
            except services.CardRejected as e:
                return Response(
                    Rejected([FieldError(e.field or "receipt", e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "receipt": services.receipt_payload(receipt),
                    "party": services.list_payload(receipt.party, with_balances=True),
                }
            )


class PartyMergeView(APIView):
    """PTY-07: معاينة الدمج (GET ?target=) والدمج (POST) — للمالك وحده؛ الصلاحية قبل التأكيد لا
    بدلاً منه؛ لا حلقات ولا دمج مدموج."""

    permission_classes = (IsAuthenticated,)

    class MergeSerializer(serializers.Serializer[dict[str, Any]]):
        target_id = serializers.UUIDField()
        confirm = serializers.CharField()
        reason = serializers.CharField(allow_blank=True, required=False, default="", max_length=300)

    def _owner(self, request: Request) -> tuple[uuid.UUID | None, home.Viewer | None]:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return None, None
        with tenant_context(tid):
            return tid, home.viewer_for(auth.user, auth.device)

    @extend_schema(
        parameters=[OpenApiParameter("target", str, OpenApiParameter.QUERY, required=True)],
        responses={200: None, 400: None, 403: None, 404: None},
    )
    def get(self, request: Request, party_id: uuid.UUID) -> Response:
        tid, viewer = self._owner(request)
        if tid is None or viewer is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            source = Party.objects.filter(id=party_id).first()
            try:
                target = Party.objects.filter(id=request.query_params.get("target", "")).first()
            except (ValueError, TypeError):
                target = None
            if source is None or target is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(services.merge_preview(source, target))

    @extend_schema(request=MergeSerializer, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, party_id: uuid.UUID) -> Response:
        tid, viewer = self._owner(request)
        if tid is None or viewer is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.MergeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with tenant_context(tid):
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            # تأكيد مزدوج: الثاني يحمل نصّاً ثابتاً — الصلاحية قبله لا بدلاً منه
            if str(d["confirm"]) != "MERGE":
                return Response(
                    Rejected([FieldError("confirm", "required")]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            source = Party.objects.filter(id=party_id).first()
            target = Party.objects.filter(id=d["target_id"]).first()
            if source is None or target is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                merge = services.merge_parties(
                    source, target, actor=viewer.user, reason=str(d.get("reason", ""))
                )
            except services.CardRejected as e:
                return Response(
                    Rejected([FieldError(e.field or "merge", e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "merge": services.merge_payload(merge),
                    "source": services.list_payload(source, with_balances=True),
                    "target": services.list_payload(target, with_balances=True),
                },
                status=status.HTTP_201_CREATED,
            )


class MergeUndoView(APIView):
    """التراجع عن الدمج بحدث جديد — ممكن ما لم تُسجَّل حركة جديدة على الوارث (ACC-78)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, merge_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            merge = (
                PartyMerge.objects.filter(id=merge_id).select_related("source", "target").first()
            )
            if merge is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                services.undo_merge(merge, actor=viewer.user)
            except services.CardRejected as e:
                return Response(
                    Rejected([FieldError("merge", e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response({"merge": services.merge_payload(merge)})


class ReceiptCorrectionView(APIView):
    """PTY-09: مستند تصحيح لسند قبض — للمالك؛ السبب إلزامي؛ الفترة المقفلة تُمنع بسبب."""

    permission_classes = (IsAuthenticated,)

    class CorrectionSerializer(serializers.Serializer[dict[str, Any]]):
        kind = serializers.ChoiceField(choices=("method", "reverse", "amount", "date"))
        reason = serializers.CharField(allow_blank=True, required=False, default="", max_length=300)
        new_method = serializers.CharField(allow_blank=True, required=False, default="")
        new_reference = serializers.CharField(
            allow_blank=True, required=False, default="", max_length=120
        )
        new_amount_minor = serializers.CharField(allow_blank=True, required=False, default="")
        new_business_date = serializers.DateField(required=False, allow_null=True)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, receipt_id: uuid.UUID) -> Response:
        """الحركة الأصلية وقيمها الفعلية وتصحيحاتها السابقة وحدّ الفترة المقفلة — للمالك."""
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            receipt = PaymentReceipt.objects.filter(id=receipt_id).select_related("party").first()
            if receipt is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(services.correction_context(receipt))

    @extend_schema(
        request=CorrectionSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, receipt_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        ser = self.CorrectionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with tenant_context(tid):
            viewer = home.viewer_for(auth.user, auth.device)
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            receipt = PaymentReceipt.objects.filter(id=receipt_id).first()
            if receipt is None:
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            amount: int | None = None
            if str(d.get("new_amount_minor", "")):
                try:
                    amount = int(str(d["new_amount_minor"]))
                except ValueError:
                    return Response(
                        Rejected([FieldError("new_amount_minor", "invalid")]).as_response(),
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            try:
                c = services.correct_receipt(
                    receipt,
                    kind=str(d["kind"]),
                    reason=str(d.get("reason", "")),
                    actor=viewer.user,
                    new_method=str(d.get("new_method", "")),
                    new_reference=str(d.get("new_reference", "")),
                    new_amount_minor=amount,
                    new_business_date=d.get("new_business_date"),
                )
            except services.CardRejected as e:
                return Response(
                    Rejected([FieldError(e.field or "correction", e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "correction": services.correction_payload(c),
                    "receipt": services.receipt_payload(receipt),
                    "party": services.list_payload(receipt.party, with_balances=True),
                },
                status=status.HTTP_201_CREATED,
            )
