"""حساب المنصة وعضويته ورموز التحقق وطلبات التحقق اليدوي (0005 §٤ — T1.1).

الجداول الثلاثة بلا مستأجر: RLS تقيّدها بسياق المنصة وحده، فلا تُقرأ من سياق مستأجر ولا بلا سياق.
"""

import django.db.models.deletion
import django.db.models.manager
from django.db import migrations, models

import core.ids

PLATFORM_ONLY = """
ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS {t}_platform_only ON {t};
CREATE POLICY {t}_platform_only ON {t}
  USING (sting_is_platform()) WITH CHECK (sting_is_platform());
"""
DROP_POLICY = """
DROP POLICY IF EXISTS {t}_platform_only ON {t};
ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {t} DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0004_rls_sessions_pin")]

    operations = [
        migrations.CreateModel(
            name="Account",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=core.ids.uuid7, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("identifier", models.CharField(max_length=254, unique=True)),
                (
                    "identifier_kind",
                    models.CharField(choices=[("phone", "هاتف"), ("email", "بريد")], max_length=8),
                ),
                ("password", models.CharField(max_length=128)),
                ("display_name", models.CharField(blank=True, default="", max_length=200)),
                ("is_active", models.BooleanField(default=True)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("failed_logins", models.PositiveIntegerField(default=0)),
                ("locked_until", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            managers=[("unscoped", django.db.models.manager.Manager())],
        ),
        migrations.CreateModel(
            name="VerificationCode",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=core.ids.uuid7, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("identifier", models.CharField(max_length=254)),
                (
                    "purpose",
                    models.CharField(
                        choices=[("register", "تسجيل"), ("recover", "استعادة")], max_length=10
                    ),
                ),
                ("code_hash", models.CharField(max_length=128)),
                ("expires_at", models.DateTimeField()),
                ("sends", models.PositiveIntegerField(default=1)),
                ("last_sent_at", models.DateTimeField()),
                ("send_failures", models.PositiveIntegerField(default=0)),
                ("confirm_attempts", models.PositiveIntegerField(default=0)),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["identifier", "purpose", "created_at"],
                        name="core_verifi_identif_2992a6_idx",
                    )
                ]
            },
            managers=[("unscoped", django.db.models.manager.Manager())],
        ),
        migrations.CreateModel(
            name="ManualVerificationRequest",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=core.ids.uuid7, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("identifier", models.CharField(max_length=254)),
                (
                    "purpose",
                    models.CharField(
                        choices=[("register", "تسجيل"), ("recover", "استعادة")], max_length=10
                    ),
                ),
                ("tenant_name", models.CharField(max_length=200)),
                (
                    "status",
                    models.CharField(
                        choices=[("open", "مفتوح"), ("approved", "مقبول"), ("rejected", "مرفوض")],
                        default="open",
                        max_length=10,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
            ],
            managers=[("unscoped", django.db.models.manager.Manager())],
        ),
        migrations.AddField(
            model_name="user",
            name="account",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="memberships",
                to="core.account",
            ),
        ),
        *[
            migrations.RunSQL(PLATFORM_ONLY.format(t=t), DROP_POLICY.format(t=t))
            for t in ("core_account", "core_verificationcode", "core_manualverificationrequest")
        ],
    ]
