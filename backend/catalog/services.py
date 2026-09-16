"""خدمات الكتالوج: إنشاء وتعديل وتعطيل بشاهد؛ الأسماء البديلة الفريدة؛ كل تغيير يُسجَّل في sync_log."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone

from catalog.models import Item, ItemAlias, ItemGroup, ItemUnit
from core.models import Unit
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from sync.reference import log_reference


def item_payload(item: Item) -> dict[str, Any]:
    units = [
        {
            "unit_id": str(u.unit_id),
            "code": u.unit.code,
            "name": u.unit.name,
            "factor_milli": str(u.factor_milli),
        }
        for u in item.units.select_related("unit").order_by("factor_milli")
    ]
    return {
        "name": item.name,
        "name_normalized": item.name_normalized,
        "group_id": str(item.group_id) if item.group_id else "",
        "group_name": item.group.name if item.group else "",
        "base_unit_id": str(item.base_unit_id),
        "base_unit_code": item.base_unit.code,
        "base_unit_name": item.base_unit.name,
        "units": units,
        "barcode": item.barcode,
        "sale_price_minor": str(item.sale_price_minor),
        "price_updated_at": item.price_updated_at.isoformat().replace("+00:00", "Z")
        if item.price_updated_at
        else "",
        "aliases": [a.alias for a in item.aliases.order_by("created_at")],
        "is_active": item.is_active,
        "deactivated_at": item.deactivated_at.isoformat().replace("+00:00", "Z")
        if item.deactivated_at
        else "",
        "updated_at": item.updated_at.isoformat().replace("+00:00", "Z"),
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


def create_item(
    *,
    name: str,
    base_unit: Unit,
    group: ItemGroup | None = None,
    barcode: str = "",
    sale_price_minor: int = 0,
    units: list[tuple[Unit, int]] | None = None,
    aliases: list[str] | None = None,
) -> Item:
    with transaction.atomic():
        item: Item = Item.objects.create(
            tenant_id=require_tenant(),
            name=name.strip(),
            base_unit=base_unit,
            group=group,
            barcode=barcode.strip(),
            sale_price_minor=sale_price_minor,
            price_updated_at=timezone.now(),
        )
        for unit, factor_milli in units or []:
            ItemUnit.objects.create(
                tenant_id=require_tenant(), item=item, unit=unit, factor_milli=factor_milli
            )
        for alias in aliases or []:
            add_alias(item, alias)
        _log_item(item)
        return item


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
