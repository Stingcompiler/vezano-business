"""نطاقات PULL ومجموعات الكيانات (§٨.٦).

الخادم يحدد مفاتيح القراءة من صلاحيات الجهاز والمستخدم — لا من طلب الجهاز. كل كيان يُسند إلى
(scope, entity_group) واحد عند كتابة `sync_log`، والمؤشر يتقدم لكل مفتاح مستقلاً.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Scope = Literal["enterprise", "branch", "device"]

#: entity → (scope, entity_group). يُوسَّع مع كل وحدة.
ENTITY_SCOPES: dict[str, tuple[Scope, str]] = {
    "shifts.ShiftOpened": ("branch", "shifts"),
    "shifts.CashMovement": ("branch", "shifts"),
    "shifts.CashCounted": ("branch", "shifts"),
    "shifts.ShiftClosed": ("branch", "shifts"),
    "shifts.CashAdjustment": ("branch", "shifts"),
    "probe.Head": ("enterprise", "probe"),
    "probe.Line": ("enterprise", "probe"),
    "catalog.ItemGroup": ("enterprise", "catalog"),
    "catalog.Item": ("enterprise", "catalog"),
    "catalog.ItemAlias": ("enterprise", "catalog"),
    "parties.Party": ("enterprise", "parties"),
    "parties.PartyCreated": ("enterprise", "parties"),
    "parties.OpeningBalance": ("enterprise", "parties"),
    "parties.PaymentReceipt": ("branch", "sales"),
    "sales.DiscountOverride": ("branch", "sales"),
    "sales.Sale": ("branch", "sales"),
    "sales.SaleLine": ("branch", "sales"),
    "sales.Payment": ("branch", "sales"),
    "sales.CreditOverride": ("branch", "sales"),
    "sales.SaleReversal": ("branch", "sales"),
    "sales.SaleReturn": ("branch", "sales"),
    "sales.SaleReturnLine": ("branch", "sales"),
    "inventory.StockMovement": ("branch", "inventory"),
    "inventory.QuarantineMovement": ("branch", "inventory"),
}

ENTERPRISE_GROUPS = ("catalog", "parties", "probe")
BRANCH_GROUPS = ("sales", "inventory", "shifts")


def scope_for(entity: str) -> tuple[Scope, str]:
    try:
        return ENTITY_SCOPES[entity]
    except KeyError as e:
        raise ValueError(f"entity {entity} has no scope mapping") from e


@dataclass(frozen=True)
class CursorKey:
    scope: Scope
    entity_group: str
    #: للنطاق الفرعي: معرف الفرع؛ للمؤسسي: فارغ
    scope_id: str = ""

    def as_dict(self) -> dict[str, str]:
        d = {"scope": self.scope, "entity_group": self.entity_group}
        if self.scope_id:
            d["scope_id"] = self.scope_id
        return d


def readable_keys(*, branch_ids: list[str]) -> list[CursorKey]:
    """مفاتيح القراءة المسموحة للجهاز: المؤسسية كلها + الفرعية لفروعه المصرح بها فقط."""
    keys = [CursorKey("enterprise", g) for g in ENTERPRISE_GROUPS]
    for bid in branch_ids:
        keys += [CursorKey("branch", g, bid) for g in BRANCH_GROUPS]
    return keys
