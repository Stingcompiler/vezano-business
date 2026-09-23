"""أعلام الإطلاق للإنتاج (0005 §١١٨ — توصية نُفّذت بأمر المالك 2026-09-24).

- `market_m3` (ربط الطلب بالمستندات) **مرفوع** بنطاق البيئة الحالية: بوابته MK-3 ثبتت آلياً.
  M1 وM2 بلا علم أصلاً (يعملان متى فُعّل السوق للمنشأة).
- `market_m4` (اقتراح التوريد، تحليلات المورد، الترويج) **منخفض**: بلا بوابة مستقلة، وتسعير العرض
  الممول (G-04) غير معتمد — يُرفع بعد التجربة الميدانية.

لا يتجاوز قرار المشغّل: يُنشئ العلم إن غاب فقط، ولا يغيّر علماً ضبطه أحد من PLT-12. يُشغَّل في كل
نشر بعد الهجرات (render.yaml)، فهو آمن للتكرار.
"""

from __future__ import annotations

import os
from typing import Any

from django.core.management.base import BaseCommand

from core.tenancy import platform_context
from stingops.models import OpsFlag

LAUNCH = (
    ("market_m3", True, "إطلاق: بوابة MK-3 ثبتت آلياً (0005 §١١٨)"),
    ("market_m4", False, "إطلاق: بلا بوابة مستقلة وتسعير G-04 غير معتمد — بعد التجربة الميدانية"),
)


class Command(BaseCommand):
    help = "ينشئ أعلام الإطلاق الغائبة لبيئة STING_ENV دون تغيير ما ضبطه المشغّل."

    def handle(self, *args: Any, **options: Any) -> None:
        env = os.environ.get("STING_ENV", "development")
        with platform_context():
            for key, enabled, note in LAUNCH:
                flag, created = OpsFlag.objects.get_or_create(
                    key=key,
                    scope_kind=OpsFlag.ScopeKind.ENV,
                    scope=env,
                    defaults={"enabled": enabled, "note": note, "changed_by_name": "إطلاق آلي"},
                )
                state = "أُنشئ" if created else "موجود — لم يُمسّ"
                self.stdout.write(f"{key}@env:{env} = {flag.enabled} ({state})")
