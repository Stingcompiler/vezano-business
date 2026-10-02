"""PLT-14 — طلبات الجولة من صفحة الهبوط (بأمر المالك 2026-09-21؛ 0005 §١٠١).

المشغّل يرى الطلبات بحالتها (جديد/تواصلنا/تحوّل/أُغلق)، ويغيّرها بملاحظة، وكل تغيير باسمه ووقته.
لا إرسال آلي للطالب (G-02) — التواصل بشري على القناة التي اختارها.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone

from core.models import Tenant
from core.tenancy import platform_context
from stingops.models import DemoRequest, DemoRequestComment

TRANSITIONS: dict[str, set[str]] = {
    DemoRequest.Status.NEW: {DemoRequest.Status.CONTACTED, DemoRequest.Status.CLOSED},
    DemoRequest.Status.CONTACTED: {DemoRequest.Status.CONVERTED, DemoRequest.Status.CLOSED},
    DemoRequest.Status.CONVERTED: set(),
    DemoRequest.Status.CLOSED: {DemoRequest.Status.CONTACTED},
}


class DemoRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _row(r: DemoRequest) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "name": r.name,
        "whatsapp": r.whatsapp,
        "email": r.email,
        "channel": r.channel,
        "channel_label": DemoRequest.Channel(r.channel).label,
        "message": r.message,
        "status": r.status,
        "status_label": DemoRequest.Status(r.status).label,
        "note": r.note,
        "created_at": _iso(r.created_at),
        "handled_at": _iso(r.handled_at),
        "handled_by_name": r.handled_by_name,
        "next": sorted(TRANSITIONS[DemoRequest.Status(r.status)]),
        # 0005 §١٣٨ — المنشأة التي تحوّل إليها الطلب (إن رُبطت)
        "tenant_id": str(r.tenant_id) if r.tenant_id else "",
        "tenant_name": r.tenant.name if r.tenant_id and r.tenant else "",
        # 0005 §١٤٧ — بريد مؤكَّد برمز، وتعليقات الفريق التي يراها صاحب الطلب في صفحة المتابعة
        "email_verified": r.email_verified_at is not None,
        "comments": [
            {"body": c.body, "author": c.author_name, "at": _iso(c.created_at)}
            for c in sorted(r.comments.all(), key=lambda c: c.created_at)
        ],
    }


def payload(*, status_filter: str = "open") -> dict[str, Any]:
    """`open` = جديد + تواصلنا (ما ينتظر فعلاً)؛ `all` الكل؛ أو حالة بعينها."""
    with platform_context():
        qs = (
            DemoRequest.objects.select_related("tenant")
            .prefetch_related("comments")
            .order_by("-created_at")
        )
        counts: dict[str, int] = {
            str(s.value): DemoRequest.objects.filter(status=s).count() for s in DemoRequest.Status
        }
        if status_filter == "open":
            qs = qs.filter(status__in=[DemoRequest.Status.NEW, DemoRequest.Status.CONTACTED])
        elif status_filter in DemoRequest.Status.values:
            qs = qs.filter(status=status_filter)
        rows = [_row(r) for r in qs[:200]]
    return {
        "requests": rows,
        "filter": status_filter,
        "counts": {
            **counts,
            "open": counts["new"] + counts["contacted"],
            "linked": DemoRequest.objects.filter(
                status=DemoRequest.Status.CONVERTED, tenant__isnull=False
            ).count(),
        },
        "fetched_at": _iso(timezone.now()),
        "rule": "لا إرسال آلي للطالب — التواصل بشري على القناة التي اختارها، ويُسجَّل هنا باسمك.",
    }


def tenant_choices(q: str) -> list[dict[str, str]]:
    """منشآت يُربط بها طلب «تحوّل» — الأحدث تسجيلاً أولاً، بالاسم فقط (لا أرقام دفتر)."""
    with platform_context():
        qs = Tenant.unscoped.all().order_by("-created_at")
        if q.strip():
            qs = qs.filter(name__icontains=q.strip())
        return [{"id": str(t.id), "name": t.name} for t in qs[:20]]


def update(
    request_id: uuid.UUID,
    *,
    status: str,
    note: str,
    by_name: str,
    tenant_id: str = "",
    comment: str = "",
) -> dict[str, Any]:
    with platform_context():
        r = DemoRequest.objects.filter(id=request_id).first()
        if r is None:
            raise DemoRejected("not_found", 404)
        tenant: Tenant | None = None
        if tenant_id:
            try:
                tenant = Tenant.unscoped.filter(id=uuid.UUID(tenant_id)).first()
            except ValueError:
                tenant = None
            if tenant is None:
                raise DemoRejected("tenant_not_found", 404)
            target = status or r.status
            if target != DemoRequest.Status.CONVERTED:
                raise DemoRejected("tenant_only_when_converted", 409)
        note = note.strip()[:1000]
        comment = comment.strip()[:2000]
        if status and status != r.status:
            if status not in TRANSITIONS[DemoRequest.Status(r.status)]:
                raise DemoRejected("bad_transition", 409)
            if status in {DemoRequest.Status.CONVERTED, DemoRequest.Status.CLOSED} and not note:
                raise DemoRejected("note_required")
            r.status = status
        elif not note and tenant is None and not comment:
            raise DemoRejected("nothing_to_change")
        if note:
            r.note = note
        if tenant is not None:
            r.tenant = tenant
        r.handled_at = timezone.now()
        r.handled_by_name = by_name
        r.save(update_fields=["status", "note", "tenant", "handled_at", "handled_by_name"])
        if comment:
            DemoRequestComment.objects.create(request=r, body=comment, author_name=by_name)
        return _row(r)
