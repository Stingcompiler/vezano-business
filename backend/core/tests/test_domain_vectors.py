"""يشغّل qty/ledger/effects/shift vectors على النظير Python — نفس النتائج على الطرفين (§٤.٤)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from core.effects import (
    LineInput,
    OperationEffects,
    ReceiptLineInput,
    Refund,
    ReturnLineInput,
    Settlement,
    compute_payment_effects,
    compute_receipt_effects,
    compute_return_effects,
    compute_sale_effects,
    compute_supplier_return_effects,
)
from core.ledger import (
    AccountKey,
    LedgerEntry,
    balance_minor,
    balance_status,
    balances_by_account,
)
from core.money import DomainError
from core.quantities import (
    UnitFactor,
    format_qty_string,
    parse_qty_string,
    parse_unit_factor,
    to_base_qty_milli,
)
from core.shift import CashTotals, expected_cash_minor, variance_minor

VECTORS = Path(__file__).resolve().parents[3] / "packages" / "domain" / "vectors"


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((VECTORS / f"{name}.json").read_text(encoding="utf-8"))
    return data


def error_code(fn: Callable[[], object]) -> str:
    try:
        fn()
    except DomainError as e:
        return e.code
    return "no_error"


def factor(f: list[str]) -> UnitFactor:
    return parse_unit_factor(f[0], f[1])


def serialize(e: OperationEffects) -> dict[str, Any]:
    return {
        "total": str(e.total_minor),
        "stock": [{"item": s.item_id, "delta": str(s.delta_base_qty_milli)} for s in e.stock],
        "quarantine": [
            {"item": s.item_id, "delta": str(s.delta_base_qty_milli)} for s in e.quarantine
        ],
        "cash": str(e.cash_minor),
        "bank_recorded": str(e.bank_recorded_minor),
        "ledger": (
            {
                "party": e.ledger.party_id,
                "role": e.ledger.role,
                "direction": e.ledger.direction,
                "amount": str(e.ledger.amount_minor),
            }
            if e.ledger
            else None
        ),
    }


QTY = load("qty")
LEDGER = load("ledger")
EFFECTS = load("effects")
SHIFT = load("shift")


@pytest.mark.parametrize("c", QTY["parse"], ids=lambda c: repr(c["input"]))
def test_qty_parse(c: dict[str, Any]) -> None:
    if "error" in c:
        assert error_code(lambda: parse_qty_string(c["input"])) == c["error"]
    else:
        assert str(parse_qty_string(c["input"])) == c["milli"]


@pytest.mark.parametrize("c", QTY["format"], ids=lambda c: f"{c['milli']}@{c['decimal_places']}")
def test_qty_format(c: dict[str, Any]) -> None:
    def run() -> str:
        return format_qty_string(int(c["milli"]), c["decimal_places"])

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        assert run() == c["output"]


@pytest.mark.parametrize("c", QTY["unit_factor"], ids=lambda c: f"{c['num']}/{c['den']}")
def test_unit_factor(c: dict[str, Any]) -> None:
    if "error" in c:
        assert error_code(lambda: parse_unit_factor(c["num"], c["den"])) == c["error"]
    else:
        assert parse_unit_factor(c["num"], c["den"]) == UnitFactor(int(c["num"]), int(c["den"]))


@pytest.mark.parametrize("c", QTY["to_base"], ids=lambda c: f"{c['qty_milli']}x{c['factor']}")
def test_to_base(c: dict[str, Any]) -> None:
    def run() -> int:
        return to_base_qty_milli(int(c["qty_milli"]), factor(c["factor"]))

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        assert str(run()) == c["base_milli"]


def test_sum_weights_exact() -> None:
    assert (
        str(sum(int(q) for q in QTY["sum_weights"]["qty_milli"]))
        == QTY["sum_weights"]["total_milli"]
    )


@pytest.mark.parametrize("c", LEDGER["balances"], ids=lambda c: c.get("note", "case")[:30])
def test_ledger_balance(c: dict[str, Any]) -> None:
    entries = [LedgerEntry(e["direction"], int(e["amount"])) for e in c["entries"]]
    if "error" in c:
        assert error_code(lambda: balance_minor(entries)) == c["error"]
    else:
        b = balance_minor(entries)
        assert str(b) == c["balance"]
        assert balance_status(b) == c["status"]


def test_ledger_by_account_no_netting() -> None:
    v = LEDGER["by_account"]
    entries = [
        (
            AccountKey(e["party"], e["role"], e["currency"]),
            LedgerEntry(e["direction"], int(e["amount"])),
        )
        for e in v["entries"]
    ]
    assert {k: str(b) for k, b in balances_by_account(entries).items()} == v["balances"]


def run_effect(c: dict[str, Any]) -> OperationEffects:
    def lines(ls: list[dict[str, Any]]) -> list[LineInput]:
        return [
            LineInput(
                x["item"], int(x["qty_milli"]), int(x["unit_price_minor"]), factor(x["factor"])
            )
            for x in ls
        ]

    def rlines(ls: list[dict[str, Any]]) -> list[ReceiptLineInput]:
        return [ReceiptLineInput(x["item"], int(x["qty_milli"]), factor(x["factor"])) for x in ls]

    kind = c["kind"]
    if kind == "sale":
        s = c["settlement"]
        return compute_sale_effects(
            lines(c["lines"]),
            Settlement(int(s["cash"]), int(s["bank"]), int(s["credit"])),
            c["party"],
        )
    if kind == "payment":
        return compute_payment_effects(c["party"], c["role"], int(c["amount"]), c["method"])
    if kind == "return":
        r = c["refund"]
        return compute_return_effects(
            [
                ReturnLineInput(
                    x["item"],
                    int(x["qty_milli"]),
                    int(x["unit_price_minor"]),
                    factor(x["factor"]),
                    x["condition"],
                )
                for x in c["lines"]
            ],
            Refund(int(r["cash"]), int(r["bank"]), int(r["credit_reduction"])),
            c["party"],
        )
    if kind == "receipt":
        value = None if c["value"] is None else int(c["value"])
        return compute_receipt_effects(rlines(c["lines"]), value, int(c["paid_cash"]), c["party"])
    if kind == "supplier_return":
        return compute_supplier_return_effects(rlines(c["lines"]), int(c["refund_cash"]))
    raise AssertionError(f"unknown kind {kind}")


@pytest.mark.parametrize("c", EFFECTS["cases"], ids=lambda c: c["id"])
def test_effects(c: dict[str, Any]) -> None:
    if "error" in c:
        assert error_code(lambda: run_effect(c)) == c["error"]
    else:
        assert serialize(run_effect(c)) == c["expect"]


def test_full_return_restores_initial_state() -> None:
    cases = {c["id"]: c for c in EFFECTS["cases"]}
    a = run_effect(cases["cash_sale_100"])
    b = run_effect(cases["full_return_good_cash"])
    assert a.cash_minor + b.cash_minor == 0
    assert a.stock[0].delta_base_qty_milli + b.stock[0].delta_base_qty_milli == 0
    assert a.ledger is None and b.ledger is None


@pytest.mark.parametrize("c", SHIFT["expected"], ids=lambda c: c.get("note", "case")[:30])
def test_shift_expected(c: dict[str, Any]) -> None:
    def run() -> int:
        return expected_cash_minor(
            CashTotals(
                int(c["opening"]),
                int(c["cash_sales"]),
                int(c["cash_debt_receipts"]),
                int(c["cash_deposits"]),
                int(c["cash_refunds"]),
                int(c["cash_withdrawals"]),
            )
        )

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        assert str(run()) == c["expected"]


@pytest.mark.parametrize(
    "c", SHIFT["variance"], ids=lambda c: c.get("note", str(c["counted"]))[:30]
)
def test_shift_variance(c: dict[str, Any]) -> None:
    def run() -> int | None:
        counted = None if c["counted"] is None else int(c["counted"])
        return variance_minor(counted, int(c["expected"]))

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        r = run()
        assert (None if r is None else str(r)) == c["variance"]
