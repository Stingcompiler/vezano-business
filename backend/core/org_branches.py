"""ORG-03/04 — الفروع وتفاصيلها وقائمة الأجهزة: لا حذف لفرع له دفتر (يُقفل بعد تحويل المخزون)،
ورمز الفرع في الترقيم ثابت بعد أول فاتورة (§٨.٢)؛ الجهاز «آخر اتصال» رقم لا حالة وهمية، وغير
المتصل ليس معطّلاً — نعرض آخر اتصال ناجح وعدد ما لم يُرفع بلا وصف كاذب (§٩.٣، §٨.١٣)."""

from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone

from core import audit
from core.models import Branch, Device, Session, User, UserBranchAccess
from core.subscription import can_add_branch, device_limit
from core.tenancy import require_tenant

CODE_RE = re.compile(r"^[A-Z0-9]{2,6}$")
#: «متصل» ≤ 15 دقيقة منذ آخر اتصال ناجح؛ «غير متصل» دون ذلك؛ «متقادم» ≥ 3 أيام (افتراض 0005 §٤٨)
CONNECTED_WITHIN = timedelta(minutes=15)
STALE_AFTER = timedelta(days=3)


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


class BranchRejected(Exception):
    def __init__(self, code: str, detail: Any = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


def _branch_ledger(branch: Branch) -> dict[str, Any]:
    """ما يحمله هذا الفرع: فواتير صادرة، ورديات مسجَّلة، مخزون حالي (أصناف برصيد)، ذمم منسوبة
    لمعاملاته — أرقامٌ لا وصف."""
    from inventory.services import branch_balances
    from sales.models import Sale
    from shifts.models import Shift

    sales = Sale.objects.filter(branch_id=branch.id)
    first = sales.aggregate(m=Max("occurred_at"))["m"]
    stock = branch_balances(branch.id)
    return {
        "invoices": sales.count(),
        "shifts": Shift.objects.filter(branch_id=branch.id).count(),
        "open_shifts": Shift.objects.filter(branch_id=branch.id, state="open").count(),
        "stock_items": sum(1 for q in stock.values() if q != 0),
        "receivables_minor": str(int(sales.aggregate(c=Sum("credit_minor"))["c"] or 0)),
        "has_ledger": bool(first) or bool(stock),
    }


def _device_rows(branch_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    """صف لكل جهاز: آخر اتصال ناجح (آخر ظهور لأي جلسة عليه)، المعلّق المبلَّغ، مستخدموه."""
    devices = Device.objects.select_related("branch").order_by("registered_at")
    if branch_id is not None:
        devices = devices.filter(branch_id=branch_id)
    sessions = (
        Session.objects.filter(device__isnull=False)
        .select_related("user")
        .order_by("device_id", "-last_seen_at")
    )
    by_device: dict[uuid.UUID, list[Session]] = {}
    for s in sessions:
        assert s.device_id is not None
        by_device.setdefault(s.device_id, []).append(s)
    now = timezone.now()
    out: list[dict[str, Any]] = []
    for d in devices:
        ss = by_device.get(d.id, [])
        last_seen = max((s.last_seen_at for s in ss), default=None)
        active = [s for s in ss if s.revoked_at is None]
        pending_sessions = [s for s in active if s.reported_pending is not None]
        pending = max((int(s.reported_pending or 0) for s in pending_sessions), default=0)
        users = []
        for s in ss:
            if s.user.display_name not in users:
                users.append(s.user.display_name)
        if d.status != Device.Status.ACTIVE:
            connectivity = "revoked"
        elif last_seen is None:
            connectivity = "silent"
        elif now - last_seen <= CONNECTED_WITHIN:
            connectivity = "connected"
        elif now - last_seen >= STALE_AFTER:
            connectivity = "stale"
        else:
            connectivity = "offline"
        out.append(
            {
                "id": str(d.id),
                "name": d.name,
                "prefix": d.prefix,
                "branch_id": str(d.branch_id),
                "branch_name": d.branch.name,
                "status": d.status,
                "connectivity": connectivity,
                "last_seen_at": _iso(last_seen),
                "pending": pending,
                "pending_at": _iso(
                    max(
                        (s.reported_pending_at for s in pending_sessions if s.reported_pending_at),
                        default=None,
                    )
                ),
                "users": users[:4],
                "registered_at": _iso(d.registered_at),
                "sells": any(
                    a.role.code in {"owner", "manager", "cashier"} or a.user.is_owner
                    for a in UserBranchAccess.objects.filter(
                        user_id__in=[s.user_id for s in active], revoked_at__isnull=True
                    ).select_related("role", "user")
                )
                if active
                else True,
            }
        )
    return out


def branches_payload(*, scope: Branch | None, can_create: bool) -> dict[str, Any]:
    qs = Branch.objects.all().order_by("created_at")
    if scope is not None:
        qs = qs.filter(id=scope.id)
    rows = []
    for b in qs:
        ledger = _branch_ledger(b)
        rows.append(
            {
                "id": str(b.id),
                "name": b.name,
                "code": b.code,
                "is_active": b.is_active,
                "is_default": b.is_default,
                "code_locked": ledger["invoices"] > 0,
                "ledger": ledger,
                "devices": _device_rows(b.id),
                "staff": UserBranchAccess.objects.filter(branch=b, revoked_at__isnull=True)
                .values("user_id")
                .distinct()
                .count(),
            }
        )
    return {"branches": rows, "can_create": can_create}


def create_branch(*, name: str, code: str, actor: User | None = None) -> Branch:
    """الإنشاء للمالك: الفرع وحدة مخزون وصندوق — رمزٌ لاتيني قصير فريد يدخل ترقيم الفواتير."""
    name = name.strip()
    code = code.strip().upper()
    if not name:
        raise BranchRejected("name_required")
    if not CODE_RE.match(code):
        raise BranchRejected("code_invalid")
    if Branch.objects.filter(code=code).exists():
        raise BranchRejected("code_taken")
    ok, why = can_add_branch()
    if not ok:
        raise BranchRejected(why)
    b: Branch = Branch.objects.create(tenant_id=require_tenant(), name=name, code=code)
    audit.record(
        kind="branch.created",
        title=f"إنشاء فرع «{b.name}»",
        actor=actor,
        branch=b,
        detail=f"الرمز في الترقيم {b.code}",
        ref_entity="core.Branch",
        ref_id=b.id,
    )
    return b


def update_branch(branch: Branch, *, name: str | None, code: str | None) -> Branch:
    """الرمز ثابت بعد أول فاتورة (§٨.٢): فواتير صادرة تحمله ولا تُعاد."""
    fields: list[str] = []
    if name is not None and name.strip() and name.strip() != branch.name:
        branch.name = name.strip()
        fields.append("name")
    if code is not None and code.strip().upper() != branch.code:
        new = code.strip().upper()
        if _branch_ledger(branch)["invoices"] > 0:
            raise BranchRejected("code_locked")
        if not CODE_RE.match(new):
            raise BranchRejected("code_invalid")
        if Branch.objects.filter(code=new).exclude(id=branch.id).exists():
            raise BranchRejected("code_taken")
        branch.code = new
        fields.append("code")
    if fields:
        branch.save(update_fields=fields)
    return branch


def close_branch(branch: Branch, *, actor: User | None = None) -> Branch:
    """البديل عن الحذف: إقفال بعد تحويل المخزون — لا وردية مفتوحة ولا رصيد باقٍ ولا جهاز يحمل
    معلّقاً؛ يبقى في التقارير التاريخية وكل فاتورة تحمل اسمه."""
    if branch.is_default:
        raise BranchRejected("default_branch")
    ledger = _branch_ledger(branch)
    if ledger["open_shifts"] > 0:
        raise BranchRejected("open_shift", ledger["open_shifts"])
    if ledger["stock_items"] > 0:
        raise BranchRejected("stock_remaining", ledger["stock_items"])
    pending = [d for d in _device_rows(branch.id) if d["pending"] > 0]
    if pending:
        raise BranchRejected("devices_pending", [d["name"] for d in pending])
    with transaction.atomic():
        branch.is_active = False
        branch.save(update_fields=["is_active"])
        audit.record(
            kind="branch.closed",
            title=f"إقفال فرع «{branch.name}»",
            actor=actor,
            branch=branch,
            detail="يبقى في التقارير التاريخية وفي كل فاتورة تحمل اسمه.",
            ref_entity="core.Branch",
            ref_id=branch.id,
        )
    return branch


def devices_payload(*, scope: Branch | None) -> dict[str, Any]:
    rows = _device_rows(scope.id if scope is not None else None)
    return {
        "devices": rows,
        "counts": {
            "total": len(rows),
            "active": sum(1 for r in rows if r["status"] == "active"),
            "pending_total": sum(int(r["pending"]) for r in rows),
        },
        # حدّ الباقة رقم صريح (ORG-06)
        "device_limit": device_limit(),
        "as_of": _iso(timezone.now()),
    }


def branch_or_none(branch_id: Any) -> Branch | None:
    try:
        return Branch.objects.filter(id=uuid.UUID(str(branch_id))).first()
    except ValueError:
        return None


def record_delete_blocked(branch: Branch, *, actor: User | None) -> None:
    ledger = _branch_ledger(branch)
    audit.record(
        kind="branch.delete_blocked",
        title=f"محاولة حذف فرع {branch.name} — مُنعت",
        actor=actor,
        branch=branch,
        detail=f"الفرع يحمل {ledger['invoices']:,} فاتورة. عُرض الإقفال بديلاً ولم يُنفَّذ بعد.",
        ref_entity="core.Branch",
        ref_id=branch.id,
    )


__all__ = [
    "BranchRejected",
    "branch_or_none",
    "branches_payload",
    "close_branch",
    "create_branch",
    "devices_payload",
    "update_branch",
]
