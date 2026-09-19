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
    #: ترتيب الإدخال — معرّفات UUID7 في الملّي ثانية نفسها لا تحفظ الترتيب
    line_no = models.PositiveIntegerField(default=0)
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


class DamageRecord(TenantScoped):
    """تالف (INV-07): الوجهة حجر (يخرج من المتاح ويبقى في المخزون الفعلي موسوماً — قد يُرتجع
    للمورد) أو هالك (خروج نهائي). لا يزيد المتاح للبيع أبداً (ACC-10)؛ الحدّ من الرصيد."""

    DESTINATION = (("quarantine", "حجر — قابل للمراجعة"), ("write_off", "هالك — خروج نهائي"))

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    damage_number = models.CharField(max_length=40)
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    unit_code = models.CharField(max_length=20, blank=True, default="")
    unit_name = models.CharField(max_length=60, blank=True, default="")
    factor_milli = models.BigIntegerField(default=1000)
    qty_milli = models.BigIntegerField()
    base_qty_milli = models.BigIntegerField()
    destination = models.CharField(max_length=12, choices=DESTINATION)
    reason = models.CharField(max_length=300)
    #: القيمة بسعر البيع وقت التسجيل — للحدّ المالي (افتراض حتى تُبنى التكلفة)
    value_minor = models.BigIntegerField(default=0)
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_damagerecord_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return self.damage_number


class StockTransfer(TenantScoped):
    """تحويل بين فرعين (INV-08/09؛ §١٠.٢): مستند خروج يخصم من المُرسل ولا يضيف للمستقبِل — الكمية
    «في الطريق» طور ثالث حقيقي حتى استلام مستقلّ (INV-10). لا يُغلق بالسهو: يبقى مفتوحاً بالمتبقّي
    حتى يُستلم أو يُلغى بقرار. مخوَّل للفرعين والمالك فقط (§٨.٦)."""

    STATUS = (
        ("sent", "أُرسل"),
        ("partially_received", "استُلم جزئياً"),
        ("received", "استُلم"),
        ("cancelled", "أُلغي"),
    )

    branch_from = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    branch_to = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    transfer_number = models.CharField(max_length=40)
    status = models.CharField(max_length=20, choices=STATUS, default="sent")
    device_id = models.UUIDField()
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    sent_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by_name = models.CharField(max_length=200, blank=True, default="")
    received_at_server = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stocktransfer_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return self.transfer_number


class StockTransferLine(TenantScoped):
    """سطر تحويل: المُرسل بالوحدة المُدخلة ومعاملها، والمستلم فعلاً (INV-10) — المتبقّي في الطريق."""

    transfer = models.ForeignKey(StockTransfer, on_delete=models.CASCADE, related_name="lines")
    line_no = models.PositiveIntegerField(default=0)
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200, blank=True, default="")
    unit_code = models.CharField(max_length=20, blank=True, default="")
    unit_name = models.CharField(max_length=60, blank=True, default="")
    factor_milli = models.BigIntegerField(default=1000)
    qty_milli = models.BigIntegerField()
    base_qty_milli = models.BigIntegerField()
    received_base_milli = models.BigIntegerField(default=0)
    #: قيمة السطر بسعر البيع وقت الإرسال — «بضاعة في الطريق» بقيمتها (افتراض حتى التكلفة)
    value_minor = models.BigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_stocktransferline_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.transfer_id}:{self.item_id}"


class TransferReceipt(TenantScoped):
    """استلام تحويل (INV-10؛ ACC-18): ساق مستقلة — ما عُدّ يدخل رصيد الوجهة بحركة `transfer_in`،
    والفرق (ناقص أو زائد) يُحجَز على التحويل بسبب مكتوب حتى يقرّ المصدر أو يعترض. الإشعار نفسه
    مرتين = استلام واحد؛ واستلام ثانٍ لتحويل استُلم لا يُطبَّق (`duplicate`)."""

    transfer = models.ForeignKey(StockTransfer, on_delete=models.PROTECT, related_name="receipts")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    receipt_number = models.CharField(max_length=40)
    device_id = models.UUIDField()
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    reason = models.CharField(max_length=300, blank=True, default="")
    #: استلام ثانٍ لتحويل استُلم — سُجّل بلا أثر (ACC-18)
    duplicate = models.BooleanField(default=False)
    received_at = models.DateTimeField(default=timezone.now)
    received_at_server = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_transferreceipt_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return self.receipt_number


class TransferReceiptLine(TenantScoped):
    """سطر استلام: المُرسل كما ادّعاه المصدر والمستلم فعلاً كما عدّته الوجهة — الفرق بينهما محجوز."""

    receipt = models.ForeignKey(TransferReceipt, on_delete=models.CASCADE, related_name="lines")
    transfer_line = models.ForeignKey(
        StockTransferLine, on_delete=models.PROTECT, related_name="receipt_lines"
    )
    item_id = models.UUIDField()
    sent_base_milli = models.BigIntegerField()
    received_base_milli = models.BigIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="inventory_transferreceiptline_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.receipt_id}:{self.item_id}"


class PurchaseOrder(TenantScoped):
    """PUR-01/02 (§٧.٧، §٣.٣): أمر شراء داخلي — وعدٌ لا التزام: لا يحرّك مخزوناً ولا مالاً؛ الذي
    يحرّكهما مستند الشراء (PUR-03) حين يُستلم ويُعتمد. يُكتب بوحدة الشراء ويُعرض معه المكافئ بوحدة
    البيع. القيمة تقديرية من آخر سعر شراء معروف. الملغى يبقى في السجل بسببه ولا يُحذف."""

    class Status(models.TextChoices):
        DRAFT = "draft", "مسودة"
        OPEN = "open", "مفتوحة"
        SENT = "sent", "مُرسل"
        UNSENT = "unsent", "لم يُرسل"
        PARTIAL = "partial", "استُلم جزئياً"
        RECEIVED = "received", "مستلَم"
        CANCELLED = "cancelled", "ملغى"
        CLOSED = "closed", "مغلق"

    number = models.CharField(max_length=20)
    supplier_id = models.UUIDField()
    supplier_name = models.CharField(max_length=200)
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    note = models.CharField(max_length=300, blank=True, default="")
    #: تقديري من آخر أسعار الشراء — null حين لا سعر معروف لصنف واحد على الأقل
    estimated_total_minor = models.BigIntegerField(null=True, blank=True)
    lines_count = models.PositiveIntegerField(default=0)
    created_by_user_id = models.UUIDField()
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    send_error = models.CharField(max_length=120, blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_reason = models.CharField(max_length=300, blank=True, default="")
    cancelled_by_name = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="inventory_po_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "number"], name="inventory_po_number_once"),
        ]

    def __str__(self) -> str:
        return f"{self.number}:{self.status}"


class PurchaseOrderLine(TenantScoped):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200)
    #: وحدة الشراء ومعاملها بالوحدة الأساسية
    unit_code = models.CharField(max_length=20)
    unit_name = models.CharField(max_length=60, blank=True, default="")
    factor_milli = models.BigIntegerField(default=1000)
    qty_milli = models.BigIntegerField()
    base_qty_milli = models.BigIntegerField()
    #: آخر سعر شراء معروف لوحدة الشراء — null إن لم يُعرف
    est_unit_price_minor = models.BigIntegerField(null=True, blank=True)
    received_base_qty_milli = models.BigIntegerField(default=0)
    line_no = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="inventory_poline_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}:{self.item_name}"
