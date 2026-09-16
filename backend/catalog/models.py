"""الكتالوج (§٦.٢، §٧.٥؛ CAT-01/02/03/06): أصناف ومجموعات ووحدات لكل صنف وأسماء بديلة.

- تعطيل الصنف حذف منطقي بشاهد صريح (ACC-45): يبقى في الفواتير والتقارير القديمة ولا يظهر في بحث POS.
- الاسم البديل مفتاح بحث يفتح صنفاً واحداً: فريد بعد التطبيع داخل المستأجر.
- معامل الوحدة يُحدَّد للصنف (كرتونة = 12) لا رقماً موحداً؛ تغييره لا يعيد تفسير الماضي (ACC-19):
  كل تغيير سطرٌ في `ItemUnitFactorChange` باسم من غيّره، والسطور السابقة تحفظ معاملها لحظة الحفظ.
- الباركود هوية لا اسم — لا يحمله صنفان (CAT-02)؛ ولكل وحدة باركودها (CAT-03) — التفرّد يشمل
  باركود الصنف (وحدته الأساسية) وباركودات وحداته الأخرى معاً داخل المستأجر.
"""

from __future__ import annotations

from typing import Any

from django.db import models
from django.db.models import Q
from django.utils import timezone

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
    # صورة الصنف (اختيارية — الكاشير يتعرّف بالصورة أسرع): data URL ≤ الحدّ؛ تُرفع بعد الصنف لا قبله
    image_data_url = models.TextField(blank=True, default="")
    image_updated_at = models.DateTimeField(null=True, blank=True)
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
    """وحدة إضافية للصنف بمعاملها إلى الوحدة الأساسية بالميلي (كرتونة = 12 → 12000) وباركودها."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="units")
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    factor_milli = models.BigIntegerField()
    barcode = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="catalog_itemunit_tenant_id"),
            models.UniqueConstraint(fields=["item", "unit"], name="catalog_itemunit_item_unit"),
            models.CheckConstraint(
                condition=Q(factor_milli__gt=0), name="catalog_itemunit_factor_pos"
            ),
            models.UniqueConstraint(
                fields=["tenant", "barcode"],
                condition=~Q(barcode=""),
                name="catalog_itemunit_barcode_per_tenant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.unit_id}={self.factor_milli}"


class ItemUnitFactorChange(TenantScoped):
    """سطر في تاريخ تغيير المعامل (CAT-03): «12 كغ · من يناير 2025 حتى اليوم · 318 سطراً» ثم
    «24 كغ · من اليوم — سميرة ع.». المعامل الجديد يسري من الآن فقط؛ عدد سطور البيع السابقة يُثبَّت
    لحظة التغيير لأنها تبقى بمعاملها (ACC-19)."""

    item_unit = models.ForeignKey(ItemUnit, on_delete=models.CASCADE, related_name="changes")
    old_factor_milli = models.BigIntegerField()
    new_factor_milli = models.BigIntegerField()
    prior_lines = models.PositiveIntegerField(default=0)
    changed_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    changed_by_name = models.CharField(max_length=200, blank=True, default="")
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="catalog_itemunitfactorchange_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item_unit_id}:{self.old_factor_milli}->{self.new_factor_milli}"


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


class ItemPrice(TenantScoped):
    """سطر في تاريخ السعر (CAT-04): «السعر سلسلة تواريخ لا قيمة واحدة». الفواتير الصادرة بالسعر
    القديم تبقى بسعرها؛ لا يُعاد تسعير أي مستند محفوظ. `effective_to` فارغ للسعر الساري."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="prices")
    price_minor = models.BigIntegerField()
    effective_from = models.DateTimeField(default=timezone.now)
    effective_to = models.DateTimeField(null=True, blank=True)
    changed_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    changed_by_name = models.CharField(max_length=200, blank=True, default="")
    # موسوم بالدفعة حين يأتي من استيراد متعدد (CAT-05 success)
    batch = models.ForeignKey(
        "PriceImportBatch", on_delete=models.PROTECT, null=True, blank=True, related_name="prices"
    )
    note = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="catalog_itemprice_tenant_id"),
            models.CheckConstraint(
                condition=Q(price_minor__gte=0), name="catalog_itemprice_nonneg"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.price_minor}@{self.effective_from:%Y-%m-%d}"


class PriceChangeRequest(TenantScoped):
    """«اطلب تغييراً» (CAT-04 permission_denied): مدير الفرع يقترح سعراً وسببه — معرفته بالسوق
    المحلي أدقّ فلا تُهدر. مراجعة المالك لها غير مرسومة بعد (0005 §١٣)."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="price_requests")
    proposed_price_minor = models.BigIntegerField()
    reason = models.CharField(max_length=300, blank=True, default="")
    requested_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    requested_by_name = models.CharField(max_length=200, blank=True, default="")
    requested_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, default="pending")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="catalog_pricechangerequest_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.proposed_price_minor}:{self.status}"


class PriceImportBatch(TenantScoped):
    """دفعة استيراد أسعار بهوية (§١٤.٢؛ CAT-05): تُعرَّف ببصمة الملف داخل المستأجر فلا يكرّر رفعُ
    الملف نفسه التطبيق — «يُطابَق بالمعرّف لا بالترتيب». الصفوف ونتائجها تُحفظ للمعاينة والتنزيل
    (R-06) والاستئناف بعد انقطاع (ما اكتمل يبقى وما انقطع يُلغى) والتراجع دفعةً خلال 24 ساعة."""

    STATUS = ("previewed", "applying", "applied", "reverted")

    file_name = models.CharField(max_length=200)
    file_sha256 = models.CharField(max_length=64)
    # [{line, item_id, name, old_price_minor, new_price_minor, result, reason}]
    # result ∈ update / unchanged / rejected
    rows = models.JSONField(default=list)
    ready_count = models.PositiveIntegerField(default=0)
    rejected_count = models.PositiveIntegerField(default=0)
    unchanged_count = models.PositiveIntegerField(default=0)
    applied_count = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, default="previewed")
    created_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    applied_at = models.DateTimeField(null=True, blank=True)
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="catalog_priceimportbatch_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "file_sha256"], name="catalog_priceimportbatch_file_per_tenant"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.file_name}:{self.status}"
