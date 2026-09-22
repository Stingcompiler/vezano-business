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
from django.utils import timezone

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
        # SYS-07 (16-D11): تجميد فوري — لا بيع جديد ولا وصول، والمحفوظ باقٍ قابلاً للاسترداد
        FROZEN = "frozen", "مجمَّد"
        # محو عن بُعد بعد إقرار مكتوب — لا استرداد بعده
        WIPED = "wiped", "ممحو"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="devices")
    name = models.CharField(max_length=200)
    # بادئة الجهاز — لا يُعاد استخدامها داخل المستأجر ولو أُلغي الجهاز (§٨.٢)
    prefix = models.CharField(max_length=4)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    # هاش اعتماد التسجيل (§٩.١) — السر نفسه يُعرض مرة واحدة ولا يُحفظ
    registration_secret_hash = models.CharField(max_length=64, blank=True, default="")
    registered_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    frozen_at = models.DateTimeField(null=True, blank=True)
    wiped_at = models.DateTimeField(null=True, blank=True)
    # إقرار المالك المكتوب بأن المعلّق على الجهاز يُعدّ مفقوداً — يبقى في سجل التدقيق
    wipe_acknowledgement = models.TextField(blank=True, default="")
    wiped_by_name = models.CharField(max_length=200, blank=True, default="")

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
    # ORG-05: التعطيل ليس حذفاً — يبقى الاسم فاعلاً؛ من عطّل ومتى ولماذا (يُقرأ في سجل التدقيق)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    deactivated_by_name = models.CharField(max_length=200, blank=True, default="")
    deactivation_reason = models.CharField(max_length=300, blank=True, default="")
    # ORG-09: «مالك سابق» بتاريخ انتهاء ولايته — لا يُمحى من أفعاله
    former_owner_until = models.DateTimeField(null=True, blank=True)
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


class DeviceEndpoint(TenantScoped):
    """اشتراك Web Push لجهاز (WEB-02؛ §١١.٦، §١١.٨؛ ACC-107، 113): نقطة النهاية سرٌّ تشغيلي — لا
    تُعاد في أي ردّ ولا تُسجَّل؛ تُخزَّن كاملةً للإرسال وبصمتها للمطابقة. الجهاز الواحد اشتراك واحد
    فعّال؛ الانتهاء عند المزوّد (410/404) يوسم `expired_at` ويجدَّد بصمت من الجهاز إن كان الإذن
    قائماً. التنبيهات بلا محتوى حساس — عناوين ثابتة فقط."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="push_endpoints")
    user = models.UUIDField()
    endpoint = models.TextField()
    endpoint_sha256 = models.CharField(max_length=64)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expired_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_deviceendpoint_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "endpoint_sha256"], name="core_deviceendpoint_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"push:{self.device_id}:{self.endpoint_sha256[:8]}"


class Unit(TenantScoped):
    """وحدة قياس للمنشأة (§١١.٤: حبة، كرتونة، كيلو). معامل التحويل يُحدَّد للصنف لا هنا (§٦.٢)."""

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=60)
    # الوحدة الأساسية التي تُحسب بها الكميات (milli) — واحدة لكل نوع قياس
    is_base = models.BooleanField(default=False)
    # `decimal_places` بين 0 و3 يحكم الإدخال والعرض (§٦.٢): الحبة 0، الكيلو 3
    decimal_places = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_unit_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "code"], name="core_unit_code_per_tenant"),
            models.CheckConstraint(
                condition=models.Q(decimal_places__lte=3), name="core_unit_decimal_places_max3"
            ),
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


class RolePermission(TenantScoped):
    """خلية في مصفوفة الأدوار (ORG-02؛ G-09): الصلاحية تُمنح للدور، والقيمة إمّا نعم/لا أو نطاق
    (فرعه، عميل البيع فقط، نقداً فقط، اقتراح فقط) أو حدّ مالي بالوحدة الصغرى ومداه (للعملية/يومياً).
    الحدود قيم تجريبية تُحرَّر هنا؛ التغيير لا يمسّ عمليات سابقة."""

    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="permissions")
    key = models.CharField(max_length=40)
    value = models.CharField(
        max_length=20
    )  # yes|no|unlimited|limit|branch|own_customer|cash_only|propose
    limit_minor = models.BigIntegerField(null=True, blank=True)
    period = models.CharField(max_length=10, blank=True, default="")  # per_op|daily|""
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_rolepermission_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "role", "key"], name="core_rolepermission_role_key"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.role_id}:{self.key}={self.value}"


class ReceiptCounter(models.Model):
    """عدّاد أرقام إيصالات الاشتراك على مستوى المنصة لكل سنة — `SR-YYYY-NNNNNN` (0005 §١١١)."""

    year = models.PositiveIntegerField(primary_key=True)
    last = models.PositiveIntegerField(default=0)

    objects: ClassVar[models.Manager[ReceiptCounter]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.year}:{self.last}"


class SubscriptionReceipt(TenantScoped):
    """إيصال اشتراك مرقَّم يُصدر عند اعتماد إثبات التحويل (ORG-07 → PLT-03) — يراه المالك في
    ORG-06/07 ويطبعه. ليس فاتورة ضريبية؛ يثبت المبلغ والباقة والفترة ورقم التحويل ومن اعتمده."""

    number = models.CharField(max_length=20, unique=True)
    proof = models.OneToOneField(
        "SubscriptionProof", on_delete=models.PROTECT, related_name="receipt"
    )
    tenant_name = models.CharField(max_length=200)
    plan_code = models.CharField(max_length=20)
    plan_name = models.CharField(max_length=60)
    cycle = models.CharField(max_length=10, default="monthly")
    cycle_label = models.CharField(max_length=20, default="شهري")
    amount_minor = models.BigIntegerField()
    currency = models.CharField(max_length=3, default="SDG")
    reference = models.CharField(max_length=64)
    period_from = models.DateTimeField()
    period_to = models.DateTimeField()
    issued_at = models.DateTimeField(default=timezone.now)
    issued_by_name = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_subreceipt_tenant_id"),
        ]
        indexes = [models.Index(fields=["tenant", "issued_at"], name="core_subreceipt_issued")]

    def __str__(self) -> str:
        return self.number


class PlanCatalog(models.Model):
    """كتالوج الباقات والتسعير (PLT-16؛ 0005 §١١٠) — على مستوى المنصة لا المستأجر. يحرّره المشغّل؛
    `core.subscription.PLANS` يقرأه. السعر لكل دورة (شهري/ربعي/سنوي — 0 = غير معروضة)، وسعر مقبل
    بتاريخ سريان (إشعار 30 يوماً كما تعد الشروط)."""

    code = models.SlugField(max_length=20, primary_key=True)
    name = models.CharField(max_length=60)
    blurb = models.CharField(max_length=200, blank=True, default="")
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    trial = models.BooleanField(default=False)
    trial_days = models.PositiveIntegerField(default=30)
    max_branches = models.PositiveIntegerField(default=1)
    max_devices = models.PositiveIntegerField(default=3)
    max_users = models.PositiveIntegerField(null=True, blank=True)
    campaign_quota = models.PositiveIntegerField(default=0)
    features = models.JSONField(default=list, blank=True)
    price_monthly_minor = models.BigIntegerField(default=0)
    price_quarterly_minor = models.BigIntegerField(default=0)
    price_yearly_minor = models.BigIntegerField(default=0)
    next_price_monthly_minor = models.BigIntegerField(null=True, blank=True)
    next_price_quarterly_minor = models.BigIntegerField(null=True, blank=True)
    next_price_yearly_minor = models.BigIntegerField(null=True, blank=True)
    next_price_effective_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    objects: ClassVar[models.Manager[PlanCatalog]] = models.Manager()

    class Meta:
        ordering = ["order", "code"]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}"


class PlanChange(models.Model):
    """سجل تغييرات الكتالوج: من غيّر ماذا ومتى ولماذا."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    plan = models.ForeignKey(PlanCatalog, on_delete=models.CASCADE, related_name="changes")
    changes = models.JSONField(default=dict, blank=True)
    reason = models.CharField(max_length=300, blank=True, default="")
    by_name = models.CharField(max_length=200, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)

    objects: ClassVar[models.Manager[PlanChange]] = models.Manager()

    class Meta:
        ordering = ["-at"]

    def __str__(self) -> str:
        return f"{self.plan_id} · {self.at:%Y-%m-%d}"


class TenantSubscription(TenantScoped):
    """اشتراك المنشأة (§١١.١): باقة بحدود صريحة وتاريخ استحقاق وحالة. الانتهاء لا يحجب الدفتر
    (§١١.٢) — يُقرأ عبر `core.subscription`. صف واحد لكل منشأة (يُبذر تجريبياً كسولاً)."""

    class State(models.TextChoices):
        TRIAL = "trial", "تجريبية"
        ACTIVE = "active", "سارية"
        EXPIRED = "expired", "منتهية"

    plan_code = models.CharField(max_length=20)
    state = models.CharField(max_length=10, choices=State.choices, default=State.TRIAL)
    started_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    extra_features = models.JSONField(default=list, blank=True)
    renewal_amount_minor = models.BigIntegerField(default=0)
    # PLT-13: إيقاف من المشغّل بسبب مسجَّل — يوقف الميزات المدفوعة كالانتهاء ولا يحجب الدفتر
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspended_reason = models.CharField(max_length=300, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="core_tenantsubscription_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant"], name="core_tenantsubscription_one_per_tenant"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.plan_code}:{self.state}"


class SubscriptionProof(TenantScoped):
    """إثبات تحويل الاشتراك (ORG-07؛ §١٦.٢): الرفع لا يُفعِّل — «معلّق» حتى مراجعة بشرية؛ رقم
    العملية البنكية إلزامي (بلا رقم لا يُمنع الاعتماد المزدوج — PLT-03) وفريد؛ الاعتماد يمدّد
    مرة واحدة بمرجعه."""

    class Status(models.TextChoices):
        PENDING = "pending", "معلّق للمراجعة"
        APPROVED = "approved", "معتمد"
        REJECTED = "rejected", "مرفوض"

    reference = models.CharField(max_length=64)
    plan_code = models.CharField(max_length=20)
    amount_minor = models.BigIntegerField()
    period_label = models.CharField(max_length=40, blank=True, default="")
    # دورة الفوترة (0005 §١١٠): monthly=30 · quarterly=90 · yearly=365 يوماً
    cycle = models.CharField(max_length=10, default="monthly")
    image_name = models.CharField(max_length=200, blank=True, default="")
    image_size = models.BigIntegerField(default=0)
    image_data = models.TextField(blank=True, default="")  # base64 (≤ 2 MB) — لا تخزين ملفات بعد
    note = models.CharField(max_length=300, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    submitted_at = models.DateTimeField(default=timezone.now)
    submitted_by_name = models.CharField(max_length=200, blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by_name = models.CharField(max_length=200, blank=True, default="")
    rejection_reason = models.CharField(max_length=300, blank=True, default="")
    extension_days = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="core_subscriptionproof_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "reference"], name="core_subscriptionproof_reference"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.reference}:{self.status}"


class AuditEvent(TenantScoped):
    """سجل التدقيق (ORG-10؛ §١٣.٥): فاعل ووقت وسبب، ولا تعديل — يُقرأ ويُصفّى ويُصدَّر ولا يُحرَّر
    ولو من المالك؛ التصحيح قيد جديد يشير إلى الأول. بلا حمولات سرّية."""

    at = models.DateTimeField(default=timezone.now)
    actor_user_id = models.UUIDField(null=True, blank=True)
    actor_name = models.CharField(max_length=200, blank=True, default="")
    actor_role = models.CharField(max_length=60, blank=True, default="")
    branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    detail = models.CharField(max_length=400, blank=True, default="")
    reason = models.CharField(max_length=300, blank=True, default="")
    sensitive = models.BooleanField(default=False)
    ref_entity = models.CharField(max_length=64, blank=True, default="")
    ref_id = models.UUIDField(null=True, blank=True)
    refers_to = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_auditevent_tenant_id"),
        ]
        indexes = [models.Index(fields=["tenant", "at"], name="core_audit_tenant_at")]

    def __str__(self) -> str:
        return f"{self.kind}@{self.at:%Y-%m-%d}"


class OwnershipTransfer(TenantScoped):
    """نقل ملكية المنشأة (ORG-09؛ 20-D15): أخطر إجراء — لا نقل أثناء وردية مفتوحة أو معلّق غير
    مرفوع؛ المالك الجديد عضو له حساب قائم مُثبَت؛ تأكيد من الطرفين خلال 24 ساعة وإلا أُلغي
    وسُجّل؛ المالك السابق يبقى «مالك سابق» بتاريخ انتهاء ولايته."""

    class State(models.TextChoices):
        PENDING = "pending", "بانتظار تأكيد المالك الجديد"
        CONFIRMED = "confirmed", "نُفّذ"
        CANCELLED = "cancelled", "أُلغي"
        EXPIRED = "expired", "انقضى"

    from_user_id = models.UUIDField()
    from_user_name = models.CharField(max_length=200)
    to_user_id = models.UUIDField()
    to_user_name = models.CharField(max_length=200)
    state = models.CharField(max_length=10, choices=State.choices, default=State.PENDING)
    requested_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="core_ownershiptransfer_tenant_id"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.from_user_name}→{self.to_user_name}:{self.state}"


class ReportExport(TenantScoped):
    """REP-06: تصدير تقرير ومعاينته — الورقة التي تخرج من النظام إلى محاسبٍ أو بنك. المدى في اسم
    الملف نفسه؛ الترويسة تقول أي مدى يغطيه ومتى حُسب؛ يُحصى ويُحدّ بالباقة (§١٤.١)."""

    REPORTS = (
        ("sales", "تقرير المبيعات"),
        ("receivables", "تقرير الذمم"),
        ("stock", "تقرير المخزون"),
        ("cash", "تقرير الصندوق"),
    )
    FORMATS = (("html", "HTML"), ("csv", "CSV"))

    report = models.CharField(max_length=16, choices=REPORTS)
    fmt = models.CharField(max_length=4, choices=FORMATS, default="html")
    range_start = models.DateField()
    range_end = models.DateField()
    branch_id = models.UUIDField(null=True, blank=True)
    file_name = models.CharField(max_length=240)
    byte_size = models.PositiveIntegerField(default=0)
    page_count = models.PositiveIntegerField(default=1)
    row_count = models.PositiveIntegerField(default=0)
    token = models.CharField(max_length=64, unique=True)
    #: المستند نفسه كما وُلِّد — التنزيل يعيده حرفياً (لا يُعاد الحساب)
    body = models.TextField()
    generated_by_user_id = models.UUIDField()
    generated_by_name = models.CharField(max_length=200, blank=True, default="")
    generated_at = models.DateTimeField(auto_now_add=True)
    open_count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_reportexport_tenant_id"),
        ]

    def __str__(self) -> str:
        return self.file_name


class Notification(TenantScoped):
    """NOT-01: صندوق الوارد — مصدر الحقيقة خادمي؛ التشغيلي فوق التسويقي دائماً (§١١.٥). الإشعار
    المنتهي يُوسم ولا يُمحى؛ ما يخصّ المالك يظهر عنوانه للموظف ويُحجب محتواه؛ الرابط داخل الإشعار
    يحمل صلاحية (ACC-113)."""

    CATEGORIES = (
        ("operational", "تشغيلي"),
        ("account", "حسابي"),
        ("marketing", "تسويقي"),
    )

    kind = models.CharField(max_length=40)
    category = models.CharField(max_length=12, choices=CATEGORIES)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True, default="")
    #: الوجهة داخل التطبيق وشاشتها (SHIFT-05، SYS-01…) — تُعرض بديلاً حين تنتهي صلاحية الرابط
    href = models.CharField(max_length=200, blank=True, default="")
    screen = models.CharField(max_length=16, blank=True, default="")
    needs_action = models.BooleanField(default=False)
    owner_only = models.BooleanField(default=False)
    branch_id = models.UUIDField(null=True, blank=True)
    #: مفتاح إزالة التكرار عند إعادة الاشتقاق (وردية بعينها، جهاز بعينه…)
    dedupe_key = models.CharField(max_length=120)
    occurred_at = models.DateTimeField(default=timezone.now)
    #: صلاحية موضوع الإشعار (عرض سوق/دعوة) — بعدها «إشعار انتهت صلاحيته»
    expires_at = models.DateTimeField(null=True, blank=True)
    #: زال سببه (أُقفلت الوردية، رُفع المعلّق) — يبقى في السجل موسوماً
    resolved_at = models.DateTimeField(null=True, blank=True)
    read_user_ids = models.JSONField(default=list)
    link_token = models.CharField(max_length=64)
    link_expires_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_notification_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "dedupe_key"], name="core_notification_dedupe_once"
            ),
        ]
        indexes = [models.Index(fields=["tenant", "occurred_at"], name="core_notif_tenant_at")]

    def __str__(self) -> str:
        return f"{self.kind}:{self.title}"


class NotificationPreference(TenantScoped):
    """NOT-02: تفضيلات التنبيه لكل مستخدم — قنوات × أنواع. التشغيلي داخل التطبيق دائم لا يُطفأ
    (§١١.٦)؛ قناة بلا وجهة لا تُحفظ."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notification_prefs")
    #: {"operational": {"in_app": true, "sms": bool}, "account": {"in_app": bool, "email": bool},
    #:  "marketing": {"in_app": bool, "email": bool}}
    prefs = models.JSONField(default=dict)
    destination_email = models.EmailField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="core_notificationpreference_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "user"], name="core_notificationpreference_once_per_user"
            ),
        ]

    def __str__(self) -> str:
        return f"prefs:{self.user_id}"


class Campaign(TenantScoped):
    """NOT-03/04 (§١١.٥، §١١.٧، §١١.٨؛ ACC-103): حملة رسائل إلى جمهور من دفتر المنشأة وحدها —
    زبائن أذنوا أو اشتروا أو عليهم ذمم أو تابعوا صفحتها؛ لا جمهور مستأجر آخر بأي حال. الإنشاء
    والاعتماد صلاحيتان منفصلتان عمداً (NOT-05)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "مسودة"
        PENDING_APPROVAL = "pending_approval", "بانتظار الاعتماد"
        SCHEDULED = "scheduled", "مجدولة"
        SENDING = "sending", "جارية"
        DONE = "done", "اكتملت"
        CANCELLED = "cancelled", "أُلغيت"

    name = models.CharField(max_length=120)
    message = models.TextField(blank=True, default="")
    channel = models.CharField(max_length=8, default="sms")
    #: {"segments": ["subscribed","bought_90d","with_debt","market_followers"]}
    audience_rules = models.JSONField(default=dict)
    audience_count = models.PositiveIntegerField(default=0)
    excluded_count = models.PositiveIntegerField(default=0)
    parts = models.PositiveIntegerField(default=1)
    cost_messages = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    # CUS-01/03: «سارٍ حتى الجمعة» — انتهاء العرض يُعرض رماديّاً بكلمة «انتهى» لا يختفي
    valid_until = models.DateField(null=True, blank=True)
    night_confirmed = models.BooleanField(default=False)
    #: NOT-06: نتائج التسليم بدرجاته الأربع (تُملأ عند الإرسال)
    results = models.JSONField(default=dict, blank=True)
    created_by_user_id = models.UUIDField()
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    #: NOT-05: من اعتمد ومتى — صلاحية منفصلة عن الإنشاء
    approved_by_name = models.CharField(max_length=200, blank=True, default="")
    approved_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by_name = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_campaign_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.name}:{self.status}"


class CampaignMessage(TenantScoped):
    """NOT-06 (§١١.٩؛ ACC-88 outbox، ACC-108، ACC-111): رسالة واحدة لكل طرف في الحملة — صفّ في
    الصادر ينتقل بين حالاته مرة واحدة؛ إعادة تشغيل العامل تكمل «المصفوف» فقط فلا تُرسل مرتين.
    «قبِلها المزوّد» ليس «سُلِّمت» وليس «قُرئت» — القراءة غير مقيسة ولن تُعرض."""

    class State(models.TextChoices):
        QUEUED = "queued", "في الطابور"
        SENT = "sent", "أُرسلت للمزوّد"
        ACCEPTED = "accepted", "قبِلها المزوّد"
        DELIVERED = "delivered", "أكّد المزوّد تسليمها"
        UNCONFIRMED = "unconfirmed", "غير محسومة"
        FAILED_PERMANENT = "failed_permanent", "فشلت نهائياً"
        FAILED_TEMPORARY = "failed_temporary", "رفض المزوّد مؤقتاً"
        OPTED_OUT = "opted_out", "أوقف التسويق أثناء الحملة"
        CANCELLED = "cancelled", "أُلغيت قبل الإرسال"

    campaign = models.ForeignKey("Campaign", on_delete=models.CASCADE, related_name="messages")
    party_id = models.UUIDField(null=True, blank=True)
    # مشترك عبر بوابة الزبون (CUS-02) — ليس طرفاً في الدفتر
    subscriber_id = models.UUIDField(null=True, blank=True)
    phone = models.CharField(max_length=32)
    read_at = models.DateTimeField(null=True, blank=True)
    state = models.CharField(max_length=20, choices=State.choices, default=State.QUEUED)
    reason = models.CharField(max_length=120, blank=True, default="")
    attempts = models.PositiveIntegerField(default=0)
    provider_ref = models.CharField(max_length=64, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_campaignmessage_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "campaign", "phone"],
                name="core_campaignmessage_once_per_phone",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.campaign_id}:{self.phone}:{self.state}"


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
    # ORG-09: تعديل متزامن يُكشف بالإصدار — لا يُكتب فوق ما لم يُقرأ (§١١.٣)
    version = models.PositiveIntegerField(default=1)
    updated_by_name = models.CharField(max_length=200, blank=True, default="")

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


class PortalChannel(TenantScoped):
    """CUS-01: قناة المحل العامة — رابط دائم/QR (`slug`) يفتحه الزبون بلا حساب (§١٤.٤). الحقول
    المنشورة فقط تخرج منه: الاسم والعنوان وساعات العمل وما نشره التاجر."""

    slug = models.CharField(max_length=24, unique=True)
    address = models.CharField(max_length=300, blank=True, default="")
    hours = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="core_portalchannel_tenant_id"),
        ]

    def __str__(self) -> str:
        return self.slug


class PortalSubscriber(TenantScoped):
    """CUS-02: اشتراك صريح بقناة محل محدَّد — لا حساب ولا ملف زبون ولا يثبت ملكية هاتف في دفتر
    الأطراف (§١٤.٤). الرقم للإرسال وحده؛ الإلغاء لمحل واحد دون غيره ولا يمحو الرسائل السابقة؛
    التراجع عن الإلغاء 7 أيام."""

    phone = models.CharField(max_length=32)
    phone_normalized = models.CharField(max_length=32, db_index=True)
    token = models.CharField(max_length=64, unique=True)
    consent_at = models.DateTimeField(default=timezone.now)
    opt_out_at = models.DateTimeField(null=True, blank=True)
    # إذن المتصفح كما أعلنه الزبون: granted / denied / default / unsupported
    push_permission = models.CharField(max_length=12, blank=True, default="")
    push_endpoint = models.TextField(blank=True, default="")
    push_p256dh = models.CharField(max_length=200, blank=True, default="")
    push_auth = models.CharField(max_length=100, blank=True, default="")
    # CUS-04: القنوات — إشعار المتصفح، رسالة نصية (موافقة منفصلة)، صندوق الوارد في الصفحة
    channel_push = models.BooleanField(default=True)
    channel_sms = models.BooleanField(default=False)
    channel_inbox = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="core_portalsubscriber_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "phone_normalized"], name="core_portalsubscriber_once_per_phone"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.phone}:{'on' if self.active else 'off'}"

    @property
    def active(self) -> bool:
        return self.opt_out_at is None
