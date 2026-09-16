"""المال والأعداد والتقريب — §٦.١ و§٦.٢ — النظير الخادمي لـ packages/domain/src/money.ts.

نفس القواعد حرفاً: سلاسل قانونية، BIGINT (int64)، تقريب النصف بعيداً عن الصفر بقسمة صحيحة.
يثبت التطابق ملف packages/domain/vectors/money.json عبر core/tests/test_money_vectors.py.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Literal

DomainErrorCode = Literal[
    "invalid_integer",
    "invalid_unsigned",
    "invalid_exchange_rate",
    "out_of_range",
    "too_long",
    "division_by_zero",
    "invalid_quantity",
    "invalid_precision",
    "inexact_quantity",
    "invalid_unit_factor",
    "invalid_ledger_amount",
    "negative_amount",
    "settlement_mismatch",
    "party_required",
    "value_required",
    "empty_operation",
]


class DomainError(ValueError):
    """خطأ مجال: الرمز للبرمجة والاختبار؛ نص الواجهة من الإطار المرسوم لا من هنا."""

    def __init__(self, code: DomainErrorCode, detail: str | None = None) -> None:
        self.code: DomainErrorCode = code
        self.detail = detail
        super().__init__(f"{code}: {detail}" if detail else code)


INTEGER_STRING = re.compile(r"^(0|[1-9][0-9]*|-[1-9][0-9]*)$")
UNSIGNED_STRING = re.compile(r"^(0|[1-9][0-9]*)$")
EXCHANGE_RATE_STRING = re.compile(r"^(?:0|[1-9][0-9]*)\.[0-9]{8}$")

INT64_MIN = -(2**63)
INT64_MAX = 2**63 - 1
MAX_INTEGER_STRING_LENGTH = 20
QTY_SCALE = 1000
EXCHANGE_RATE_SCALE = 100_000_000


def assert_int64(value: int, what: str = "value") -> int:
    if value < INT64_MIN or value > INT64_MAX:
        raise DomainError("out_of_range", what)
    return value


def parse_integer_string(value: object) -> int:
    """يقبل سلسلة قانونية فقط؛ العدد العادي بدل السلسلة مرفوض (§٦.١)."""
    if not isinstance(value, str):
        raise DomainError("invalid_integer", "not a string")
    if len(value) > MAX_INTEGER_STRING_LENGTH:
        raise DomainError("too_long", str(len(value)))
    if not INTEGER_STRING.fullmatch(value):
        raise DomainError("invalid_integer", value)
    return assert_int64(int(value))


def parse_unsigned_string(value: object) -> int:
    if not isinstance(value, str):
        raise DomainError("invalid_unsigned", "not a string")
    if len(value) > MAX_INTEGER_STRING_LENGTH:
        raise DomainError("too_long", str(len(value)))
    if not UNSIGNED_STRING.fullmatch(value):
        raise DomainError("invalid_unsigned", value)
    return assert_int64(int(value))


def format_integer_string(value: int) -> str:
    return str(assert_int64(value))


def parse_exchange_rate(value: object) -> int:
    """سعر الصرف بمقياس 10^8؛ ثمانية منازل بالضبط وقيمة > 0."""
    if not isinstance(value, str):
        raise DomainError("invalid_exchange_rate", "not a string")
    if not EXCHANGE_RATE_STRING.fullmatch(value):
        raise DomainError("invalid_exchange_rate", value)
    whole, frac = value.split(".")
    scaled = int(whole) * EXCHANGE_RATE_SCALE + int(frac)
    if scaled <= 0:
        raise DomainError("invalid_exchange_rate", "must be > 0")
    return assert_int64(scaled, "exchange_rate")


def round_half_away_div(numerator: int, denominator: int) -> int:
    """قسمة صحيحة بتقريب النصف بعيداً عن الصفر — لا float (§٦.٢)."""
    if denominator == 0:
        raise DomainError("division_by_zero")
    if denominator < 0:
        numerator, denominator = -numerator, -denominator
    negative = numerator < 0
    abs_num = -numerator if negative else numerator
    quotient, remainder = divmod(abs_num, denominator)
    rounded = quotient + 1 if remainder * 2 >= denominator else quotient
    return -rounded if negative else rounded


def line_total_minor(qty_milli: int, unit_price_minor: int) -> int:
    """line_total_minor = round_half_away(qty_milli × unit_price_minor / 1000)."""
    assert_int64(qty_milli, "qty_milli")
    assert_int64(unit_price_minor, "unit_price_minor")
    return assert_int64(
        round_half_away_div(qty_milli * unit_price_minor, QTY_SCALE), "line_total_minor"
    )


def invoice_total_minor(line_totals: Iterable[int]) -> int:
    """مجموع السطور المقرَّبة — لا يُعاد تقريب مجموع غير مقرَّب (§٦.٢)."""
    total = 0
    for line in line_totals:
        assert_int64(line, "line_total_minor")
        total = assert_int64(total + line, "invoice_total_minor")
    return total
