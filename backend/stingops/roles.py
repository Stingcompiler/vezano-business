"""أدوار المشغّلين (0005 §١١٨ — توصية نُفّذت بأمر المالك 2026-09-24).

- **مدير المنصة** (`admin`): كل شيء.
- **الدعم** (`support`): يقرأ كل شاشات المنصة، ولا يغيّر إلا طلبات الجولة. اعتماد الدفع، والتسعير
  والكتالوج، والاشتراكات، والأعلام، والإعلانات، والتحقّق، والبلاغات والخلافات، والنسخ، والمشغّلون
  لمدير المنصة وحده — كلها قرارات مالية أو تمسّ كل المستأجرين.

الفرض على الخادم في نقطة واحدة (`check_request`) لا في كل شاشة؛ المشغّل بلا ملف يُعامَل «دعماً»
(أقل صلاحية) لا مديراً.
"""

from __future__ import annotations

from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework.request import Request

from core.models import User
from core.tenancy import platform_context
from stingops.models import OperatorProfile

ADMIN = OperatorProfile.Role.ADMIN
SUPPORT = OperatorProfile.Role.SUPPORT

#: ما يغيّره «الدعم» — مسارات لا أثر مالياً ولا عاماً لها
SUPPORT_WRITE_PREFIXES = ("/api/platform/demo-requests",)


def role_of(user: User) -> str:
    with platform_context():
        role = (
            OperatorProfile.objects.filter(user_id=user.id).values_list("role", flat=True).first()
        )
    return str(role) if role else SUPPORT


def require_admin(user: User) -> None:
    if role_of(user) != ADMIN:
        raise PermissionDenied("admin_required")


def check_request(request: Request, user: User) -> None:
    """القراءة لكل مشغّل؛ التغيير لمدير المنصة إلا ما يسمح به «الدعم»."""
    if request.method in SAFE_METHODS:
        return
    if request.path.startswith(SUPPORT_WRITE_PREFIXES):
        return
    require_admin(user)
