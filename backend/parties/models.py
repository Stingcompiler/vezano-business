"""الأطراف (§٧.٥؛ POS-04، PTY-01…): الطرف يُنشأ بالاسم فقط؛ الهاتف اختياري؛ التطبيع للبحث يحتفظ
بالاسم الأصلي ولا يثبت أن شخصين هما الشخص نفسه. قرار الهوية «طرف منفصل مع تمييز» يُسجَّل
(`distinct_from`) لا يُستنتج. الرصيد ليس حقلاً — يُشتق من الدفتر عبر مزوّدي PTY حين يُبنى.
"""

from __future__ import annotations

from typing import Any

from django.db import models
from django.utils import timezone

from core.models import TenantScoped
from core.search_normalize import normalize_search


def normalize_phone(phone: str) -> str:
    """أرقام لاتينية فقط للمطابقة («الرقم مسجَّل على طرف قائم»)؛ العرض بالأصل."""
    latin = phone.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    return "".join(ch for ch in latin if ch.isdigit())


class Party(TenantScoped):
    name = models.CharField(max_length=200)
    name_normalized = models.CharField(max_length=200, db_index=True)
    phone = models.CharField(max_length=32, blank=True, default="")
    phone_normalized = models.CharField(max_length=32, blank=True, default="", db_index=True)
    #: أسماء بديلة للبحث («أبو محمد · الطيب») — لا تثبت هوية (§٧.٥)
    aliases = models.JSONField(default=list, blank=True)
    aliases_normalized = models.TextField(blank=True, default="")
    #: وصف حرّ على البطاقة («يشتري بالتجزئة، ويورّدنا بيضاً أسبوعياً»)
    note = models.CharField(max_length=300, blank=True, default="")
    #: حدّ الائتمان بالوحدة الصغرى؛ صفر = بلا حدّ مضبوط (PTY-03 يضبطه)
    credit_limit_minor = models.BigIntegerField(default=0)
    is_customer = models.BooleanField(default=True)
    is_supplier = models.BooleanField(default=False)
    #: «إنشاء منفصل مع تمييز»: قرار هوية صريح بأن هذا ليس ذاك (§٧.٥)
    distinct_from = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    #: خريطة الهوية (§٧.٥؛ ACC-78): دُمج في هذا الطرف — الحركات تبقى بهويتها وتُحسب للوارث
    merged_into = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="merged_sources"
    )
    created_by_user_id = models.UUIDField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="parties_party_tenant_id"),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.name_normalized = normalize_search(self.name)
        self.phone_normalized = normalize_phone(self.phone)
        self.aliases_normalized = " | ".join(
            normalize_search(str(a)) for a in (self.aliases or []) if str(a).strip()
        )
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name


class OpeningBalance(TenantScoped):
    """رصيد افتتاحي (§١٤.٢؛ PTY-04، ACC-79): حركة معتمدة بجودة تاريخ معلومة لا كتابة مباشرة لحقل
    الرصيد — بند واحد بلا فواتير خلفه، يظهر أول الكشف ولا يُحتسب في أعمار الدين. للمالك وحده،
    مرة واحدة لكل صفة (عميل/مورد) وقبل أول حركة."""

    SIDE = (("customer_due", "عليها لنا"), ("supplier_owed", "لها علينا"))

    party = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="opening_balances")
    side = models.CharField(max_length=16, choices=SIDE)
    amount_minor = models.BigIntegerField()
    reason = models.CharField(max_length=300)
    reference = models.CharField(max_length=120, blank=True, default="")
    #: تاريخ أعمال الدين القائم إن عُرف؛ فارغ = «قبل النظام»
    business_date = models.DateField(null=True, blank=True)
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="parties_openingbalance_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "party", "side"], name="parties_openingbalance_once_per_side"
            ),
        ]

    def __str__(self) -> str:
        return f"opening:{self.party_id}:{self.side}:{self.amount_minor}"


class PaymentReceipt(TenantScoped):
    """سند قبض أو ردّ (§٧.٤، §٧.٦؛ PTY-06): يخفض التراكمي دون توزيع على فواتير (ACC-79). النقد يدخل
    صندوق الوردية فوراً؛ التحويل البنكي «مسجَّل» لا يُسقط الذمّة حتى «مطابق» بفعل صريح (ACC-133)،
    ومرجعه لا يُستهلك مرتين (ACC-15). الردّ ليس سداداً سالباً — له سببه وصلاحيته. لا يُحذف: التصحيح
    بسند عكس يشير إليه."""

    KIND = (("receipt", "سداد"), ("refund", "ردّ مبلغ"))
    METHOD = (("cash", "نقداً"), ("bank", "تحويل بنكي"))

    party = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="receipts")
    receipt_number = models.CharField(max_length=40)
    kind = models.CharField(max_length=8, choices=KIND, default="receipt")
    method = models.CharField(max_length=8, choices=METHOD)
    amount_minor = models.BigIntegerField()
    reference = models.CharField(max_length=120, blank=True, default="")
    reason = models.CharField(max_length=300, blank=True, default="")
    branch_id = models.UUIDField()
    device_id = models.UUIDField()
    shift_id = models.UUIDField(null=True, blank=True)
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    #: التحويل يُطابَق بفعل صريح من كشف البنك — قبلها لا أثر على الذمّة
    matched_at = models.DateTimeField(null=True, blank=True)
    matched_by_name = models.CharField(max_length=200, blank=True, default="")
    business_date = models.DateField()
    occurred_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="parties_paymentreceipt_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "receipt_number"], name="parties_paymentreceipt_number"
            ),
            # مرجع التحويل لا يُستهلك مرتين (ACC-15)
            models.UniqueConstraint(
                fields=["tenant", "reference"],
                condition=models.Q(method="bank"),
                name="parties_paymentreceipt_bank_reference_once",
            ),
        ]

    def __str__(self) -> str:
        return self.receipt_number


class PartyMerge(TenantScoped):
    """قرار دمج (PTY-07): يُسجَّل باسم من نفّذه ويُتراجع عنه بحدث جديد لا بمحو — ما لم تُسجَّل
    حركة جديدة على الوارث بعده."""

    source = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="merges_as_source")
    target = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="merges_as_target")
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    reason = models.CharField(max_length=300, blank=True, default="")
    movements_at_merge = models.PositiveIntegerField(default=0)
    occurred_at = models.DateTimeField(auto_now_add=True)
    undone_at = models.DateTimeField(null=True, blank=True)
    undone_by_name = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="parties_partymerge_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"merge:{self.source_id}->{self.target_id}"


class ReceiptCorrection(TenantScoped):
    """مستند تصحيح لسند قبض (PTY-09): الأصل ثابت والتصحيح مستقل بسبب واضح وهوية منفّذ. أنواعه:
    تصحيح وسيلة الدفع، عكس الحركة بالكامل، تصحيح المبلغ، تصحيح تاريخ الأعمال (`DateCorrection`
    تقريرياً — الفترة المقفلة تُمنع بسبب)."""

    KIND = (
        ("method", "تصحيح وسيلة الدفع"),
        ("reverse", "عكس الحركة بالكامل"),
        ("amount", "تصحيح المبلغ"),
        ("date", "تصحيح تاريخ الأعمال"),
    )

    receipt = models.ForeignKey(
        PaymentReceipt, on_delete=models.PROTECT, related_name="corrections"
    )
    kind = models.CharField(max_length=8, choices=KIND)
    new_method = models.CharField(max_length=8, blank=True, default="")
    new_reference = models.CharField(max_length=120, blank=True, default="")
    new_amount_minor = models.BigIntegerField(null=True, blank=True)
    new_business_date = models.DateField(null=True, blank=True)
    reason = models.CharField(max_length=300)
    decided_by_user_id = models.UUIDField()
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="parties_receiptcorrection_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"correction:{self.receipt_id}:{self.kind}"
