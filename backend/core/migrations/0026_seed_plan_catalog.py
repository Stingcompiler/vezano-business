# بذر كتالوج الباقات من قيم الإطار التي كانت في الشيفرة (0005 §٥٠) — الأسعار نفسها، والربعي/السنوي غير
# معروضين حتى يضبطهما المشغّل (PLT-16؛ 0005 §١١٠).
from django.db import migrations

from core.plan_defaults import DEFAULT_PLANS as SEED


def seed(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    for row in SEED:
        PlanCatalog.objects.get_or_create(code=row["code"], defaults=row)


class Migration(migrations.Migration):
    dependencies = [("core", "0025_plan_catalog")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
