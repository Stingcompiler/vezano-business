"""يشغّل packages/domain/vectors/money.json على النظير Python — نفس النتائج على الطرفين (§٤.٤)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from core.money import (
    DomainError,
    format_integer_string,
    invoice_total_minor,
    line_total_minor,
    parse_exchange_rate,
    parse_integer_string,
    parse_unsigned_string,
    round_half_away_div,
)

VECTORS = Path(__file__).resolve().parents[3] / "packages" / "domain" / "vectors" / "money.json"
V: dict[str, Any] = json.loads(VECTORS.read_text(encoding="utf-8"))


def error_code(fn: Callable[[], object]) -> str:
    try:
        fn()
    except DomainError as e:
        return e.code
    return "no_error"


@pytest.mark.parametrize("c", V["integer_strings"], ids=lambda c: repr(c["input"]))
def test_integer_strings(c: dict[str, Any]) -> None:
    if c["valid"]:
        assert format_integer_string(parse_integer_string(c["input"])) == c["value"]
    else:
        assert error_code(lambda: parse_integer_string(c["input"])) == c["error"]


@pytest.mark.parametrize("c", V["unsigned_strings"], ids=lambda c: repr(c["input"]))
def test_unsigned_strings(c: dict[str, Any]) -> None:
    if c["valid"]:
        assert format_integer_string(parse_unsigned_string(c["input"])) == c["value"]
    else:
        assert error_code(lambda: parse_unsigned_string(c["input"])) == c["error"]


@pytest.mark.parametrize("c", V["exchange_rates"], ids=lambda c: repr(c["input"]))
def test_exchange_rates(c: dict[str, Any]) -> None:
    if c["valid"]:
        assert str(parse_exchange_rate(c["input"])) == c["scaled"]
    else:
        assert error_code(lambda: parse_exchange_rate(c["input"])) == c["error"]


@pytest.mark.parametrize(
    "c", V["round_half_away_div"], ids=lambda c: f"{c['numerator']}/{c['denominator']}"
)
def test_round_half_away_div(c: dict[str, Any]) -> None:
    def run() -> int:
        return round_half_away_div(int(c["numerator"]), int(c["denominator"]))

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        assert str(run()) == c["result"]


@pytest.mark.parametrize(
    "c", V["line_totals"], ids=lambda c: f"{c['qty_milli']}x{c['unit_price_minor']}"
)
def test_line_totals(c: dict[str, Any]) -> None:
    def run() -> int:
        return line_total_minor(int(c["qty_milli"]), int(c["unit_price_minor"]))

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        assert str(run()) == c["line_total_minor"]


@pytest.mark.parametrize("c", V["invoice_totals"], ids=lambda c: c.get("note", "case")[:30])
def test_invoice_totals(c: dict[str, Any]) -> None:
    def run() -> int:
        return invoice_total_minor(line_total_minor(int(q), int(p)) for q, p in c["lines"])

    if "error" in c:
        assert error_code(run) == c["error"]
    else:
        assert str(run()) == c["invoice_total_minor"]


def test_plain_number_rejected() -> None:
    assert error_code(lambda: parse_integer_string(125000)) == "invalid_integer"
    assert error_code(lambda: parse_exchange_rate(1)) == "invalid_exchange_rate"
