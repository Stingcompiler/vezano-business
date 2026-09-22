# الربعي والسنوي (بأمر المالك 2026-09-22؛ 0005 §١١٠): يُضبطان للباقتين المدفوعتين إن كانا 0 —
# القيم قابلة للتحرير من PLT-16.
from django.db import migrations

PRICES = {
    "single": (12_500_000, 45_000_000),
    "dual": (23_500_000, 85_000_000),
}


def forward(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    for code, (q, y) in PRICES.items():
        row = PlanCatalog.objects.filter(code=code).first()
        if row is None:
            continue
        changed = False
        if not row.price_quarterly_minor:
            row.price_quarterly_minor = q
            changed = True
        if not row.price_yearly_minor:
            row.price_yearly_minor = y
            changed = True
        if changed:
            row.save(update_fields=["price_quarterly_minor", "price_yearly_minor"])


class Migration(migrations.Migration):
    dependencies = [("core", "0026_seed_plan_catalog")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
