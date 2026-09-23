# بذر كتالوج الباقات من قيم الإطار التي كانت في الشيفرة (0005 §٥٠) — الأسعار نفسها، والربعي/السنوي غير
# معروضين حتى يضبطهما المشغّل (PLT-16؛ 0005 §١١٠).
from django.db import migrations

from core.plan_defaults import DEFAULT_PLANS as SEED


def seed(apps, schema_editor):
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    # القيم الافتراضية تنمو بحقول لاحقة (الإضافات 0032) — يُبذر ما يعرفه النموذج التاريخي وحده
    known = {f.name for f in PlanCatalog._meta.get_fields()}
    for row in SEED:
        defaults = {k: v for k, v in row.items() if k in known}
        PlanCatalog.objects.get_or_create(code=row["code"], defaults=defaults)


class Migration(migrations.Migration):
    dependencies = [("core", "0025_plan_catalog")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
