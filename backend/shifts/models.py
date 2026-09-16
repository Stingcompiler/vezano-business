"""إسقاط الورديات الخادمي (§١٠.٣؛ SHIFT-01/02): مشتق من أحداث `shifts.ShiftOpened` و
`shifts.CashMovement` المقبولة في PUSH — الأحداث هي الحقيقة والإسقاط للتقارير والرئيسية
واكتشاف «وردية ثانية للفرع نفسه من جهاز آخر» (تُحال إلى SYS-03).

`expected_cash` = الافتتاح + مبيعات نقدية + سدادات نقدية + إيداعات − مرتجعات نقدية − سحوبات؛ آثار
البيع والسداد تصل مع POS/PTY عبر `CASH_EFFECT_PROVIDERS` — اليوم الافتتاح والحركات فقط.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.models import Branch, TenantScoped


class Shift(TenantScoped):
    """الوردية: لمستخدم على جهاز وصندوق محددين. `id` = `shift_id` من الحدث."""

    STATE = (("open", "مفتوحة"), ("closed", "مقفلة"))

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    device_id = models.UUIDField()
    user_id = models.UUIDField()
    user_name = models.CharField(max_length=200, blank=True, default="")
    device_name = models.CharField(max_length=200, blank=True, default="")
    opening_float_minor = models.BigIntegerField()
    business_date = models.DateField()
    opened_at = models.DateTimeField(default=timezone.now)
    state = models.CharField(max_length=8, choices=STATE, default="open")
    closed_at = models.DateTimeField(null=True, blank=True)
    expected_cash_at_close_minor = models.BigIntegerField(null=True, blank=True)
    #: مصدر المتوقَّع لحظة الإقفال: من الجهاز (قد تنقصه مبيعات أجهزة أخرى) أو الخادم
    expected_source = models.CharField(max_length=8, blank=True, default="")
    counted_cash_minor = models.BigIntegerField(null=True, blank=True)
    count_status = models.CharField(max_length=16, blank=True, default="")
    counted_by_user_id = models.UUIDField(null=True, blank=True)
    counted_by_name = models.CharField(max_length=200, blank=True, default="")
    witness_user_id = models.UUIDField(null=True, blank=True)
    witness_name = models.CharField(max_length=200, blank=True, default="")
    denominations = models.JSONField(default=list)
    #: رقم الحدث الأول (ترتيب القبول)
    server_seq = models.BigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="shifts_shift_tenant_id"),
        ]
        indexes = [models.Index(fields=["tenant", "branch", "state"], name="shifts_branch_state")]

    def __str__(self) -> str:
        return f"{self.id}:{self.state}"


class ShiftCashMovement(TenantScoped):
    """حركة صندوق مقبولة (إيداع/سحب) — `id` = `movement_id` من الحدث."""

    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField(max_length=16)
    signed_amount_minor = models.BigIntegerField()
    reason = models.CharField(max_length=300, blank=True, default="")
    actor_user_id = models.UUIDField()
    actor_name = models.CharField(max_length=200, blank=True, default="")
    authorized_by_user_id = models.UUIDField(null=True, blank=True)
    authorized_by_name = models.CharField(max_length=200, blank=True, default="")
    #: الحركة المعكوسة تبقى ومعها الأصلية مشطوبةً لا محذوفة (SHIFT-03)
    reverses = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversed_by"
    )
    number = models.CharField(max_length=32, blank=True, default="")
    occurred_at = models.DateTimeField()
    #: لحظة قبول الخادم — الحركة «المتأخرة» ما وصل بعد إقفال ورديتها (SHIFT-05؛ ACC-68)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="shifts_cashmovement_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.shift_id}:{self.kind}:{self.signed_amount_minor}"


class CashMovementRequest(TenantScoped):
    """«اطلب من ندى» (SHIFT-03 permission_denied): الكاشير يطلب سحباً بالمبلغ والسبب، فيوافق
    المالك من جهازه وتُسجَّل باسمه. موافقة المالك غير مرسومة بعد (0005 §١٥)."""

    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name="requests")
    kind = models.CharField(max_length=16)
    amount_minor = models.BigIntegerField()
    reason = models.CharField(max_length=300, blank=True, default="")
    requested_by_user_id = models.UUIDField()
    requested_by_name = models.CharField(max_length=200, blank=True, default="")
    requested_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, default="pending")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="shifts_cashmovementrequest_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.shift_id}:{self.kind}:{self.amount_minor}:{self.status}"


class CashAdjustment(TenantScoped):
    """تسوية الفارق (§١٠.٣ `CashAdjustment(shift_id, signed_amount_minor, approved_by, reason)`):
    إقرار مالي بقبول فارق الوردية باسم من اعتمده وسببه — «لا يتغير تاريخ فرق اعتمده المدير دون حدث
    مراجعة ظاهر». `late_item_ids` ما أُقرّت مراجعته من الحركات المتأخرة (SHIFT-05 conflict)."""

    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name="adjustments")
    signed_amount_minor = models.BigIntegerField()
    approved_by_user_id = models.UUIDField()
    approved_by_name = models.CharField(max_length=200, blank=True, default="")
    reason = models.CharField(max_length=300, blank=True, default="")
    late_item_ids = models.JSONField(default=list)
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="shifts_cashadjustment_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.shift_id}:{self.signed_amount_minor}:{self.approved_by_name}"
