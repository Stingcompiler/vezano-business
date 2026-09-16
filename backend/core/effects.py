"""آثار العمليات — §٧.٢ و§٧.٤ — النظير الخادمي لـ packages/domain/src/effects.ts."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from core.ledger import Direction
from core.money import DomainError, assert_int64, invoice_total_minor, line_total_minor
from core.quantities import UnitFactor, to_base_qty_milli

Role = Literal["customer", "supplier"]
PaymentMethod = Literal["cash", "bank"]
ReturnCondition = Literal["good", "damaged"]


@dataclass(frozen=True)
class LineInput:
    item_id: str
    qty_milli: int
    unit_price_minor: int
    unit_factor: UnitFactor


@dataclass(frozen=True)
class ReturnLineInput(LineInput):
    condition: ReturnCondition = "good"


@dataclass(frozen=True)
class ReceiptLineInput:
    item_id: str
    qty_milli: int
    unit_factor: UnitFactor


@dataclass(frozen=True)
class Settlement:
    cash_minor: int
    bank_minor: int
    credit_minor: int


@dataclass(frozen=True)
class Refund:
    cash_minor: int
    bank_minor: int
    credit_reduction_minor: int


@dataclass(frozen=True)
class StockEffect:
    item_id: str
    delta_base_qty_milli: int


@dataclass(frozen=True)
class LedgerEffect:
    party_id: str
    role: Role
    direction: Direction
    amount_minor: int


@dataclass(frozen=True)
class OperationEffects:
    total_minor: int
    stock: tuple[StockEffect, ...] = field(default_factory=tuple)
    quarantine: tuple[StockEffect, ...] = field(default_factory=tuple)
    cash_minor: int = 0
    bank_recorded_minor: int = 0
    ledger: LedgerEffect | None = None


def _non_negative(value: int, what: str) -> int:
    if value < 0:
        raise DomainError("negative_amount", what)
    return assert_int64(value, what)


def _line_totals(lines: Sequence[LineInput]) -> list[int]:
    out: list[int] = []
    for line in lines:
        if line.qty_milli <= 0:
            raise DomainError("invalid_quantity", line.item_id)
        out.append(line_total_minor(line.qty_milli, line.unit_price_minor))
    return out


def _stock(lines: Sequence[LineInput | ReceiptLineInput], sign: int) -> tuple[StockEffect, ...]:
    return tuple(
        StockEffect(line.item_id, sign * to_base_qty_milli(line.qty_milli, line.unit_factor))
        for line in lines
    )


def _assert_settlement(total: int, cash: int, bank: int, credit: int) -> None:
    _non_negative(cash, "cash")
    _non_negative(bank, "bank")
    _non_negative(credit, "credit")
    if cash + bank + credit != total:
        raise DomainError("settlement_mismatch", f"{cash}+{bank}+{credit}≠{total}")


def compute_sale_effects(
    lines: Sequence[LineInput], settlement: Settlement, party_id: str | None
) -> OperationEffects:
    if not lines:
        raise DomainError("empty_operation", "sale")
    total = invoice_total_minor(_line_totals(lines))
    _assert_settlement(total, settlement.cash_minor, settlement.bank_minor, settlement.credit_minor)
    if settlement.credit_minor > 0 and not party_id:
        raise DomainError("party_required", "credit")
    ledger = (
        LedgerEffect(party_id, "customer", "debit", settlement.credit_minor)
        if settlement.credit_minor > 0 and party_id
        else None
    )
    return OperationEffects(
        total_minor=total,
        stock=_stock(lines, -1),
        cash_minor=settlement.cash_minor,
        bank_recorded_minor=settlement.bank_minor,
        ledger=ledger,
    )


def compute_payment_effects(
    party_id: str, role: Role, amount_minor: int, method: PaymentMethod
) -> OperationEffects:
    if amount_minor <= 0:
        raise DomainError("invalid_ledger_amount", str(amount_minor))
    assert_int64(amount_minor, "amount_minor")
    inbound = role == "customer"
    signed = amount_minor if inbound else -amount_minor
    return OperationEffects(
        total_minor=amount_minor,
        cash_minor=signed if method == "cash" else 0,
        bank_recorded_minor=signed if method == "bank" else 0,
        ledger=LedgerEffect(party_id, role, "credit" if inbound else "debit", amount_minor),
    )


def compute_return_effects(
    lines: Sequence[ReturnLineInput], refund: Refund, party_id: str | None
) -> OperationEffects:
    if not lines:
        raise DomainError("empty_operation", "return")
    total = invoice_total_minor(_line_totals(lines))
    _assert_settlement(total, refund.cash_minor, refund.bank_minor, refund.credit_reduction_minor)
    if refund.credit_reduction_minor > 0 and not party_id:
        raise DomainError("party_required", "credit_reduction")
    good = [line for line in lines if line.condition == "good"]
    damaged = [line for line in lines if line.condition == "damaged"]
    ledger = (
        LedgerEffect(party_id, "customer", "credit", refund.credit_reduction_minor)
        if refund.credit_reduction_minor > 0 and party_id
        else None
    )
    return OperationEffects(
        total_minor=total,
        stock=_stock(good, 1),
        quarantine=_stock(damaged, 1),
        cash_minor=-refund.cash_minor,
        bank_recorded_minor=-refund.bank_minor,
        ledger=ledger,
    )


def compute_receipt_effects(
    lines: Sequence[ReceiptLineInput],
    value_minor: int | None,
    paid_cash_minor: int,
    supplier_id: str | None,
) -> OperationEffects:
    if not lines:
        raise DomainError("empty_operation", "receipt")
    _non_negative(paid_cash_minor, "paid_cash")
    for line in lines:
        if line.qty_milli <= 0:
            raise DomainError("invalid_quantity", line.item_id)
    stock = _stock(lines, 1)
    if value_minor is None:
        if paid_cash_minor > 0:
            raise DomainError("value_required", "paid without value")
        return OperationEffects(total_minor=0, stock=stock)
    _non_negative(value_minor, "value")
    if paid_cash_minor > value_minor:
        raise DomainError("settlement_mismatch", "paid > value")
    remaining = value_minor - paid_cash_minor
    if remaining > 0 and not supplier_id:
        raise DomainError("party_required", "supplier")
    ledger = (
        LedgerEffect(supplier_id, "supplier", "credit", remaining)
        if remaining > 0 and supplier_id
        else None
    )
    return OperationEffects(
        total_minor=value_minor, stock=stock, cash_minor=-paid_cash_minor, ledger=ledger
    )


def compute_supplier_return_effects(
    lines: Sequence[ReceiptLineInput], refund_cash_minor: int
) -> OperationEffects:
    if not lines:
        raise DomainError("empty_operation", "supplier_return")
    _non_negative(refund_cash_minor, "refund_cash")
    for line in lines:
        if line.qty_milli <= 0:
            raise DomainError("invalid_quantity", line.item_id)
    return OperationEffects(
        total_minor=refund_cash_minor, stock=_stock(lines, -1), cash_minor=refund_cash_minor
    )
