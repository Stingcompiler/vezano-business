"""خدمات الكتالوج: إنشاء وتعديل وتعطيل بشاهد؛ الأسماء البديلة الفريدة؛ الوحدات ومعاملاتها
وباركوداتها؛ كل تغيير يُسجَّل في sync_log (`log_reference`) داخل معاملة.

- الإنشاء والتعديل أونلاين (§٨.١)؛ حدود الطول والقيمة تُرفض بكل أخطائها معاً (ACC-25).
- تغيير المعامل لا يعيد تفسير الماضي (ACC-19): يُسجَّل سطراً في التاريخ بعدد السطور السابقة
  واسم من غيّره؛ من يحسب السطور السابقة مزوّدٌ تسجّله وحدة البيع حين تُبنى (`FACTOR_USAGE_PROVIDERS`).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone

from catalog.limits import (
    ALIAS_MAX_LEN,
    BARCODE_MAX_LEN,
    FACTOR_MAX_MILLI,
    FACTOR_MIN_MILLI,
    IMAGE_MAX_BYTES,
    NAME_MAX_LEN,
    PRICE_MAX_MINOR,
    FieldError,
    Rejected,
    check_integer,
    check_text,
)
from catalog.models import Item, ItemAlias, ItemGroup, ItemUnit, ItemUnitFactorChange
from core.models import Unit, User
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from sync.reference import log_reference

#: سطور البيع السابقة التي تستخدم معامل هذه الوحدة — تسجّله POS حين تُبنى؛ حتى ذلك الحين صفر بصدق
FACTOR_USAGE_PROVIDERS: list[Callable[[ItemUnit], int]] = []
#: حركات الصنف (مخزون/بيع) — الوحدة الأساسية «لا تتغيّر بعد أول حركة»؛ تسجّله INV/POS
ITEM_MOVEMENT_PROVIDERS: list[Callable[[Item], int]] = []


def prior_lines(iu: ItemUnit) -> int:
    return sum(p(iu) for p in FACTOR_USAGE_PROVIDERS)


def movement_count(item: Item) -> int:
    return sum(p(item) for p in ITEM_MOVEMENT_PROVIDERS)


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def unit_payload(u: Unit) -> dict[str, Any]:
    return {
        "id": str(u.id),
        "code": u.code,
        "name": u.name,
        "is_base": u.is_base,
        "decimal_places": u.decimal_places,
    }


def item_unit_payload(u: ItemUnit) -> dict[str, Any]:
    return {
        "id": str(u.id),
        "unit_id": str(u.unit_id),
        "code": u.unit.code,
        "name": u.unit.name,
        "decimal_places": u.unit.decimal_places,
        "factor_milli": str(u.factor_milli),
        "barcode": u.barcode,
        "created_at": _iso(u.created_at),
    }


def item_payload(item: Item) -> dict[str, Any]:
    """حمولة الصنف كما تصل الأجهزة (PULL/النسخة) — بلا الصورة نفسها (حجمها)؛ حضورها فقط."""
    units = [
        item_unit_payload(u) for u in item.units.select_related("unit").order_by("factor_milli")
    ]
    return {
        "name": item.name,
        "name_normalized": item.name_normalized,
        "group_id": str(item.group_id) if item.group_id else "",
        "group_name": item.group.name if item.group else "",
        "base_unit_id": str(item.base_unit_id),
        "base_unit_code": item.base_unit.code,
        "base_unit_name": item.base_unit.name,
        "base_unit_decimal_places": item.base_unit.decimal_places,
        "units": units,
        "barcode": item.barcode,
        "sale_price_minor": str(item.sale_price_minor),
        "price_updated_at": _iso(item.price_updated_at),
        "image_present": bool(item.image_data_url),
        "image_updated_at": _iso(item.image_updated_at),
        "aliases": [a.alias for a in item.aliases.order_by("created_at")],
        "is_active": item.is_active,
        "deactivated_at": _iso(item.deactivated_at),
        "updated_at": _iso(item.updated_at),
    }


def factor_change_payload(c: ItemUnitFactorChange) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "old_factor_milli": str(c.old_factor_milli),
        "new_factor_milli": str(c.new_factor_milli),
        "prior_lines": c.prior_lines,
        "changed_by_name": c.changed_by_name,
        "changed_at": _iso(c.changed_at),
    }


def item_card_payload(item: Item) -> dict[str, Any]:
    """بطاقة الصنف (CAT-02/CAT-03): الحمولة + الصورة + تاريخ المعاملات وسطورها السابقة + قفل
    الوحدة الأساسية."""
    base = item_payload(item)
    units = []
    for u, pu in zip(
        item.units.select_related("unit").order_by("factor_milli"), base["units"], strict=True
    ):
        units.append(
            {
                **pu,
                "prior_lines": prior_lines(u),
                "changes": [
                    factor_change_payload(c) for c in u.changes.order_by("changed_at", "id")
                ],
            }
        )
    return {
        "id": str(item.id),
        **base,
        "units": units,
        "image_data_url": item.image_data_url,
        "movements": movement_count(item),
        "base_unit_locked": movement_count(item) > 0,
    }


def group_payload(g: ItemGroup) -> dict[str, Any]:
    return {
        "name": g.name,
        "parent_id": str(g.parent_id) if g.parent_id else "",
        "parent_name": g.parent.name if g.parent else "",
        "sort_order": g.sort_order,
        "note": g.note,
        "updated_at": g.updated_at.isoformat().replace("+00:00", "Z"),
    }


def _log_item(item: Item) -> None:
    log_reference(require_tenant(), "catalog.Item", item.id)


def create_group(*, name: str, parent: ItemGroup | None = None, note: str = "") -> ItemGroup:
    with transaction.atomic():
        g: ItemGroup = ItemGroup.objects.create(
            name=name.strip(),
            parent=parent,
            note=note.strip(),
            sort_order=ItemGroup.objects.count(),
            tenant_id=require_tenant(),
        )
        log_reference(require_tenant(), "catalog.ItemGroup", g.id)
        return g


@dataclass(frozen=True)
class BarcodeOwner:
    item: Item
    unit_name: str  # اسم الوحدة التي تحمل الباركود (الأساسية أو الإضافية)


def barcode_owner(
    barcode: str, *, exclude_item: Item | None = None, exclude_item_unit: ItemUnit | None = None
) -> BarcodeOwner | None:
    """من يحمل هذا الباركود؟ الصنف (وحدته الأساسية) أو وحدة إضافية لصنف — «هوية لا اسم»."""
    b = barcode.strip()
    if not b:
        return None
    items = Item.objects.filter(barcode=b).select_related("base_unit")
    if exclude_item is not None:
        items = items.exclude(id=exclude_item.id)
    owner = items.first()
    if owner is not None:
        return BarcodeOwner(owner, owner.base_unit.name)
    units = ItemUnit.objects.filter(barcode=b).select_related("item", "unit")
    if exclude_item_unit is not None:
        units = units.exclude(id=exclude_item_unit.id)
    iu = units.first()
    if iu is not None:
        return BarcodeOwner(iu.item, iu.unit.name)
    return None


def _barcode_errors(
    field: str,
    barcode: str,
    *,
    exclude_item: Item | None = None,
    exclude_item_unit: ItemUnit | None = None,
) -> list[FieldError]:
    errs = check_text(field, barcode, BARCODE_MAX_LEN, required=False)
    if errs:
        return errs
    b = barcode.strip()
    if b and not b.isascii():
        return [FieldError(field, "not_ascii")]
    owner = barcode_owner(b, exclude_item=exclude_item, exclude_item_unit=exclude_item_unit)
    if owner is not None:
        return [
            FieldError(
                field,
                "barcode_taken",
                extra={
                    "barcode": b,
                    "owner_item_id": str(owner.item.id),
                    "owner_item_name": owner.item.name,
                    "owner_unit_name": owner.unit_name,
                },
            )
        ]
    return []


def _factor_errors(field: str, factor_milli: Any) -> list[FieldError]:
    return check_integer(field, factor_milli, FACTOR_MIN_MILLI, FACTOR_MAX_MILLI)


def create_item(
    *,
    name: str,
    base_unit: Unit | None,
    group: ItemGroup | None = None,
    barcode: str = "",
    sale_price_minor: int | str = 0,
    units: Sequence[tuple[Unit, int | str]] | None = None,
    aliases: list[str] | None = None,
    unit_barcodes: dict[uuid.UUID, str] | None = None,
) -> Item:
    """يرفض بكل الأخطاء معاً (ACC-25؛ CAT-02 «خطآن يمنعان الحفظ») ثم يحفظ داخل معاملة واحدة."""
    errors: list[FieldError] = []
    errors += check_text("name", name, NAME_MAX_LEN, required=True)
    if base_unit is None:
        errors.append(FieldError("base_unit_id", "required"))
    errors += _barcode_errors("barcode", barcode)
    errors += check_integer("sale_price_minor", sale_price_minor, 0, PRICE_MAX_MINOR)
    seen: set[uuid.UUID] = set()
    for unit, factor_milli in units or []:
        if base_unit is not None and unit.id == base_unit.id:
            errors.append(FieldError("units", "same_as_base", extra={"unit_id": str(unit.id)}))
        if unit.id in seen:
            errors.append(FieldError("units", "duplicate_unit", extra={"unit_id": str(unit.id)}))
        seen.add(unit.id)
        errors += _factor_errors("units", factor_milli)
        ub = (unit_barcodes or {}).get(unit.id, "")
        if ub:
            if ub.strip() == barcode.strip():
                errors.append(FieldError("units", "barcode_taken", extra={"barcode": ub}))
            errors += _barcode_errors("units", ub)
    for alias in aliases or []:
        errors += check_text("aliases", alias, ALIAS_MAX_LEN, required=True)
    if errors:
        raise Rejected(errors)
    assert base_unit is not None
    with transaction.atomic():
        item: Item = Item.objects.create(
            tenant_id=require_tenant(),
            name=name.strip(),
            base_unit=base_unit,
            group=group,
            barcode=barcode.strip(),
            sale_price_minor=int(sale_price_minor),
            price_updated_at=timezone.now(),
        )
        for unit, factor_milli in units or []:
            ItemUnit.objects.create(
                tenant_id=require_tenant(),
                item=item,
                unit=unit,
                factor_milli=int(factor_milli),
                barcode=(unit_barcodes or {}).get(unit.id, "").strip(),
            )
        for alias in aliases or []:
            add_alias(item, alias)
        _log_item(item)
        return item


def update_item(
    item: Item,
    *,
    name: str | None = None,
    group: ItemGroup | None | bool = False,
    base_unit: Unit | None = None,
    barcode: str | None = None,
    sale_price_minor: int | str | None = None,
) -> Item:
    """تعديل بطاقة الصنف أونلاين. الوحدة الأساسية لا تتغيّر بعد أول حركة (`base_unit_locked`)."""
    errors: list[FieldError] = []
    if name is not None:
        errors += check_text("name", name, NAME_MAX_LEN, required=True)
    if barcode is not None:
        errors += _barcode_errors("barcode", barcode, exclude_item=item)
    if sale_price_minor is not None:
        errors += check_integer("sale_price_minor", sale_price_minor, 0, PRICE_MAX_MINOR)
    if base_unit is not None and base_unit.id != item.base_unit_id:
        if movement_count(item) > 0:
            errors.append(
                FieldError("base_unit_id", "locked_after_movement", actual=movement_count(item))
            )
        elif item.units.filter(unit=base_unit).exists():
            errors.append(FieldError("base_unit_id", "same_as_unit"))
    if errors:
        raise Rejected(errors)
    with transaction.atomic():
        fields: list[str] = []
        if name is not None:
            item.name = name.strip()
            fields += ["name", "name_normalized"]
        if group is not False:
            item.group = group  # type: ignore[assignment]
            fields.append("group")
        if base_unit is not None:
            item.base_unit = base_unit
            fields.append("base_unit")
        if barcode is not None:
            item.barcode = barcode.strip()
            fields.append("barcode")
        if sale_price_minor is not None and int(sale_price_minor) != item.sale_price_minor:
            item.sale_price_minor = int(sale_price_minor)
            item.price_updated_at = timezone.now()
            fields += ["sale_price_minor", "price_updated_at"]
        if fields:
            item.save(update_fields=[*fields, "updated_at"])
            _log_item(item)
        return item


class ImageTooLarge(Exception):
    def __init__(self, size: int) -> None:
        super().__init__(str(size))
        self.size = size


def set_item_image(item: Item, data_url: str) -> Item:
    """الصورة تُرفع بعد الصنف لا قبله (CAT-02 saving): الحدّ معلن، والأكبر يُرفض ليُصغَّر على الجهاز."""
    size = len(data_url.encode("utf-8"))
    if size > IMAGE_MAX_BYTES:
        raise ImageTooLarge(size)
    if data_url and not data_url.startswith("data:image/"):
        raise Rejected([FieldError("image_data_url", "not_an_image")])
    with transaction.atomic():
        item.image_data_url = data_url
        item.image_updated_at = timezone.now() if data_url else None
        item.save(update_fields=["image_data_url", "image_updated_at", "updated_at"])
        _log_item(item)
        return item


def add_item_unit(
    item: Item, *, unit: Unit | None, factor_milli: Any, barcode: str = ""
) -> ItemUnit:
    """وحدة أكبر بمعاملها وباركودها (CAT-03 «إضافة وحدة»)."""
    errors: list[FieldError] = []
    if unit is None:
        errors.append(FieldError("unit_id", "required"))
    elif unit.id == item.base_unit_id:
        errors.append(FieldError("unit_id", "same_as_base"))
    elif item.units.filter(unit=unit).exists():
        errors.append(FieldError("unit_id", "duplicate_unit"))
    errors += _factor_errors("factor_milli", factor_milli)
    errors += _barcode_errors("barcode", barcode)
    if errors:
        raise Rejected(errors)
    assert unit is not None
    with transaction.atomic():
        iu: ItemUnit = ItemUnit.objects.create(
            tenant_id=require_tenant(),
            item=item,
            unit=unit,
            factor_milli=int(factor_milli),
            barcode=barcode.strip(),
        )
        _log_item(item)
        return iu


def change_item_unit(
    iu: ItemUnit,
    *,
    factor_milli: Any | None = None,
    barcode: str | None = None,
    changed_by: User | None = None,
) -> ItemUnit:
    """تغيير المعامل يسري من الآن فقط ويُسجَّل سطراً في التاريخ باسم من غيّره وعدد السطور السابقة
    التي تبقى بمعاملها (ACC-19). لا تعديل بأثر رجعي."""
    errors: list[FieldError] = []
    if factor_milli is not None:
        errors += _factor_errors("factor_milli", factor_milli)
    if barcode is not None:
        errors += _barcode_errors("barcode", barcode, exclude_item_unit=iu)
    if errors:
        raise Rejected(errors)
    with transaction.atomic():
        fields: list[str] = []
        if factor_milli is not None and int(factor_milli) != iu.factor_milli:
            ItemUnitFactorChange.objects.create(
                tenant_id=require_tenant(),
                item_unit=iu,
                old_factor_milli=iu.factor_milli,
                new_factor_milli=int(factor_milli),
                prior_lines=prior_lines(iu),
                changed_by=changed_by,
                changed_by_name=changed_by.display_name if changed_by else "",
            )
            iu.factor_milli = int(factor_milli)
            fields.append("factor_milli")
        if barcode is not None and barcode.strip() != iu.barcode:
            iu.barcode = barcode.strip()
            fields.append("barcode")
        if fields:
            iu.save(update_fields=fields)
            _log_item(iu.item)
        return iu


class AliasTaken(Exception):
    """الاسم البديل مسجّل على صنف آخر — نسمّيه ونضع رابطاً إليه (CAT-06 validation_error)."""

    def __init__(self, owner: Item, alias: str) -> None:
        super().__init__(alias)
        self.owner = owner
        self.alias = alias


def add_alias(item: Item, alias: str) -> ItemAlias:
    normalized = normalize_search(alias)
    if not normalized:
        raise ValueError("alias_empty")
    existing: ItemAlias | None = (
        ItemAlias.objects.filter(alias_normalized=normalized).select_related("item").first()
    )
    if existing is not None:
        if existing.item_id == item.id:
            return existing
        raise AliasTaken(existing.item, alias)
    # الاسم الرسمي لصنف آخر يحجز مفتاح البحث أيضاً
    other = Item.objects.filter(name_normalized=normalized).exclude(id=item.id).first()
    if other is not None:
        raise AliasTaken(other, alias)
    try:
        with transaction.atomic():
            row: ItemAlias = ItemAlias.objects.create(
                tenant_id=require_tenant(), item=item, alias=alias.strip()
            )
            _log_item(item)
            return row
    except IntegrityError:
        owner = ItemAlias.objects.filter(alias_normalized=normalized).select_related("item").first()
        raise AliasTaken(owner.item if owner else item, alias) from None


def remove_alias(item: Item, alias_id: uuid.UUID) -> bool:
    with transaction.atomic():
        deleted, _ = ItemAlias.objects.filter(item=item, id=alias_id).delete()
        if deleted:
            _log_item(item)
        return bool(deleted)


def deactivate_item(item: Item) -> Item:
    """حذف منطقي بشاهد صريح: يصل الأجهزة كتحديث `is_active=false` لا باختفاء (ACC-45)."""
    with transaction.atomic():
        if item.is_active:
            item.is_active = False
            item.deactivated_at = timezone.now()
            item.save(update_fields=["is_active", "deactivated_at", "updated_at"])
            _log_item(item)
        return item


def reactivate_item(item: Item) -> Item:
    with transaction.atomic():
        if not item.is_active:
            item.is_active = True
            item.deactivated_at = None
            item.save(update_fields=["is_active", "deactivated_at", "updated_at"])
            _log_item(item)
        return item


@dataclass(frozen=True)
class ItemQuery:
    q: str = ""
    group_id: str = ""
    include_inactive: bool = False


def search_items(query: ItemQuery, *, limit: int = 100, offset: int = 0) -> tuple[list[Item], int]:
    """بحث بالبادئة على الاسم المطبَّع والأسماء البديلة والباركود (§٧.٥)."""
    qs = Item.objects.select_related("group", "base_unit").prefetch_related(
        "aliases", "units__unit"
    )
    if not query.include_inactive:
        qs = qs.filter(is_active=True)
    if query.group_id:
        qs = qs.filter(group_id=query.group_id)
    n = normalize_search(query.q)
    if n:
        qs = qs.filter(
            Q(name_normalized__startswith=n)
            | Q(name_normalized__contains=f" {n}")
            | Q(aliases__alias_normalized__startswith=n)
            | Q(aliases__alias_normalized__contains=f" {n}")
            | Q(barcode__startswith=query.q.strip())
        ).distinct()
    total = qs.count()
    return list(qs.order_by("name_normalized")[offset : offset + limit]), total


def groups_overview() -> list[dict[str, Any]]:
    """المجموعات بعدد أصنافها والأسماء البديلة المسجّلة على أصنافها؛ و«بلا مجموعة» صفاً أخيراً."""
    rows: list[dict[str, Any]] = []
    for g in (
        ItemGroup.objects.select_related("parent")
        .annotate(n=Count("items", filter=Q(items__is_active=True)))
        .order_by("sort_order", "name")
    ):
        aliases = list(
            ItemAlias.objects.filter(item__group=g, item__is_active=True)
            .order_by("created_at")
            .values_list("alias", flat=True)[:12]
        )
        rows.append({"id": str(g.id), **group_payload(g), "items": g.n, "aliases": aliases})
    ungrouped = Item.objects.filter(group__isnull=True, is_active=True).count()
    rows.append(
        {
            "id": "",
            "name": "بلا مجموعة",
            "parent_id": "",
            "parent_name": "",
            "sort_order": len(rows),
            "note": "",
            "updated_at": "",
            "items": ungrouped,
            "aliases": [],
        }
    )
    return rows
