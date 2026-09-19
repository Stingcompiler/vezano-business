"""PUR-01/PUR-02: القائمة والمعاينة والإنشاء والإرسال والإلغاء."""

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
from core.models import Branch
from core.tenancy import tenant_context
from inventory import purchase_docs, purchasing
from inventory.models import PurchaseDocument, PurchaseOrder, PurchaseReturn


def _tenant(auth: Any) -> Any:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _viewer(auth: Any) -> home.Viewer:
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


def _branch(viewer: home.Viewer, branch_id: Any) -> Branch | None:
    if branch_id and viewer.is_owner:
        try:
            b: Branch | None = Branch.objects.filter(id=uuid.UUID(str(branch_id))).first()
            if b is not None:
                return b
        except ValueError:
            pass
    fallback: Branch | None = viewer.branch or Branch.objects.order_by("created_at").first()
    return fallback


def _reject(e: purchasing.OrderRejected) -> Response:
    code = 403 if e.code == "permission_denied" else 400
    return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=code)


class PurchaseOrdersView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter("scope", str, OpenApiParameter.QUERY, required=False),
            OpenApiParameter("supplier_id", str, OpenApiParameter.QUERY, required=False),
        ],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        q = request.query_params
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not purchasing.can_view(v):
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name}, status=403
                )
            return Response(
                purchasing.list_payload(
                    v, scope=str(q.get("scope", "open")), supplier_id=str(q.get("supplier_id", ""))
                )
            )

    @extend_schema(request=None, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            branch = _branch(v, body.get("branch_id"))
            if branch is None:
                return Response({"detail": "branch_required"}, status=400)
            try:
                o = purchasing.create(
                    actor=auth.user,
                    viewer=v,
                    branch=branch,
                    supplier_id=body.get("supplier_id"),
                    raw_lines=list(body.get("lines") or []),
                    note=str(body.get("note", "")),
                    confirmed=bool(body.get("confirmed", False)),
                )
            except purchasing.OrderRejected as e:
                return _reject(e)
            return Response({"order": purchasing.order_payload(o)}, status=201)


class PurchaseOrderPreviewView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not purchasing.can_create(v):
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name}, status=403
                )
            branch = _branch(v, body.get("branch_id"))
            if branch is None:
                return Response({"detail": "branch_required"}, status=400)
            try:
                return Response(
                    purchasing.preview(
                        branch_id=branch.id,
                        supplier_id=body.get("supplier_id"),
                        raw_lines=list(body.get("lines") or []),
                        confirmed=bool(body.get("confirmed", False)),
                    )
                )
            except purchasing.OrderRejected as e:
                return _reject(e)


class PurchaseOrderDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, order_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not purchasing.can_view(v):
                return Response({"detail": "permission_denied"}, status=403)
            o = PurchaseOrder.objects.filter(id=order_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            return Response(
                {"order": purchasing.order_payload(o, show_value=purchasing.can_create(v))}
            )


class PurchaseOrderActionView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID, action: str) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            o = PurchaseOrder.objects.filter(id=order_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                if action == "send":
                    purchasing.send(actor=auth.user, viewer=v, order=o)
                elif action == "cancel":
                    purchasing.cancel(
                        actor=auth.user, viewer=v, order=o, reason=str(body.get("reason", ""))
                    )
                else:
                    return Response({"detail": "unknown_action"}, status=404)
            except purchasing.OrderRejected as e:
                return _reject(e)
            o.refresh_from_db()
            return Response({"order": purchasing.order_payload(o)})


# ------------------------------------------------------------------ PUR-03/PUR-04 (T2.14)


def _reject_doc(e: purchasing.OrderRejected) -> Response:
    code = 403 if e.code in {"permission_denied", "over_limit"} else 400
    return Response({"detail": e.code, "field": e.field, "extra": e.extra}, status=code)


class PurchaseOrderDocumentView(APIView):
    """يبدأ مستند شراء من أمر (أو يعيد مسوّدته القائمة)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None, 404: None})
    def post(self, request: Request, order_id: uuid.UUID) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(auth)
            o = PurchaseOrder.objects.filter(id=order_id).first()
            if o is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                d = purchase_docs.draft_from_order(actor=auth.user, viewer=v, order=o)
            except purchasing.OrderRejected as e:
                return _reject_doc(e)
            return Response({"document": purchase_docs.document_payload(d, v)})


class PurchaseDocumentDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, document_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not purchasing.can_view(v):
                return Response(
                    {"detail": "permission_denied", "role_name": v.role_name}, status=403
                )
            d = PurchaseDocument.objects.filter(id=document_id).first()
            if d is None:
                return Response({"detail": "not_found"}, status=404)
            return Response(
                {
                    "document": purchase_docs.document_payload(d, v),
                    "return_limits": purchase_docs.return_limits(d),
                    "returns": [
                        purchase_docs.return_payload(r) for r in d.returns.order_by("created_at")
                    ],
                    "ask_name": purchasing.owner_name(),
                }
            )

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def patch(self, request: Request, document_id: uuid.UUID) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            d = PurchaseDocument.objects.filter(id=document_id).first()
            if d is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                purchase_docs.save_draft(
                    actor=auth.user,
                    viewer=v,
                    document=d,
                    supplier_invoice_number=body.get("supplier_invoice_number"),
                    lines=list(body.get("lines") or []),
                    note=body.get("note"),
                )
            except purchasing.OrderRejected as e:
                return _reject_doc(e)
            d.refresh_from_db()
            return Response({"document": purchase_docs.document_payload(d, v)})


class PurchaseDocumentActionView(APIView):
    """approve · refer · return"""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, document_id: uuid.UUID, action: str) -> Response:
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            d = PurchaseDocument.objects.filter(id=document_id).first()
            if d is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                if action == "approve":
                    if body.get("supplier_invoice_number") is not None or body.get("lines"):
                        purchase_docs.save_draft(
                            actor=auth.user,
                            viewer=v,
                            document=d,
                            supplier_invoice_number=body.get("supplier_invoice_number"),
                            lines=list(body.get("lines") or []),
                            note=body.get("note"),
                        )
                        d.refresh_from_db()
                    purchase_docs.approve(actor=auth.user, viewer=v, document=d)
                elif action == "refer":
                    purchase_docs.refer(actor=auth.user, viewer=v, document=d)
                elif action == "return":
                    r = purchase_docs.record_return(
                        actor=auth.user, viewer=v, document=d, lines=list(body.get("lines") or [])
                    )
                    return Response({"return": purchase_docs.return_payload(r)}, status=201)
                else:
                    return Response({"detail": "unknown_action"}, status=404)
            except purchasing.OrderRejected as e:
                return _reject_doc(e)
            d.refresh_from_db()
            return Response({"document": purchase_docs.document_payload(d, v)})


class PurchaseReturnDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, return_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            if not purchasing.can_view(v):
                return Response({"detail": "permission_denied"}, status=403)
            r = PurchaseReturn.objects.filter(id=return_id).first()
            if r is None:
                return Response({"detail": "not_found"}, status=404)
            return Response({"return": purchase_docs.return_payload(r)})

    @extend_schema(request=None, responses={200: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, return_id: uuid.UUID) -> Response:
        """ردّ المورد على المرتجع."""
        auth = request.auth
        tid = _tenant(auth)
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        with tenant_context(tid):
            v = _viewer(auth)
            r = PurchaseReturn.objects.filter(id=return_id).first()
            if r is None:
                return Response({"detail": "not_found"}, status=404)
            try:
                purchase_docs.respond(
                    actor=auth.user,
                    viewer=v,
                    purchase_return=r,
                    lines=list(body.get("lines") or []),
                    note=str(body.get("note", "")),
                )
            except purchasing.OrderRejected as e:
                return _reject_doc(e)
            r.refresh_from_db()
            return Response({"return": purchase_docs.return_payload(r)})
