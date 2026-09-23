# أسعار الإضافات الافتراضية (بأمر المالك 2026-09-23؛ 0005 §١١٦) — تقدير المنفّذ، قابلة للتحرير من
# PLT-16: جهاز 10,000 ومستخدم 5,000 شهرياً للباقتين، فرع 30,000 للفرع الواحد و35,000 للفرعين.
from django.db import migrations

PRICES = {
    "single": (1_000_000, 500_000, 3_000_000),
    "dual": (1_000_000, 500_000, 3_500_000),
}


def forward(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    for code, (dev, usr, br) in PRICES.items():
        PlanCatalog.objects.filter(code=code, addon_device_minor=0).update(
            addon_device_minor=dev, addon_user_minor=usr, addon_branch_minor=br
        )


class Migration(migrations.Migration):
    dependencies = [("core", "0032_addons")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
