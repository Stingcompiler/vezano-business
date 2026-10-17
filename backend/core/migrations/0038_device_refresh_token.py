"""رموز تجديد الجوال (0005 §١٦٢): RLS ومفاتيح مركبة تمنع ربط رمز بجلسة أو جهاز مستأجر آخر."""

import django.db.models.deletion
from django.db import migrations, models

import core.ids
from core.db import rls


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0037_account_contact_phone"),
    ]

    operations = [
        migrations.CreateModel(
            name="DeviceRefreshToken",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=core.ids.uuid7, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("family", models.UUIDField(db_index=True)),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                (
                    "revoke_reason",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("reuse", "إعادة رمز مدوَّر"),
                            ("device_mismatch", "جهاز غير الجهاز المربوط"),
                            ("session_revoked", "الجلسة ملغاة"),
                            ("device_revoked", "الجهاز مسحوب"),
                            ("user_inactive", "المستخدم معطَّل"),
                            ("reissued", "أُصدرت سلسلة أحدث للجلسة"),
                        ],
                        default="",
                        max_length=20,
                    ),
                ),
                (
                    "device",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="core.device",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="core.session",
                    ),
                ),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="core.tenant",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("tenant", "id"), name="core_devicerefresh_tenant_id"
                    )
                ],
            },
        ),
        migrations.RunSQL(
            rls.enable_sql("core_devicerefreshtoken"), rls.disable_sql("core_devicerefreshtoken")
        ),
        migrations.RunSQL(
            rls.composite_fk_sql(
                "core_devicerefreshtoken",
                "core_devicerefresh_session_same_tenant",
                "tenant_id, session_id",
                "core_session",
                "tenant_id, id",
            ),
            rls.drop_constraint_sql(
                "core_devicerefreshtoken", "core_devicerefresh_session_same_tenant"
            ),
        ),
        migrations.RunSQL(
            rls.composite_fk_sql(
                "core_devicerefreshtoken",
                "core_devicerefresh_device_same_tenant",
                "tenant_id, device_id",
                "core_device",
                "tenant_id, id",
            ),
            rls.drop_constraint_sql(
                "core_devicerefreshtoken", "core_devicerefresh_device_same_tenant"
            ),
        ),
    ]
