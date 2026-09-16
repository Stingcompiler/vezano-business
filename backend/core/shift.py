"""الوردية والصندوق — §١٠.٣ — النظير الخادمي لـ packages/domain/src/shift.ts."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from core.money import DomainError, assert_int64


@dataclass(frozen=True)
class CashTotals:
    opening_float_minor: int
    cash_sales_minor: int
    cash_debt_receipts_minor: int
    cash_deposits_minor: int
    cash_refunds_minor: int
    cash_withdrawals_minor: int


def expected_cash_minor(t: CashTotals) -> int:
    for k, v in asdict(t).items():
        if v < 0:
            raise DomainError("negative_amount", k)
        assert_int64(v, k)
    return assert_int64(
        t.opening_float_minor
        + t.cash_sales_minor
        + t.cash_debt_receipts_minor
        + t.cash_deposits_minor
        - t.cash_refunds_minor
        - t.cash_withdrawals_minor,
        "expected_cash",
    )


def variance_minor(counted_cash_minor: int | None, expected_cash_at_close_minor: int) -> int | None:
    """None يعني «بلا عدّ — غير معروف» ولا يُعرض صفراً (معيار §١٨ ACC-67)."""
    if counted_cash_minor is None:
        return None
    if counted_cash_minor < 0:
        raise DomainError("negative_amount", "counted_cash")
    return assert_int64(counted_cash_minor - expected_cash_at_close_minor, "variance")
