# 0005 §١١٧ — أسعار الربعي/السنوي والإضافات بقرار نيابة عن المالك. تُحدَّث القيم التي ما زالت على
# الافتراض السابق وحدها؛ ما ضبطه المشغّل من PLT-16 لا يُمسّ.
from django.db import migrations

# (الرمز، الحقل، القيمة السابقة، الجديدة)
CHANGES = [
    ("single", "price_quarterly_minor", 12_500_000, 12_800_000),
    ("single", "price_yearly_minor", 45_000_000, 48_600_000),
    ("single", "addon_branch_minor", 3_000_000, 0),
    ("dual", "price_quarterly_minor", 23_500_000, 24_200_000),
    ("dual", "price_yearly_minor", 85_000_000, 91_800_000),
]


def apply(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    for code, field, old, new in CHANGES:
        PlanCatalog.objects.filter(code=code, **{field: old}).update(**{field: new})


def revert(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    for code, field, old, new in CHANGES:
        PlanCatalog.objects.filter(code=code, **{field: new}).update(**{field: old})


class Migration(migrations.Migration):
    dependencies = [("core", "0034_subscription_cycle")]
    operations = [migrations.RunPython(apply, revert)]
