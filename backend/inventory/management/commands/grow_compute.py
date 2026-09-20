"""الحساب الليلي لـGROW-01/02 (`cron` عند 06:00): يمرّ على كل المستأجرين ويخزّن اللقطات بختمها —
«الفحص التالي غداً 6 ص» صادقٌ ما دام هذا الأمر مجدولاً."""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from core.models import Branch, Tenant
from core.tenancy import platform_context, tenant_context
from inventory import grow


class Command(BaseCommand):
    help = "يحسب اقتراح التوريد وتحليلات المورد لكل مستأجر ويخزّنها بختم زمني"

    def handle(self, *args: Any, **options: Any) -> None:
        with platform_context():
            tenant_ids = list(Tenant.unscoped.values_list("id", flat=True))
        n = 0
        for tid in tenant_ids:
            with tenant_context(tid):
                branches = list(Branch.objects.order_by("code"))
                grow.compute_all_for_tenant(branches)
                n += 1
        self.stdout.write(f"grow_compute: {n} tenants")
