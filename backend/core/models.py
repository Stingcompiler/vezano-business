"""كيانات core (§٥.١).

Tenant → Branch → Device، Tenant → User → UserBranchAccess، Role، TenantSettings.

- عزل بثلاث طبقات (§٥.٤): RLS في الهجرة 0002، `TenantManager` هنا، ومفاتيح مركبة (tenant_id, id).
- عملة المؤسسة وأُسّها يُختاران عند التسجيل ويثبتان (§٦.٣) — حارس قاعدة بيانات في 0002.
- لا حذف اعتيادي: التعطيل حذف منطقي (§٥.٢).
"""

from __future__ import annotations

from typing import Any, ClassVar

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.db.models import Q

from core.ids import uuid7
from core.tenancy import TenantManager


class Tenant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    name = models.CharField(max_length=200)
    # ISO 4217 — الجنيه السوداني SDG بأُسّ 2 في النطاق الأول
    base_currency = models.CharField(max_length=3)
    base_currency_exponent = models.SmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[TenantManager] = TenantManager()
    unscoped: ClassVar[models.Manager[Tenant]] = models.Manager()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(base_currency__regex=r"^[A-Z]{3}$"), name="core_tenant_currency_iso4217"
            ),
            models.CheckConstraint(
                condition=Q(base_currency_exponent__gte=0) & Q(base_currency_exponent__lte=4),
                name="core_tenant_exponent_range",
            ),
            # هدف المفتاح المركب من الحركات المالية (§٦.٣)
            models.UniqueConstraint(
                fields=["id", "base_currency", "base_currency_exponent"],
                name="core_tenant_currency_target",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class TenantScoped(models.Model):
    """أساس كل كيان يخص مستأجراً: `tenant` + قيد (tenant_id, id) هدفاً للمفاتيح المركبة."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="+")

    objects: ClassVar[TenantManager] = TenantManager()
    unscoped: ClassVar[models.Manager[Any]] = models.Manager()

    class Meta:
        abstract = True


class Branch(TenantScoped):
    name = models.CharField(max_length=200)
    # بادئة الفرع في ترقيم الفواتير INV-<فرع>-<جهاز>-<سنة>-<تسلسل> (§٨.٢)
    code = models.CharField(max_length=6)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_branch_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "code"], name="core_branch_code_per_tenant"),
            models.CheckConstraint(
                condition=Q(code__regex=r"^[A-Z0-9]{2,6}$"), name="core_branch_code_format"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}"


class Device(TenantScoped):
    class Status(models.TextChoices):
        ACTIVE = "active", "فعّال"
        REVOKED = "revoked", "ملغى"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="devices")
    name = models.CharField(max_length=200)
    # بادئة الجهاز — لا يُعاد استخدامها داخل المستأجر ولو أُلغي الجهاز (§٨.٢)
    prefix = models.CharField(max_length=4)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    # هاش اعتماد التسجيل (§٩.١) — السر نفسه يُعرض مرة واحدة ولا يُحفظ
    registration_secret_hash = models.CharField(max_length=64, blank=True, default="")
    registered_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_device_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "prefix"], name="core_device_prefix_per_tenant"
            ),
            models.CheckConstraint(
                condition=Q(prefix__regex=r"^[A-Z0-9]{1,4}$"), name="core_device_prefix_format"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.prefix} · {self.name}"


class UserManager(TenantManager, BaseUserManager["User"]):
    def create_user(self, tenant: Tenant, username: str, display_name: str, **extra: Any) -> User:
        user: User = self.model(
            tenant=tenant, username=username, display_name=display_name, **extra
        )
        user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """مستخدم مسمّى داخل مستأجر (§٣.١). المصادقة البعيدة وPIN المحلي هويات مختلفة (§٩)."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    # NULL لموظفي منصة Sting فقط (مشغّل الخدمة وناشر إعلاناتها — §٣.١)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    # الحساب (هوية المنصة) الذي تنتمي إليه هذه العضوية — اختياري: مستخدم الجهاز/PIN بلا حساب
    # يبقى صالحاً (0005 §٤)
    account = models.ForeignKey(
        "Account", on_delete=models.SET_NULL, null=True, blank=True, related_name="memberships"
    )
    username = models.CharField(max_length=150)
    display_name = models.CharField(max_length=200)
    is_owner = models.BooleanField(default=False)
    is_platform_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS: ClassVar[list[str]] = ["display_name"]

    objects: ClassVar[UserManager] = UserManager()
    unscoped: ClassVar[models.Manager[User]] = models.Manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_user_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "username"], name="core_user_username_per_tenant"
            ),
            # موظف المنصة بلا مستأجر وبعلم صريح؛ مستخدم المستأجر بمستأجر وبلا العلم
            models.CheckConstraint(
                condition=(Q(tenant__isnull=True) & Q(is_platform_staff=True))
                | (Q(tenant__isnull=False) & Q(is_platform_staff=False)),
                name="core_user_platform_xor_tenant",
            ),
        ]

    def __str__(self) -> str:
        return self.display_name


class Account(models.Model):
    """حساب على مستوى المنصة — هوية واحدة بعدة عضويات (0005 §٤؛ الإطار ACC-01 «لي حساب — دخول»).

    المعرّف هاتف أو بريد مطبَّع (`core.auth.accounts.normalize_identifier`). كلمة المرور بمشفّرات
    Django. المصادقة البعيدة لحساب المالك أقوى من PIN الكاشير (§٩.١) — PIN لا يمرّ من هنا.
    """

    class Kind(models.TextChoices):
        PHONE = "phone", "هاتف"
        EMAIL = "email", "بريد"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    identifier = models.CharField(max_length=254, unique=True)
    identifier_kind = models.CharField(max_length=8, choices=Kind.choices)
    password = models.CharField(max_length=128)
    display_name = models.CharField(max_length=200, blank=True, default="")
    is_active = models.BooleanField(default=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    # قفل الدخول التصاعدي المعلن (D26 «بعد خمس محاولات») — يُصفَّر عند نجاح الدخول
    failed_logins = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    unscoped: ClassVar[models.Manager[Account]] = models.Manager()

    def __str__(self) -> str:
        return self.identifier


class VerificationCode(models.Model):
    """رمز تحقق محايد القناة (G-02): يُحفظ مشفّراً، يعيش مدة معلنة، ولإعادة إرساله حدّ وعدّاد."""

    class Purpose(models.TextChoices):
        REGISTER = "register", "تسجيل"
        RECOVER = "recover", "استعادة"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    identifier = models.CharField(max_length=254)
    purpose = models.CharField(max_length=10, choices=Purpose.choices)
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    # عدد مرات الإرسال للرمز الحيّ نفسه (الأول + إعادات) وآخر وقت إرسال — لعدّاد «متاحة بعد N ثانية»
    sends = models.PositiveIntegerField(default=1)
    last_sent_at = models.DateTimeField()
    send_failures = models.PositiveIntegerField(default=0)
    confirm_attempts = models.PositiveIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    unscoped: ClassVar[models.Manager[VerificationCode]] = models.Manager()

    class Meta:
        indexes = [models.Index(fields=["identifier", "purpose", "created_at"])]

    def __str__(self) -> str:
        return f"verify:{self.purpose}:{self.identifier}"


class ManualVerificationRequest(models.Model):
    """طلب تحقق يدوي بالدعم — مسار مكتمل لا استثناء طارئ (13-D8 G-02)."""

    class Status(models.TextChoices):
        OPEN = "open", "مفتوح"
        APPROVED = "approved", "مقبول"
        REJECTED = "rejected", "مرفوض"

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    identifier = models.CharField(max_length=254)
    purpose = models.CharField(max_length=10, choices=VerificationCode.Purpose.choices)
    tenant_name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    unscoped: ClassVar[models.Manager[ManualVerificationRequest]] = models.Manager()

    def __str__(self) -> str:
        return f"manual:{self.identifier}:{self.status}"


class Unit(TenantScoped):
    """وحدة قياس للمنشأة (§١١.٤: حبة، كرتونة، كيلو). معامل التحويل يُحدَّد للصنف لا هنا (§٦.٢)."""

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=60)
    # الوحدة الأساسية التي تُحسب بها الكميات (milli) — واحدة لكل نوع قياس
    is_base = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_unit_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "code"], name="core_unit_code_per_tenant"),
        ]

    def __str__(self) -> str:
        return self.name


class PaymentMethod(TenantScoped):
    """طريقة دفع معلنة (§١١.٤: نقداً، تحويلاً بنكياً). النقد وحده يدخل الدرج (§١٠.٣)."""

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=60)
    is_cash = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_paymentmethod_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "code"], name="core_paymentmethod_code_per_tenant"
            ),
        ]

    def __str__(self) -> str:
        return self.name


class TenantCreation(models.Model):
    """سجل إنشاء منشأة بهوية طلب من العميل — «لا إعادة عمياء: نستعلم عن الحالة أولاً»
    (34-D26 ACC-04).

    مستوى المنصة (RLS للمنصة وحدها). الإنشاء ذرّي: إمّا سجل مكتمل بنتيجته أو لا سجل.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="creations")
    client_request_id = models.UUIDField()
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="+")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="+")
    sector = models.CharField(max_length=40)
    created_counts = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    unscoped: ClassVar[models.Manager[TenantCreation]] = models.Manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_request_id"], name="core_tenantcreation_request"
            )
        ]

    def __str__(self) -> str:
        return f"creation:{self.client_request_id}"


class Invitation(TenantScoped):
    """دعوة موظف أو منشأة سوق (ACC-06؛ §١٤.٦): عضوية داخل هذه المنشأة فقط — لا ملف عام ولا نشر.

    الرمز يُحفظ هاشاً؛ الدعوة مرتبطة بمعرّف المدعوّ فلا تُقبل بحساب آخر (لا نُفشي لمن كانت).
    القبول يُسجَّل مرة واحدة ولا يُستهلك بالفشل (34-D26 server_error).
    """

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="invitations")
    role = models.ForeignKey("Role", on_delete=models.PROTECT, related_name="+")
    inviter = models.ForeignKey(User, on_delete=models.PROTECT, related_name="sent_invitations")
    invitee_identifier = models.CharField(max_length=254)
    token_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    accepted_user = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True, related_name="accepted_invitation"
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_invitation_tenant_id"),
            models.UniqueConstraint(fields=["token_hash"], name="core_invitation_token"),
        ]

    def __str__(self) -> str:
        return f"invite:{self.invitee_identifier}@{self.tenant_id}"


class Role(TenantScoped):
    """الأدوار الافتراضية بيانات قابلة للضبط (§٣.١)؛ سقوف التفويض تُضاف مع G-09."""

    code = models.CharField(max_length=40)
    name = models.CharField(max_length=100)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_role_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "code"], name="core_role_code_per_tenant"),
        ]

    def __str__(self) -> str:
        return self.name


class UserBranchAccess(TenantScoped):
    """تخويل مستخدم على فرع بدور؛ التخويل الخادمي مطلوب حتى لو أخفت الواجهة الزر (§٣.١)."""

    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="branch_access")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="user_access")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="+")
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_uba_tenant_id"),
            models.UniqueConstraint(fields=["user", "branch"], name="core_uba_user_branch"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.branch_id}"


class TenantSettings(models.Model):
    """إعدادات بمجالات JSONB locale/sales/inventory/pos/branding مع مخطط تحقق (§١١.٣)."""

    tenant = models.OneToOneField(
        Tenant, on_delete=models.CASCADE, primary_key=True, related_name="settings"
    )
    locale = models.JSONField(default=dict, blank=True)
    sales = models.JSONField(default=dict, blank=True)
    inventory = models.JSONField(default=dict, blank=True)
    pos = models.JSONField(default=dict, blank=True)
    branding = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects: ClassVar[TenantManager] = TenantManager()
    unscoped: ClassVar[models.Manager[TenantSettings]] = models.Manager()

    def __str__(self) -> str:
        return f"settings:{self.tenant_id}"


class Session(models.Model):
    """جلسة مستخدم (وجهاز نقل إن وُجد) — مرجع الإلغاء الذي يفحصه الخادم مع كل طلب (§٩.٤).

    لا ترث TenantScoped لأن جلسة موظف المنصة بلا مستأجر؛ تُقيَّد بـ RLS وبالمدير نفسه.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="sessions")
    device = models.ForeignKey(
        Device, on_delete=models.PROTECT, null=True, blank=True, related_name="sessions"
    )
    user_agent = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    # ACC-09: «أنهِ بعد رفع المعلّق» — يُنفَّذ حين يبلّغ الجهاز أن طابوره فرغ (بعد PUSH)
    revoke_after_upload = models.BooleanField(default=False)
    # آخر عدد معلّق أبلغه الجهاز عبر PUSH — «هذا الجهاز عليه N عملية لم تُرفع» قبل التأكيد
    reported_pending = models.PositiveIntegerField(null=True, blank=True)
    reported_pending_at = models.DateTimeField(null=True, blank=True)

    objects: ClassVar[TenantManager] = TenantManager()
    unscoped: ClassVar[models.Manager[Session]] = models.Manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_session_tenant_id")
        ]

    def __str__(self) -> str:
        return f"session:{self.id}"


class PinVerifier(TenantScoped):
    """متحقق PIN مشتق (PBKDF2) — لا PIN نصي، ينزل إلى أجهزة صاحبه فقط (§٩.١، §٨.٦)."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="pin_verifier")
    encoded = models.CharField(max_length=200)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_pinverifier_tenant_id")
        ]

    def __str__(self) -> str:
        return f"pin:{self.user_id}:v{self.version}"

    @classmethod
    def next_version(cls, user: User) -> int:
        current = cls.unscoped.filter(user=user).values_list("version", flat=True).first()
        return (current or 0) + 1
