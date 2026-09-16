"""الكتالوج (§٦.٢، §٧.٥؛ CAT-01/03/06): أصناف ومجموعات ووحدات لكل صنف وأسماء بديلة.

- تعطيل الصنف حذف منطقي بشاهد صريح (ACC-45): يبقى في الفواتير والتقارير القديمة ولا يظهر في بحث POS.
- الاسم البديل مفتاح بحث يفتح صنفاً واحداً: فريد بعد التطبيع داخل المستأجر.
- معامل الوحدة يُحدَّد للصنف (كرتونة = 12) لا رقماً موحداً؛ تغييره لا يعيد تفسير الماضي (ACC-19).
"""

from __future__ import annotations

from typing import Any

from django.db import models
from django.db.models import Q

from core.models import TenantScoped, Unit
from core.search_normalize import normalize_search


class ItemGroup(TenantScoped):
    name = models.CharField(max_length=120)
    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="children"
    )
    sort_order = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="catalog_group_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "name"], name="catalog_group_name_per_tenant"
            ),
        ]

    def __str__(self) -> str:
        return self.name


class Item(TenantScoped):
    name = models.CharField(max_length=200)
    name_normalized = models.CharField(max_length=200, db_index=True)
    group = models.ForeignKey(
        ItemGroup, on_delete=models.PROTECT, null=True, blank=True, related_name="items"
    )
    base_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    barcode = models.CharField(max_length=64, blank=True, default="")
    # سعر البيع بالوحدة الأساسية بالوحدات الصغرى (minor) — تاريخ الأسعار مع CAT-04
    sale_price_minor = models.BigIntegerField(default=0)
    price_updated_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="catalog_item_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "barcode"],
                condition=~Q(barcode=""),
                name="catalog_item_barcode_per_tenant",
            ),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.name_normalized = normalize_search(self.name)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name


class ItemUnit(TenantScoped):
    """وحدة إضافية للصنف بمعاملها إلى الوحدة الأساسية بالميلي (كرتونة = 12 → 12000)."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="units")
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    factor_milli = models.BigIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="catalog_itemunit_tenant_id"),
            models.UniqueConstraint(fields=["item", "unit"], name="catalog_itemunit_item_unit"),
            models.CheckConstraint(
                condition=Q(factor_milli__gt=0), name="catalog_itemunit_factor_pos"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.unit_id}={self.factor_milli}"


class ItemAlias(TenantScoped):
    """اسم بديل للبحث لا صنف: «ببسي» و«بيبسي» و«pepsi» مداخل لصنف واحد (CAT-06)."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="aliases")
    alias = models.CharField(max_length=120)
    alias_normalized = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="catalog_alias_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "alias_normalized"], name="catalog_alias_unique_per_tenant"
            ),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.alias_normalized = normalize_search(self.alias)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.alias
