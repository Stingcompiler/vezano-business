"""وصفات القطاع (§١١.٤): اختيار النشاط يحمّل وحدات وطرق دفع وأدواراً وبيانات مرجعية أولية.

المصدر الوحيد للوصفات؛ الأصناف والمجموعات المبدئية تُضاف مع نماذج الكتالوج (T1.8) — حتى ذلك الحين
تُبلَّغ أعدادها صفراً بصدق (34-D26 ACC-04 success: «نقول ما أُنشئ»).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class UnitSpec:
    code: str
    name: str
    is_base: bool = False
    #: منازل الإدخال والعرض (§٦.٢) — الوزن 3 والعدّ 0
    decimal_places: int = 0


@dataclass(frozen=True)
class PaymentSpec:
    code: str
    name: str
    is_cash: bool = False


@dataclass(frozen=True)
class RoleSpec:
    code: str
    name: str


@dataclass(frozen=True)
class Recipe:
    code: str
    name: str
    units: tuple[UnitSpec, ...] = field(default_factory=tuple)
    payment_methods: tuple[PaymentSpec, ...] = field(default_factory=tuple)
    roles: tuple[RoleSpec, ...] = field(default_factory=tuple)


# وصفة البقالة كما تنصّ §١١.٤: حبة وكرتونة وكيلو؛ نقداً وتحويلاً بنكياً؛ مدير وكاشير وأمين مخزن.
GROCERY = Recipe(
    code="grocery",
    name="بقالة ومواد غذائية",
    units=(
        UnitSpec("piece", "حبة", is_base=True),
        UnitSpec("carton", "كرتونة"),
        UnitSpec("kg", "كيلو", is_base=True, decimal_places=3),
    ),
    payment_methods=(
        PaymentSpec("cash", "نقداً", is_cash=True),
        PaymentSpec("bank_transfer", "تحويلاً بنكياً"),
    ),
    roles=(
        RoleSpec("owner", "مالك"),
        RoleSpec("manager", "مدير"),
        RoleSpec("cashier", "كاشير"),
        RoleSpec("storekeeper", "أمين مخزن"),
    ),
)

RECIPES: dict[str, Recipe] = {GROCERY.code: GROCERY}

#: العملات المتاحة عند التأسيس — الجنيه السوداني بأُسّ ٢ (§٦.٣؛ الإطار 28-D21 ACC-04)
CURRENCIES: dict[str, tuple[str, int]] = {"SDG": ("الجنيه السوداني (SDG)", 2)}
