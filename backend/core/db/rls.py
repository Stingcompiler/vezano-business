"""مولِّد SQL لسياسات RLS — الطبقة الأولى من العزل (§٥.٤ بند ١).

تستعمله هجرات core والوحدات اللاحقة حتى تُكتب كل سياسة بالصيغة نفسها:
`USING`/`WITH CHECK` على `tenant_id = sting_current_tenant()`، مع سماح لسياق المنصة،
و`FORCE ROW LEVEL SECURITY` حتى لا يتجاوزها مالك الجدول نفسه.
"""

from __future__ import annotations

APP_ROLE = "sting_app"

FUNCTIONS_SQL = """
CREATE OR REPLACE FUNCTION sting_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('sting.tenant_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION sting_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('sting.platform', true), '') = 'on'
$$;
"""

FUNCTIONS_REVERSE_SQL = """
DROP FUNCTION IF EXISTS sting_is_platform();
DROP FUNCTION IF EXISTS sting_current_tenant();
"""

# دور التطبيق: بلا LOGIN هنا (التشغيل يفعّله خارج الهجرات)، بلا BYPASSRLS، وليس مالك الجداول.
_APP_ROLE_TEMPLATE = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
    CREATE ROLE {role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO {role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO {role};
"""

# نص هجرة ثابت باسم دور ثابت — لا مدخل مستخدم (S608 لا ينطبق)
APP_ROLE_SQL = _APP_ROLE_TEMPLATE.replace("{role}", APP_ROLE)


def enable_sql(table: str, tenant_column: str = "tenant_id") -> str:
    policy = f"{table}_tenant_isolation"
    return f"""
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS {policy} ON {table};
CREATE POLICY {policy} ON {table}
  USING (sting_is_platform() OR {tenant_column} = sting_current_tenant())
  WITH CHECK (sting_is_platform() OR {tenant_column} = sting_current_tenant());
"""


def disable_sql(table: str) -> str:
    return f"""
DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};
ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
"""


def composite_fk_sql(table: str, name: str, columns: str, ref_table: str, ref_columns: str) -> str:
    """مفتاح خارجي مركب يمنع ربط كيان بمستأجر آخر (§٥.٤ بند ٣).

    قابل للتأجيل داخل العملية (§٨.٣ بند ٨).
    """
    return (
        f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY ({columns}) "
        f"REFERENCES {ref_table} ({ref_columns}) DEFERRABLE INITIALLY IMMEDIATE;"
    )


def drop_constraint_sql(table: str, name: str) -> str:
    return f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name};"
