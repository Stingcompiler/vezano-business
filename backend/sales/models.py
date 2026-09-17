"""البيع (POS): حدث تجاوز الخصم (POS-03؛ §٧.٤) وإسقاط البيع بأعضائه (`Sale/SaleLine/Payment`؛
حركة المخزون في `inventory`) من عملية `sale` المقبولة في PUSH — الأحداث هي الحقيقة (§٨.٣)."""

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


class Sale(TenantScoped):
    """إسقاط البيع من حدث `sales.Sale` المقبول (§٧.٢–٧.٣): الرقم المرئي من الجهاز
    (`INV-KRT-A2-26-000001`) وUUID الهوية؛ الإجماليات مشتقة خادمياً وتُطابَق بما أرسله الجهاز."""

    branch_id = models.UUIDField()
    device_id = models.UUIDField()
    shift_id = models.UUIDField(null=True, blank=True)
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    party_id = models.UUIDField(null=True, blank=True)
    invoice_number = models.CharField(max_length=40)
    subtotal_minor = models.BigIntegerField()
    discount_mode = models.CharField(max_length=8, blank=True, default="")
    discount_value = models.CharField(max_length=32, blank=True, default="")
    discount_minor = models.BigIntegerField(default=0)
    discount_reason = models.CharField(max_length=300, blank=True, default="")
    total_minor = models.BigIntegerField()
    cash_minor = models.BigIntegerField(default=0)
    bank_minor = models.BigIntegerField(default=0)
    credit_minor = models.BigIntegerField(default=0)
    business_date = models.DateField()
    occurred_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_sale_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "invoice_number"], name="sales_sale_invoice_per_tenant"
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "branch_id", "occurred_at"], name="sales_branch_at")
        ]

    def __str__(self) -> str:
        return self.invoice_number


class SaleLine(TenantScoped):
    """سطر البيع: السعر والوحدة ومعاملها مثبَّتة لحظة الحفظ (ACC-19)؛ السعر اليدوي موسوم باسم من
    أدخله."""

    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="lines")
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    unit_id = models.UUIDField()
    unit_code = models.CharField(max_length=32, blank=True, default="")
    factor_milli = models.BigIntegerField()
    qty_milli = models.BigIntegerField()
    unit_price_minor = models.BigIntegerField()
    line_total_minor = models.BigIntegerField()
    manual_price = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_saleline_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.sale_id}:{self.item_id}"


class Payment(TenantScoped):
    """تسوية البيع (§٧.٤): نقد → الصندوق؛ تحويل → «مسجَّل — غير مطابق»؛ آجل → ذمّة الطرف."""

    METHOD = (("cash", "نقد"), ("bank", "تحويل"), ("credit", "آجل"))

    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="payments")
    method = models.CharField(max_length=8, choices=METHOD)
    amount_minor = models.BigIntegerField()
    #: للنقد: المستلَم والباقي (ACC-24) — للعرض والمراجعة لا للاشتقاق
    received_minor = models.BigIntegerField(null=True, blank=True)
    change_minor = models.BigIntegerField(null=True, blank=True)
    reference = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_payment_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.sale_id}:{self.method}:{self.amount_minor}"


class CreditOverride(TenantScoped):
    """تجاوز حدّ ائتمان الطرف بسبب (§٧.٤؛ POS-06): «الحد أداة انتباه لا قفل» — يُسجَّل باسم الكاشير
    مع الحدّ والرصيد بعد البيع، ويُراجع عند الاتصال."""

    sale_id = models.UUIDField()
    party_id = models.UUIDField()
    branch_id = models.UUIDField()
    device_id = models.UUIDField()
    requested_by_user_id = models.UUIDField()
    requested_by_name = models.CharField(max_length=200, blank=True, default="")
    credit_limit_minor = models.BigIntegerField()
    balance_after_minor = models.BigIntegerField()
    reason = models.CharField(max_length=300)
    status = models.CharField(max_length=16, default="pending")
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_creditoverride_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.party_id}:{self.balance_after_minor}>{self.credit_limit_minor}"
