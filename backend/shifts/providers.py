"""مساهمات الورديات: مُطبِّقات الإسقاط في PUSH، ومزوّد الرئيسية (وردية مفتوحة منذ …)."""

from __future__ import annotations

from typing import Any

from core import home
from shifts.models import Shift
from shifts.services import (
    _iso,
    apply_cash_adjustment,
    apply_cash_counted,
    apply_cash_movement,
    apply_shift_closed,
    apply_shift_opened,
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


home.HOME_PROVIDERS.append(_home_shift)
