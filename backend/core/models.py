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
        user = self.model(tenant=tenant, username=username, display_name=display_name, **extra)
        user.set_unusable_password()
        user.save(using=self._db)
        return user  # type: ignore[no-any-return]


class User(AbstractBaseUser):
    """مستخدم مسمّى داخل مستأجر (§٣.١). المصادقة البعيدة وPIN المحلي هويات مختلفة (§٩)."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    # NULL لموظفي منصة Sting فقط (مشغّل الخدمة وناشر إعلاناتها — §٣.١)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
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
