"""دفتر حسابات الأطراف — §٧.١ — النظير الخادمي لـ packages/domain/src/ledger.ts."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from core.money import DomainError, assert_int64

AccountRole = Literal["customer", "supplier"]
Direction = Literal["debit", "credit"]
BalanceStatus = Literal["owes_us", "we_owe", "settled"]


@dataclass(frozen=True)
class LedgerEntry:
    direction: Direction
    amount_minor: int


@dataclass(frozen=True)
class AccountKey:
    party_id: str
    role: AccountRole
    currency: str

    def __str__(self) -> str:
        return f"{self.party_id}|{self.role}|{self.currency}"


def balance_minor(entries: Iterable[LedgerEntry]) -> int:
    balance = 0
    for e in entries:
        if e.amount_minor <= 0:
            raise DomainError("invalid_ledger_amount", str(e.amount_minor))
        assert_int64(e.amount_minor, "amount_minor")
        delta = e.amount_minor if e.direction == "debit" else -e.amount_minor
        balance = assert_int64(balance + delta, "balance")
    return balance


def balance_status(balance: int) -> BalanceStatus:
    if balance > 0:
        return "owes_us"
    if balance < 0:
        return "we_owe"
    return "settled"


def balances_by_account(entries: Iterable[tuple[AccountKey, LedgerEntry]]) -> dict[str, int]:
    groups: dict[str, list[LedgerEntry]] = {}
    for key, entry in entries:
        groups.setdefault(str(key), []).append(entry)
    return {k: balance_minor(v) for k, v in groups.items()}
