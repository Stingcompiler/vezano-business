"""PLT-16 — كتالوج الباقات والتسعير من مساحة المشغّل (بأمر المالك 2026-09-22؛ 0005 §١١٠).

كانت الباقات ثوابت في الشيفرة. الآن `core.PlanCatalog`: الاسم، الوصف، الترتيب، الحدود، الخصائص،
الأسعار لكل دورة (شهري/ربعي/سنوي)، مدة التجريبية، الأرشفة، و**سعر مقبل بتاريخ سريان** (الشروط
تعد بإشعار 30 يوماً — يُفرض هنا كحدّ أدنى). كل تعديل يُسجَّل في `PlanChange` باسم من قام به وسببه.
الصفحات العامة وORG-06 والتحققات تقرأ الكتالوج عبر `core.subscription.PLANS`.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import PlanCatalog, PlanChange, TenantSubscription
from core.subscription import CYCLES, FEATURES, PLANS
from core.tenancy import platform_context

MIN_PRICE_NOTICE_DAYS = 30

NON_NEGATIVE = (
    "order",
    "campaign_quota",
    "price_monthly_minor",
    "price_quarterly_minor",
    "price_yearly_minor",
)
EDITABLE = (
    "name",
    "blurb",
    "order",
    "is_active",
    "trial",
    "trial_days",
    "max_branches",
    "max_devices",
    "max_users",
    "campaign_quota",
    "features",
    "price_monthly_minor",
    "price_quarterly_minor",
    "price_yearly_minor",
)


class PlanOpRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _row(p: PlanCatalog, subscribers: dict[str, int]) -> dict[str, Any]:
    return {
        "code": p.code,
        "name": p.name,
        "blurb": p.blurb,
        "order": p.order,
        "is_active": p.is_active,
        "trial": p.trial,
        "trial_days": p.trial_days,
        "max_branches": p.max_branches,
        "max_devices": p.max_devices,
        "max_users": p.max_users,
        "campaign_quota": p.campaign_quota,
        "features": list(p.features or []),
        "price_monthly_minor": str(p.price_monthly_minor),
        "price_quarterly_minor": str(p.price_quarterly_minor),
        "price_yearly_minor": str(p.price_yearly_minor),
        "next_price": (
            {
                "monthly_minor": str(p.next_price_monthly_minor)
                if p.next_price_monthly_minor is not None
                else None,
                "quarterly_minor": str(p.next_price_quarterly_minor)
                if p.next_price_quarterly_minor is not None
                else None,
                "yearly_minor": str(p.next_price_yearly_minor)
                if p.next_price_yearly_minor is not None
                else None,
                "effective_at": _iso(p.next_price_effective_at),
            }
            if p.next_price_effective_at
            else None
        ),
        "subscribers": subscribers.get(p.code, 0),
        "updated_at": _iso(p.updated_at),
    }


def payload() -> dict[str, Any]:
    PLANS.ensure_seeded()
    with platform_context():
        subs: dict[str, int] = {}
        for code in TenantSubscription.unscoped.values_list("plan_code", flat=True):
            subs[code] = subs.get(code, 0) + 1
        rows = [_row(p, subs) for p in PlanCatalog.objects.all()]
        changes = [
            {
                "id": str(c.id),
                "plan_code": c.plan_id,
                "changes": c.changes,
                "reason": c.reason,
                "by_name": c.by_name,
                "at": _iso(c.at),
            }
            for c in PlanChange.objects.select_related("plan")[:50]
        ]
    return {
        "plans": rows,
        "features": list(FEATURES),
        "cycles": [{"cycle": c, "label": v[1], "days": v[0]} for c, v in CYCLES.items()],
        "changes": changes,
        "min_price_notice_days": MIN_PRICE_NOTICE_DAYS,
        "rule": (
            "تغيير السعر الحالي يمسّ التجديدات القادمة فقط؛ الأسعار المعلنة تحتاج إشعاراً قبل "
            "30 يوماً — لذلك السعر الجديد يُجدول بتاريخ سريان لا يُطبَّق فوراً."
        ),
    }


def _int(v: Any, *, name: str, minimum: int = 0) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise PlanOpRejected(f"{name}_invalid") from None
    if n < minimum:
        raise PlanOpRejected(f"{name}_invalid")
    return n


def _apply(p: PlanCatalog, body: dict[str, Any]) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    for f in EDITABLE:
        if f not in body:
            continue
        v = body[f]
        if f in ("name",):
            v = str(v or "").strip()[:60]
            if not v:
                raise PlanOpRejected("name_required")
        elif f == "blurb":
            v = str(v or "").strip()[:200]
        elif f in ("is_active", "trial"):
            v = bool(v)
        elif f == "features":
            if not isinstance(v, list) or any(x not in FEATURES for x in v):
                raise PlanOpRejected("features_invalid")
            v = sorted(set(str(x) for x in v))
        elif f == "max_users":
            v = None if v in (None, "", "null") else _int(v, name=f, minimum=1)
        elif f in (
            "order",
            "campaign_quota",
            "price_monthly_minor",
            "price_quarterly_minor",
            "price_yearly_minor",
        ):
            v = _int(v, name=f)
        else:
            v = _int(v, name=f, minimum=1)
        old = getattr(p, f)
        if old != v:
            changes[f] = {"from": old, "to": v}
            setattr(p, f, v)
    return changes


def create(body: dict[str, Any], *, by_name: str, reason: str) -> dict[str, Any]:
    code = str(body.get("code") or "").strip().lower()
    if not code.isidentifier() or len(code) > 20:
        raise PlanOpRejected("code_invalid")
    with platform_context():
        if PlanCatalog.objects.filter(code=code).exists():
            raise PlanOpRejected("code_exists", 409)
        p = PlanCatalog(code=code, name="")
        changes = _apply(p, body)
        if not p.name:
            raise PlanOpRejected("name_required")
        if "pos_core" not in (p.features or []):
            p.features = sorted(set(list(p.features or []) + ["pos_core"]))
        p.save()
        PlanChange.objects.create(
            plan=p, changes={"created": changes}, reason=reason[:300], by_name=by_name
        )
    PLANS.refresh()
    return payload()


def update(code: str, body: dict[str, Any], *, by_name: str, reason: str) -> dict[str, Any]:
    with platform_context():
        p = PlanCatalog.objects.filter(code=code).first()
        if p is None:
            raise PlanOpRejected("not_found", 404)
        changes = _apply(p, body)
        if not changes:
            raise PlanOpRejected("nothing_to_change")
        if "pos_core" not in (p.features or []):
            raise PlanOpRejected("pos_core_required")
        if not p.is_active and p.trial:
            raise PlanOpRejected("trial_required")
        p.save()
        PlanChange.objects.create(plan=p, changes=changes, reason=reason[:300], by_name=by_name)
    PLANS.refresh()
    return payload()


def schedule_price(code: str, body: dict[str, Any], *, by_name: str, reason: str) -> dict[str, Any]:
    """سعر مقبل بتاريخ سريان ≥ 30 يوماً من الآن؛ `clear` يلغيه."""
    with platform_context():
        p = PlanCatalog.objects.filter(code=code).first()
        if p is None:
            raise PlanOpRejected("not_found", 404)
        if body.get("clear"):
            if p.next_price_effective_at is None:
                raise PlanOpRejected("nothing_to_change")
            p.next_price_monthly_minor = None
            p.next_price_quarterly_minor = None
            p.next_price_yearly_minor = None
            p.next_price_effective_at = None
            p.save()
            PlanChange.objects.create(
                plan=p, changes={"next_price": "cleared"}, reason=reason[:300], by_name=by_name
            )
            PLANS.refresh()
            return payload()
        raw = str(body.get("effective_at") or "")
        eff: datetime | None = parse_datetime(raw) if raw else None
        if eff is None:
            raise PlanOpRejected("effective_at_invalid")
        if timezone.is_naive(eff):
            eff = timezone.make_aware(eff)
        if eff < timezone.now() + timedelta(days=MIN_PRICE_NOTICE_DAYS):
            raise PlanOpRejected("notice_too_short")
        nxt = {
            k: (None if body.get(k) in (None, "") else _int(body.get(k), name=k))
            for k in ("monthly_minor", "quarterly_minor", "yearly_minor")
        }
        if all(v is None for v in nxt.values()):
            raise PlanOpRejected("price_required")
        p.next_price_monthly_minor = nxt["monthly_minor"]
        p.next_price_quarterly_minor = nxt["quarterly_minor"]
        p.next_price_yearly_minor = nxt["yearly_minor"]
        p.next_price_effective_at = eff
        p.save()
        PlanChange.objects.create(
            plan=p,
            changes={"next_price": {**nxt, "effective_at": _iso(eff)}},
            reason=reason[:300],
            by_name=by_name,
        )
    PLANS.refresh()
    return payload()
