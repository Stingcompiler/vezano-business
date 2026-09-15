"""العزل ثلاثي الطبقات (§٥.٤) وحارس العملة (§٦.٣):

1. دالتا السياق `sting_current_tenant()` و`sting_is_platform()`.
2. دور التطبيق `sting_app`: بلا BYPASSRLS وليس مالك الجداول؛ امتيازات DML فقط.
3. RLS مفعّلة ومفروضة (FORCE) على كل جدول مستأجر، بسياسة USING/WITH CHECK.
4. حارس يمنع تعديل عملة المؤسسة أو أُسّها بعد الإنشاء (معيار §١٨ ACC-27).
5. مفاتيح خارجية مركبة (tenant_id, x_id) تمنع ربط كيان بمستأجر آخر (معيار §١٨ ACC-60).
"""

from django.db import migrations

from core.db import rls

TENANT_TABLES = [
    ("core_branch", "tenant_id"),
    ("core_device", "tenant_id"),
    ("core_user", "tenant_id"),
    ("core_role", "tenant_id"),
    ("core_userbranchaccess", "tenant_id"),
    ("core_tenantsettings", "tenant_id"),
    # جدول المستأجر نفسه: الصف المرئي هو المستأجر الحالي (id) أو الكل لسياق المنصة
    ("core_tenant", "id"),
]

COMPOSITE_FKS = [
    (
        "core_device",
        "core_device_branch_same_tenant",
        "tenant_id, branch_id",
        "core_branch",
        "tenant_id, id",
    ),
    (
        "core_userbranchaccess",
        "core_uba_user_same_tenant",
        "tenant_id, user_id",
        "core_user",
        "tenant_id, id",
    ),
    (
        "core_userbranchaccess",
        "core_uba_branch_same_tenant",
        "tenant_id, branch_id",
        "core_branch",
        "tenant_id, id",
    ),
    (
        "core_userbranchaccess",
        "core_uba_role_same_tenant",
        "tenant_id, role_id",
        "core_role",
        "tenant_id, id",
    ),
]

CURRENCY_GUARD_SQL = """
CREATE OR REPLACE FUNCTION sting_tenant_currency_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_currency IS DISTINCT FROM OLD.base_currency
     OR NEW.base_currency_exponent IS DISTINCT FROM OLD.base_currency_exponent THEN
    RAISE EXCEPTION 'tenant base currency is immutable (§6.3)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'core_tenant_currency_immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS core_tenant_currency_immutable ON core_tenant;
CREATE TRIGGER core_tenant_currency_immutable
  BEFORE UPDATE ON core_tenant FOR EACH ROW
  EXECUTE FUNCTION sting_tenant_currency_guard();
"""

CURRENCY_GUARD_REVERSE_SQL = """
DROP TRIGGER IF EXISTS core_tenant_currency_immutable ON core_tenant;
DROP FUNCTION IF EXISTS sting_tenant_currency_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]

    operations = [
        migrations.RunSQL(rls.FUNCTIONS_SQL, rls.FUNCTIONS_REVERSE_SQL),
        migrations.RunSQL(rls.APP_ROLE_SQL, migrations.RunSQL.noop),
        *[
            migrations.RunSQL(rls.enable_sql(table, column), rls.disable_sql(table))
            for table, column in TENANT_TABLES
        ],
        migrations.RunSQL(CURRENCY_GUARD_SQL, CURRENCY_GUARD_REVERSE_SQL),
        *[
            migrations.RunSQL(
                rls.composite_fk_sql(table, name, cols, ref, ref_cols),
                rls.drop_constraint_sql(table, name),
            )
            for table, name, cols, ref, ref_cols in COMPOSITE_FKS
        ],
    ]
