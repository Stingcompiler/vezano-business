"""حارس إعادة الضبط (§١٥.٤): «تُحمى إعادة الضبط من التشغيل على الإنتاج أو بيانات عميل حقيقي».

ثلاثة شروط معاً: بيئة معلنة غير إنتاجية، وقاعدة بيانات اسمها يحمل وسم تجريب،
وعدم وجود مستأجر خارج السيناريو (بيانات عميل حقيقي).
"""

from __future__ import annotations

import os

from django.conf import settings


class ProductionGuard(RuntimeError):
    pass


ALLOWED_ENVS = {"development", "test", "ci"}
DB_MARKERS = ("_dev", "_test", "test_", "demo", "scenario")


def assert_non_production() -> None:
    env = os.environ.get("STING_ENV", "development")
    if env not in ALLOWED_ENVS:
        raise ProductionGuard(
            f"إعادة الضبط مرفوضة في البيئة {env!r} — مسموحة في {sorted(ALLOWED_ENVS)} فقط"
        )
    db_name = str(settings.DATABASES["default"]["NAME"])
    if not any(m in db_name for m in DB_MARKERS):
        raise ProductionGuard(f"اسم قاعدة البيانات {db_name!r} لا يحمل وسم تجريب ({DB_MARKERS})")
    from core.models import Tenant
    from core.scenario.seed import FIXED
    from core.tenancy import platform_context

    with platform_context():
        scenario_ids = [FIXED["tenant_a"], FIXED["tenant_b"], FIXED["tenant_c"]]
        foreign = Tenant.unscoped.exclude(id__in=scenario_ids).count()
    if foreign:
        raise ProductionGuard(
            f"القاعدة تحوي {foreign} مستأجراً خارج السيناريو — قد تكون بيانات عميل حقيقي"
        )
