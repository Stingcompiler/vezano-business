"""إدارة المنشأة (ORG-01/02): المستخدمون والدعوات، ومصفوفة الأدوار والصلاحيات (G-09).

- الدعوة ليست حساباً والتعطيل ليس حذفاً: حالات الدعوة الأربع (مُرسَلة/منتهية/مقبولة/ملغاة) تُشتق من
  حقولها؛ الدعوة المنتهية لا تُحيا — تُصدر جديدة برابط جديد ويبقى أثر الأولى.
- الصلاحية تُمنح للدور والنطاق للمستخدم في الفرع؛ عمود المالك مقفل (لا يسحب صلاحيته الأخيرة عن
  نفسه)؛ التغيير يسري عند الفعل التالي ولا يمسّ عمليات سابقة.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from core import audit
from core.auth.accounts import normalize_identifier
from core.auth.invitations import DEFAULT_TTL, create_invitation
from core.models import Branch, Invitation, Role, RolePermission, User, UserBranchAccess
from core.tenancy import require_tenant

# ترتيب الأعمدة كما في الإطار (07-D3): مالك · مدير فرع · كاشير · أمين مخزن
ROLE_ORDER: tuple[str, ...] = ("owner", "manager", "cashier", "storekeeper")

VALUES: tuple[str, ...] = (
    "yes",
    "no",
    "unlimited",
    "limit",
    "branch",
    "own_customer",
    "cash_only",
    "propose",
)
PERIODS: tuple[str, ...] = ("per_op", "daily")


@dataclass(frozen=True)
class Cell:
    value: str
    limit_minor: int | None = None
    period: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "limit_minor": None if self.limit_minor is None else str(self.limit_minor),
            "period": self.period,
        }


def _y() -> Cell:
    return Cell("yes")


def _n() -> Cell:
    return Cell("no")


def _lim(minor: int, period: str = "per_op") -> Cell:
    return Cell("limit", minor, period)


@dataclass(frozen=True)
class PermissionSpec:
    key: str
    label: str
    note: str
    defaults: dict[str, Cell]
    #: صياغة الحدّ في الخلية كما في الإطار: «N للعملية» للخصم، «حتى N» للمرتجع والعجز
    limit_style: str = "upto"


#: قيم تجريبية — الإطار 07-D3 ORG-02 (G-09)؛ تُحرَّر في المصفوفة
PERMISSIONS: tuple[PermissionSpec, ...] = (
    PermissionSpec(
        "sell",
        "البيع وإصدار الفاتورة",
        "POS-01–08",
        {"owner": _y(), "manager": _y(), "cashier": _y(), "storekeeper": _n()},
    ),
    PermissionSpec(
        "discount",
        "خصم وتجاوز سعر",
        "POS-03 · حد مالي",
        {
            "owner": Cell("unlimited"),
            "manager": _lim(20_000),
            "cashier": _lim(1_000),
            "storekeeper": _n(),
        },
        limit_style="per_op",
    ),
    PermissionSpec(
        "refund",
        "مرتجع",
        "POS-10",
        {"owner": _y(), "manager": _y(), "cashier": _lim(50_000), "storekeeper": _n()},
    ),
    PermissionSpec(
        "view_receivables",
        "رؤية ذمم كل العملاء",
        "PTY-01 · REP-02",
        {
            "owner": _y(),
            "manager": Cell("branch"),
            "cashier": Cell("own_customer"),
            "storekeeper": _n(),
        },
    ),
    PermissionSpec(
        "record_payment",
        "تسجيل سداد",
        "PTY-06",
        {"owner": _y(), "manager": _y(), "cashier": Cell("cash_only"), "storekeeper": _n()},
    ),
    PermissionSpec(
        "close_short",
        "إغلاق وردية بعجز",
        "SHIFT-04 · حد مالي",
        {
            "owner": Cell("unlimited"),
            "manager": _lim(30_000),
            "cashier": _lim(5_000),
            "storekeeper": _n(),
        },
    ),
    PermissionSpec(
        "stock_adjust",
        "تسوية جرد",
        "INV-06",
        {"owner": _y(), "manager": Cell("branch"), "cashier": _n(), "storekeeper": Cell("propose")},
    ),
    PermissionSpec(
        "campaign_create",
        "إنشاء حملة",
        "NOT-04",
        {"owner": _y(), "manager": _y(), "cashier": _n(), "storekeeper": _n()},
    ),
    PermissionSpec(
        "campaign_approve",
        "اعتماد ونشر حملة",
        "NOT-05 · منفصل عمداً",
        {"owner": _y(), "manager": _n(), "cashier": _n(), "storekeeper": _n()},
    ),
    PermissionSpec(
        "purchase_approve",
        "اعتماد مستند شراء",
        "PUR-03 · الاعتماد توقيع على مبلغ",
        {"owner": _y(), "manager": _lim(300_000), "cashier": _n(), "storekeeper": _n()},
    ),
    PermissionSpec(
        "conflict_review",
        "مراجعة تعارض وحجر",
        "SYS-03",
        {"owner": _y(), "manager": _n(), "cashier": _n(), "storekeeper": _n()},
    ),
)
PERMISSION_BY_KEY = {p.key: p for p in PERMISSIONS}
FINANCIAL_KEYS = frozenset({"discount", "refund", "close_short"})


def _roles() -> list[Role]:
    roles = list(Role.objects.all())
    rank = {c: i for i, c in enumerate(ROLE_ORDER)}
    roles.sort(key=lambda r: (rank.get(r.code, len(ROLE_ORDER)), r.name))
    return roles


def ensure_matrix() -> None:
    """يبذر الخلايا الافتراضية لكل دور يفتقدها — مرة واحدة ولا يلمس ما حُرِّر."""
    tenant_id = require_tenant()
    existing = {(rp.role_id, rp.key) for rp in RolePermission.objects.all()}
    rows: list[RolePermission] = []
    for role in _roles():
        for spec in PERMISSIONS:
            if (role.id, spec.key) in existing:
                continue
            cell = spec.defaults.get(role.code, _n())
            rows.append(
                RolePermission(
                    tenant_id=tenant_id,
                    role=role,
                    key=spec.key,
                    value=cell.value,
                    limit_minor=cell.limit_minor,
                    period=cell.period,
                )
            )
    if rows:
        RolePermission.objects.bulk_create(rows)


def cell_for(role_code: str, key: str) -> Cell:
    """خلية دور بمفتاح — من المصفوفة المحفوظة وإلا الافتراض (منشآت قبل ORG-02)."""
    spec = PERMISSION_BY_KEY[key]
    rp = RolePermission.objects.filter(role__code=role_code, key=key).first()
    if rp is None:
        return spec.defaults.get(role_code, _n())
    return Cell(rp.value, rp.limit_minor, rp.period)


def limit_minor_for(role_code: str, key: str) -> int | None:
    """الحدّ المالي للدور: None = بلا حدّ (المالك «بلا حد»)؛ صفر = ممنوع."""
    c = cell_for(role_code, key)
    if c.value == "unlimited" or c.value == "yes":
        return None
    if c.value == "limit":
        return c.limit_minor or 0
    return 0


def _cell_label(c: Cell, style: str = "upto") -> str:
    """نصّ الخلية كما في الإطار: نعم/لا/بلا حد/N للعملية/حتى N/فرعه/عميل البيع فقط/نقداً فقط/
    اقتراح فقط."""
    if c.value == "yes":
        return "نعم"
    if c.value == "no":
        return "لا"
    if c.value == "unlimited":
        return "بلا حد"
    if c.value == "branch":
        return "فرعه"
    if c.value == "own_customer":
        return "عميل البيع فقط"
    if c.value == "cash_only":
        return "نقداً فقط"
    if c.value == "propose":
        return "اقتراح فقط"
    amount = _major(c.limit_minor or 0)
    if c.period == "daily":
        return f"{amount} يومياً"
    return f"{amount} للعملية" if style == "per_op" else f"حتى {amount}"


def _major(minor: int) -> str:
    """مبلغ للعرض بلا كسور صفرية (200 لا 200.00) — الوحدة الصغرى مئوية."""
    whole, frac = divmod(abs(minor), 100)
    sign = "-" if minor < 0 else ""
    return f"{sign}{whole:,}" if frac == 0 else f"{sign}{whole:,}.{frac:02d}"


def matrix_payload() -> dict[str, Any]:
    ensure_matrix()
    roles = _roles()
    by_role_key = {(rp.role_id, rp.key): rp for rp in RolePermission.objects.all()}
    counts = dict(
        UserBranchAccess.objects.filter(revoked_at__isnull=True, user__is_active=True)
        .values("role_id")
        .annotate(n=Count("user_id", distinct=True))
        .values_list("role_id", "n")
    )
    rows = []
    for spec in PERMISSIONS:
        cells = []
        for role in roles:
            rp = by_role_key.get((role.id, spec.key))
            c = Cell(rp.value, rp.limit_minor, rp.period) if rp else _n()
            cells.append(
                {"role_id": str(role.id), "label": _cell_label(c, spec.limit_style), **c.as_dict()}
            )
        rows.append(
            {
                "key": spec.key,
                "label": spec.label,
                "note": spec.note,
                "financial": spec.key in FINANCIAL_KEYS,
                "cells": cells,
            }
        )
    from core.models import Tenant

    tenant = Tenant.unscoped.get(id=require_tenant())
    return {
        "tenant_name": tenant.name,
        "roles": [
            {
                "id": str(r.id),
                "code": r.code,
                "name": r.name,
                "users": int(counts.get(r.id, 0)),
                "locked": r.code == "owner",
            }
            for r in roles
        ],
        "rows": rows,
    }


class MatrixRejected(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


def save_matrix(changes: list[dict[str, Any]], *, actor: User | None = None) -> dict[str, Any]:
    """يطبّق تغييرات خلايا: `{role_id, key, value, limit_minor?, period?}`. عمود المالك مقفل
    (`owner_locked`)؛ الحدّ المالي يحتاج قيمة ومدى (`limit_required`). يعيد عدد الموظفين
    المتأثرين."""
    ensure_matrix()
    roles = {str(r.id): r for r in _roles()}
    touched_roles: set[uuid.UUID] = set()
    changed = 0
    with transaction.atomic():
        for ch in changes:
            role = roles.get(str(ch.get("role_id", "")))
            key = str(ch.get("key", ""))
            value = str(ch.get("value", ""))
            if role is None or key not in PERMISSION_BY_KEY:
                raise MatrixRejected("unknown_cell", f"{ch.get('role_id')}/{key}")
            if role.code == "owner":
                raise MatrixRejected("owner_locked", key)
            if value not in VALUES:
                raise MatrixRejected("invalid_value", value)
            limit: int | None = None
            period = str(ch.get("period", "") or "")
            if value == "limit":
                raw = ch.get("limit_minor")
                try:
                    limit = int(str(raw))
                except (TypeError, ValueError):
                    raise MatrixRejected("limit_required", key) from None
                if limit < 0 or period not in PERIODS:
                    raise MatrixRejected("limit_required", key)
            else:
                period = ""
            rp = RolePermission.objects.get(role=role, key=key)
            if (rp.value, rp.limit_minor, rp.period) == (value, limit, period):
                continue
            rp.value, rp.limit_minor, rp.period = value, limit, period
            rp.save(update_fields=["value", "limit_minor", "period", "updated_at"])
            touched_roles.add(role.id)
            changed += 1
    affected = (
        UserBranchAccess.objects.filter(
            role_id__in=list(touched_roles), revoked_at__isnull=True, user__is_active=True
        )
        .values("user_id")
        .distinct()
        .count()
        if touched_roles
        else 0
    )
    if changed:
        audit.record(
            kind="roles.changed",
            title="تعديل مصفوفة الأدوار والصلاحيات",
            actor=actor,
            detail=(
                f"تغيّرت {changed} خلية؛ تغيّرت صلاحيات {affected} موظفين — تسري عند الفعل التالي."
            ),
        )
    return {"changed_cells": changed, "affected_users": affected}


# ---------------------------------------------------------------- ORG-01 المستخدمون والدعوات


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def mask_identifier(identifier: str) -> str:
    """«kamal@…» للبريد (الاسم المحلي ثم @…) و«0912…» للهاتف (أول أربعة أرقام) — المعرّف الكامل لا
    يُعرض في القائمة."""
    if "@" in identifier:
        return f"{identifier.split('@', 1)[0]}@…"
    return f"{identifier[:4]}…" if len(identifier) > 4 else identifier


def invitation_status(inv: Invitation, now: Any = None) -> str:
    now = now or timezone.now()
    if inv.accepted_at is not None:
        return "accepted"
    if inv.revoked_at is not None:
        return "revoked"
    if inv.expires_at <= now:
        return "expired"
    return "sent"


def invitation_payload(inv: Invitation) -> dict[str, Any]:
    return {
        "id": str(inv.id),
        "identifier_masked": mask_identifier(inv.invitee_identifier),
        "role_code": inv.role.code,
        "role_name": inv.role.name,
        "branch_id": str(inv.branch_id),
        "branch_name": inv.branch.name,
        "status": invitation_status(inv),
        "sent_at": _iso(inv.created_at),
        "expires_at": _iso(inv.expires_at),
        "accepted_at": _iso(inv.accepted_at),
        "revoked_at": _iso(inv.revoked_at),
        "inviter_name": inv.inviter.display_name,
    }


def _operations_by_user() -> dict[uuid.UUID, int]:
    from sync.models import Operation

    return dict(
        Operation.objects.values("actor_user")
        .annotate(n=Count("id"))
        .values_list("actor_user", "n")
    )


def users_payload(*, branch_scope: Branch | None) -> dict[str, Any]:
    """القائمة من الخادم دائماً: المستخدمون بأدوارهم ونطاقهم وحالتهم، والدعوات بحالاتها الأربع.
    مدير الفرع يرى فريق فرعه فقط."""
    ops = _operations_by_user()
    access = UserBranchAccess.objects.filter(revoked_at__isnull=True).select_related(
        "user", "branch", "role"
    )
    if branch_scope is not None:
        access = access.filter(branch=branch_scope)
    by_user: dict[uuid.UUID, dict[str, Any]] = {}
    for a in access.order_by("user__display_name", "granted_at"):
        u = a.user
        row = by_user.setdefault(
            u.id,
            {
                "id": str(u.id),
                "display_name": u.display_name,
                "is_owner": u.is_owner,
                "status": "active" if u.is_active else "disabled",
                "roles": [],
                "branches": [],
                "all_branches": u.is_owner,
                "operations": int(ops.get(u.id, 0)),
                "disabled_since": "",
            },
        )
        if a.role.code not in [r["code"] for r in row["roles"]]:
            row["roles"].append({"code": a.role.code, "name": a.role.name})
        if str(a.branch_id) not in [b["id"] for b in row["branches"]]:
            row["branches"].append({"id": str(a.branch_id), "name": a.branch.name})
    # مالك بلا تخويل صريح على فرع، ومستخدم معطَّل فقد تخويلاته — يبقيان في القائمة باسميهما
    for u in User.objects.all().order_by("display_name"):
        if u.id in by_user:
            continue
        if branch_scope is not None and not u.is_owner:
            continue
        by_user[u.id] = {
            "id": str(u.id),
            "display_name": u.display_name,
            "is_owner": u.is_owner,
            "status": "active" if u.is_active else "disabled",
            "roles": [{"code": "owner", "name": "مالك"}] if u.is_owner else [],
            "branches": [],
            "all_branches": u.is_owner,
            "operations": int(ops.get(u.id, 0)),
            "disabled_since": "",
        }
    invitations = Invitation.objects.select_related("role", "branch", "inviter").order_by(
        "-created_at"
    )
    if branch_scope is not None:
        invitations = invitations.filter(branch=branch_scope)
    inv_rows = [invitation_payload(i) for i in invitations]
    users = list(by_user.values())
    users.sort(key=lambda r: (not r["is_owner"], r["status"] != "active", r["display_name"]))
    return {
        "users": users,
        "invitations": inv_rows,
        "counts": {
            "users": len(users),
            "open_invitations": sum(1 for r in inv_rows if r["status"] == "sent"),
        },
        "invite_ttl_hours": int(DEFAULT_TTL.total_seconds() // 3600),
    }


class InviteRejected(Exception):
    def __init__(self, code: str, existing: Invitation | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.existing = existing


def pending_invitation(identifier: str) -> Invitation | None:
    now = timezone.now()
    return (
        Invitation.objects.filter(
            invitee_identifier=identifier,
            accepted_at__isnull=True,
            revoked_at__isnull=True,
            expires_at__gt=now,
        )
        .select_related("role", "branch", "inviter")
        .first()
    )


def role_summary(role: Role) -> list[str]:
    """«ما سيملكه المدعوّ حين يقبل»: الصلاحيات التي ليست «لا» بنصّ خليتها."""
    out: list[str] = []
    for spec in PERMISSIONS:
        c = cell_for(role.code, spec.key)
        if c.value == "no":
            continue
        label = _cell_label(c, spec.limit_style)
        out.append(spec.label if label == "نعم" else f"{spec.label} — {label}")
    return out


def invite(
    *, inviter: User, identifier: str, role: Role, branch: Branch, ttl: timedelta = DEFAULT_TTL
) -> tuple[Invitation, str]:
    """دعوة جديدة؛ رقم عليه دعوة معلّقة لم تُقبل → `already_invited` مع الدعوة القائمة (لا دعوة
    ثانية)."""
    try:
        normalized, _kind = normalize_identifier(identifier)
    except ValueError:
        raise InviteRejected("identifier_invalid") from None
    if User.objects.filter(is_active=True, account__identifier=normalized).exists():
        raise InviteRejected("already_member")
    existing = pending_invitation(normalized)
    if existing is not None:
        raise InviteRejected("already_invited", existing)
    inv, raw = create_invitation(
        inviter=inviter, branch=branch, role=role, invitee_identifier=normalized, ttl=ttl
    )
    audit.record(
        kind="invitation.sent",
        title=f"دعوة {mask_identifier(normalized)} بدور {role.name}",
        actor=inviter,
        branch=branch,
        detail="حتى قبولها لا يوجد حساب ولا صلاحية.",
        ref_entity="core.Invitation",
        ref_id=inv.id,
    )
    return inv, raw


def resend(inv: Invitation, *, inviter: User) -> tuple[Invitation, str]:
    """الدعوة المنتهية لا تُحيا: دعوة جديدة برابط جديد وصلاحية جديدة؛ المُرسَلة تُلغى لصالح الجديدة
    ويبقى أثر الأولى ومن أرسلها."""
    if inv.accepted_at is not None:
        raise InviteRejected("already_accepted")
    if invitation_status(inv) == "sent":
        inv.revoked_at = timezone.now()
        inv.save(update_fields=["revoked_at"])
    return create_invitation(
        inviter=inviter,
        branch=inv.branch,
        role=inv.role,
        invitee_identifier=inv.invitee_identifier,
    )


def revoke(inv: Invitation) -> Invitation:
    if inv.accepted_at is not None:
        raise InviteRejected("already_accepted")
    if inv.revoked_at is None:
        inv.revoked_at = timezone.now()
        inv.save(update_fields=["revoked_at"])
        audit.record(
            kind="invitation.revoked",
            title=f"إلغاء دعوة {mask_identifier(inv.invitee_identifier)}",
            actor=None,
            branch=inv.branch,
            ref_entity="core.Invitation",
            ref_id=inv.id,
        )
    return inv
