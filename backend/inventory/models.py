"""المخزون (§٧.٢): حركات المخزون الصالح للبيع آثارٌ مستقلة موقَّعة — وارد موجب وصادر سالب — لا تُشتق
الإشارة من اسم العملية. يبدأ هنا بحركة البيع (T1.16)؛ الاستلام والجرد والتحويل مع INV."""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.models import Branch, TenantScoped


class StockMovement(TenantScoped):
    """حركة على المخزون الصالح للبيع بالوحدة الأساسية (أجزاء الألف)؛ `id` = `movement_id` من
    الحدث."""

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    item_id = models.UUIDField()
    #: بالوحدة الأساسية: البيع سالب، الاستلام موجب
    delta_base_qty_milli = models.BigIntegerField()
    reason = models.CharField(max_length=16)
    #: العملية الأصل (بيع/استلام/جرد…) — للتتبع لا للاشتقاق
    source_entity = models.CharField(max_length=64, blank=True, default="")
    source_id = models.UUIDField(null=True, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stockmovement_tenant_id"
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "branch", "item_id"], name="inventory_branch_item")
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.delta_base_qty_milli}"


class QuarantineMovement(TenantScoped):
    """حركة على الحجر/الهالك (ACC-10): التالف من مرتجع لا يدخل المخزون الصالح للبيع — أثر صريح
    منفصل يُرى ولا يُشتق. بالوحدة الأساسية، موجب دخولاً إلى الحجر."""

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    item_id = models.UUIDField()
    base_qty_milli = models.BigIntegerField()
    #: `return_damaged` من المرتجع؛ الإتلاف/الإخراج مع INV
    reason = models.CharField(max_length=24)
    source_entity = models.CharField(max_length=64, blank=True, default="")
    source_id = models.UUIDField(null=True, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_quarantinemovement_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"quarantine:{self.item_id}:{self.base_qty_milli}"
