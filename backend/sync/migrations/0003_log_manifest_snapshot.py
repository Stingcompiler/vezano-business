"""sync_log وسجل الوصول واللقطات مع RLS وحارس القفل (§٨.٥).

حارس `sync_log`: يرفض الإدراج ما لم يكن صف SyncState للمستأجر مقفولاً في المعاملة الجارية
(`pg_locks` + `FOR UPDATE` على الصف). وجود القفل لا يثبت أنه أُخذ أولاً — يُفرض الترتيب بمسار
الكتابة الموحد واختباراته؛ الحارس يمنع الكتابة العشوائية خارج المسار.
"""

from django.db import migrations, models

import core.ids
from core.db import rls

GUARD_SQL = """
CREATE OR REPLACE FUNCTION sting_sync_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked boolean;
BEGIN
  -- هل صف SyncState لهذا المستأجر مقفول بـ FOR UPDATE داخل هذه المعاملة؟
  SELECT EXISTS (
    SELECT 1 FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE l.pid = pg_backend_pid()
      AND c.relname = 'sync_syncstate'
      AND l.locktype = 'tuple'
      AND l.granted
  ) INTO locked;
  IF NOT locked THEN
    -- المسار الموحد يأخذ القفل بـ select_for_update: القفل يُمسك كـ transactionid/tuple.
    -- نتحقق بديلاً: هل نحن داخل معاملة تحمل قفل صف على الجدول (RowExclusive أو أعلى)؟
    SELECT EXISTS (
      SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE l.pid = pg_backend_pid() AND c.relname = 'sync_syncstate' AND l.granted
        AND l.mode IN ('RowShareLock','RowExclusiveLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')
    ) INTO locked;
  END IF;
  IF NOT locked THEN
    RAISE EXCEPTION 'sync_log write without tenant sync lock (§8.5)'
      USING ERRCODE = 'lock_not_available', CONSTRAINT = 'sync_log_requires_tenant_lock';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_log_requires_tenant_lock ON sync_log;
CREATE TRIGGER sync_log_requires_tenant_lock
  BEFORE INSERT OR UPDATE ON sync_log FOR EACH ROW
  EXECUTE FUNCTION sting_sync_log_guard();
"""
GUARD_REVERSE = """
DROP TRIGGER IF EXISTS sync_log_requires_tenant_lock ON sync_log;
DROP FUNCTION IF EXISTS sting_sync_log_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("sync", "0002_rls"), ("core", "0004_rls_sessions_pin")]

    operations = [
        migrations.CreateModel(
            name="SyncLog",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("scope", models.CharField(max_length=16)),
                ("scope_id", models.CharField(blank=True, default="", max_length=64)),
                ("entity_group", models.CharField(max_length=32)),
                ("entity", models.CharField(max_length=64)),
                ("entity_id", models.UUIDField()),
                ("server_seq", models.BigIntegerField()),
                ("tombstone", models.BooleanField(default=False)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT, related_name="+", to="core.tenant"
                    ),
                ),
            ],
            options={"db_table": "sync_log"},
        ),
        migrations.AddConstraint(
            model_name="synclog",
            constraint=models.UniqueConstraint(
                fields=("tenant", "entity", "entity_id"), name="sync_log_pk"
            ),
        ),
        migrations.AddIndex(
            model_name="synclog",
            index=models.Index(
                fields=["tenant", "scope", "scope_id", "entity_group", "server_seq"],
                name="sync_log_pull_idx",
            ),
        ),
        migrations.CreateModel(
            name="AccessManifest",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=core.ids.uuid7, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("device", models.UUIDField()),
                ("version", models.PositiveIntegerField()),
                ("branch_ids", models.JSONField(default=list)),
                ("issued_at", models.DateTimeField(auto_now_add=True)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT, related_name="+", to="core.tenant"
                    ),
                ),
            ],
            options={"abstract": False},
        ),
        migrations.AddConstraint(
            model_name="accessmanifest",
            constraint=models.UniqueConstraint(
                fields=("tenant", "id"), name="sync_manifest_tenant_id"
            ),
        ),
        migrations.AddConstraint(
            model_name="accessmanifest",
            constraint=models.UniqueConstraint(
                fields=("tenant", "device", "version"), name="sync_manifest_version"
            ),
        ),
        migrations.CreateModel(
            name="Snapshot",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=core.ids.uuid7, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("sync_epoch", models.CharField(max_length=64)),
                ("cutoff_server_seq", models.BigIntegerField()),
                ("schema_version", models.PositiveSmallIntegerField(default=1)),
                ("as_of", models.DateTimeField(auto_now_add=True)),
                ("balances", models.JSONField(default=list)),
                ("stock", models.JSONField(default=dict)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT, related_name="+", to="core.tenant"
                    ),
                ),
            ],
            options={"abstract": False},
        ),
        migrations.AddConstraint(
            model_name="snapshot",
            constraint=models.UniqueConstraint(
                fields=("tenant", "id"), name="sync_snapshot_tenant_id"
            ),
        ),
        migrations.AddIndex(
            model_name="snapshot",
            index=models.Index(
                fields=["tenant", "sync_epoch", "cutoff_server_seq"], name="sync_snap_cut_idx"
            ),
        ),
        *[
            migrations.RunSQL(rls.enable_sql(t), rls.disable_sql(t))
            for t in ("sync_log", "sync_accessmanifest", "sync_snapshot")
        ],
        migrations.RunSQL(GUARD_SQL, GUARD_REVERSE),
    ]
