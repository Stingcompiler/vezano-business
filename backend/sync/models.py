"""سجل العمليات المقبولة وأعضائها (§٥.٣، §٨.٣، §٨.٥).

- `Operation`: هوية واحدة لكل (tenant, operation_id) — `UNIQUE` هو ما يمنع تكرار النقل.
- `Member`: كل عضو بهويته الثابتة وتجزئته القانونية ورقم `server_seq` من عداد المستأجر.
- `QuarantinedOperation`: الرفض الدائم والتعارض يُحفظان بأصلهما للمراجعة، لا يُمحيان (§٩.٣).
- الحمولات تُحفظ كما وصلت (JSONB) لإعادة إنتاج التجزئة بإصدارها الأصلي (§٨.٤).
"""

from __future__ import annotations

from typing import ClassVar

from django.db import models

from core.models import Tenant, TenantScoped
from core.tenancy import TenantManager


class SyncState(models.Model):
    """عداد المستأجر وجيله (§٨.٥). صف واحد لكل مستأجر؛ القفل عليه يسرلسل الكتابة."""

    tenant = models.OneToOneField(
        Tenant, on_delete=models.CASCADE, primary_key=True, related_name="sync_state"
    )
    sync_epoch = models.CharField(max_length=64)
    sync_counter = models.BigIntegerField(default=0)

    objects: ClassVar[TenantManager] = TenantManager()
    unscoped: ClassVar[models.Manager[SyncState]] = models.Manager()

    def __str__(self) -> str:
        return f"{self.tenant_id}@{self.sync_epoch}#{self.sync_counter}"


class Operation(TenantScoped):
    class Status(models.TextChoices):
        ACCEPTED = "accepted", "مقبولة"

    operation_id = models.UUIDField()
    kind = models.CharField(max_length=64)
    op_version = models.PositiveSmallIntegerField()
    device = models.UUIDField()
    actor_user = models.UUIDField()
    members_hash = models.CharField(max_length=64)
    hash_version = models.PositiveSmallIntegerField()
    sync_epoch = models.CharField(max_length=64)
    #: رقم أول عضو — للترتيب فقط؛ أعضاء العملية لهم أرقامهم
    server_seq = models.BigIntegerField()
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_operation_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "operation_id"], name="sync_operation_unique"
            ),
        ]
        indexes = [models.Index(fields=["tenant", "server_seq"], name="sync_op_seq_idx")]

    def __str__(self) -> str:
        return f"{self.kind}:{self.operation_id}"


class Member(TenantScoped):
    operation = models.ForeignKey(Operation, on_delete=models.PROTECT, related_name="members")
    entity = models.CharField(max_length=64)
    entity_id = models.UUIDField()
    schema_version = models.PositiveSmallIntegerField()
    payload = models.JSONField()
    content_hash = models.CharField(max_length=64)
    server_seq = models.BigIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_member_tenant_id"),
            # لكل أثر أعمال عملية مالكة واحدة (§٨.٣ بند ٥)
            models.UniqueConstraint(
                fields=["tenant", "entity", "entity_id"], name="sync_member_entity_unique"
            ),
            models.UniqueConstraint(fields=["tenant", "server_seq"], name="sync_member_seq_unique"),
        ]

    def __str__(self) -> str:
        return f"{self.entity}:{self.entity_id}"


class QuarantinedOperation(TenantScoped):
    class Reason(models.TextChoices):
        CONFLICTED = "conflicted", "تعارض"
        REJECTED = "rejected", "مرفوضة"

    operation_id = models.UUIDField()
    device = models.UUIDField()
    reason = models.CharField(max_length=12, choices=Reason.choices)
    code = models.CharField(max_length=64)
    detail = models.TextField(blank=True, default="")
    original = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.UUIDField(null=True, blank=True)
    decision = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_quarantine_tenant_id")
        ]

    def __str__(self) -> str:
        return f"{self.reason}:{self.operation_id}"


from sync.models_log import AccessManifest, Snapshot, SyncLog  # noqa: E402, F401 — تسجيل النماذج
