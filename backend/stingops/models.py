"""PLT — منصة المشغّل: حسابات تشغيل منفصلة (تحقّق ثنائي دائماً)، وجلسات مقيّدة ومسجَّلة،
ووصول دعم مقيّد بتذكرة من المالك (ACC-60 · ACC-62). لا صف هنا يحمل بيانات دفتر مستأجر."""

from __future__ import annotations

from typing import ClassVar

from django.db import models
from django.utils import timezone

from core.ids import uuid7
from core.models import Tenant, User


class OperatorProfile(models.Model):
    """مشغّل الخدمة = مستخدم منصة (`is_platform_staff`) بسرّ TOTP — لا استثناء «أجهزة موثوقة»."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.OneToOneField(User, on_delete=models.PROTECT, related_name="operator_profile")
    totp_secret = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    objects: ClassVar[models.Manager[OperatorProfile]] = models.Manager()

    def __str__(self) -> str:
        return f"operator:{self.user_id}"


class OperatorAccessLog(models.Model):
    """كل فتح سجل مستأجر يُدقَّق: من، أيّ مستأجر، ماذا، متى، وبأيّ تذكرة إن كانت قراءة دعم."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    operator = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    tenant = models.ForeignKey(
        Tenant, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    action = models.CharField(max_length=40)
    detail = models.CharField(max_length=300, blank=True, default="")
    ticket_ref = models.CharField(max_length=40, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)

    objects: ClassVar[models.Manager[OperatorAccessLog]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.action}@{self.tenant_id}"


class SupportGrant(models.Model):
    """وصول دعم مقيّد: تذكرة مفتوحة من المالك، نطاق زمني، سبب مكتوب — يظهر في سجل تدقيقه هو."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="+")
    ticket_ref = models.CharField(max_length=40)
    reason = models.CharField(max_length=300)
    hours = models.PositiveIntegerField(default=48)
    granted_by_name = models.CharField(max_length=200)
    granted_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    objects: ClassVar[models.Manager[SupportGrant]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.ticket_ref}@{self.tenant_id}"


class ProofClaim(models.Model):
    """PLT-03: المراجعة تُحجز لشخص واحد 15 دقيقة ويظهر اسمه لبقية الفريق — لا اعتمادان متوازيان."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    proof_id = models.UUIDField()
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="+")
    operator = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    claimed_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    released_at = models.DateTimeField(null=True, blank=True)
    handover_requested_by = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    objects: ClassVar[models.Manager[ProofClaim]] = models.Manager()

    def __str__(self) -> str:
        return f"claim:{self.proof_id}"


class PlatformAnnouncement(models.Model):
    """PLT-04: إعلان منصة أو نافذة صيانة — بموعد وأثر ومدة وجمهور معلَن قبل الجدولة؛ لا وعد بميزة
    لباقة لا تشملها (ACC-104). يغذّي PUB-03 ولا يُرسل شيئاً للزبائن النهائيين."""

    class Kind(models.TextChoices):
        MAINTENANCE = "maintenance", "صيانة مجدولة"
        NOTICE = "notice", "إعلان"

    class Audience(models.TextChoices):
        ALL = "all", "كل المتاجر"
        MARKET = "market", "متاجر ذات مزامنة سوق فعّالة"

    class Status(models.TextChoices):
        DRAFT = "draft", "مسودة"
        SCHEDULED = "scheduled", "مجدول"
        CANCELLED = "cancelled", "أُلغي"
        DONE = "done", "انتهى"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.MAINTENANCE)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=600)
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.MARKET)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    audience_count = models.PositiveIntegerField(default=0)
    created_by_name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by_name = models.CharField(max_length=200, blank=True, default="")

    objects: ClassVar[models.Manager[PlatformAnnouncement]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.kind}:{self.title}"


class ChannelState(models.Model):
    """PLT-05: حالة قناة إرسال كما يعلنها المشغّل (تعطّل معلَن/يعمل) — لا مفاتيح ولا أسرار مزوّد؛
    التحويل إلى الاحتياطي يُسجَّل ولا يحدث صامتاً، وما لم يُرسل يبقى «بانتظار قناة» لا «فشل نهائي»."""

    class Key(models.TextChoices):
        SMS_PRIMARY = "sms_primary", "الرسائل النصية — المزوّد الأساسي"
        SMS_FALLBACK = "sms_fallback", "الرسائل النصية — الاحتياطي"
        PUSH = "push", "إشعارات التطبيق"
        EMAIL = "email", "البريد التشغيلي"

    class State(models.TextChoices):
        UP = "up", "يعمل"
        DOWN = "down", "متعذّر"

    key = models.CharField(max_length=16, choices=Key.choices, unique=True)
    state = models.CharField(max_length=6, choices=State.choices, default=State.UP)
    note = models.CharField(max_length=300, blank=True, default="")
    changed_at = models.DateTimeField(default=timezone.now)
    changed_by_name = models.CharField(max_length=200, blank=True, default="")

    objects: ClassVar[models.Manager[ChannelState]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.key}:{self.state}"


class ServerBackup(models.Model):
    """PLT-10: نسخة خادمية (ليلية/أسبوعية) كما يسجّلها مسار النسخ — الوجود ليس صلاحية؛ الصلاحية
    تُثبتها تجربة استعادة (ACC-75)."""

    class Kind(models.TextChoices):
        NIGHTLY = "nightly", "ليلية"
        WEEKLY = "weekly", "أسبوعية"

    class Status(models.TextChoices):
        OK = "ok", "صالحة"
        FAILED = "failed", "فشلت"
        INCOMPLETE = "incomplete", "لم تكتمل"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.NIGHTLY)
    taken_at = models.DateTimeField()
    size_bytes = models.BigIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OK)
    note = models.CharField(max_length=300, blank=True, default="")
    # عدد صفوف الجداول الأساسية وقت النسخ — مرجع تحقّق السلامة في التجربة
    table_counts = models.JSONField(default=dict, blank=True)
    location_ref = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[models.Manager[ServerBackup]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.kind}:{self.taken_at:%Y-%m-%d}:{self.status}"


class RestoreDrill(models.Model):
    """PLT-10: تجربة استعادة مسجَّلة بمن نفّذها ومتى ونتيجتها — RPO/RTO نتيجةً لا وعداً؛ الاستعادة
    الحيّة لا تُنفَّذ من هنا، تُسجَّل طلباً بمسار متعدّد الموافقات فقط."""

    class Target(models.TextChoices):
        ISOLATED = "isolated", "بيئة معزولة"
        LIVE = "live", "بيانات حيّة"

    class Result(models.TextChoices):
        OK = "ok", "ناجحة"
        FAILED = "failed", "فشلت"
        BLOCKED = "blocked", "مُنعت"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    backup = models.ForeignKey(ServerBackup, on_delete=models.PROTECT, related_name="drills")
    target = models.CharField(max_length=8, choices=Target.choices, default=Target.ISOLATED)
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    result = models.CharField(max_length=8, choices=Result.choices, default=Result.OK)
    rpo_minutes = models.PositiveIntegerField(default=0)
    rto_minutes = models.PositiveIntegerField(default=0)
    integrity_pct = models.PositiveSmallIntegerField(default=0)
    detail = models.CharField(max_length=400, blank=True, default="")
    by_name = models.CharField(max_length=200)
    second_approver_name = models.CharField(max_length=200, blank=True, default="")
    environment_confirmation = models.CharField(max_length=120, blank=True, default="")

    objects: ClassVar[models.Manager[RestoreDrill]] = models.Manager()

    def __str__(self) -> str:
        return f"drill:{self.backup_id}:{self.result}"
