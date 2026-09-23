# حدّ المستخدمين في الكتالوج (بأمر المالك 2026-09-23 «تحديد الأجهزة والمستخدمين»؛ 0005 §١١٤):
# من أوصاف الباقات نفسها — فرع واحد «مستخدمان»، فرعان «5 مستخدمين»، التجريبية كالفرع الواحد.
# يُضبط فقط إن كان فارغاً (لا يدوس تحرير المشغّل)؛ قابل للتحرير من PLT-16.
from django.db import migrations

USERS = {"single": 2, "dual": 5, "trial": 2}


def forward(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    for code, n in USERS.items():
        PlanCatalog.objects.filter(code=code, max_users__isnull=True).update(max_users=n)


class Migration(migrations.Migration):
    dependencies = [("core", "0030_tenant_limit_extras")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
