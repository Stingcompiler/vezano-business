"""PLT-14 — طلبات الجولة من صفحة الهبوط (بأمر المالك 2026-09-21؛ 0005 §١٠١).

المشغّل يرى الطلبات بحالتها (جديد/تواصلنا/تحوّل/أُغلق)، ويغيّرها بملاحظة، وكل تغيير باسمه ووقته.
لا إرسال آلي للطالب (G-02) — التواصل بشري على القناة التي اختارها.
"""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone

from core.tenancy import platform_context
from stingops.models import DemoRequest

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
    }


def payload(*, status_filter: str = "open") -> dict[str, Any]:
    """`open` = جديد + تواصلنا (ما ينتظر فعلاً)؛ `all` الكل؛ أو حالة بعينها."""
    with platform_context():
        qs = DemoRequest.objects.all().order_by("-created_at")
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
        "counts": {**counts, "open": counts["new"] + counts["contacted"]},
        "fetched_at": _iso(timezone.now()),
        "rule": "لا إرسال آلي للطالب — التواصل بشري على القناة التي اختارها، ويُسجَّل هنا باسمك.",
    }


def update(request_id: uuid.UUID, *, status: str, note: str, by_name: str) -> dict[str, Any]:
    with platform_context():
        r = DemoRequest.objects.filter(id=request_id).first()
        if r is None:
            raise DemoRejected("not_found", 404)
        note = note.strip()[:1000]
        if status and status != r.status:
            if status not in TRANSITIONS[DemoRequest.Status(r.status)]:
                raise DemoRejected("bad_transition", 409)
            if status in {DemoRequest.Status.CONVERTED, DemoRequest.Status.CLOSED} and not note:
                raise DemoRejected("note_required")
            r.status = status
        elif not note:
            raise DemoRejected("nothing_to_change")
        if note:
            r.note = note
        r.handled_at = timezone.now()
        r.handled_by_name = by_name
        r.save(update_fields=["status", "note", "handled_at", "handled_by_name"])
        return _row(r)
