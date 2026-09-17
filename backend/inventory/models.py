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
    #: سبب الحركة كما كُتب (تسوية الجرد: «تالف» …) — يظهر في INV-02 «سبب: …»
    note = models.CharField(max_length=300, blank=True, default="")
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


class GoodsReceipt(TenantScoped):
    """استلام بضاعة (INV-04): مورد ومرجع وكمية مطلوبة، والتكلفة اختيارية — لا نفرض وحدة تكلفة
    (§٣.٣). يُحفظ محلياً أولاً ثم يُرفع؛ أثره على المخزون حركات `receive` بالوحدة الأساسية."""

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    receipt_number = models.CharField(max_length=40)
    party_id = models.UUIDField(null=True, blank=True)
    supplier_name = models.CharField(max_length=200)
    reference = models.CharField(max_length=120)
    device_id = models.UUIDField()
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    business_date = models.DateField()
    occurred_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_goodsreceipt_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return self.receipt_number


class GoodsReceiptLine(TenantScoped):
    """سطر استلام: الكمية بالوحدة المُدخلة ومعاملها المعلن، والتحويل إلى الوحدة الأساسية صريح."""

    receipt = models.ForeignKey(GoodsReceipt, on_delete=models.CASCADE, related_name="lines")
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    unit_code = models.CharField(max_length=20, blank=True, default="")
    factor_milli = models.BigIntegerField(default=1000)
    qty_milli = models.BigIntegerField()
    base_qty_milli = models.BigIntegerField()
    #: تكلفة الوحدة المُدخلة — اختيارية؛ فارغة = لم تُعرف وقت الاستلام
    unit_cost_minor = models.BigIntegerField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_goodsreceiptline_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.receipt_id}:{self.item_id}"


class StockOpening(TenantScoped):
    """افتتاحية المخزون (INV-03): مستند واحد يجمع أصنافاً يُراجَع قبل الاعتماد؛ الاعتماد يُنشئ الرصيد
    فهو للمالك؛ تُعتمد مرة واحدة لكل صنف وقبل أول حركة."""

    STATUS = (("submitted", "أُرسلت للاعتماد"), ("approved", "معتمدة"))

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=12, choices=STATUS, default="submitted")
    created_by_user_id = models.UUIDField()
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    approved_by_user_id = models.UUIDField(null=True, blank=True)
    approved_by_name = models.CharField(max_length=200, blank=True, default="")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stockopening_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"opening:{self.branch_id}:{self.status}"


class StockOpeningLine(TenantScoped):
    """سطر افتتاحية: الوحدة المُدخلة والكمية والتحويل الصريح إلى وحدة المخزون؛ تكلفة يدوية
    اختيارية."""

    opening = models.ForeignKey(StockOpening, on_delete=models.CASCADE, related_name="lines")
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    unit_code = models.CharField(max_length=20, blank=True, default="")
    unit_name = models.CharField(max_length=60, blank=True, default="")
    factor_milli = models.BigIntegerField(default=1000)
    qty_milli = models.BigIntegerField()
    base_qty_milli = models.BigIntegerField()
    unit_cost_minor = models.BigIntegerField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stockopeningline_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.opening_id}:{self.item_id}"


class CountSession(TenantScoped):
    """جلسة جرد (INV-05): عدّ فعلي مع حفظ تقدّم — المتوقَّع محجوب حتى يُدخل المعدود (القاعدة 9)؛
    الإغلاق يوثّق ما عُدّ ولا يُسوّي؛ التسوية قرار تالٍ مخوَّل (INV-06)."""

    STATUS = (("closed", "أُغلقت"), ("adjusted", "سُوّيت"))

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    session_number = models.CharField(max_length=40)
    device_id = models.UUIDField()
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    status = models.CharField(max_length=12, choices=STATUS, default="closed")
    #: عدد أصناف الكتالوج وقت الجلسة — «عُدّ 180 صنفاً من 214» (جرد جزئي)
    total_items = models.PositiveIntegerField(default=0)
    started_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_countsession_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return self.session_number


class CountLine(TenantScoped):
    """سطر عدّ: المعدود كما أُدخل ولا يُعاد كتابته، ورصيد النظام لحظة العدّ (لقطة الجهاز)."""

    session = models.ForeignKey(CountSession, on_delete=models.CASCADE, related_name="lines")
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    unit_name = models.CharField(max_length=60, blank=True, default="")
    counted_qty_milli = models.BigIntegerField()
    #: لقطة الجهاز وقت العدّ؛ فارغة = لم يكن للجهاز رصيد معروف
    system_qty_milli = models.BigIntegerField(null=True, blank=True)
    counted_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="inventory_countline_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.session_id}:{self.item_id}"


class StockAdjustment(TenantScoped):
    """تسوية جرد (INV-06): مستند بفاعل وسبب لكل فرق — يُنشئ حركات `count`؛ لا «قبول الكل»."""

    session = models.ForeignKey(CountSession, on_delete=models.PROTECT, related_name="adjustments")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    adjustment_number = models.CharField(max_length=40)
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stockadjustment_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return self.adjustment_number


class StockAdjustmentLine(TenantScoped):
    """فرق مسوًّى بسببه المكتوب: الدفتري لحظة التسوية والمعدود والفرق."""

    adjustment = models.ForeignKey(StockAdjustment, on_delete=models.CASCADE, related_name="lines")
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    book_qty_milli = models.BigIntegerField()
    counted_qty_milli = models.BigIntegerField()
    delta_milli = models.BigIntegerField()
    reason = models.CharField(max_length=300)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stockadjustmentline_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.adjustment_id}:{self.item_id}"
