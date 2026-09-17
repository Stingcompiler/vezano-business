"""البيع (POS): يبدأ بحدث تجاوز الخصم (POS-03؛ §٧.٤ «حدث تجاوز ومراجعة عند الاتصال»)؛ البيع نفسه
(`Sale/SaleLine/Payment/StockMovement`) يأتي مع خط الحفظ في T1.16."""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.models import TenantScoped


class DiscountOverride(TenantScoped):
    """طلب اعتماد خصم يتجاوز سقف الدور: يُسجَّل باسم الكاشير ويُراجع عند الاتصال؛ الموافقة تُسجَّل
    باسم من وافق (اعتماد مدير الفرع/المالك غير مرسوم بعد — 0005 §١٨)."""

    STATUS = (("pending", "بانتظار الاعتماد"), ("approved", "معتمد"), ("rejected", "مرفوض"))

    branch_id = models.UUIDField()
    device_id = models.UUIDField()
    requested_by_user_id = models.UUIDField()
    requested_by_name = models.CharField(max_length=200, blank=True, default="")
    #: «مبلغ» أو «نسبة» — الطلب يحمل النوع والقيمة كما كُتبت وسقف الدور وقتها
    mode = models.CharField(max_length=8)
    value = models.CharField(max_length=32)
    cap = models.CharField(max_length=32)
    reason = models.CharField(max_length=300, blank=True, default="")
    cart_total_minor = models.BigIntegerField(default=0)
    status = models.CharField(max_length=16, choices=STATUS, default="pending")
    decided_by_user_id = models.UUIDField(null=True, blank=True)
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    decided_at = models.DateTimeField(null=True, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="sales_discountoverride_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.mode}:{self.value}:{self.status}"
