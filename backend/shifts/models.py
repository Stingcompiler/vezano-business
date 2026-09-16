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
    counted_cash_minor = models.BigIntegerField(null=True, blank=True)
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
    occurred_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="shifts_cashmovement_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.shift_id}:{self.kind}:{self.signed_amount_minor}"
