"""الاشتراك والباقات وانتهاؤه (ORG-06/08؛ §١١.١–١١.٢، §١٦.١؛ G-08): حدود صريحة بالأرقام لا
«غير محدود» بنجمة؛ الميزة غير المتاحة تُعرض رمادية بسبب لا تُخفى؛ الانتهاء لا يحجب الدفتر —
البيع والذمم والورديات والتصدير تستمر، والسوق والحملات والتقارير التحليلية تُحجب.

الحدود والأسعار هنا قيم عرض من الإطار (§١٦.١: «تصميم عرض يحتاج اختبار تكلفة») — تُضبط عند
حسمها (0005 §٥٠).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core.models import Branch, Device, Tenant, TenantSubscription, User, UserBranchAccess
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

PLANS: dict[str, Plan] = {
    "single": Plan(
        code="single",
        name="فرع واحد",
        price_minor=4_500_000,
        max_branches=1,
        max_devices=3,
        max_users=None,
        campaign_quota=0,
        features=frozenset({"pos_core", "advanced_reports", "bulk_pricing"}),
        blurb="3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
    ),
    "dual": Plan(
        code="dual",
        name="فرعان",
        price_minor=8_500_000,
        max_branches=2,
        max_devices=6,
        max_users=None,
        campaign_quota=1_200,
        features=frozenset(
            {
                "pos_core",
                "multi_branch",
                "advanced_reports",
                "branch_compare",
                "market_publish",
                "market_private_prices",
                "campaigns",
                "bulk_pricing",
            }
        ),
        blurb="6 أجهزة · 5 مستخدمين · مقارنة الفروع · نشر في السوق واستقبال الطلبات",
    ),
    "trial": Plan(
        code="trial",
        name="تجريبية",
        price_minor=0,
        max_branches=1,
        max_devices=3,
        max_users=None,
        campaign_quota=0,
        features=frozenset({"pos_core", "advanced_reports", "bulk_pricing"}),
        blurb="كل ميزات باقة الفرع الواحد. عند الانتهاء تبقى بياناتك وتتحوّل للقراءة والبيع النقدي.",
        trial=True,
    ),
}
PLAN_ORDER: tuple[str, ...] = ("single", "dual", "trial")


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
            expires_at=tenant.created_at + timedelta(days=TRIAL_DAYS),
        )
    return sub


def days_since_expiry(sub: TenantSubscription, now: Any = None) -> int:
    """سالب = لم ينتهِ بعد."""
    ref = now or timezone.now()
    if ref >= sub.expires_at:
        return int((ref - sub.expires_at).days)
    return -(int((sub.expires_at - ref).days) + 1)


def status_of(sub: TenantSubscription, now: Any = None) -> str:
    """`trial` | `active` | `grace` (0–14 يوماً بعد الانتهاء) | `expired`."""
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
    granted = code in plan.features or code in (sub.extra_features or [])
    if not granted:
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
                "period": "trial" if p.trial else "month",
                "trial_days": TRIAL_DAYS if p.trial else None,
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
        sub.expires_at = now + timedelta(days=TRIAL_DAYS)
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


def due_payload(plan_code: str | None = None) -> dict[str, Any]:
    """المستحق: سعر الباقة والفترة التالية (الشهر بعد الاستحقاق الحالي)."""
    sub = ensure_subscription()
    plan = PLANS.get(
        plan_code or ("single" if sub.plan_code == "trial" else sub.plan_code), PLANS["single"]
    )
    nxt = sub.expires_at if sub.expires_at > timezone.now() else timezone.now()
    month = nxt.month % 12  # الشهر التالي (0-based بعد التقريب)
    return {
        "plan_code": plan.code,
        "plan_name": plan.name,
        "amount_minor": str(plan.price_minor),
        "currency": "SDG",
        "period_label": MONTHS_AR[month],
        "review_sla": REVIEW_SLA_TEXT,
    }


def proof_payload(p: SubscriptionProof) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "reference": p.reference,
        "plan_code": p.plan_code,
        "amount_minor": str(p.amount_minor),
        "period_label": p.period_label,
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
) -> SubscriptionProof:
    """يسجّل الإثبات «معلّقاً للمراجعة»: الرقم إلزامي وفريد (المكرر يعيد الأول)، الصورة اختيارية
    (المسار البديل: الرقم والتاريخ نصاً ريثما تصل الصورة)."""
    ref = reference.strip()
    if not ref:
        raise ProofRejected("reference_required")
    if plan_code not in PLANS or PLANS[plan_code].trial:
        raise ProofRejected("plan_invalid")
    if image_size > MAX_IMAGE_BYTES or len(image_data) > MAX_IMAGE_BYTES * 4 // 3 + 16:
        raise ProofRejected("image_too_large")
    existing = SubscriptionProof.objects.filter(reference=ref).first()
    if existing is not None:
        raise ProofRejected("duplicate_reference", existing)
    due = due_payload(plan_code)
    proof: SubscriptionProof = SubscriptionProof.objects.create(
        tenant_id=require_tenant(),
        reference=ref,
        plan_code=plan_code,
        amount_minor=PLANS[plan_code].price_minor,
        period_label=str(due["period_label"]),
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
        sub.expires_at = base + timedelta(days=EXTENSION_DAYS)
        sub.plan_code = p.plan_code
        sub.state = TenantSubscription.State.ACTIVE
        sub.renewal_amount_minor = p.amount_minor
        sub.save()
        p.status = SubscriptionProof.Status.APPROVED
        p.extension_days = EXTENSION_DAYS
    else:
        if not reason.strip():
            raise ProofRejected("reason_required")
        p.status = SubscriptionProof.Status.REJECTED
        p.rejection_reason = reason.strip()[:300]
    p.reviewed_at = now
    p.reviewed_by_name = reviewer_name
    p.save()
    from core import audit

    audit.record(
        kind="subscription.reviewed",
        title=("اعتماد إثبات تحويل الاشتراك — مُدّد شهراً" if approve else "رفض إثبات تحويل الاشتراك"),
        actor=None,
        actor_role="مراجع المنصة",
        detail=f"رقم العملية {p.reference} · بواسطة {reviewer_name}",
        reason=reason.strip() if not approve else "",
        ref_entity="core.SubscriptionProof",
        ref_id=p.id,
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
