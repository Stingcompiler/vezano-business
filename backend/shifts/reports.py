"""REP-04 — تقرير الصندوق والورديات (36-D28؛ 16-D11 stale؛ §١٠.٣، §٧.٧؛ SHIFT-05): لكل وردية
مغلقة المتوقَّع والمعدود والفارق ومن عدّ؛ الفوارق مجموعةٌ في الأعلى. المفتوحة لا تدخل — وردية بلا
عدّ ليس لها فارق. حالته الفريدة `conflict`: وردية أُقفلت على جهازين بمبلغين — لا نجمع ولا نرجّح؛
تُعرض النسختان وتُحال إلى SYS-03 ويُستثنى الصفّ من المجموع ويُقال ذلك. يطابق SHIFT-02/05."""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta
from typing import Any

from django.db.models import Max
from django.utils import timezone

from core import home
from core.models import Branch
from sales.reports import Range, _completeness
from shifts.models import Shift
from shifts.services import ABANDONED_AFTER, _iso, _variance
from sync.models import QuarantinedOperation
from sync.review import _device_name, _head, _members, _user_name


def _bounds(rng: Range) -> tuple[datetime, datetime]:
    tz = timezone.get_current_timezone()
    return (
        datetime.combine(rng.start, time.min, tzinfo=tz),
        datetime.combine(rng.end + timedelta(days=1), time.min, tzinfo=tz),
    )


def _second_closes() -> dict[uuid.UUID, dict[str, Any]]:
    """الإقفالات المحجورة `shift_closed_twice` غير المحسومة: النسخة الثانية لكل وردية."""
    out: dict[uuid.UUID, dict[str, Any]] = {}
    qs = QuarantinedOperation.objects.filter(
        reason=QuarantinedOperation.Reason.CONFLICTED,
        code="shift_closed_twice",
        reviewed_at__isnull=True,
    ).order_by("received_at")
    for q in qs:
        members = _members(q.original)
        closed = _head(members, "shifts.ShiftClosed")
        counted = _head(members, "shifts.CashCounted")
        try:
            sid = uuid.UUID(str(closed.get("shift_id")))
        except ValueError:
            continue
        actor = _user_name(q.actor_user)
        if not actor and counted.get("actor_user_id"):
            try:
                actor = _user_name(uuid.UUID(str(counted["actor_user_id"])))
            except ValueError:
                actor = ""
        out[sid] = {
            "quarantine_id": str(q.id),
            "device_name": _device_name(q.device),
            "counted_by_name": actor,
            "counted_cash_minor": str(counted.get("counted_cash_minor", "")) if counted else "",
            "expected_cash_at_close_minor": str(closed.get("expected_cash_at_close_minor", "")),
            "occurred_at": str(closed.get("occurred_at", "")),
            "received_at": _iso(q.received_at),
        }
    return out


def cash_report(*, viewer: home.Viewer, rng: Range, branch_id: Any = None) -> dict[str, Any]:
    start, end = _bounds(rng)
    branch_ids: list[uuid.UUID] | None
    if viewer.is_owner:
        branch_ids = None
        if branch_id:
            try:
                branch_ids = [uuid.UUID(str(branch_id))]
            except ValueError:
                branch_ids = None
    else:
        branch_ids = [viewer.branch.id] if viewer.branch else []
    closed = Shift.objects.filter(state="closed", closed_at__gte=start, closed_at__lt=end)
    open_qs = Shift.objects.filter(state="open")
    if branch_ids is not None:
        closed = closed.filter(branch_id__in=branch_ids)
        open_qs = open_qs.filter(branch_id__in=branch_ids)
    seconds = _second_closes()
    now = timezone.now()
    rows: list[dict[str, Any]] = []
    for s in closed.select_related("branch").order_by("-closed_at"):
        v = _variance(s)
        second = seconds.get(s.id)
        latest = s.adjustments.order_by("-occurred_at").first()
        rows.append(
            {
                "id": str(s.id),
                "branch_name": s.branch.name,
                "device_name": s.device_name,
                "user_name": s.user_name,
                "opened_at": _iso(s.opened_at),
                "closed_at": _iso(s.closed_at),
                "count_status": s.count_status,
                "expected_cash_at_close_minor": str(s.expected_cash_at_close_minor)
                if s.expected_cash_at_close_minor is not None
                else "",
                "counted_cash_minor": str(s.counted_cash_minor)
                if s.counted_cash_minor is not None
                else "",
                "counted_by_name": s.counted_by_name,
                "witness_name": s.witness_name,
                "variance_minor": str(v) if v is not None else "",
                "reviewed": latest is not None,
                "reviewed_by_name": latest.approved_by_name if latest else "",
                "conflict": second,
            }
        )
    counted_rows = [r for r in rows if r["variance_minor"] != "" and r["conflict"] is None]
    total_variance = sum(int(r["variance_minor"]) for r in counted_rows)
    over = sum(int(r["variance_minor"]) for r in counted_rows if int(r["variance_minor"]) > 0)
    short = sum(int(r["variance_minor"]) for r in counted_rows if int(r["variance_minor"]) < 0)
    unreviewed = [
        r for r in counted_rows if r["variance_minor"] not in ("", "0") and not r["reviewed"]
    ]
    open_rows = [
        {
            "id": str(s.id),
            "branch_name": s.branch.name,
            "user_name": s.user_name,
            "opened_at": _iso(s.opened_at),
            "open_hours": int((now - s.opened_at).total_seconds() // 3600),
            "abandoned": (now - s.opened_at) >= ABANDONED_AFTER,
        }
        for s in open_qs.select_related("branch").order_by("opened_at")
    ]
    last_closed = Shift.objects.filter(
        state="closed", **({"branch_id__in": branch_ids} if branch_ids is not None else {})
    ).aggregate(m=Max("closed_at"))["m"]
    return {
        "scope": "all" if branch_ids is None else "branch",
        "branch_name": viewer.branch.name if viewer.branch else "",
        "can_all_branches": viewer.is_owner,
        "range": {
            "key": rng.key,
            "start": rng.start.isoformat(),
            "end": rng.end.isoformat(),
            "label": rng.label,
        },
        "rows": rows,
        "totals": {
            "shifts": len(rows),
            "counted": len(counted_rows),
            "not_counted": sum(1 for r in rows if r["count_status"] == "not_counted"),
            "variance_minor": str(total_variance),
            "over_minor": str(over),
            "short_minor": str(short),
            "unreviewed_variances": len(unreviewed),
            "excluded_conflicts": sum(1 for r in rows if r["conflict"] is not None),
        },
        "open_shifts": open_rows,
        "completeness": _completeness(branch_ids),
        "branches": [{"id": str(b.id), "name": b.name} for b in Branch.objects.order_by("name")]
        if viewer.is_owner
        else [],
        "computed_at": _iso(now),
        "last_closed_date": timezone.localtime(last_closed).date().isoformat()
        if last_closed
        else "",
    }


def export_csv(payload: dict[str, Any]) -> str:
    t = payload["totals"]
    head = (
        f"# تقرير الصندوق والورديات · {payload['range']['label']} · "
        f"حُسب في {payload['computed_at']} · "
        f"الفارق {t['variance_minor']} · خارج المجموع {t['excluded_conflicts']}"
    )
    lines = [
        head,
        "closed_at,branch,user,expected_minor,counted_minor,variance_minor,counted_by,conflict",
    ]
    for r in payload["rows"]:
        lines.append(
            ",".join(
                [
                    r["closed_at"],
                    str(r["branch_name"]).replace(",", " "),
                    str(r["user_name"]).replace(",", " "),
                    r["expected_cash_at_close_minor"],
                    r["counted_cash_minor"],
                    r["variance_minor"],
                    str(r["counted_by_name"]).replace(",", " "),
                    "1" if r["conflict"] else "",
                ]
            )
        )
    return "\n".join(lines) + "\n"
