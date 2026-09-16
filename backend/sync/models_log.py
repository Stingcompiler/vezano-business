"""`sync_log` وسجل الوصول واللقطات (§٨.٥، §٨.٧، §٨.٩)."""

from __future__ import annotations

from typing import ClassVar

from django.db import models

from core.models import Tenant, TenantScoped
from core.tenancy import TenantManager


class SyncLog(models.Model):
    """صف لكل حدث ثابت وآخر علامة لكل كيان مرجعي؛ الفهرس هو مسار PULL (§٨.٥).

    المفتاح الأساسي (tenant, entity, entity_id) كما في المخطط المرجعي؛ الكتابة محروسة
    بقفل المستأجر (المحفّز في الهجرة 0003).
    """

    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="+")
    scope = models.CharField(max_length=16)
    scope_id = models.CharField(max_length=64, blank=True, default="")
    entity_group = models.CharField(max_length=32)
    entity = models.CharField(max_length=64)
    entity_id = models.UUIDField()
    server_seq = models.BigIntegerField()
    #: شاهد حذف/تعطيل: يصل صريحاً لا بالاختفاء (§٨.٧)
    tombstone = models.BooleanField(default=False)

    objects: ClassVar[TenantManager] = TenantManager()
    unscoped: ClassVar[models.Manager[SyncLog]] = models.Manager()

    class Meta:
        db_table = "sync_log"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "entity", "entity_id"], name="sync_log_pk")
        ]
        indexes = [
            models.Index(
                fields=["tenant", "scope", "scope_id", "entity_group", "server_seq"],
                name="sync_log_pull_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.entity}:{self.entity_id}@{self.server_seq}"


class AccessManifest(TenantScoped):
    """قائمة وصول الجهاز ذات إصدار (§٨.٧): سحب الصلاحية يصل بقائمة كاملة جديدة لا بالاختفاء."""

    device = models.UUIDField()
    version = models.PositiveIntegerField()
    branch_ids = models.JSONField(default=list)
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_manifest_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "device", "version"], name="sync_manifest_version"
            ),
        ]

    def __str__(self) -> str:
        return f"manifest:{self.device}:v{self.version}"


class Snapshot(TenantScoped):
    """لقطة ثابتة عند نقطة قطع (§٨.٩ بند ١): الجيل والهوية والإصدار وas_of والقطع والأرصدة."""

    sync_epoch = models.CharField(max_length=64)
    cutoff_server_seq = models.BigIntegerField()
    schema_version = models.PositiveSmallIntegerField(default=1)
    as_of = models.DateTimeField(auto_now_add=True)
    #: [{party_id, account_role, currency, amount_minor}] — سلاسل عددية
    balances = models.JSONField(default=list)
    #: {item_id: qty_milli} للفرع — يُملأ مع وحدة inventory
    stock = models.JSONField(default=dict)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_snapshot_tenant_id"),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "sync_epoch", "cutoff_server_seq"], name="sync_snap_cut_idx"
            )
        ]

    def __str__(self) -> str:
        return f"snapshot:{self.id}@{self.cutoff_server_seq}"

    def envelope(self) -> dict[str, object]:
        return {
            "sync_epoch": self.sync_epoch,
            "snapshot_id": str(self.id),
            "cutoff_server_seq": str(self.cutoff_server_seq),
            "schema_version": self.schema_version,
            "as_of": self.as_of.isoformat().replace("+00:00", "Z"),
            "balances": self.balances,
        }


class BootstrapImage(TenantScoped):
    """النسخة المادية للتهيئة (§٨.١٠): الجيل واللقطة والقطع والنطاقات والانتهاء وفهرس الصفحات."""

    device = models.ForeignKey(
        "core.Device", on_delete=models.PROTECT, related_name="bootstrap_images"
    )
    snapshot = models.ForeignKey(
        Snapshot, on_delete=models.PROTECT, related_name="bootstrap_images"
    )
    sync_epoch = models.CharField(max_length=64)
    cutoff_server_seq = models.BigIntegerField()
    schema_version = models.PositiveSmallIntegerField(default=1)
    #: [{group, total, pages}] بترتيب النطاقات المسمّاة
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_bootstrapimage_tenant_id")
        ]

    def __str__(self) -> str:
        return f"image:{self.id}"


class BootstrapPage(TenantScoped):
    """صفحة مجمّدة من نطاق في نسخة مادية — محتواها لا يتغير بين الطلبات."""

    image = models.ForeignKey(BootstrapImage, on_delete=models.CASCADE, related_name="pages")
    group = models.CharField(max_length=20)
    page_no = models.PositiveIntegerField()
    entities = models.JSONField(default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="sync_bootstrappage_tenant_id"),
            models.UniqueConstraint(
                fields=["image", "group", "page_no"], name="sync_bootstrappage_unique_page"
            ),
        ]

    def __str__(self) -> str:
        return f"page:{self.image_id}:{self.group}:{self.page_no}"
