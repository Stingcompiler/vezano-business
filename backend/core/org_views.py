"""ORG-01/02 — المستخدمون والدعوات ومصفوفة الأدوار: القائمة من الخادم دائماً؛ المصفوفة للمالك
وحده تعديلاً ولمدير الفرع قراءةً."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core import home, org
from core.auth.tokens import AuthContext
from core.models import Branch, Invitation, Role
from core.tenancy import tenant_context

MANAGE_ROLES = frozenset({"manager"})


def _ctx(request: Request) -> tuple[AuthContext, home.Viewer] | Response:
    auth = request.auth
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
    viewer = home.viewer_for(auth.user, auth.device)
    if not (viewer.is_owner or viewer.role_code in MANAGE_ROLES):
        return Response({"detail": "owner_or_manager_required"}, status=status.HTTP_403_FORBIDDEN)
    return auth, viewer


class UsersView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            scope = None if viewer.is_owner else viewer.branch
            payload = org.users_payload(branch_scope=scope)
            payload["branches"] = [
                {"id": str(b.id), "name": b.name}
                for b in Branch.objects.filter(is_active=True).order_by("created_at")
            ]
            payload["roles"] = [
                {"id": str(r.id), "code": r.code, "name": r.name}
                for r in Role.objects.exclude(code="owner").order_by("name")
            ]
            payload["can_invite"] = viewer.is_owner or viewer.role_code in MANAGE_ROLES
            return Response(payload)


class OrgInviteSerializer(serializers.Serializer[dict[str, Any]]):
    identifier = serializers.CharField(max_length=254)
    role_id = serializers.UUIDField()
    branch_id = serializers.UUIDField()


def _invite_reply(inv: Invitation, token: str) -> dict[str, Any]:
    return {
        "invitation": org.invitation_payload(inv),
        "link": f"/invite/{token}",
        "grants": org.role_summary(inv.role),
    }


class InvitationsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=OrgInviteSerializer, responses={201: None, 400: None, 403: None, 409: None}
    )
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = OrgInviteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            role = Role.objects.filter(id=d["role_id"]).first()
            branch = Branch.objects.filter(id=d["branch_id"], is_active=True).first()
            if role is None or branch is None:
                return Response({"detail": "role_or_branch_not_found"}, status=404)
            if role.code == "owner":
                return Response({"detail": "owner_not_invitable"}, status=400)
            if not viewer.is_owner and viewer.branch is not None and branch.id != viewer.branch.id:
                return Response({"detail": "branch_out_of_scope"}, status=403)
            try:
                inv, token = org.invite(
                    inviter=auth.user, identifier=str(d["identifier"]), role=role, branch=branch
                )
            except org.InviteRejected as e:
                body: dict[str, Any] = {"detail": e.code}
                if e.existing is not None:
                    body["existing"] = org.invitation_payload(e.existing)
                return Response(body, status=status.HTTP_409_CONFLICT if e.existing else 400)
            return Response(_invite_reply(inv, token), status=status.HTTP_201_CREATED)


class InvitationActionView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, invitation_id: uuid.UUID, action: str) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            inv = (
                Invitation.objects.filter(id=invitation_id)
                .select_related("role", "branch", "inviter")
                .first()
            )
            if inv is None:
                return Response({"detail": "invitation_not_found"}, status=404)
            if (
                not viewer.is_owner
                and viewer.branch is not None
                and inv.branch_id != viewer.branch.id
            ):
                return Response({"detail": "branch_out_of_scope"}, status=403)
            try:
                if action == "resend":
                    new, token = org.resend(inv, inviter=auth.user)
                    return Response(_invite_reply(new, token), status=status.HTTP_201_CREATED)
                if action == "revoke":
                    return Response({"invitation": org.invitation_payload(org.revoke(inv))})
            except org.InviteRejected as e:
                return Response({"detail": e.code}, status=400)
            return Response({"detail": "unknown_action"}, status=404)


class OrgMatrixCellSerializer(serializers.Serializer[dict[str, Any]]):
    role_id = serializers.UUIDField()
    key = serializers.CharField(max_length=40)
    value = serializers.ChoiceField(choices=org.VALUES)
    limit_minor = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    period = serializers.CharField(required=False, allow_blank=True, max_length=10)


class OrgMatrixSerializer(serializers.Serializer[dict[str, Any]]):
    changes = OrgMatrixCellSerializer(many=True)


class RolesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            return Response({**org.matrix_payload(), "can_edit": viewer.is_owner})

    @extend_schema(request=OrgMatrixSerializer, responses={200: None, 400: None, 403: None})
    def put(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = OrgMatrixSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            if not viewer.is_owner:
                # المصفوفة للمالك وحده — مدير الفرع يرى ولا يعدّل
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            try:
                changes: list[dict[str, Any]] = [dict(c) for c in s.validated_data["changes"]]
                result = org.save_matrix(changes)
            except org.MatrixRejected as e:
                return Response({"detail": e.code, "key": e.detail}, status=400)
            return Response({**result, **org.matrix_payload(), "can_edit": True})


# ---------------------------------------------------------------- ORG-03/04 الفروع والأجهزة
from core import org_branches  # noqa: E402


class OrgBranchSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=200)
    code = serializers.CharField(max_length=6)


class OrgBranchUpdateSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=200, required=False)
    code = serializers.CharField(max_length=6, required=False)


class BranchesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            scope = None if viewer.is_owner else viewer.branch
            return Response(org_branches.branches_payload(scope=scope, can_create=viewer.is_owner))

    @extend_schema(request=OrgBranchSerializer, responses={201: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = OrgBranchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            if not viewer.is_owner:
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            try:
                b = org_branches.create_branch(
                    name=str(s.validated_data["name"]), code=str(s.validated_data["code"])
                )
            except org_branches.BranchRejected as e:
                return Response({"detail": e.code}, status=400)
            return Response(
                org_branches.branches_payload(scope=b, can_create=True)["branches"][0],
                status=status.HTTP_201_CREATED,
            )


class BranchActionView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=OrgBranchUpdateSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, branch_id: uuid.UUID, action: str) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            branch = org_branches.branch_or_none(branch_id)
            if branch is None:
                return Response({"detail": "branch_not_found"}, status=404)
            if not viewer.is_owner and (viewer.branch is None or viewer.branch.id != branch.id):
                return Response({"detail": "branch_out_of_scope"}, status=status.HTTP_403_FORBIDDEN)
            body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
            try:
                if action == "update":
                    name = body.get("name")
                    code = body.get("code")
                    if code is not None and not viewer.is_owner:
                        return Response({"detail": "owner_required"}, status=403)
                    org_branches.update_branch(
                        branch,
                        name=str(name) if name is not None else None,
                        code=str(code) if code is not None else None,
                    )
                elif action == "close":
                    if not viewer.is_owner:
                        return Response({"detail": "owner_required"}, status=403)
                    org_branches.close_branch(branch)
                elif action == "delete":
                    # الحذف غير موجود: فرع له دفتر يُقفل ولا يُمحى
                    return Response(
                        {
                            "detail": "delete_unavailable",
                            "ledger": org_branches._branch_ledger(branch),
                        },
                        status=400,
                    )
                else:
                    return Response({"detail": "unknown_action"}, status=404)
            except org_branches.BranchRejected as e:
                return Response({"detail": e.code, "extra": e.detail}, status=400)
            return Response(
                org_branches.branches_payload(scope=branch, can_create=viewer.is_owner)["branches"][
                    0
                ]
            )


class DevicesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = _ctx(request)
            if isinstance(out, Response):
                return out
            _, viewer = out
            scope = None if viewer.is_owner else viewer.branch
            return Response(org_branches.devices_payload(scope=scope))


# ---------------------------------------------------------------- ORG-05 السحب
from core import org_revoke  # noqa: E402
from core.models import User  # noqa: E402


class OrgRevokeSerializer(serializers.Serializer[dict[str, Any]]):
    action = serializers.ChoiceField(choices=("disable", "revoke_branch", "wipe_device"))
    mode = serializers.ChoiceField(choices=("now", "after_upload"), required=False, default="now")
    branch_id = serializers.UUIDField(required=False)
    device_id = serializers.UUIDField(required=False)
    acknowledgement = serializers.CharField(required=False, allow_blank=True, max_length=600)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=300)


class UserRevocationView(APIView):
    permission_classes = (IsAuthenticated,)

    def _load(
        self, request: Request, user_id: uuid.UUID
    ) -> tuple[AuthContext, home.Viewer, User] | Response:
        out = _ctx(request)
        if isinstance(out, Response):
            return out
        auth, viewer = out
        user = User.objects.filter(id=user_id).first()
        if user is None:
            return Response({"detail": "user_not_found"}, status=404)
        return auth, viewer, user

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, user_id: uuid.UUID) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(auth.tenant_id):
            out = self._load(request, user_id)
            if isinstance(out, Response):
                return out
            _, viewer, user = out
            return Response(org_revoke.preview(user, actor=auth.user, actor_branch=viewer.branch))

    @extend_schema(
        request=OrgRevokeSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, user_id: uuid.UUID) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = OrgRevokeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(auth.tenant_id):
            out = self._load(request, user_id)
            if isinstance(out, Response):
                return out
            _, viewer, user = out
            try:
                if d["action"] == "disable":
                    result = org_revoke.disable_user(
                        user,
                        actor=auth.user,
                        mode=str(d.get("mode", "now")),
                        reason=str(d.get("reason", "")),
                    )
                elif d["action"] == "revoke_branch":
                    branch = Branch.objects.filter(id=d.get("branch_id")).first()
                    if branch is None:
                        return Response({"detail": "branch_not_found"}, status=404)
                    result = org_revoke.revoke_branch(
                        user, actor=auth.user, actor_branch=viewer.branch, branch=branch
                    )
                else:
                    device = org_revoke.device_or_none(d.get("device_id"))
                    if device is None:
                        return Response({"detail": "device_not_found"}, status=404)
                    result = org_revoke.wipe_device(
                        device,
                        actor=auth.user,
                        acknowledgement=str(d.get("acknowledgement", "")),
                        reason=str(d.get("reason", "")),
                    )
                    # المحو يُلحقه تعطيل المستخدم نفسه إن كان نشطاً (سرقة أو فقد — الوصول يُسحب معاً)
                    if (
                        user.is_active
                        and not user.is_owner
                        and not org_revoke._user_ledger(user)["open_shift"]
                    ):
                        org_revoke.disable_user(
                            user, actor=auth.user, mode="now", reason=str(d.get("reason", ""))
                        )
            except org_revoke.RevokeRejected as e:
                code = (
                    status.HTTP_403_FORBIDDEN
                    if e.code in {"owner_required", "branch_out_of_scope"}
                    else 400
                )
                return Response({"detail": e.code, "extra": e.detail}, status=code)
            return Response(
                {**result, **org_revoke.preview(user, actor=auth.user, actor_branch=viewer.branch)}
            )
