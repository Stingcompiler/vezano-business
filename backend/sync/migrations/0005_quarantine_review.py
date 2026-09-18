from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sync", "0004_bootstrap_images")]

    operations = [
        migrations.AddField(
            model_name="quarantinedoperation",
            name="decision_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="quarantinedoperation",
            name="decided_by_name",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
    ]
