"""حدود الطول والقيمة للكتالوج (معيار §١٨ ACC-25): تُرفض بنص كامل لا بقطع ولا overflow.

المكان الوحيد للأرقام؛ الواجهة تقرؤها من استجابة الرفض (`limit`/`actual`) لا من ثوابت مكرّرة.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.money import INT64_MAX

NAME_MAX_LEN = 200
BARCODE_MAX_LEN = 64
ALIAS_MAX_LEN = 120
#: سعر البيع بالوحدة الصغرى: دون سقف BIGINT بهامش يحفظ ضرب الكمية × السعر (§٦.١)
PRICE_MAX_MINOR = 10**15
#: معامل التحويل بالميلي: مليون وحدة أساسية في الوحدة البديلة الواحدة على الأكثر
FACTOR_MAX_MILLI = 10**9
FACTOR_MIN_MILLI = 1
#: صورة الصنف كـdata URL — الحدّ معلن قبل الرفع لا بعده
IMAGE_MAX_BYTES = 2 * 1024 * 1024

assert PRICE_MAX_MINOR < INT64_MAX


@dataclass(frozen=True)
class FieldError:
    """خطأ حقل واحد برمزه وحدّه وقيمته الفعلية — الواجهة تصوغه نصاً كاملاً (C-FIELD)."""

    field: str
    code: str
    limit: int | str | None = None
    actual: int | str | None = None
    extra: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"field": self.field, "code": self.code}
        if self.limit is not None:
            d["limit"] = self.limit
        if self.actual is not None:
            d["actual"] = self.actual
        if self.extra:
            d.update(self.extra)
        return d


class Rejected(Exception):
    """رفض مضبوط: كل الأخطاء معاً («خطآن يمنعان الحفظ») لا أول خطأ فقط."""

    def __init__(self, errors: list[FieldError]) -> None:
        super().__init__(", ".join(f"{e.field}:{e.code}" for e in errors))
        self.errors = errors

    def as_response(self) -> dict[str, Any]:
        return {"detail": "validation_error", "errors": [e.as_dict() for e in self.errors]}


def check_text(field: str, value: str, max_len: int, *, required: bool) -> list[FieldError]:
    v = value.strip()
    if required and not v:
        return [FieldError(field, "required")]
    if len(v) > max_len:
        return [FieldError(field, "too_long", limit=max_len, actual=len(v))]
    return []


def check_integer(field: str, value: Any, lo: int, hi: int) -> list[FieldError]:
    """قيمة صحيحة ضمن [lo, hi]؛ السلسلة القانونية أو العدد الصحيح — لا float."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return [FieldError(field, "not_a_number")]
    if isinstance(value, str):
        if len(value) > 20 or not value.lstrip("-").isdigit():
            return [FieldError(field, "not_a_number")]
        value = int(value)
    if value < lo or value > hi:
        return [FieldError(field, "out_of_range", limit=hi if value > hi else lo, actual=value)]
    return []
