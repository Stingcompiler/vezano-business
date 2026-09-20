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
