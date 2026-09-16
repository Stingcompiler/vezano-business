"""سجل أنواع العمليات (§٧.٣، §٨.٣): لكل `kind` أعضاؤه المطلوبة والاختيارية وحقوله القانونية وقواعد
اشتقاقه. «يتبع التحقق kind وop_version، ولا يفترض وجود قيد ذمة في كل بيع».

المرحلة ٠ تعرّف الأنواع اللازمة لبوابة الخروج؛ الأنواع المالية الكاملة تُضاف مع وحداتها (sales…)
بالمخطط نفسه. الاشتقاق الخادمي (§٧.٣: «لا يثق بإجمالي يرسله العميل») يأتي من core.effects.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from core.money import DomainError, parse_integer_string, parse_unsigned_string

Payload = Mapping[str, Any]


class KindError(ValueError):
    """رفض دائم للتحقق (يدخل الحجر فوراً — §٨.٣)."""


@dataclass(frozen=True)
class EntitySpec:
    entity: str
    schema_version: int
    fields: tuple[str, ...]
    required: tuple[str, ...]
    validate: Callable[[Payload], None] = lambda payload: None


@dataclass(frozen=True)
class KindSpec:
    kind: str
    op_version: int
    #: entity → (min, max) عدد الأعضاء المسموح من هذا النوع
    members: Mapping[str, tuple[int, int | None]]
    entities: Mapping[str, EntitySpec]
    #: يفحص اتساق الأعضاء معاً (مثل مجموع التسوية = الإجمالي)
    validate_operation: Callable[[Mapping[str, list[Payload]]], None] = lambda members: None
    #: أنواع الكيانات التي يجوز أن تشير إليها التبعيات
    dependency_entities: tuple[str, ...] = field(default_factory=tuple)


_REGISTRY: dict[tuple[str, int], KindSpec] = {}


def register(spec: KindSpec) -> KindSpec:
    _REGISTRY[(spec.kind, spec.op_version)] = spec
    return spec


def get_kind(kind: str, op_version: int) -> KindSpec:
    try:
        return _REGISTRY[(kind, op_version)]
    except KeyError as e:
        raise KindError(f"unknown kind {kind}@{op_version}") from e


def _require(payload: Payload, *names: str) -> None:
    missing = [n for n in names if payload.get(n) in (None, "")]
    if missing:
        raise KindError(f"missing fields: {missing}")


def _money(payload: Payload, *names: str, unsigned: bool = False) -> None:
    for n in names:
        try:
            (parse_unsigned_string if unsigned else parse_integer_string)(payload[n])
        except DomainError as e:
            raise KindError(f"{n}: {e.code}") from e


# ---------------------------------------------------------------- shift_open (§١٠.٣)
def _validate_shift_opened(p: Payload) -> None:
    _require(
        p, "shift_id", "branch_id", "device_id", "user_id", "opening_float_minor", "business_date"
    )
    _money(p, "opening_float_minor", unsigned=True)


SHIFT_OPENED = EntitySpec(
    entity="shifts.ShiftOpened",
    schema_version=1,
    fields=(
        "shift_id",
        "branch_id",
        "device_id",
        "user_id",
        "opening_float_minor",
        "business_date",
        "occurred_at",
    ),
    required=(
        "shift_id",
        "branch_id",
        "device_id",
        "user_id",
        "opening_float_minor",
        "business_date",
    ),
    validate=_validate_shift_opened,
)

register(
    KindSpec(
        kind="shift_open",
        op_version=1,
        members={"shifts.ShiftOpened": (1, 1)},
        entities={SHIFT_OPENED.entity: SHIFT_OPENED},
    )
)


# ---------------------------------------------------------------- cash_movement (§١٠.٣)
def _validate_cash_movement(p: Payload) -> None:
    _require(
        p, "movement_id", "shift_id", "kind", "signed_amount_minor", "actor_user_id", "occurred_at"
    )
    _money(p, "signed_amount_minor")
    if p["kind"] not in ("deposit", "withdrawal"):
        raise KindError("kind must be deposit|withdrawal")
    if p.get("kind") == "withdrawal" and not p.get("reason"):
        raise KindError("withdrawal requires reason")


CASH_MOVEMENT = EntitySpec(
    entity="shifts.CashMovement",
    schema_version=1,
    fields=(
        "movement_id",
        "shift_id",
        "kind",
        "signed_amount_minor",
        "reason",
        "actor_user_id",
        "occurred_at",
    ),
    required=(
        "movement_id",
        "shift_id",
        "kind",
        "signed_amount_minor",
        "actor_user_id",
        "occurred_at",
    ),
    validate=_validate_cash_movement,
)

register(
    KindSpec(
        kind="cash_movement",
        op_version=1,
        members={CASH_MOVEMENT.entity: (1, 1)},
        entities={CASH_MOVEMENT.entity: CASH_MOVEMENT},
        dependency_entities=("shifts.ShiftOpened",),
    )
)


# ---------------------------------------------------------------- test-only kind
# نوع اختباري بعضوين لاختبار العضوية والتجزئة والتبعيات دون ربط بالوحدات المالية
def _validate_probe(p: Payload) -> None:
    _require(p, "value")


PROBE_HEAD = EntitySpec("probe.Head", 1, ("value", "note"), ("value",), _validate_probe)
PROBE_LINE = EntitySpec("probe.Line", 1, ("value",), ("value",), _validate_probe)
register(
    KindSpec(
        kind="probe",
        op_version=1,
        members={"probe.Head": (1, 1), "probe.Line": (0, 5)},
        entities={"probe.Head": PROBE_HEAD, "probe.Line": PROBE_LINE},
        dependency_entities=("probe.Head",),
    )
)
