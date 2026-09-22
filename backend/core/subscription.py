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
    ReceiptCounter,
    SubscriptionReceipt,
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
        "next_plan_code": sub.next_plan_code,
        "next_plan_name": _plan_name_safe(sub.next_plan_code) if sub.next_plan_code else "",
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
    current = PLANS.get(sub.plan_code, PLANS[default])
    # التخفيض المجدول (0005 §١١٢) يصير المستحق الافتراضي للتجديد
    code = plan_code or sub.next_plan_code or (default if current.trial else sub.plan_code)
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
        "cycle_label": (
            "فرق ترقية" if p.kind == "upgrade" else CYCLES.get(p.cycle, CYCLES["monthly"])[1]
        ),
        "kind": p.kind,
        "image_name": p.image_name,
        "image_size": p.image_size,
        "has_image": bool(p.image_data),
        "status": p.status,
        "submitted_at": _iso(p.submitted_at),
        "reviewed_at": _iso(p.reviewed_at),
        "reviewed_by_name": p.reviewed_by_name,
        "rejection_reason": p.rejection_reason,
        "extension_days": p.extension_days,
        "receipt": _receipt_ref(p),
    }


def _plan_name_safe(code: str) -> str:
    plan = PLANS.get(code)
    return plan.name if plan else code


def _receipt_ref(p: SubscriptionProof) -> dict[str, str] | None:
    r = SubscriptionReceipt.objects.filter(proof=p).first()
    return {"id": str(r.id), "number": r.number} if r else None


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
    kind: str = "renewal",
) -> SubscriptionProof:
    """يسجّل الإثبات «معلّقاً للمراجعة»: الرقم إلزامي وفريد (المكرر يعيد الأول)، الصورة اختيارية
    (المسار البديل: الرقم والتاريخ نصاً ريثما تصل الصورة)."""
    ref = reference.strip()
    if not ref:
        raise ProofRejected("reference_required")
    if plan_code not in PLANS or PLANS[plan_code].trial or not PLANS[plan_code].is_active:
        raise ProofRejected("plan_invalid")
    if kind == "upgrade":
        try:
            quote = change_quote(plan_code)
        except PlanChangeRejected as e:
            raise ProofRejected(e.code) from None
        if quote["kind"] != "upgrade" or int(quote["amount_minor"]) <= 0:
            raise ProofRejected("not_upgrade")
        cycle = "monthly"
    elif cycle not in CYCLES or PLANS[plan_code].price_for(cycle) <= 0:
        raise ProofRejected("cycle_invalid")
    if image_size > MAX_IMAGE_BYTES or len(image_data) > MAX_IMAGE_BYTES * 4 // 3 + 16:
        raise ProofRejected("image_too_large")
    existing = SubscriptionProof.objects.filter(reference=ref).first()
    if existing is not None:
        raise ProofRejected("duplicate_reference", existing)
    due = due_payload(plan_code, cycle)
    amount = int(quote["amount_minor"]) if kind == "upgrade" else PLANS[plan_code].price_for(cycle)
    proof: SubscriptionProof = SubscriptionProof.objects.create(
        tenant_id=require_tenant(),
        reference=ref,
        plan_code=plan_code,
        amount_minor=amount,
        period_label=("فرق ترقية" if kind == "upgrade" else str(due["period_label"])),
        cycle=cycle,
        kind=kind,
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
        if p.kind == "upgrade":
            # 0005 §١١٢ — الترقية: الباقة تتغيّر الآن، والتاريخ كما هو
            days = 0
            sub.plan_code = p.plan_code
            sub.next_plan_code = ""
            sub.save()
            p.status = SubscriptionProof.Status.APPROVED
            p.extension_days = 0
            _issue_receipt(p, period_from=now, period_to=sub.expires_at, by_name=reviewer_name)
        else:
            days = CYCLES.get(p.cycle, CYCLES["monthly"])[0]
            sub.expires_at = base + timedelta(days=days)
            sub.plan_code = p.plan_code
            # التخفيض المجدول يُستهلك حين يُجدَّد على الباقة الأصغر
            if sub.next_plan_code == p.plan_code:
                sub.next_plan_code = ""
            sub.state = TenantSubscription.State.ACTIVE
            sub.renewal_amount_minor = p.amount_minor
            sub.save()
            p.status = SubscriptionProof.Status.APPROVED
            p.extension_days = days
            # 0005 §١١١ — إيصال مرقَّم للمستأجر
            _issue_receipt(p, period_from=base, period_to=sub.expires_at, by_name=reviewer_name)
    else:
        if not reason.strip():
            raise ProofRejected("reason_required")
        p.status = SubscriptionProof.Status.REJECTED
        p.rejection_reason = reason.strip()[:300]
    p.reviewed_at = now
    p.reviewed_by_name = reviewer_name
    p.save()
    ext_days = 0 if p.kind == "upgrade" else CYCLES.get(p.cycle, CYCLES["monthly"])[0]
    receipt_ref = _receipt_ref(p)
    receipt_no = receipt_ref["number"] if receipt_ref else ""
    # PLT-13: الخط الزمني على مستوى المنصة
    from stingops.subscriptions import record_proof_review

    record_proof_review(p, approve=approve, reviewer_name=reviewer_name)
    from core import audit

    audit.record(
        kind="subscription.reviewed",
        title=(
            (
                f"اعتماد فرق الترقية — الباقة «{_plan_name_safe(p.plan_code)}» من الآن"
                if p.kind == "upgrade"
                else f"اعتماد إثبات تحويل الاشتراك — مُدّد {ext_days} يوماً"
            )
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
            (
                f"رقم العملية {p.reference} · الترقية سارية الآن · الإيصال {receipt_no}"
                if p.kind == "upgrade"
                else (
                    f"رقم العملية {p.reference} · مُدّد الاشتراك {ext_days} يوماً · "
                    f"الإيصال {receipt_no}"
                )
            )
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


# ------------------------------------------------------------------ 0005 §١١٢ ترقية/تخفيض


class PlanChangeRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _usage() -> dict[str, int]:
    return {
        "branches": Branch.objects.filter(is_active=True).count(),
        "devices": Device.objects.filter(status=Device.Status.ACTIVE).count(),
    }


def change_quote(target_code: str, now: Any = None) -> dict[str, Any]:
    """عرض التغيير: ترقية بفرق مقسَّط على المتبقي (سعر شهري ÷ 30 × الأيام المتبقية)، أو تخفيض
    يسري عند التجديد بلا ردّ مال؛ التخفيض يُمنع إن تجاوز الاستعمال حدود الباقة الأصغر."""
    now = now or timezone.now()
    sub = ensure_subscription()
    current = plan_of(sub)
    target = PLANS.get(target_code)
    if target is None or not target.is_active or target.trial:
        raise PlanChangeRejected("plan_invalid")
    if target.code == sub.plan_code:
        raise PlanChangeRejected("same_plan", 409)
    if sub.suspended_at is not None:
        raise PlanChangeRejected("suspended", 409)
    remaining = max(0, (sub.expires_at - now).days)
    upgrade = target.price_minor > current.price_minor
    if current.trial or status_of(sub, now) in {"grace", "expired"}:
        # التجريبية أو المنتهي: لا فرق — يدفع الباقة كاملة عند التجديد (ORG-07 بالباقة المختارة)
        kind = "renewal"
        diff = 0
    elif upgrade:
        kind = "upgrade"
        diff = (target.price_minor - current.price_minor) * remaining // 30
    else:
        kind = "downgrade"
        diff = 0
    usage = _usage()
    blocked: list[str] = []
    if usage["branches"] > target.max_branches:
        blocked.append(f"الفروع النشطة {usage['branches']} تتجاوز حدّ الباقة {target.max_branches}")
    if usage["devices"] > target.max_devices:
        blocked.append(f"الأجهزة النشطة {usage['devices']} تتجاوز حدّ الباقة {target.max_devices}")
    return {
        "from": {
            "code": current.code,
            "name": current.name,
            "price_minor": str(current.price_minor),
        },
        "to": {"code": target.code, "name": target.name, "price_minor": str(target.price_minor)},
        "kind": kind,
        "remaining_days": remaining,
        "expires_at": _iso(sub.expires_at),
        "amount_minor": str(diff),
        "currency": "SDG",
        "effective": "immediately_after_approval" if kind == "upgrade" else "at_renewal",
        "blocked_reasons": blocked,
        "pending_downgrade": sub.next_plan_code,
        "note": (
            "الترقية تسري فور اعتماد إثبات فرق السعر على الأيام المتبقية — تاريخ الانتهاء لا يتغيّر."
            if kind == "upgrade"
            else "التخفيض يسري عند التجديد القادم؛ لا يُردّ مال عن المدة المدفوعة."
            if kind == "downgrade"
            else "من التجريبية أو بعد الانتهاء: تُدفع الباقة المختارة كاملة عند التجديد."
        ),
    }


def request_downgrade(target_code: str, *, actor: User) -> dict[str, Any]:
    q = change_quote(target_code)
    if q["kind"] != "downgrade":
        raise PlanChangeRejected("not_downgrade")
    if q["blocked_reasons"]:
        raise PlanChangeRejected("limits_exceeded", 409)
    sub = ensure_subscription()
    sub.next_plan_code = target_code
    sub.save(update_fields=["next_plan_code", "updated_at"])
    from core import audit

    audit.record(
        kind="subscription.downgrade_scheduled",
        title=f"تخفيض مجدول إلى «{q['to']['name']}» عند التجديد",
        actor=actor,
        detail=f"الحالية «{q['from']['name']}» حتى {sub.expires_at:%Y-%m-%d}",
    )
    return q


def cancel_downgrade(*, actor: User) -> None:
    sub = ensure_subscription()
    if not sub.next_plan_code:
        raise PlanChangeRejected("nothing_to_cancel")
    sub.next_plan_code = ""
    sub.save(update_fields=["next_plan_code", "updated_at"])
    from core import audit

    audit.record(kind="subscription.downgrade_cancelled", title="أُلغي التخفيض المجدول", actor=actor)


def _next_receipt_number(now: Any) -> str:
    """`SR-YYYY-NNNNNN` — عدّاد سنوي على مستوى المنصة تحت قفل صف."""
    from django.db import transaction

    from core.tenancy import platform_context

    with platform_context(), transaction.atomic():
        counter, _ = ReceiptCounter.objects.select_for_update().get_or_create(year=now.year)
        counter.last += 1
        counter.save(update_fields=["last"])
        return f"SR-{now.year}-{counter.last:06d}"


def _issue_receipt(
    p: SubscriptionProof, *, period_from: Any, period_to: Any, by_name: str
) -> SubscriptionReceipt:
    now = timezone.now()
    tenant = Tenant.unscoped.get(id=p.tenant_id)
    plan = PLANS.get(p.plan_code)
    receipt: SubscriptionReceipt = SubscriptionReceipt.objects.create(
        tenant_id=p.tenant_id,
        number=_next_receipt_number(now),
        proof=p,
        tenant_name=tenant.name,
        plan_code=p.plan_code,
        plan_name=plan.name if plan else p.plan_code,
        cycle=p.cycle if p.kind != "upgrade" else "upgrade",
        cycle_label=(
            "فرق ترقية" if p.kind == "upgrade" else CYCLES.get(p.cycle, CYCLES["monthly"])[1]
        ),
        amount_minor=p.amount_minor,
        currency="SDG",
        reference=p.reference,
        period_from=period_from,
        period_to=period_to,
        issued_at=now,
        issued_by_name=by_name,
    )
    return receipt


def receipt_payload(r: SubscriptionReceipt) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "number": r.number,
        "tenant_name": r.tenant_name,
        "plan_code": r.plan_code,
        "plan_name": r.plan_name,
        "cycle": r.cycle,
        "cycle_label": r.cycle_label,
        "amount_minor": str(r.amount_minor),
        "currency": r.currency,
        "reference": r.reference,
        "period_from": _iso(r.period_from),
        "period_to": _iso(r.period_to),
        "issued_at": _iso(r.issued_at),
        "issued_by_name": r.issued_by_name,
        "proof_id": str(r.proof_id),
        "issuer": RECEIPT_ISSUER,
        "note": "إيصال اشتراك — ليس فاتورة ضريبية. يثبت استلام المبلغ عن الفترة المذكورة.",
    }


def receipts_payload() -> dict[str, Any]:
    rows = SubscriptionReceipt.objects.order_by("-issued_at")
    return {"receipts": [receipt_payload(r) for r in rows]}


#: هوية المُصدر على الإيصال — تُملأ من الاسم القانوني حين يحسمه المالك (0005 §٩٨)
RECEIPT_ISSUER = {
    "name": "فيزانو",
    "legal": "[الاسم القانوني للمزوّد]",
    "contact": "[البريد الرسمي]",
}


def proofs_payload(*, viewer_is_owner: bool) -> dict[str, Any]:
    proofs = SubscriptionProof.objects.order_by("-submitted_at")
    return {
        "due": due_payload(),
        "proofs": [proof_payload(p) for p in proofs],
        "can_submit": viewer_is_owner,
        "review_sla": REVIEW_SLA_TEXT,
    }
