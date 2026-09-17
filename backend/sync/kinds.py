"""سجل أنواع العمليات (§٧.٣، §٨.٣): لكل `kind` أعضاؤه المطلوبة والاختيارية وحقوله القانونية وقواعد
اشتقاقه. «يتبع التحقق kind وop_version، ولا يفترض وجود قيد ذمة في كل بيع».

المرحلة ٠ تعرّف الأنواع اللازمة لبوابة الخروج؛ الأنواع المالية الكاملة تُضاف مع وحداتها (sales…)
بالمخطط نفسه. الاشتقاق الخادمي (§٧.٣: «لا يثق بإجمالي يرسله العميل») يأتي من core.effects.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from core.money import (
    DomainError,
    invoice_total_minor,
    line_total_minor,
    parse_integer_string,
    parse_unsigned_string,
    round_half_away_div,
)
from core.quantities import parse_unit_factor, to_base_qty_milli

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


# ---------------------------------------------------------------- cash_adjustment (§١٠.٣؛ SHIFT-05)
def _validate_cash_adjustment(p: Payload) -> None:
    """التسوية إقرار مالي بقبول الفارق: باسم من اعتمده، وبسبب مكتوب حين يكون ثمّة فارق. الصفر
    يجوز (إقرار مراجعة حركة متأخرة بلا فارق)."""
    _require(p, "adjustment_id", "shift_id", "signed_amount_minor", "approved_by_user_id")
    _require(p, "occurred_at")
    _money(p, "signed_amount_minor")
    if int(p["signed_amount_minor"]) != 0 and not str(p.get("reason", "")).strip():
        raise KindError("cash adjustment with a variance requires reason")
    late = p.get("late_item_ids", [])
    if not isinstance(late, list) or any(not isinstance(x, str) for x in late):
        raise KindError("late_item_ids must be a list of ids")


CASH_ADJUSTMENT = EntitySpec(
    entity="shifts.CashAdjustment",
    schema_version=1,
    fields=(
        "adjustment_id",
        "shift_id",
        "signed_amount_minor",
        "approved_by_user_id",
        "reason",
        "late_item_ids",
        "occurred_at",
    ),
    required=(
        "adjustment_id",
        "shift_id",
        "signed_amount_minor",
        "approved_by_user_id",
        "occurred_at",
    ),
    validate=_validate_cash_adjustment,
)

register(
    KindSpec(
        kind="cash_adjustment",
        op_version=1,
        members={CASH_ADJUSTMENT.entity: (1, 1)},
        entities={CASH_ADJUSTMENT.entity: CASH_ADJUSTMENT},
        dependency_entities=("shifts.ShiftOpened", "shifts.ShiftClosed"),
    )
)


# ---------------------------------------------------------------- party_create (§٧.٥؛ POS-04)
def _validate_party_created(p: Payload) -> None:
    """الإنشاء السريع بالاسم فقط؛ الهاتف اختياري؛ «إنشاء منفصل مع تمييز» يحمل قرار الهوية."""
    _require(p, "party_id", "name", "occurred_at")
    if not str(p["name"]).strip():
        raise KindError("party name must not be blank")


PARTY_CREATED = EntitySpec(
    entity="parties.PartyCreated",
    schema_version=1,
    fields=("party_id", "name", "phone", "distinct_from_party_id", "occurred_at"),
    required=("party_id", "name", "occurred_at"),
    validate=_validate_party_created,
)

register(
    KindSpec(
        kind="party_create",
        op_version=1,
        members={PARTY_CREATED.entity: (1, 1)},
        entities={PARTY_CREATED.entity: PARTY_CREATED},
    )
)


# ---------------------------------------------------------------- discount_override (§٧.٤؛ POS-03)
def _validate_discount_override(p: Payload) -> None:
    """طلب اعتماد خصم فوق سقف الدور: النوع والقيمة والسبب إلزامية؛ يُنسب للكاشير ويُراجع عند
    الاتصال."""
    _require(p, "request_id", "branch_id", "mode", "value", "reason", "occurred_at")
    if p["mode"] not in ("amount", "percent"):
        raise KindError("mode must be amount|percent")
    try:
        parse_unsigned_string(str(p["value"]))
    except DomainError as e:
        raise KindError(f"value: {e.code}") from e
    if int(p["value"]) == 0:
        raise KindError("value must be positive")
    if not str(p["reason"]).strip():
        raise KindError("discount override requires reason")
    if "cart_total_minor" in p:
        _money(p, "cart_total_minor", unsigned=True)


DISCOUNT_OVERRIDE = EntitySpec(
    entity="sales.DiscountOverride",
    schema_version=1,
    fields=(
        "request_id",
        "branch_id",
        "mode",
        "value",
        "cap",
        "reason",
        "cart_total_minor",
        "occurred_at",
    ),
    required=("request_id", "branch_id", "mode", "value", "reason", "occurred_at"),
    validate=_validate_discount_override,
)

register(
    KindSpec(
        kind="discount_override",
        op_version=1,
        members={DISCOUNT_OVERRIDE.entity: (1, 1)},
        entities={DISCOUNT_OVERRIDE.entity: DISCOUNT_OVERRIDE},
    )
)


# ---------------------------------------------------------------- sale (§٣.٢، §٧.٢–٧.٤؛ POS-05)
SALE_DISCOUNT_MODES = ("", "amount", "percent")
PAYMENT_METHODS = ("cash", "bank", "credit")


def _validate_sale(p: Payload) -> None:
    _require(
        p,
        "sale_id",
        "invoice_number",
        "branch_id",
        "device_id",
        "user_id",
        "subtotal_minor",
        "total_minor",
        "business_date",
        "occurred_at",
    )
    _money(p, "subtotal_minor", "total_minor", unsigned=True)
    if p.get("discount_mode", "") not in SALE_DISCOUNT_MODES:
        raise KindError("discount_mode must be amount|percent")
    if p.get("discount_mode"):
        _require(p, "discount_value", "discount_minor", "discount_reason")
        parse_unsigned_string(str(p["discount_value"]))
        _money(p, "discount_minor", unsigned=True)


SALE = EntitySpec(
    entity="sales.Sale",
    schema_version=1,
    fields=(
        "sale_id",
        "invoice_number",
        "branch_id",
        "device_id",
        "shift_id",
        "user_id",
        "party_id",
        "subtotal_minor",
        "discount_mode",
        "discount_value",
        "discount_minor",
        "discount_reason",
        "total_minor",
        "business_date",
        "occurred_at",
    ),
    required=(
        "sale_id",
        "invoice_number",
        "branch_id",
        "device_id",
        "user_id",
        "subtotal_minor",
        "total_minor",
        "business_date",
        "occurred_at",
    ),
    validate=_validate_sale,
)


def _validate_sale_line(p: Payload) -> None:
    _require(p, "line_id", "sale_id", "item_id", "unit_id", "factor_milli", "qty_milli")
    _require(p, "unit_price_minor", "line_total_minor")
    _money(p, "unit_price_minor", "line_total_minor", unsigned=True)
    try:
        qty = parse_unsigned_string(p["qty_milli"])
        factor = parse_unsigned_string(p["factor_milli"])
    except DomainError as e:
        raise KindError(f"qty/factor: {e.code}") from e
    if qty == 0 or factor == 0:
        raise KindError("qty_milli and factor_milli must be positive")
    # §٧.٣: لا يثق الخادم بإجمالي يرسله العميل دون اشتقاق
    if line_total_minor(qty, int(p["unit_price_minor"])) != int(p["line_total_minor"]):
        raise KindError("line_total_minor does not match qty × price")


SALE_LINE = EntitySpec(
    entity="sales.SaleLine",
    schema_version=1,
    fields=(
        "line_id",
        "sale_id",
        "item_id",
        "item_name",
        "unit_id",
        "unit_code",
        "factor_milli",
        "qty_milli",
        "unit_price_minor",
        "line_total_minor",
        "manual_price",
        "sort_order",
    ),
    required=(
        "line_id",
        "sale_id",
        "item_id",
        "unit_id",
        "factor_milli",
        "qty_milli",
        "unit_price_minor",
        "line_total_minor",
    ),
    validate=_validate_sale_line,
)


def _validate_payment(p: Payload) -> None:
    _require(p, "payment_id", "sale_id", "method", "amount_minor")
    if p["method"] not in PAYMENT_METHODS:
        raise KindError("method must be cash|bank|credit")
    _money(p, "amount_minor", unsigned=True)
    for n in ("received_minor", "change_minor"):
        if p.get(n) not in (None, ""):
            _money(p, n, unsigned=True)


PAYMENT = EntitySpec(
    entity="sales.Payment",
    schema_version=1,
    fields=(
        "payment_id",
        "sale_id",
        "method",
        "amount_minor",
        "received_minor",
        "change_minor",
        "reference",
    ),
    required=("payment_id", "sale_id", "method", "amount_minor"),
    validate=_validate_payment,
)


def _validate_stock_movement(p: Payload) -> None:
    _require(p, "movement_id", "branch_id", "item_id", "delta_base_qty_milli", "reason")
    _money(p, "delta_base_qty_milli")
    if int(p["delta_base_qty_milli"]) == 0:
        raise KindError("delta_base_qty_milli must be non-zero")


STOCK_MOVEMENT = EntitySpec(
    entity="inventory.StockMovement",
    schema_version=1,
    fields=(
        "movement_id",
        "branch_id",
        "item_id",
        "delta_base_qty_milli",
        "reason",
        "source_entity",
        "source_id",
        "occurred_at",
    ),
    required=("movement_id", "branch_id", "item_id", "delta_base_qty_milli", "reason"),
    validate=_validate_stock_movement,
)


def _validate_sale_operation(members: Mapping[str, list[Payload]]) -> None:
    """يتحقق الخادم من الإجمالي والعلاقات ومعاملات الوحدة وأثر الدفع والمخزون (§٧.٣)."""
    sale = members["sales.Sale"][0]
    lines = members.get("sales.SaleLine", [])
    payments = members.get("sales.Payment", [])
    moves = members.get("inventory.StockMovement", [])
    sid = sale["sale_id"]
    if any(ln["sale_id"] != sid for ln in lines) or any(pm["sale_id"] != sid for pm in payments):
        raise KindError("members must reference the same sale_id")
    subtotal = invoice_total_minor(int(ln["line_total_minor"]) for ln in lines)
    if subtotal != int(sale["subtotal_minor"]):
        raise KindError("subtotal_minor does not match lines")
    discount = 0
    if sale.get("discount_mode") == "amount":
        discount = min(int(sale["discount_value"]), subtotal)
    elif sale.get("discount_mode") == "percent":
        discount = round_half_away_div(subtotal * int(sale["discount_value"]), 100)
    if discount != int(sale.get("discount_minor", 0) or 0):
        raise KindError("discount_minor does not match discount_value")
    if subtotal - discount != int(sale["total_minor"]):
        raise KindError("total_minor must equal subtotal − discount")
    if sum(int(pm["amount_minor"]) for pm in payments) != int(sale["total_minor"]):
        raise KindError("payments must sum to total_minor")
    if any(pm["method"] == "credit" for pm in payments) and not sale.get("party_id"):
        raise KindError("credit payment requires party_id")
    # حركة المخزون لكل سطر بالوحدة الأساسية = −(الكمية × المعامل) — مشتقة لا مرسلة
    expected: dict[str, int] = {}
    for ln in lines:
        try:
            base = to_base_qty_milli(
                int(ln["qty_milli"]), parse_unit_factor(str(ln["factor_milli"]), "1000")
            )
        except DomainError as e:
            raise KindError(f"line quantity: {e.code}") from e
        expected[str(ln["item_id"])] = expected.get(str(ln["item_id"]), 0) - base
    got: dict[str, int] = {}
    for mv in moves:
        if mv.get("source_id") not in (None, "", sid):
            raise KindError("stock movement must reference the sale")
        got[str(mv["item_id"])] = got.get(str(mv["item_id"]), 0) + int(mv["delta_base_qty_milli"])
    if got != expected:
        raise KindError("stock movements do not match sale lines")


register(
    KindSpec(
        kind="sale",
        op_version=1,
        members={
            SALE.entity: (1, 1),
            SALE_LINE.entity: (1, None),
            PAYMENT.entity: (1, None),
            STOCK_MOVEMENT.entity: (1, None),
        },
        entities={
            SALE.entity: SALE,
            SALE_LINE.entity: SALE_LINE,
            PAYMENT.entity: PAYMENT,
            STOCK_MOVEMENT.entity: STOCK_MOVEMENT,
        },
        validate_operation=_validate_sale_operation,
        dependency_entities=("shifts.ShiftOpened", "parties.PartyCreated"),
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
