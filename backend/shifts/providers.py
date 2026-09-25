"""مساهمات الورديات: مُطبِّقات الإسقاط في PUSH، ومزوّد الرئيسية (وردية مفتوحة منذ …)."""

from __future__ import annotations

from typing import Any

from django.utils import timezone

from core import home
from core.shift import expected_cash_minor
from shifts.models import Shift
from shifts.services import (
    _iso,
    apply_cash_adjustment,
    apply_cash_counted,
    apply_cash_movement,
    apply_shift_closed,
    apply_shift_opened,
    cash_totals,
)
from sync.appliers import register_applier

register_applier("shifts.ShiftOpened", apply_shift_opened)
register_applier("shifts.CashMovement", apply_cash_movement)
register_applier("shifts.CashCounted", apply_cash_counted)
register_applier("shifts.ShiftClosed", apply_shift_closed)
register_applier("shifts.CashAdjustment", apply_cash_adjustment)


def _home_shift(viewer: home.Viewer, out: dict[str, Any]) -> None:
    """HOME-01/02: الوردية المفتوحة في فرع المشاهد (أو أول فرع) — «وردية مفتوحة منذ 08:00»."""
    qs = Shift.objects.filter(state="open").select_related("branch").order_by("opened_at")
    if viewer.branch is not None:
        qs = qs.filter(branch=viewer.branch)
    shift = qs.first()
    if shift is None:
        return
    out["shift"] = {
        "id": str(shift.id),
        "open_since": _iso(shift.opened_at),
        "user_name": shift.user_name,
        "device_name": shift.device_name,
        "branch_name": shift.branch.name,
    }


def _home_cash(viewer: home.Viewer, out: dict[str, Any]) -> None:
    """HOME-01 «نقد الصناديق»: المتوقع في درج كل وردية مفتوحة — «قبل العدّ».

    0005 §١٢٨: كانت الملاحظة «متوقع لا معدود»."""
    if not viewer.can_see_finance:
        return
    qs = Shift.objects.filter(state="open")
    if viewer.branch is not None:
        qs = qs.filter(branch=viewer.branch)
    shifts = list(qs)
    if not shifts:
        return
    total = sum(expected_cash_minor(cash_totals(sh)) for sh in shifts)
    out["kpis"].append(
        {
            "key": "cash",
            "label": "نقد الصناديق",
            "value": {"kind": "money", "amount_minor": str(total), "exponent": 2},
            "scope": f"{len(shifts)} ورديات مفتوحة" if len(shifts) > 1 else "وردية مفتوحة",
            "note": "المتوقَّع قبل العدّ",
            "note_kind": "warn",
            "as_of": timezone.now().isoformat().replace("+00:00", "Z"),
            "href": "/shifts/current",
        }
    )


def _home_decisions(viewer: home.Viewer, out: dict[str, Any]) -> None:
    """«قرارات تنتظرك»: وردية مهجورة تُقفل بعدّ حاضر، وفروق ورديات الأسبوع بلا اعتماد."""
    if not viewer.can_see_finance:
        return
    from shifts.services import REVIEW_WINDOW, review_rows

    branch_id = None if viewer.is_owner or viewer.branch is None else viewer.branch.id
    rows = review_rows(branch_id)
    for r in rows:
        if r["state"] == "open" and r["abandoned"]:
            out["decisions"].append(
                {
                    "id": f"shift-abandoned:{r['id']}",
                    "title": f"وردية {r['user_name']} مفتوحة منذ {r['open_hours']} ساعة",
                    "detail": f"{r['branch_name']} · تُقفل بعدّ حاضر",
                    "action": "افتح الإقفال",
                    "href": "/shifts/review",
                    "severity": "danger",
                }
            )
    pending = [
        r
        for r in rows
        if r["state"] == "closed" and r["variance_minor"] not in ("", "0") and r["review"] is None
    ]
    if pending:
        worst = max(pending, key=lambda r: abs(int(r["variance_minor"])))
        v = int(worst["variance_minor"])
        days = REVIEW_WINDOW.days
        out["decisions"].append(
            {
                "id": "shift-variances",
                "title": home.counted(
                    len(pending),
                    "وردية بفرق لم يُعتمد",
                    "ورديتان بفرق لم يُعتمد",
                    "ورديات بفرق لم يُعتمد",
                    "وردية بفرق لم يُعتمد",
                )
                + f" خلال {days} أيام",
                "detail": (
                    f"أكبرها {'عجز' if v < 0 else 'زيادة'} {home.money_short(abs(v))}"
                    f" · {worst['branch_name']}"
                ),
                "action": "راجع الفروق",
                "href": "/shifts/review",
                "severity": "warn",
            }
        )


home.HOME_PROVIDERS.append(_home_shift)
home.HOME_PROVIDERS.append(_home_cash)
home.HOME_PROVIDERS.append(_home_decisions)
