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

    class Role(models.TextChoices):
        ADMIN = "admin", "مدير المنصة"
        SUPPORT = "support", "الدعم"

    # 0005 §١١٨ — «الدعم» يقرأ كل شيء ولا يغيّر إلا طلبات الجولة؛ المالي والتسعير والأعلام
    # والمشغّلون لمدير المنصة (`stingops.roles`)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.ADMIN)
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


class DailyCounter(models.Model):
    """PLT-11: عدّاد يومي بلا هوية (زيارات السوق المجهولة) — أرقام M0 من السجلّ لا من تخمين."""

    day = models.DateField()
    key = models.CharField(max_length=40)
    count = models.PositiveIntegerField(default=0)

    objects: ClassVar[models.Manager[DailyCounter]] = models.Manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["day", "key"], name="stingops_dailycounter_day_key"),
        ]

    def __str__(self) -> str:
        return f"{self.key}@{self.day}={self.count}"


class M0Snapshot(models.Model):
    """PLT-11: تجميع شهري محسوب عبر كل المستأجرين بختمه الزمني — يُقرأ بختمه لا كأنه حتى اللحظة."""

    month = models.CharField(max_length=7, unique=True)  # YYYY-MM
    computed_at = models.DateTimeField()
    payload = models.JSONField(default=dict)
    computed_by_name = models.CharField(max_length=200, blank=True, default="")

    objects: ClassVar[models.Manager[M0Snapshot]] = models.Manager()

    def __str__(self) -> str:
        return f"m0:{self.month}"


class PlanEntitlement(models.Model):
    """PLT-12: تجاوز استحقاق على مستوى الباقة (لا فوق مستأجر بعينه) — يرثه كل مستأجر ضمن حدوده،
    ويغيّر `has_feature` فوراً."""

    plan_code = models.CharField(max_length=20)
    feature = models.CharField(max_length=40)
    enabled = models.BooleanField(default=True)
    changed_at = models.DateTimeField(default=timezone.now)
    changed_by_name = models.CharField(max_length=200, blank=True, default="")

    objects: ClassVar[models.Manager[PlanEntitlement]] = models.Manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["plan_code", "feature"], name="stingops_planentitlement_plan_feature"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.plan_code}:{self.feature}={self.enabled}"


class OpsFlag(models.Model):
    """PLT-12: علم تشغيل بنطاق صريح (باقة أو بيئة) — علمٌ بلا نطاق قد يتسرّب إلى الجميع فيُمنع."""

    class ScopeKind(models.TextChoices):
        PLAN = "plan", "باقة"
        ENV = "env", "بيئة"

    key = models.CharField(max_length=40)
    scope_kind = models.CharField(max_length=4, choices=ScopeKind.choices)
    scope = models.CharField(max_length=40)
    enabled = models.BooleanField(default=False)
    note = models.CharField(max_length=300, blank=True, default="")
    changed_at = models.DateTimeField(default=timezone.now)
    changed_by_name = models.CharField(max_length=200, blank=True, default="")

    objects: ClassVar[models.Manager[OpsFlag]] = models.Manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["key", "scope_kind", "scope"], name="stingops_opsflag_key_scope"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.key}@{self.scope_kind}:{self.scope}={self.enabled}"


class DemoRequest(models.Model):
    """قسم «تواصل» في صفحة الهبوط (PUB-01): طلب جولة قصيرة — يُحفظ على مستوى المنصة (لا مستأجر)
    ويقرأه المشغّل؛ لا وعد بموعد ولا إرسال آلي (لا مزوّد رسائل بعد — G-02)."""

    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "واتساب"
        CALL = "call", "مكالمة"
        EMAIL = "email", "بريد"

    class Status(models.TextChoices):
        NEW = "new", "جديد"
        CONTACTED = "contacted", "تواصلنا"
        CONVERTED = "converted", "تحوّل"
        CLOSED = "closed", "أُغلق"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    name = models.CharField(max_length=200)
    whatsapp = models.CharField(max_length=40)
    email = models.CharField(max_length=254, blank=True, default="")
    channel = models.CharField(max_length=8, choices=Channel.choices)
    message = models.TextField(blank=True, default="")
    source_path = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    handled_at = models.DateTimeField(null=True, blank=True)
    handled_by_name = models.CharField(max_length=200, blank=True, default="")
    # PLT-14: حالة المتابعة وملاحظة المشغّل (0005 §١٠١)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW)
    note = models.TextField(blank=True, default="")

    objects: ClassVar[models.Manager[DemoRequest]] = models.Manager()

    class Meta:
        indexes = [
            models.Index(fields=["created_at"], name="stingops_demoreq_created"),
            models.Index(fields=["status", "created_at"], name="stingops_demoreq_status"),
        ]

    def __str__(self) -> str:
        return f"{self.name} · {self.channel}"


class SubscriptionEvent(models.Model):
    """PLT-13: سجل اشتراك المستأجر على مستوى المنصة — كل تصرّف للمشغّل (تمديد/تغيير باقة/إيقاف/
    استئناف/ملاحظة) وكل مراجعة إثبات، بمن ومتى ولماذا. يُقرأ خطاً زمنياً في تفاصيل المستأجر."""

    class Kind(models.TextChoices):
        EXTEND = "extend", "تمديد"
        PLAN_CHANGE = "plan_change", "تغيير الباقة"
        SUSPEND = "suspend", "إيقاف"
        RESUME = "resume", "استئناف"
        NOTE = "note", "ملاحظة"
        LIMITS = "limits", "زيادة حدود"
        PROOF_APPROVED = "proof_approved", "اعتماد إثبات"
        PROOF_REJECTED = "proof_rejected", "رفض إثبات"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    days = models.IntegerField(default=0)
    from_plan = models.CharField(max_length=20, blank=True, default="")
    to_plan = models.CharField(max_length=20, blank=True, default="")
    expires_before = models.DateTimeField(null=True, blank=True)
    expires_after = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=300, blank=True, default="")
    by_name = models.CharField(max_length=200)
    at = models.DateTimeField(default=timezone.now)

    objects: ClassVar[models.Manager[SubscriptionEvent]] = models.Manager()

    class Meta:
        indexes = [models.Index(fields=["tenant", "at"], name="stingops_subevent_tenant_at")]

    def __str__(self) -> str:
        return f"{self.kind} · {self.tenant_id} · {self.at:%Y-%m-%d}"
