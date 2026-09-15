"""RLS ومفاتيح مركبة لجداول المزامنة (§٥.٤)."""

from django.db import migrations

from core.db import rls

TABLES = [
    ("sync_syncstate", "tenant_id"),
    ("sync_operation", "tenant_id"),
    ("sync_member", "tenant_id"),
    ("sync_quarantinedoperation", "tenant_id"),
]


class Migration(migrations.Migration):
    dependencies = [("sync", "0001_initial"), ("core", "0004_rls_sessions_pin")]

    operations = [
        *[migrations.RunSQL(rls.enable_sql(t, c), rls.disable_sql(t)) for t, c in TABLES],
        migrations.RunSQL(
            rls.composite_fk_sql(
                "sync_member",
                "sync_member_operation_same_tenant",
                "tenant_id, operation_id",
                "sync_operation",
                "tenant_id, id",
            ),
            rls.drop_constraint_sql("sync_member", "sync_member_operation_same_tenant"),
        ),
    ]
