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


class SaleReversal(TenantScoped):
    """مستند إلغاء مستقل مرتبط بالمستند المختار (§٧.٣؛ POS-12 conflict): «سجّل عكساً» لا «احذف» —
    الأصل يبقى مقروءاً للأبد، والعكس يحمل هوية المنفّذ وسببه. آثاره مستقلة موقَّعة: المخزون يعود،
    والنقد يخرج من درج وردية الأصل، والذمّة تنخفض."""

    KIND = (("duplicate", "تكرار تجاري"), ("correction", "تصحيح"))

    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="reversals")
    branch_id = models.UUIDField()
    kind = models.CharField(max_length=16, choices=KIND, default="duplicate")
    #: المستند الذي بقي (الأصل) حين يكون العكس لتكرار
    kept_sale_id = models.UUIDField(null=True, blank=True)
    reason = models.CharField(max_length=300)
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_salereversal_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "sale"], name="sales_salereversal_once"),
        ]

    def __str__(self) -> str:
        return f"reversal:{self.sale_id}:{self.kind}"


class DuplicateDecision(TenantScoped):
    """قرار مراجعة زوج مشتبه به: «الاثنان بيعان حقيقيان» يُغلق الاشتباه بلا أثر؛ «إلغاء المستند»
    يُنشئ `SaleReversal`. القرار محفوظ حتى لا يعود الزوج إلى القائمة."""

    DECISION = (("both_real", "الاثنان بيعان حقيقيان"), ("reverse", "إلغاء المستند الثاني"))

    first_sale_id = models.UUIDField()
    second_sale_id = models.UUIDField()
    decision = models.CharField(max_length=16, choices=DECISION)
    reason = models.CharField(max_length=300, blank=True, default="")
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="sales_duplicatedecision_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.first_sale_id}/{self.second_sale_id}:{self.decision}"


class DuplicateReport(TenantScoped):
    """«أبلغ عن اشتباه» من الكاشير: الملاحظة من الميدان والقرار ممن يملك أثره (POS-12
    permission_denied). يبقى مفتوحاً حتى يقرّر مدير الفرع أو المالك."""

    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="duplicate_reports")
    reported_by_user_id = models.UUIDField()
    reported_by_name = models.CharField(max_length=200, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    resolved_at = models.DateTimeField(null=True, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="sales_duplicatereport_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"report:{self.sale_id}"


class SaleReturn(TenantScoped):
    """مرتجع كلي أو جزئي (POS-10؛ §٧.٢–٧.٣، ACC-09/10/11): مستند مستقل يشير إلى أصله والأصل باقٍ
    كما كان. حالة البضاعة (صالحة → المخزون، تالفة → الحجر) ووجهة الرد (نقداً من الصندوق أو خصماً
    من ذمّة العميل) معلنتان. التجاوز التراكمي للأصل يُكشف مركزياً ويُوسم ولا يُمحى."""

    CONDITION = (("good", "صالحة — تعود للمخزون"), ("damaged", "تالفة — إلى الحجر أو الهالك"))
    DESTINATION = (("cash", "نقداً من الصندوق"), ("credit", "خصماً من ذمة العميل"))

    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="returns")
    return_number = models.CharField(max_length=40)
    branch_id = models.UUIDField()
    device_id = models.UUIDField()
    shift_id = models.UUIDField(null=True, blank=True)
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    party_id = models.UUIDField(null=True, blank=True)
    condition = models.CharField(max_length=8, choices=CONDITION)
    destination = models.CharField(max_length=8, choices=DESTINATION)
    total_minor = models.BigIntegerField()
    cash_minor = models.BigIntegerField(default=0)
    credit_minor = models.BigIntegerField(default=0)
    #: سطرٌ ردّ أكثر من المُباع ناقص المُرتجَع سابقاً وقت الوصول — يُراجع مركزياً (ACC-11)
    exceeds_original = models.BooleanField(default=False)
    business_date = models.DateField()
    occurred_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_salereturn_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "return_number"], name="sales_salereturn_number_per_tenant"
            ),
        ]

    def __str__(self) -> str:
        return self.return_number


class SaleReturnLine(TenantScoped):
    """سطر مرتجع يشير إلى سطر البيع الأصلي بكميته وسعره المثبَّتين."""

    sale_return = models.ForeignKey(SaleReturn, on_delete=models.PROTECT, related_name="lines")
    sale_line = models.ForeignKey(SaleLine, on_delete=models.PROTECT, related_name="returns")
    item_id = models.UUIDField()
    factor_milli = models.BigIntegerField()
    qty_milli = models.BigIntegerField()
    unit_price_minor = models.BigIntegerField()
    line_total_minor = models.BigIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sales_salereturnline_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.sale_return_id}:{self.sale_line_id}:{self.qty_milli}"
