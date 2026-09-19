"""سجل التدقيق (ORG-10): كتابة ملحقة فقط `record(...)`، وقراءة بنطاق يتبع نطاق المسؤولية —
الكاشير أفعاله وحدها، والمدير فرعه، والمالك الكل (§١٣.٥؛ R-04). بلا حمولات سرّية: عناوين وأسباب
ومراجع لا أرقام حسابات ولا رموز."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core.models import AuditEvent, Branch, User
from core.tenancy import require_tenant

#: الأفعال الحسّاسة (مرشّح «الأفعال الحسّاسة فقط»)
SENSITIVE_KINDS: frozenset[str] = frozenset(
    {
        "user.disabled",
        "user.branch_revoked",
        "device.wiped",
        "device.frozen",
        "branch.delete_blocked",
        "branch.closed",
        "roles.changed",
        "shift.variance_approved",
        "party.merged",
        "party.distinct",
        "quarantine.decided",
        "subscription.reviewed",
        "settings.changed",
        "ownership.requested",
        "ownership.transferred",
        "ownership.cancelled",
        "ownership.expired",
        "report.exported",
        "report.limit_requested",
        "campaign.saved",
        "campaign.approved",
        "campaign.cancelled",
        "campaign.retried",
        "purchase_order.created",
        "purchase_order.cancelled",
    }
)

RANGES: dict[str, timedelta | None] = {
    "today": None,
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "all": timedelta(days=3650),
}


def record(
    *,
    kind: str,
    title: str,
    actor: User | None,
    actor_role: str = "",
    branch: Branch | None = None,
    detail: str = "",
    reason: str = "",
    ref_entity: str = "",
    ref_id: uuid.UUID | None = None,
    refers_to: AuditEvent | None = None,
) -> AuditEvent:
    event: AuditEvent = AuditEvent.objects.create(
        tenant_id=require_tenant(),
        actor_user_id=actor.id if actor else None,
        actor_name=actor.display_name if actor else "",
        actor_role=actor_role or ("مالك" if actor and actor.is_owner else ""),
        branch=branch,
        kind=kind,
        title=title[:200],
        detail=detail[:400],
        reason=reason[:300],
        sensitive=kind in SENSITIVE_KINDS,
        ref_entity=ref_entity,
        ref_id=ref_id,
        refers_to=refers_to,
    )
    return event


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def row(e: AuditEvent) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "at": _iso(e.at),
        "actor_name": e.actor_name,
        "actor_role": e.actor_role,
        "branch_id": str(e.branch_id) if e.branch_id else "",
        "branch_name": e.branch.name if e.branch is not None else "",
        "kind": e.kind,
        "title": e.title,
        "detail": e.detail,
        "reason": e.reason,
        "sensitive": e.sensitive,
        "ref_entity": e.ref_entity,
        "ref_id": str(e.ref_id) if e.ref_id else "",
        "refers_to": str(e.refers_to_id) if e.refers_to_id else "",
    }


def scoped(*, viewer: User, viewer_branch: Branch | None, is_manager: bool) -> Any:
    qs = AuditEvent.objects.select_related("branch")
    if viewer.is_owner:
        return qs
    if is_manager and viewer_branch is not None:
        return qs.filter(branch=viewer_branch)
    return qs.filter(actor_user_id=viewer.id)


def query(
    *,
    viewer: User,
    viewer_branch: Branch | None,
    is_manager: bool,
    range_key: str = "today",
    branch_id: uuid.UUID | None = None,
    sensitive_only: bool = False,
    limit: int = 200,
) -> dict[str, Any]:
    now = timezone.now()
    qs = scoped(viewer=viewer, viewer_branch=viewer_branch, is_manager=is_manager)
    span = RANGES.get(range_key, None)
    since = now.replace(hour=0, minute=0, second=0, microsecond=0) if span is None else now - span
    base = qs
    qs = qs.filter(at__gte=since)
    if branch_id is not None:
        qs = qs.filter(branch_id=branch_id)
    if sensitive_only:
        qs = qs.filter(sensitive=True)
    rows = [row(e) for e in qs.order_by("-at")[:limit]]
    last = base.order_by("-at").first()
    return {
        "range": range_key if range_key in RANGES else "today",
        "since": _iso(since),
        "rows": rows,
        "count": qs.count(),
        "last_event_at": _iso(last.at) if last else "",
        "scope": "all" if viewer.is_owner else ("branch" if is_manager else "own"),
        "can_export": viewer.is_owner,
    }


def export_csv(payload: dict[str, Any]) -> str:
    """تصدير للمالك فقط — يحمل نطاق التصفية في ترويسته."""
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(
        [
            "# سجل التدقيق · المدى: "
            f"{payload['range']} · منذ {payload['since']} · العدد {payload['count']}"
        ]
    )
    w.writerow(["at", "actor", "role", "branch", "kind", "title", "detail", "reason", "sensitive"])
    for r in payload["rows"]:
        w.writerow(
            [
                r["at"],
                r["actor_name"],
                r["actor_role"],
                r["branch_name"],
                r["kind"],
                r["title"],
                r["detail"],
                r["reason"],
                "1" if r["sensitive"] else "0",
            ]
        )
    return out.getvalue()
