"""الرئيسية والبحث العام (HOME-01/02/03): سجلّ مزوّدين تُسهم فيه الوحدات حين تُبنى.

- كل رقم يحمل مصدره (رابطاً) ووقته (R-01)؛ لا بطاقة مؤشر بلا مصدر.
- رئيسية الموظف ليست رئيسية المالك منقوصة: بطاقاتها مهامه، والمحجوب لا يُعرض رمادياً بل لا يُعرض.
- البحث لا يُظهر ما لا يُفتح؛ داخل المنشأة يُعلَن العدد والنوع بلا محتوى، وخارجها لا شيء.

حتى تُبنى POS/PTY/INV/CAT، المزوّدون المسجَّلون هنا: المزامنة (المعلّق على أجهزة المنشأة)
والورديات (لاحقاً). البقية تُضيف مزوّديها في مهامها.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from django.utils import timezone

from core.models import Branch, Device, Role, Session, Tenant, User, UserBranchAccess

# ---------- الأدوار والصلاحيات (حتى مصفوفة G-09) ----------

SELL_ROLES = {"owner", "manager", "cashier"}
FINANCE_ROLES = {"owner", "manager"}


@dataclass(frozen=True)
class Viewer:
    user: User
    is_owner: bool
    role_code: str
    role_name: str
    branch: Branch | None
    device: Device | None

    @property
    def can_sell(self) -> bool:
        return self.is_owner or self.role_code in SELL_ROLES

    @property
    def can_see_finance(self) -> bool:
        return self.is_owner or self.role_code in FINANCE_ROLES


def viewer_for(user: User, device: Device | None) -> Viewer:
    access = (
        UserBranchAccess.objects.filter(user=user, revoked_at__isnull=True)
        .select_related("role", "branch")
        .order_by("granted_at")
        .first()
    )
    role: Role | None = access.role if access else None
    branch = device.branch if device else (access.branch if access else None)
    return Viewer(
        user=user,
        is_owner=user.is_owner,
        role_code=role.code if role else ("owner" if user.is_owner else ""),
        role_name="مالك" if user.is_owner else (role.name if role else ""),
        branch=branch,
        device=device,
    )


# ---------- سجلّ المزوّدين ----------

Provider = Callable[[Viewer, dict[str, Any]], None]
HOME_PROVIDERS: list[Provider] = []
SEARCH_PROVIDERS: list[Callable[[Viewer, str, dict[str, Any]], None]] = []


def home_provider(fn: Provider) -> Provider:
    HOME_PROVIDERS.append(fn)
    return fn


def _pending_attention(viewer: Viewer, out: dict[str, Any]) -> None:
    """المزامنة: أجهزة المنشأة التي أبلغت معلّقاً (Session.reported_pending) — للمالك والمدير."""
    if not viewer.can_see_finance:
        return
    now = timezone.now()
    for s in (
        Session.objects.filter(
            device__isnull=False, revoked_at__isnull=True, reported_pending__gt=0
        )
        .select_related("device")
        .order_by("-reported_pending")
    ):
        minutes = int((now - (s.reported_pending_at or now)).total_seconds() // 60)
        out["attention"].append(
            {
                "id": f"pending:{s.id}",
                "title_count": s.reported_pending,
                "title": "عمليات معلقة منذ",
                "minutes": minutes,
                "detail": f"{s.device.name if s.device else ''} — لا اتصال بالخادم",
                "action": "مركز المزامنة",
                "href": "/sync",
            }
        )


HOME_PROVIDERS.append(_pending_attention)


def money_short(minor: int) -> str:
    """مبلغ بطاقة/قرار في الرئيسية: الجنيه الكامل بلا «.00» والعملة ظاهرة (0005 §١٢٨)."""
    whole, frac = divmod(abs(minor), 100)
    text = f"{whole:,}" if frac == 0 else f"{whole:,}.{frac:02d}"
    return f"{'−' if minor < 0 else ''}{text} ج.س"


def counted(n: int, one: str, two: str, few: str, many: str) -> str:
    """العدد مع معدوده كما يُقرأ: «صنف نفد»، «صنفان نفدا»، «3 أصناف نفدت»، «12 صنفاً نفد»."""
    if n == 1:
        return one
    if n == 2:
        return two
    return f"{n} {few if 3 <= n % 100 <= 10 else many}"


def _quarantine_decision(viewer: Viewer, out: dict[str, Any]) -> None:
    """«قرارات تنتظرك»: عمليات محجوزة (تعارض أو رفض) لم تُحسم — المالك يقرّر (SYS-03)."""
    if not viewer.is_owner:
        return
    from sync.models import QuarantinedOperation

    n = QuarantinedOperation.objects.filter(reviewed_at__isnull=True).count()
    if n:
        out["decisions"].append(
            {
                "id": "quarantine",
                "title": counted(
                    n,
                    "عملية محجوزة تنتظر حسمك",
                    "عمليتان محجوزتان تنتظران حسمك",
                    "عمليات محجوزة تنتظر حسمك",
                    "عملية محجوزة تنتظر حسمك",
                ),
                "detail": "النسختان محفوظتان — لا شيء يُحذف قبل قرارك",
                "action": "راجع التعارضات",
                "href": "/sync/review",
                "severity": "danger",
            }
        )


def _market_decisions(viewer: Viewer, out: dict[str, Any]) -> None:
    """عروض أسعار من الموردين تنتظر قبول المشتري (الطلب ملك المشتري)."""
    if not viewer.can_see_finance:
        return
    from market.models import MarketOrder

    for o in MarketOrder.objects.filter(status=MarketOrder.Status.QUOTED).order_by("created_at")[
        :3
    ]:
        out["decisions"].append(
            {
                "id": f"market-quote:{o.id}",
                "title": f"عرض سعر من {o.supplier_name} ينتظر قبولك",
                "detail": f"طلب السوق {o.number}",
                "action": "قارن واقبل",
                "href": f"/market/orders/{o.id}",
                "severity": "warn",
            }
        )


HOME_PROVIDERS.append(_quarantine_decision)
HOME_PROVIDERS.append(_market_decisions)


def home_summary(
    tenant_id: uuid.UUID, viewer: Viewer, *, period: str = "today", branch_id: str = ""
) -> dict[str, Any]:
    tenant = Tenant.objects.get(id=tenant_id)
    branches = list(Branch.objects.filter(is_active=True).order_by("created_at"))
    devices_pending = Session.objects.filter(
        device__isnull=False, revoked_at__isnull=True, reported_pending__gt=0
    ).exists()
    out: dict[str, Any] = {
        "kind": "owner" if viewer.can_see_finance else "employee",
        "tenant_name": tenant.name,
        "user": {
            "display_name": viewer.user.display_name,
            "role_name": viewer.role_name,
            "branch_name": viewer.branch.name if viewer.branch else "",
            "device_name": viewer.device.name if viewer.device else "",
        },
        "period": period,
        "branch_id": branch_id,
        "branches": [{"id": str(b.id), "name": b.name} for b in branches],
        "branches_synced": not devices_pending,
        "coverage_at": timezone.now().isoformat().replace("+00:00", "Z"),
        "decisions": [],
        "kpis": [],
        "attention": [],
        "tasks": [],
        "quick_actions": ["sale", "payment", "return"] if viewer.can_sell else [],
        "can_see_finance": viewer.can_see_finance,
        "margin_locked": True,
        "shift": None,
    }
    for provider in HOME_PROVIDERS:
        provider(viewer, out)
    # الأخطر أولاً (ترتيب مستقر داخل كل درجة)
    out["decisions"].sort(key=lambda d: 0 if d.get("severity") == "danger" else 1)
    out["decisions_count"] = len(out["decisions"])
    return out


SEARCH_KINDS: tuple[tuple[str, str], ...] = (
    ("parties", "أطراف"),
    ("documents", "مستندات"),
    ("items", "أصناف"),
)


def search(viewer: Viewer, q: str) -> dict[str, Any]:
    """الأنواع بترتيب ثابت لا يتبدّل بعدد النتائج؛ المحجوب داخل المنشأة يُعدّ ولا يُعرض."""
    started = timezone.now()
    out: dict[str, Any] = {
        "query": q,
        "groups": [{"kind": k, "label": label, "results": []} for k, label in SEARCH_KINDS],
        "restricted": [],
        "suggestions": {
            "nearest": [],
            "other_branches": len(Branch.objects.all()) > 1,
            "create": True,
        },
    }
    for provider in SEARCH_PROVIDERS:
        provider(viewer, q, out)
    out["total"] = sum(len(g["results"]) for g in out["groups"])
    out["kinds_with_results"] = sum(1 for g in out["groups"] if g["results"])
    out["elapsed_ms"] = int((timezone.now() - started).total_seconds() * 1000)
    return out


@dataclass
class NoticeList:
    items: list[dict[str, Any]] = field(default_factory=list)


def notices(tenant_id: uuid.UUID, viewer: Viewer) -> dict[str, Any]:
    """إشعارات سريعة: ما يحتاج فعلاً من الرئيسية (قرارات وانتباه) بوقته."""
    summary = home_summary(tenant_id, viewer)
    items: list[dict[str, Any]] = []
    for d in summary["decisions"]:
        items.append({**d, "needs_action": True})
    for a in summary["attention"]:
        items.append({**a, "needs_action": True})
    return {"items": items, "needs_action": sum(1 for i in items if i["needs_action"])}
