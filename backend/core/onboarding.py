"""معالج بدء الاستخدام (ACC-10؛ F01): يُكمل ما بدأته وصفة القطاع، كلّه اختياري ويُستأنف.

الخطوات = اتحاد إطاري 06-D2 (بيانات المنشأة، استيراد الأصناف، الأرصدة الافتتاحية، الطابعة)
و34-D26 (الشعار، دعوة موظف). حالتها تُشتق من البيانات لا من علامات يدوية؛ الصرف النهائي يُحفظ
في إعدادات المنشأة فلا يعود المعالج على أي جهاز.
"""

from __future__ import annotations

import uuid
from typing import Any

from core.models import Branch, Invitation, Tenant, TenantSettings

LOGO_MAX_BYTES = 2 * 1024 * 1024  # الحدّ معلن قبل الرفع لا بعده (34-D26 validation_error)


def settings_for(tenant_id: uuid.UUID) -> TenantSettings:
    obj, _ = TenantSettings.objects.get_or_create(tenant_id=tenant_id)
    assert isinstance(obj, TenantSettings)
    return obj


def onboarding_status(tenant_id: uuid.UUID) -> dict[str, Any]:
    tenant = Tenant.objects.get(id=tenant_id)
    s = settings_for(tenant_id)
    pos = dict(s.pos)
    branding = dict(s.branding)
    branches = Branch.objects.filter(is_active=True).count()
    invites = Invitation.objects.count()
    # الكتالوج والأرصدة الافتتاحية تأتي مع نماذجهما (T1.8، T1.19) — حتى ذلك الحين صفر بصدق
    return {
        "tenant_name": tenant.name,
        "currency_name": {"SDG": "الجنيه السوداني"}.get(tenant.base_currency, tenant.base_currency),
        "branches": branches,
        "dismissed": bool(pos.get("onboarding_dismissed", False)),
        "steps": {
            "org": {"done": True},
            "items": {"imported": 0, "rejected": 0, "sales": 0},
            "balances": {"count": 0},
            "printer": {"linked": bool(pos.get("printer_linked", False))},
            "logo": {"present": bool(branding.get("logo_data_url"))},
            "invite": {"sent": invites},
        },
    }


def dismiss_onboarding(tenant_id: uuid.UUID, dismissed: bool) -> None:
    s = settings_for(tenant_id)
    pos = dict(s.pos)
    pos["onboarding_dismissed"] = dismissed
    s.pos = pos
    s.save(update_fields=["pos", "updated_at"])


class LogoTooLarge(Exception):
    def __init__(self, size: int) -> None:
        super().__init__(str(size))
        self.size = size


def set_logo(tenant_id: uuid.UUID, data_url: str) -> None:
    """يقبل صورة data URL بحجم ≤ الحدّ؛ الأكبر يُرفض ليُصغَّر على الجهاز («سنصغّره لك»)."""
    size = len(data_url.encode("utf-8"))
    if size > LOGO_MAX_BYTES:
        raise LogoTooLarge(size)
    s = settings_for(tenant_id)
    branding = dict(s.branding)
    branding["logo_data_url"] = data_url
    s.branding = branding
    s.save(update_fields=["branding", "updated_at"])
