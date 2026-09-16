"""ACC-03/ACC-04: عضويات الحساب واختيار المنشأة وإنشاؤها (T1.2).

- العضويات تُشتق من الجلسة أو من تذكرة الاختيار الصادرة عن الدخول (لا من حقل يختاره العميل).
- الاختيار يُصدر جلسة للمستخدم داخل المنشأة؛ العضوية الموقوفة تُرفض بسبب لا تُخفى (28-D21).
- الإنشاء ذرّي وبهوية طلب من العميل: التكرار يعيد النتيجة نفسها لا منشأة ثانية (34-D26 server_error).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from django.db import IntegrityError, transaction
from rest_framework_simplejwt.exceptions import TokenError

from core.auth.accounts import SelectTicket
from core.auth.tokens import issue_session_tokens
from core.models import (
    Account,
    Branch,
    PaymentMethod,
    Role,
    Tenant,
    TenantCreation,
    Unit,
    User,
    UserBranchAccess,
)
from core.recipes import CURRENCIES, RECIPES
from core.tenancy import platform_context


class TicketInvalid(Exception):
    pass


def account_from_ticket(raw: str) -> Account:
    try:
        ticket = SelectTicket(raw)  # type: ignore[arg-type]
    except TokenError:
        raise TicketInvalid from None
    with platform_context():
        account = Account.unscoped.filter(id=str(ticket.get("aid", "")), is_active=True).first()
    if account is None:
        raise TicketInvalid
    return account


@dataclass(frozen=True)
class MembershipRow:
    user_id: str
    tenant_id: str
    tenant_name: str
    role_name: str
    scope: str
    status: str  # active | suspended

    def as_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "tenant_id": self.tenant_id,
            "tenant_name": self.tenant_name,
            "role_name": self.role_name,
            "scope": self.scope,
            "status": self.status,
        }


def memberships_of(account: Account) -> list[MembershipRow]:
    with platform_context():
        users = list(
            User.unscoped.filter(account=account, tenant__isnull=False)
            .select_related("tenant")
            .order_by("created_at")
        )
        rows: list[MembershipRow] = []
        for u in users:
            accesses = list(
                UserBranchAccess.unscoped.filter(user=u, revoked_at__isnull=True).select_related(
                    "role", "branch"
                )
            )
            total = Branch.unscoped.filter(tenant_id=u.tenant_id, is_active=True).count()
            role_name = "مالك" if u.is_owner else (accesses[0].role.name if accesses else "")
            if u.is_owner or (total and len(accesses) >= total):
                scope = "كل الفروع"
            else:
                scope = "، ".join(a.branch.name for a in accesses)
            rows.append(
                MembershipRow(
                    user_id=str(u.id),
                    tenant_id=str(u.tenant_id),
                    tenant_name=u.tenant.name if u.tenant else "",
                    role_name=role_name,
                    scope=scope,
                    status="active" if u.is_active else "suspended",
                )
            )
    return rows


class MembershipSuspended(Exception):
    pass


class MembershipNotFound(Exception):
    pass


def select_membership(account: Account, tenant_id: str, *, user_agent: str = "") -> dict[str, str]:
    with platform_context():
        user = User.unscoped.filter(account=account, tenant_id=tenant_id).first()
        if user is None:
            raise MembershipNotFound
        if not user.is_active:
            raise MembershipSuspended
        session, refresh = issue_session_tokens(user, user_agent=user_agent)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "session_id": str(session.id),
        "tenant_id": str(user.tenant_id),
        "user_id": str(user.id),
    }


class ValidationFailed(Exception):
    def __init__(self, fields: dict[str, str]) -> None:
        super().__init__(str(fields))
        self.fields = fields


@dataclass(frozen=True)
class CreationResult:
    creation: TenantCreation
    already_existed: bool

    def as_dict(self) -> dict[str, Any]:
        c = self.creation
        return {
            "client_request_id": str(c.client_request_id),
            "tenant_id": str(c.tenant_id),
            "tenant_name": c.tenant.name,
            "branch_id": str(c.branch_id),
            "user_id": str(c.user_id),
            "sector": c.sector,
            "created": c.created_counts,
        }


def creation_for(account: Account, client_request_id: uuid.UUID) -> TenantCreation | None:
    with platform_context():
        return (
            TenantCreation.unscoped.filter(account=account, client_request_id=client_request_id)
            .select_related("tenant")
            .first()
        )


def create_tenant(
    account: Account,
    *,
    client_request_id: uuid.UUID,
    name: str,
    sector: str,
    currency: str,
    first_branch_name: str,
) -> CreationResult:
    """ينشئ المنشأة ووصفتها وفرعها الأول والمالك في معاملة واحدة.

    التحقق (34-D26 validation_error): الاسم الفارغ والقطاع غير المختار يمنعان الإنشاء؛
    تكرار الاسم لا يُمنع.
    """
    fields: dict[str, str] = {}
    name = name.strip()
    if not name:
        fields["name"] = "empty"
    if sector not in RECIPES:
        fields["sector"] = "empty" if not sector else "unknown"
    if currency not in CURRENCIES:
        fields["currency"] = "unknown"
    if fields:
        raise ValidationFailed(fields)
    existing = creation_for(account, client_request_id)
    if existing is not None:
        return CreationResult(existing, already_existed=True)
    recipe = RECIPES[sector]
    _, exponent = CURRENCIES[currency]
    branch_name = first_branch_name.strip() or "الرئيسي"
    try:
        with platform_context(), transaction.atomic():
            tenant = Tenant.unscoped.create(
                name=name, base_currency=currency, base_currency_exponent=exponent
            )
            branch = Branch.unscoped.create(
                tenant=tenant, name=branch_name, code="BR1", is_default=True
            )
            roles = {
                r.code: Role.unscoped.create(tenant=tenant, code=r.code, name=r.name)
                for r in recipe.roles
            }
            units = [
                Unit.unscoped.create(
                    tenant=tenant,
                    code=u.code,
                    name=u.name,
                    is_base=u.is_base,
                    decimal_places=u.decimal_places,
                )
                for u in recipe.units
            ]
            methods = [
                PaymentMethod.unscoped.create(
                    tenant=tenant, code=p.code, name=p.name, is_cash=p.is_cash
                )
                for p in recipe.payment_methods
            ]
            user = User.objects.create_user(
                tenant=tenant,
                username="owner",
                display_name=account.display_name or account.identifier,
                is_owner=True,
                account=account,
            )
            UserBranchAccess.unscoped.create(
                tenant=tenant, user=user, branch=branch, role=roles["owner"]
            )
            # حالة المزامنة (الجيل والعدّاد) تولد مع المنشأة (§٨.٢)
            from sync.counter import ensure_state

            ensure_state(tenant.id)
            creation = TenantCreation.unscoped.create(
                account=account,
                client_request_id=client_request_id,
                tenant=tenant,
                user=user,
                branch=branch,
                sector=sector,
                created_counts={
                    "items": 0,
                    "groups": 0,
                    "branches": 1,
                    "units": len(units),
                    "payment_methods": len(methods),
                    "roles": len(roles),
                },
            )
    except IntegrityError:
        # سباق على نفس client_request_id: الطلب الأول فاز — نعيد نتيجته
        existing = creation_for(account, client_request_id)
        if existing is None:
            raise
        return CreationResult(existing, already_existed=True)
    return CreationResult(creation, already_existed=False)
