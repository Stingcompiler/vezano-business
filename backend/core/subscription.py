"""الاشتراك والباقات وانتهاؤه (ORG-06/08؛ §١١.١–١١.٢، §١٦.١؛ G-08): حدود صريحة بالأرقام لا
«غير محدود» بنجمة؛ الميزة غير المتاحة تُعرض رمادية بسبب لا تُخفى؛ الانتهاء لا يحجب الدفتر —
البيع والذمم والورديات والتصدير تستمر، والسوق والحملات والتقارير التحليلية تُحجب.

الحدود والأسعار هنا قيم عرض من الإطار (§١٦.١: «تصميم عرض يحتاج اختبار تكلفة») — تُضبط عند
حسمها (0005 §٥٠).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, overload

from django.utils import timezone

from core.models import (
    Branch,
    Device,
    PlanCatalog,
    Tenant,
    TenantSubscription,
    User,
    UserBranchAccess,
)
from core.tenancy import require_tenant

TRIAL_DAYS = 30
#: §١١.٢ — مهلة السماح بعد الانتهاء ثم تدرّج الحجب
GRACE_DAYS = 14
ADVANCED_STOP_DAYS = 15
DEVICES_STOP_DAYS = 31


@dataclass(frozen=True)
class Plan:
    code: str
    name: str
    price_minor: int  # شهرياً بالوحدة الصغرى (SDG)
    max_branches: int
    max_devices: int
    max_users: int | None  # None = غير محدود (المستخدمون المسمّون ضمن الأساسي §١٦.١)
    campaign_quota: int
    features: frozenset[str] = field(default_factory=frozenset)
    blurb: str = ""
    trial: bool = False
    # 0005 §١١٠ — من الكتالوج: دورات الفوترة (0 = غير معروضة)، مدة التجريبية، الترتيب، والسعر المقبل
    price_quarterly_minor: int = 0
    price_yearly_minor: int = 0
    trial_days: int = TRIAL_DAYS
    order: int = 0
    is_active: bool = True
    next_price_minor: int | None = None
    next_price_quarterly_minor: int | None = None
    next_price_yearly_minor: int | None = None
    next_price_effective_at: Any = None

    def price_for(self, cycle: str) -> int:
        """سعر الدورة؛ الدورة غير المعروضة تُرفض في `submit_proof`."""
        if cycle == "quarterly":
            return self.price_quarterly_minor
        if cycle == "yearly":
            return self.price_yearly_minor
        return self.price_minor


#: دورات الفوترة (0005 §١١٠): الرمز → (الأيام، التسمية)
CYCLES: dict[str, tuple[int, str]] = {
    "monthly": (30, "شهري"),
    "quarterly": (90, "ربعي"),
    "yearly": (365, "سنوي"),
}


#: مفاتيح الخصائص (تقنية داخل العقود؛ أسماؤها للمشتري في `FEATURE_LABELS`)
FEATURES: tuple[str, ...] = (
    "pos_core",
    "multi_branch",
    "advanced_reports",
    "branch_compare",
    "market_publish",
    "market_private_prices",
    "campaigns",
    "bulk_pricing",
    "cost_margin",
    "supplier_analytics",
)


def _promote_due_prices(row: PlanCatalog, now: Any) -> None:
    """السعر المقبل الذي حان سريانه يصير الحالي (كسولاً عند القراءة — لا مجدول)."""
    if row.next_price_effective_at is None or row.next_price_effective_at > now:
        return
    if row.next_price_monthly_minor is not None:
        row.price_monthly_minor = row.next_price_monthly_minor
    if row.next_price_quarterly_minor is not None:
        row.price_quarterly_minor = row.next_price_quarterly_minor
    if row.next_price_yearly_minor is not None:
        row.price_yearly_minor = row.next_price_yearly_minor
    row.next_price_monthly_minor = None
    row.next_price_quarterly_minor = None
    row.next_price_yearly_minor = None
    row.next_price_effective_at = None
    row.save(
        update_fields=[
            "price_monthly_minor",
            "price_quarterly_minor",
            "price_yearly_minor",
            "next_price_monthly_minor",
            "next_price_quarterly_minor",
            "next_price_yearly_minor",
            "next_price_effective_at",
        ]
    )


def _to_plan(row: PlanCatalog) -> Plan:
    return Plan(
        code=row.code,
        name=row.name,
        price_minor=int(row.price_monthly_minor),
        max_branches=row.max_branches,
        max_devices=row.max_devices,
        max_users=row.max_users,
        campaign_quota=row.campaign_quota,
        features=frozenset(row.features or []),
        blurb=row.blurb,
        trial=row.trial,
        price_quarterly_minor=int(row.price_quarterly_minor),
        price_yearly_minor=int(row.price_yearly_minor),
        trial_days=row.trial_days,
        order=row.order,
        is_active=row.is_active,
        next_price_minor=row.next_price_monthly_minor,
        next_price_quarterly_minor=row.next_price_quarterly_minor,
        next_price_yearly_minor=row.next_price_yearly_minor,
        next_price_effective_at=row.next_price_effective_at,
    )


class _PlanCatalog:
    """`PLANS` — قاموس باقات يقرأ الكتالوج من قاعدة البيانات (كاش قصير لكل عملية؛ `refresh()` بعد
    تحرير المشغّل). الباقات المؤرشفة تبقى قابلة للقراءة بالرمز (اشتراكات قائمة) ولا تُعرض."""

    TTL_SECONDS = 2

    def __init__(self) -> None:
        self._all: dict[str, Plan] = {}
        self._loaded_at = 0.0

    def refresh(self) -> None:
        self._loaded_at = 0.0

    def ensure_seeded(self) -> None:
        """يضمن وجود صفوف الكتالوج (البذر الافتراضي إن كان الجدول فارغاً)."""
        self.refresh()
        self._load()

    def _load(self) -> dict[str, Plan]:
        import time

        if self._all and time.monotonic() - self._loaded_at < self.TTL_SECONDS:
            return self._all
        now = timezone.now()
        rows = list(PlanCatalog.objects.all())
        if not rows:
            # جدول فارغ (قاعدة جديدة/مُفرَّغة) → البذر الافتراضي
            from core.plan_defaults import DEFAULT_PLANS

            for row in DEFAULT_PLANS:
                PlanCatalog.objects.get_or_create(code=row["code"], defaults=row)
            rows = list(PlanCatalog.objects.all())
        for r in rows:
            _promote_due_prices(r, now)
        self._all = {r.code: _to_plan(r) for r in rows}
        self._loaded_at = time.monotonic()
        return self._all

    def __getitem__(self, code: str) -> Plan:
        return self._load()[code]

    @overload
    def get(self, code: str) -> Plan | None: ...
    @overload
    def get(self, code: str, default: Plan) -> Plan: ...
    def get(self, code: str, default: Plan | None = None) -> Plan | None:
        return self._load().get(code, default)

    def __contains__(self, code: object) -> bool:
        return code in self._load()

    def __iter__(self) -> Iterator[str]:
        return iter(self.visible_codes())

    def keys(self) -> list[str]:
        return self.visible_codes()

    def values(self) -> list[Plan]:
        return [self._load()[c] for c in self.visible_codes()]

    def items(self) -> list[tuple[str, Plan]]:
        return [(c, self._load()[c]) for c in self.visible_codes()]

    def visible_codes(self) -> list[str]:
        """الباقات المعروضة للمشتري والمستأجر بترتيبها (الفعّالة فقط)."""
        return [
            p.code
            for p in sorted(self._load().values(), key=lambda p: (p.order, p.code))
            if p.is_active
        ]

    def all_codes(self) -> list[str]:
        return [p.code for p in sorted(self._load().values(), key=lambda p: (p.order, p.code))]


PLANS = _PlanCatalog()


def plan_order() -> tuple[str, ...]:
    """ترتيب الباقات المعروضة — كان ثابتاً `PLAN_ORDER`؛ الآن من الكتالوج."""
    return tuple(PLANS.visible_codes())


class _PlanOrder:
    """توافق: `PLAN_ORDER` كان tuple — يبقى قابلاً للتكرار والفهرسة والطول."""

    def __iter__(self) -> Iterator[str]:
        return iter(plan_order())

    def __len__(self) -> int:
        return len(plan_order())

    def __getitem__(self, i: int) -> str:
        return plan_order()[i]

    def __contains__(self, code: object) -> bool:
        return code in plan_order()


PLAN_ORDER = _PlanOrder()


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def ensure_subscription() -> TenantSubscription:
    """صف الاشتراك — يُبذر تجريبياً (30 يوماً من إنشاء المنشأة) للمنشآت السابقة على ORG-06."""
    tenant_id = require_tenant()
    sub: TenantSubscription | None = TenantSubscription.objects.filter(tenant_id=tenant_id).first()
    if sub is None:
        tenant = Tenant.unscoped.get(id=tenant_id)
        sub = TenantSubscription.objects.create(
            tenant_id=tenant_id,
            plan_code="trial",
            state=TenantSubscription.State.TRIAL,
            started_at=tenant.created_at,
            expires_at=tenant.created_at + timedelta(days=trial_days()),
        )
    return sub


def trial_days() -> int:
    """مدة التجريبية من الكتالوج (PLT-16) — الثابت احتياطاً."""
    t = PLANS.get("trial")
    return t.trial_days if t else TRIAL_DAYS


def days_since_expiry(sub: TenantSubscription, now: Any = None) -> int:
    """سالب = لم ينتهِ بعد."""
    ref = now or timezone.now()
    if ref >= sub.expires_at:
        return int((ref - sub.expires_at).days)
    return -(int((sub.expires_at - ref).days) + 1)


def status_of(sub: TenantSubscription, now: Any = None) -> str:
    """`trial` | `active` | `grace` (0–14 يوماً بعد الانتهاء) | `expired` | `suspended` (PLT-13)."""
    if sub.suspended_at is not None:
        return "suspended"
    d = days_since_expiry(sub, now)
    if d < 0:
        return "trial" if sub.plan_code == "trial" else "active"
    return "grace" if d <= GRACE_DAYS else "expired"


def plan_of(sub: TenantSubscription) -> Plan:
    return PLANS.get(sub.plan_code, PLANS["trial"])


def has_feature(code: str, *, now: Any = None) -> bool:
    """المدخل المركزي (§١١.١): الوظائف الأساسية المحمية (`pos_core`) لا تتوقف بحال؛ ما سواها يتبع
    الباقة ثم التدرّج بعد الانتهاء (§١١.٢)."""
    if code == "pos_core":
        return True
    sub = ensure_subscription()
    plan = plan_of(sub)
    # PLT-12: تجاوز على مستوى الباقة (لا فوق مستأجر) يغيّر الاستحقاق فوراً
    from stingops.growth import plan_feature_enabled

    override = plan_feature_enabled(plan.code, code)
    granted = (
        override
        if override is not None
        else (code in plan.features or code in (sub.extra_features or []))
    )
    if not granted:
        return False
    # PLT-13: الإيقاف من المشغّل = كالانتهاء بعد المهلة — الميزات المدفوعة تتوقف، والدفتر لا يُحجب
    if sub.suspended_at is not None:
        return False
    d = days_since_expiry(sub, now)
    if d < 0 or d <= GRACE_DAYS:
        return True
    # من اليوم 15: تتوقف التقارير المتقدمة والتسعير الجماعي والحملات والسوق
    return False


def can_register_device(*, now: Any = None) -> tuple[bool, str]:
    """حدّ الأجهزة رقم صريح: عند بلوغه لا نمنع البيع — نمنع إضافة جهاز جديد ونشرح البديل."""
    sub = ensure_subscription()
    plan = plan_of(sub)
    active = Device.objects.filter(status=Device.Status.ACTIVE).count()
    if active >= plan.max_devices:
        return False, "device_limit"
    if sub.suspended_at is not None:
        return False, "subscription_suspended"
    if days_since_expiry(sub, now) >= DEVICES_STOP_DAYS:
        return False, "subscription_expired"
    return True, ""


def can_add_branch() -> tuple[bool, str]:
    sub = ensure_subscription()
    plan = plan_of(sub)
    if Branch.objects.filter(is_active=True).count() >= plan.max_branches:
        return False, "branch_limit"
    return True, ""


FEATURE_ROWS: tuple[dict[str, str], ...] = (
    {
        "code": "pos_core",
        "label": "نقاط البيع والطباعة والجرد",
        "note": "لا تتوقف في أي حال — حتى بعد انتهاء الاشتراك",
    },
    {"code": "multi_branch", "label": "تعدّد الفروع", "note": ""},
    {
        "code": "market_private_prices",
        "label": "قوائم أسعار خاصة في السوق",
        "note": "فُعّلت لباقتك حديثاً",
    },
    {
        "code": "market_publish",
        "label": "أدوات البائع ونشر العروض",
        "note": "تحتاج تحقّق دور بائع منفصلاً — ليس قيد باقة بل قيد تحقّق (MP-08)",
    },
    {
        "code": "supplier_analytics",
        "label": "تحليلات المورد المتقدّمة",
        "note": "غير مشمولة في باقة الفرعين. نعرضها رمادية مع ما تفعله بالضبط، ولا نخفيها.",
    },
)

#: G-08 — القائمة الصريحة لما يستمر وما يتوقف بعد الانتهاء (07-D3 ORG-08)
CONTINUES: tuple[str, ...] = (
    "البيع كاملاً — نقدي وآجل ومختلط",
    "المرتجع ومعالجة فشل الحفظ",
    "الورديات والصندوق والإغلاق",
    "كشوف الحساب وتسجيل السداد",
    "تصدير نسخة محلية كاملة",
    "تصدير التقارير",
)
STOPS: tuple[str, ...] = (
    "السوق — التصفح والنشر",
    "طلبات التوريد",
    "الحملات والإرسال",
    "التقارير التحليلية",
    "الاستيراد الجماعي",
)


def _feature_status(code: str, plan: Plan, sub: TenantSubscription) -> str:
    if code == "pos_core":
        return "open"
    if code == "market_publish":
        return "conditional" if code in plan.features else "locked"
    return "open" if (code in plan.features or code in (sub.extra_features or [])) else "locked"


def entitlements_payload(*, viewer_is_owner: bool, now: Any = None) -> dict[str, Any]:
    now = now or timezone.now()
    sub = ensure_subscription()
    plan = plan_of(sub)
    branches = Branch.objects.filter(is_active=True).count()
    devices = Device.objects.filter(status=Device.Status.ACTIVE).count()
    users = (
        UserBranchAccess.objects.filter(revoked_at__isnull=True, user__is_active=True)
        .values("user_id")
        .distinct()
        .count()
    )
    users += 0 if users else User.objects.filter(is_active=True).count()
    st = status_of(sub, now)
    rows = []
    for f in FEATURE_ROWS:
        s = _feature_status(f["code"], plan, sub)
        note = f["note"]
        if f["code"] == "multi_branch":
            if plan.max_branches == 1:
                note = "فرع واحد في باقتك · الثاني يحتاج ترقية"
            elif plan.max_branches == 2:
                note = "فرعان في باقتك · الثالث يحتاج ترقية"
            else:
                note = f"{plan.max_branches} فروع في باقتك"
        rows.append({**f, "note": note, "status": s})
    return {
        "plan": {
            "code": plan.code,
            "name": plan.name,
            "trial": plan.trial,
            "state": st,
            "expires_at": _iso(sub.expires_at),
            "days_since_expiry": days_since_expiry(sub, now),
            # المبالغ للمالك ومن فوّضه فقط — مدير الفرع يرى الحدود والميزات لا المبالغ (ORG-06)
            "price_minor": str(plan.price_minor) if viewer_is_owner else None,
            "currency": "SDG",
            "suspended_reason": sub.suspended_reason,
        },
        "limits": {
            "branches": {"used": branches, "max": plan.max_branches},
            "devices": {"used": devices, "max": plan.max_devices},
            "users": {"used": users, "max": plan.max_users},
            "campaign_quota": {"used": 0, "max": plan.campaign_quota},
        },
        "features": rows,
        "if_expired": {"continues": list(CONTINUES), "stops": list(STOPS)},
        "plans": [
            {
                "code": p.code,
                "name": p.name,
                "price_minor": str(p.price_minor),
                "price_quarterly_minor": str(p.price_quarterly_minor),
                "price_yearly_minor": str(p.price_yearly_minor),
                "period": "trial" if p.trial else "month",
                "trial_days": p.trial_days if p.trial else None,
                "blurb": p.blurb,
                "max_branches": p.max_branches,
                "max_devices": p.max_devices,
                "current": p.code == plan.code,
            }
            for p in (PLANS[c] for c in PLAN_ORDER)
        ],
        "can_see_amounts": viewer_is_owner,
        "can_renew": viewer_is_owner,
    }


def expiry_payload(*, viewer_is_owner: bool, now: Any = None) -> dict[str, Any]:
    now = now or timezone.now()
    sub = ensure_subscription()
    st = status_of(sub, now)
    return {
        "state": st,
        "expired": st in {"grace", "expired"},
        "expired_at": _iso(sub.expires_at),
        "days_since_expiry": days_since_expiry(sub, now),
        "continues": list(CONTINUES),
        "stops": list(STOPS),
        "can_renew": viewer_is_owner,
        "can_see_amounts": viewer_is_owner,
        "plan_name": plan_of(sub).name,
        "suspended": sub.suspended_at is not None,
        "suspended_reason": sub.suspended_reason,
    }


def set_for_scenario(
    *, state: str, days_since_expiry: int = 0, plan_code: str = "single"
) -> TenantSubscription:
    """للسيناريو والاختبار فقط (خلف حارس الأعطال): يضبط الاشتراك على حالة بعينها."""
    sub = ensure_subscription()
    now = timezone.now()
    sub.plan_code = plan_code
    if state == "expired":
        sub.state = TenantSubscription.State.EXPIRED
        sub.expires_at = now - timedelta(days=days_since_expiry, seconds=1)
    elif state == "trial":
        sub.state = TenantSubscription.State.TRIAL
        sub.plan_code = "trial"
        sub.expires_at = now + timedelta(days=trial_days())
    else:
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = now + timedelta(days=30)
    sub.save()
    return sub


def device_limit() -> int:
    return plan_of(ensure_subscription()).max_devices


__all__ = [
    "PLANS",
    "can_add_branch",
    "can_register_device",
    "device_limit",
    "entitlements_payload",
    "expiry_payload",
    "has_feature",
    "set_for_scenario",
    "status_of",
]


# ---------------------------------------------------------------- ORG-07 إثبات التحويل
from core.models import SubscriptionProof  # noqa: E402

MAX_IMAGE_BYTES = 2 * 1024 * 1024
EXTENSION_DAYS = 30
REVIEW_SLA_TEXT = "يوم عمل واحد"
MONTHS_AR = (
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
)


class ProofRejected(Exception):
    def __init__(self, code: str, existing: SubscriptionProof | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.existing = existing


def _default_paid_code() -> str:
    """أول باقة مدفوعة معروضة — احتياطاً لمستأجر تجريبي بلا اختيار."""
    for c in PLANS.visible_codes():
        if not PLANS[c].trial:
            return c
    return "single"


def due_payload(plan_code: str | None = None, cycle: str = "monthly") -> dict[str, Any]:
    """المستحق: سعر الباقة للدورة المختارة والفترة التالية (0005 §١١٠: شهري/ربعي/سنوي)."""
    sub = ensure_subscription()
    default = _default_paid_code()
    code = plan_code or (
        default if PLANS.get(sub.plan_code, PLANS[default]).trial else sub.plan_code
    )
    plan = PLANS.get(code, PLANS[default])
    if cycle not in CYCLES:
        cycle = "monthly"
    nxt = sub.expires_at if sub.expires_at > timezone.now() else timezone.now()
    month = nxt.month % 12  # الشهر التالي (0-based بعد التقريب)
    days, cycle_label = CYCLES[cycle]
    return {
        "plan_code": plan.code,
        "plan_name": plan.name,
        "cycle": cycle,
        "cycle_label": cycle_label,
        "cycle_days": days,
        "amount_minor": str(plan.price_for(cycle)),
        "currency": "SDG",
        "period_label": MONTHS_AR[month]
        if cycle == "monthly"
        else f"{cycle_label} من {MONTHS_AR[month]}",
        "review_sla": REVIEW_SLA_TEXT,
        "cycles": [
            {
                "cycle": c,
                "label": CYCLES[c][1],
                "days": CYCLES[c][0],
                "amount_minor": str(plan.price_for(c)),
                "available": plan.price_for(c) > 0,
            }
            for c in CYCLES
        ],
    }


def proof_payload(p: SubscriptionProof) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "reference": p.reference,
        "plan_code": p.plan_code,
        "amount_minor": str(p.amount_minor),
        "period_label": p.period_label,
        "cycle": p.cycle,
        "cycle_label": CYCLES.get(p.cycle, CYCLES["monthly"])[1],
        "image_name": p.image_name,
        "image_size": p.image_size,
        "has_image": bool(p.image_data),
        "status": p.status,
        "submitted_at": _iso(p.submitted_at),
        "reviewed_at": _iso(p.reviewed_at),
        "reviewed_by_name": p.reviewed_by_name,
        "rejection_reason": p.rejection_reason,
        "extension_days": p.extension_days,
    }


def submit_proof(
    *,
    actor: User,
    reference: str,
    plan_code: str,
    image_name: str = "",
    image_size: int = 0,
    image_data: str = "",
    note: str = "",
    cycle: str = "monthly",
) -> SubscriptionProof:
    """يسجّل الإثبات «معلّقاً للمراجعة»: الرقم إلزامي وفريد (المكرر يعيد الأول)، الصورة اختيارية
    (المسار البديل: الرقم والتاريخ نصاً ريثما تصل الصورة)."""
    ref = reference.strip()
    if not ref:
        raise ProofRejected("reference_required")
    if plan_code not in PLANS or PLANS[plan_code].trial or not PLANS[plan_code].is_active:
        raise ProofRejected("plan_invalid")
    if cycle not in CYCLES or PLANS[plan_code].price_for(cycle) <= 0:
        raise ProofRejected("cycle_invalid")
    if image_size > MAX_IMAGE_BYTES or len(image_data) > MAX_IMAGE_BYTES * 4 // 3 + 16:
        raise ProofRejected("image_too_large")
    existing = SubscriptionProof.objects.filter(reference=ref).first()
    if existing is not None:
        raise ProofRejected("duplicate_reference", existing)
    due = due_payload(plan_code, cycle)
    proof: SubscriptionProof = SubscriptionProof.objects.create(
        tenant_id=require_tenant(),
        reference=ref,
        plan_code=plan_code,
        amount_minor=PLANS[plan_code].price_for(cycle),
        period_label=str(due["period_label"]),
        cycle=cycle,
        image_name=image_name[:200],
        image_size=int(image_size),
        image_data=image_data,
        note=note.strip()[:300],
        submitted_by_name=actor.display_name,
    )
    return proof


def attach_image(
    p: SubscriptionProof, *, image_name: str, image_size: int, image_data: str
) -> SubscriptionProof:
    if image_size > MAX_IMAGE_BYTES:
        raise ProofRejected("image_too_large")
    if p.status != SubscriptionProof.Status.PENDING:
        raise ProofRejected("already_reviewed")
    p.image_name, p.image_size, p.image_data = image_name[:200], int(image_size), image_data
    p.save(update_fields=["image_name", "image_size", "image_data"])
    return p


def review_proof(
    p: SubscriptionProof, *, reviewer_name: str, approve: bool, reason: str = ""
) -> SubscriptionProof:
    """المراجعة البشرية: الاعتماد يمدّد الاشتراك شهراً بمرجع الرقم مرة واحدة؛ الرفض بسبب مذكور."""
    if p.status != SubscriptionProof.Status.PENDING:
        raise ProofRejected("already_reviewed")
    now = timezone.now()
    if approve:
        sub = ensure_subscription()
        base = sub.expires_at if sub.expires_at > now else now
        days = CYCLES.get(p.cycle, CYCLES["monthly"])[0]
        sub.expires_at = base + timedelta(days=days)
        sub.plan_code = p.plan_code
        sub.state = TenantSubscription.State.ACTIVE
        sub.renewal_amount_minor = p.amount_minor
        sub.save()
        p.status = SubscriptionProof.Status.APPROVED
        p.extension_days = days
    else:
        if not reason.strip():
            raise ProofRejected("reason_required")
        p.status = SubscriptionProof.Status.REJECTED
        p.rejection_reason = reason.strip()[:300]
    p.reviewed_at = now
    p.reviewed_by_name = reviewer_name
    p.save()
    ext_days = CYCLES.get(p.cycle, CYCLES["monthly"])[0]
    # PLT-13: الخط الزمني على مستوى المنصة
    from stingops.subscriptions import record_proof_review

    record_proof_review(p, approve=approve, reviewer_name=reviewer_name)
    from core import audit

    audit.record(
        kind="subscription.reviewed",
        title=(
            f"اعتماد إثبات تحويل الاشتراك — مُدّد {ext_days} يوماً"
            if approve
            else "رفض إثبات تحويل الاشتراك"
        ),
        actor=None,
        actor_role="مراجع المنصة",
        detail=f"رقم العملية {p.reference} · بواسطة {reviewer_name}",
        reason=reason.strip() if not approve else "",
        ref_entity="core.SubscriptionProof",
        ref_id=p.id,
    )
    # NOT-01: إشعار حسابي يخصّ المالك — يظهر عنوانه للموظف على الجهاز المشترك ويُحجب محتواه
    from core import notifications

    notifications.emit(
        kind="proof_reviewed",
        category="account",
        title=("اعتُمد إثبات تحويل الاشتراك" if approve else "رُفض إثبات تحويل الاشتراك"),
        body=(
            f"رقم العملية {p.reference} · مُدّد الاشتراك {ext_days} يوماً."
            if approve
            else f"رقم العملية {p.reference} · السبب: {reason.strip()}"
        ),
        href="/org/subscription",
        screen="ORG-06",
        needs_action=not approve,
        owner_only=True,
        dedupe_key=f"proof_reviewed:{p.id}",
    )
    return p


def proofs_payload(*, viewer_is_owner: bool) -> dict[str, Any]:
    proofs = SubscriptionProof.objects.order_by("-submitted_at")
    return {
        "due": due_payload(),
        "proofs": [proof_payload(p) for p in proofs],
        "can_submit": viewer_is_owner,
        "review_sla": REVIEW_SLA_TEXT,
    }
