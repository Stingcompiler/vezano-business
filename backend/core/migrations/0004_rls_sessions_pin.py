"""RLS ومفاتيح مركبة لجدولي الجلسات ومتحققات PIN (§٥.٤).

جلسة موظف المنصة بلا مستأجر: مرئية لسياق المنصة فقط.
"""

from django.db import migrations

from core.db import rls

SESSION_POLICY = """
ALTER TABLE core_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS core_session_tenant_isolation ON core_session;
CREATE POLICY core_session_tenant_isolation ON core_session
  USING (sting_is_platform() OR tenant_id = sting_current_tenant())
  WITH CHECK (sting_is_platform() OR tenant_id = sting_current_tenant());
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0003_sessions_pin_registration")]

    operations = [
        migrations.RunSQL(SESSION_POLICY, rls.disable_sql("core_session")),
        migrations.RunSQL(rls.enable_sql("core_pinverifier"), rls.disable_sql("core_pinverifier")),
        migrations.RunSQL(
            rls.composite_fk_sql(
                "core_pinverifier",
                "core_pinverifier_user_same_tenant",
                "tenant_id, user_id",
                "core_user",
                "tenant_id, id",
            ),
            rls.drop_constraint_sql("core_pinverifier", "core_pinverifier_user_same_tenant"),
        ),
        migrations.RunSQL(
            rls.composite_fk_sql(
                "core_session",
                "core_session_device_same_tenant",
                "tenant_id, device_id",
                "core_device",
                "tenant_id, id",
            ),
            rls.drop_constraint_sql("core_session", "core_session_device_same_tenant"),
        ),
    ]
