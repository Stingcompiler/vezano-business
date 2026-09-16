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


# ---------------------------------------------------------------- cash_movement (§١٠.٣؛ SHIFT-03)
CASH_MOVEMENT_KINDS = ("deposit", "withdrawal", "expense")


def _validate_cash_movement(p: Payload) -> None:
    _require(
        p, "movement_id", "shift_id", "kind", "signed_amount_minor", "actor_user_id", "occurred_at"
    )
    _money(p, "signed_amount_minor")
    if p["kind"] not in CASH_MOVEMENT_KINDS:
        raise KindError("kind must be deposit|withdrawal|expense")
    amount = int(p["signed_amount_minor"])
    if amount == 0:
        raise KindError("signed_amount_minor must be non-zero")
    # الإيداع موجب؛ السحب والمصروف سالبان — والعكس (reverses_movement_id) بالإشارة المضادّة
    if not p.get("reverses_movement_id"):
        if p["kind"] == "deposit" and amount < 0:
            raise KindError("deposit must be positive")
        if p["kind"] in ("withdrawal", "expense") and amount > 0:
            raise KindError("withdrawal/expense must be negative")
    # كل حركة خارج البيع لها سبب مكتوب (SHIFT-03) — الإيداع الافتتاحي في ShiftOpened لا هنا
    if not str(p.get("reason", "")).strip():
        raise KindError("cash movement requires reason")


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
        "authorized_by_user_id",
        "reverses_movement_id",
        "number",
        "occurred_at",
    ),
    required=(
        "movement_id",
        "shift_id",
        "kind",
        "signed_amount_minor",
        "reason",
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
        dependency_entities=("shifts.ShiftOpened", "shifts.CashMovement"),
    )
)


# ---------------------------------------------------------------- shift_close (§١٠.٣؛ SHIFT-04)
def _validate_cash_counted(p: Payload) -> None:
    _require(p, "count_id", "shift_id", "counted_cash_minor", "actor_user_id", "occurred_at")
    _money(p, "counted_cash_minor", unsigned=True)
    denoms = p.get("denominations", [])
    if not isinstance(denoms, list):
        raise KindError("denominations must be a list")
    for d in denoms:
        if not isinstance(d, dict) or "face_minor" not in d or "count" not in d:
            raise KindError("denomination needs face_minor and count")
        try:
            parse_unsigned_string(str(d["face_minor"]))
            if int(d["count"]) < 0:
                raise KindError("count must be >= 0")
        except (DomainError, ValueError) as e:
            raise KindError(f"denomination: {e}") from e


CASH_COUNTED = EntitySpec(
    entity="shifts.CashCounted",
    schema_version=1,
    fields=(
        "count_id",
        "shift_id",
        "counted_cash_minor",
        "denominations",
        "actor_user_id",
        "witness_user_id",
        "occurred_at",
    ),
    required=("count_id", "shift_id", "counted_cash_minor", "actor_user_id", "occurred_at"),
    validate=_validate_cash_counted,
)


def _validate_shift_closed(p: Payload) -> None:
    _require(p, "shift_id", "expected_cash_at_close_minor", "count_status", "occurred_at")
    _money(p, "expected_cash_at_close_minor")
    if p["count_status"] not in ("counted", "not_counted"):
        raise KindError("count_status must be counted|not_counted")
    if p.get("expected_source", "device") not in ("device", "server"):
        raise KindError("expected_source must be device|server")


SHIFT_CLOSED = EntitySpec(
    entity="shifts.ShiftClosed",
    schema_version=1,
    fields=(
        "shift_id",
        "expected_cash_at_close_minor",
        "count_status",
        "expected_source",
        "actor_user_id",
        "occurred_at",
    ),
    required=("shift_id", "expected_cash_at_close_minor", "count_status", "occurred_at"),
    validate=_validate_shift_closed,
)


def _validate_shift_close_operation(members: Mapping[str, list[Payload]]) -> None:
    closed = members["shifts.ShiftClosed"][0]
    counted = members.get("shifts.CashCounted", [])
    if closed["count_status"] == "counted" and not counted:
        raise KindError("counted close requires CashCounted member")
    if counted and counted[0]["shift_id"] != closed["shift_id"]:
        raise KindError("CashCounted.shift_id must match ShiftClosed.shift_id")


register(
    KindSpec(
        kind="shift_close",
        op_version=1,
        members={SHIFT_CLOSED.entity: (1, 1), CASH_COUNTED.entity: (0, 1)},
        entities={SHIFT_CLOSED.entity: SHIFT_CLOSED, CASH_COUNTED.entity: CASH_COUNTED},
        validate_operation=_validate_shift_close_operation,
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
