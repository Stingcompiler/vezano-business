"""الكميات والوحدات — §٦.٢ — النظير الخادمي لـ packages/domain/src/quantities.ts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from core.money import (
    QTY_SCALE,
    DomainError,
    assert_int64,
    parse_unsigned_string,
    round_half_away_div,
)

QTY_DECIMALS = 3
DecimalPlaces = Literal[0, 1, 2, 3]
_QTY_STRING = re.compile(r"^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$")


@dataclass(frozen=True)
class UnitFactor:
    """عدد وحدات المخزون الأساسية في وحدة بديلة واحدة — نسبة موجبة num/den."""

    num: int
    den: int


def parse_unit_factor(num: str, den: str = "1") -> UnitFactor:
    n = parse_unsigned_string(num)
    d = parse_unsigned_string(den)
    if n == 0 or d == 0:
        raise DomainError("invalid_unit_factor", f"{num}/{den}")
    return UnitFactor(n, d)


def parse_qty_string(value: object) -> int:
    if not isinstance(value, str):
        raise DomainError("invalid_quantity", "not a string")
    if not _QTY_STRING.fullmatch(value):
        raise DomainError("invalid_quantity", value)
    whole, _, frac = value.partition(".")
    return assert_int64(int(whole) * QTY_SCALE + int(frac.ljust(QTY_DECIMALS, "0") or "0"))


def assert_qty_precision(qty_milli: int, decimal_places: DecimalPlaces) -> int:
    step = 10 ** (QTY_DECIMALS - decimal_places)
    if qty_milli % step != 0:
        raise DomainError("invalid_precision", f"{qty_milli} @ {decimal_places}")
    return qty_milli


def format_qty_string(qty_milli: int, decimal_places: DecimalPlaces) -> str:
    assert_qty_precision(qty_milli, decimal_places)
    negative = qty_milli < 0
    abs_qty = -qty_milli if negative else qty_milli
    whole, frac_int = divmod(abs_qty, QTY_SCALE)
    frac = str(frac_int).rjust(QTY_DECIMALS, "0")[:decimal_places]
    return f"{'-' if negative else ''}{whole}{'.' + frac if decimal_places > 0 else ''}"


def to_base_qty_milli(qty_milli: int, factor: UnitFactor) -> int:
    """base = qty × num / den — يجب أن تكون دقيقة بثلاث منازل وإلا inexact_quantity."""
    assert_int64(qty_milli, "qty_milli")
    scaled = qty_milli * factor.num
    if scaled % factor.den != 0:
        raise DomainError("inexact_quantity", f"{qty_milli} × {factor.num}/{factor.den}")
    return assert_int64(scaled // factor.den, "base_qty_milli")


def from_base_qty_milli_for_display(base_milli: int, factor: UnitFactor) -> int:
    """كمية بالوحدة الأساسية → بالوحدة البديلة للعرض فقط: base × den / num مقرَّبة بالنصف بعيداً
    عن الصفر إلى ثلاث منازل (CAT-03 «أمثلة محسوبة»). لا تُستعمل في حدث أو رصيد."""
    assert_int64(base_milli, "base_qty_milli")
    return assert_int64(round_half_away_div(base_milli * factor.den, factor.num), "unit_qty_milli")
