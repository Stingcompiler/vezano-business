"""MP-08/MP-09 — دور البائع وطلب التحقق، وصفحة المنشأة المنشورة."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import PortalChannel, Tenant, User
from core.tenancy import require_tenant
from market.models import MarketAccount, MarketProfile

REVIEW_USUAL_DAYS = 3
VERIFIED_DAYS = 365
MAX_DOC_BYTES = 2 * 1024 * 1024
BADGE_LIMITS = (
    "الشارة تقول: تحققنا من وجود هذه المنشأة ومن هوية مسؤولها. لا تقول إن بضاعتها جيدة، "
    "ولا إنها ستسلّم في الموعد، ولا إننا نضمن أي طلب."
)
BADGE_PUBLIC = "التوثيق لا يشمل جودة السلع أو الالتزام بالتسليم."


class MarketRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code, self.field, self.extra = code, field, extra or {}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def ensure_account() -> MarketAccount:
    acc: MarketAccount | None = MarketAccount.objects.first()
    if acc is None:
        acc = MarketAccount.objects.create(tenant_id=require_tenant())
    return acc


def ensure_profile() -> MarketProfile:
    p: MarketProfile | None = MarketProfile.objects.first()
    if p is None:
        tenant = Tenant.unscoped.get(id=require_tenant())
        p = MarketProfile.objects.create(tenant_id=tenant.id, public_name=tenant.name)
    return p


def can_edit_identity(viewer: home.Viewer) -> bool:
    """الاسم والشارة والمناطق تمثّل المنشأة كلها — تحريرها للمالك (MP-09 permission_denied)."""
    return viewer.is_owner


# ------------------------------------------------------------------ MP-08 التحقق


def checklist(acc: MarketAccount) -> list[dict[str, Any]]:
    """قائمة الطلب حقلاً حقلاً، مع سبب النقص السابق إن وُجد — «طلبك مرفوض» بلا سبب يعيد نفس الملف."""
    reasons = acc.review_reasons or {}
    return [
        {
            "key": "identity",
            "title": "هوية مسؤول المنشأة",
            "hint": "نفس التحقق المستخدم للشراء — لا يُعاد",
            "done": True,
            "reason": "",
        },
        {
            "key": "service_area",
            "title": "عنوان النشاط ومنطقة الخدمة",
            "hint": " · ".join(x for x in (acc.business_address, acc.service_area_note) if x)
            or "المنطقة التي تخدمها وكيف يستلم المشتري",
            "done": bool(acc.business_address and acc.service_area_note),
            "reason": str(reasons.get("service_area", "")),
        },
        {
            "key": "terms",
            "title": "موافقة على شروط البائع",
            "hint": "مسؤولية الوصف والسعر والتسليم على المنشأة لا على Sting",
            "done": acc.terms_accepted_at is not None,
            "reason": "",
        },
        {
            "key": "registry_doc",
            "title": "مستند السجل التجاري",
            "hint": "صورة واضحة · يراجعها مشرف السوق ولا تُنشر في ملفك العام",
            "done": bool(acc.registry_doc_data_url),
            "reason": str(reasons.get("registry_doc", "")),
        },
    ]


def account_payload(acc: MarketAccount, viewer: home.Viewer) -> dict[str, Any]:
    tenant = Tenant.unscoped.get(id=acc.tenant_id)
    items = checklist(acc)
    done = sum(1 for i in items if i["done"])
    days = (
        max(0, (timezone.now() - acc.submitted_at).days) if acc.submitted_at is not None else None
    )
    return {
        "shop_name": tenant.name,
        "role": acc.role,
        "verification": acc.verification,
        "verification_label": MarketAccount.Verification(acc.verification).label,
        "checklist": items,
        "done": done,
        "total": len(items),
        "submitted_at": _iso(acc.submitted_at),
        "days_since_submitted": days,
        "usual_review_days": REVIEW_USUAL_DAYS,
        "reviewed_at": _iso(acc.reviewed_at),
        "review_reasons": acc.review_reasons or {},
        "badge_limits": BADGE_LIMITS,
        "can_submit": viewer.is_owner,
        "terms_accepted_at": _iso(acc.terms_accepted_at),
        "registry_doc_name": acc.registry_doc_name,
    }


def save_verification(
    *,
    actor: User,
    viewer: home.Viewer,
    business_address: str | None,
    service_area_note: str | None,
    accept_terms: bool | None,
    registry_doc: dict[str, str] | None,
) -> MarketAccount:
    """يحفظ ما اكتمل من القائمة (مسوّدة)؛ لا شيء يُنشر."""
    if not viewer.is_owner:
        raise MarketRejected("owner_required")
    acc = ensure_account()
    if acc.verification == MarketAccount.Verification.VERIFIED:
        return acc
    if business_address is not None:
        acc.business_address = business_address.strip()[:300]
    if service_area_note is not None:
        acc.service_area_note = service_area_note.strip()[:300]
    if accept_terms:
        acc.terms_accepted_at = acc.terms_accepted_at or timezone.now()
    if registry_doc and registry_doc.get("data_url"):
        data = registry_doc["data_url"]
        if len(data) > MAX_DOC_BYTES * 4 // 3 + 64:
            raise MarketRejected("doc_too_large", "registry_doc")
        acc.registry_doc_data_url = data
        acc.registry_doc_name = registry_doc.get("name", "")[:200]
    if acc.verification == MarketAccount.Verification.NONE:
        acc.verification = MarketAccount.Verification.DRAFT
    acc.save()
    return acc


def submit_verification(*, actor: User, viewer: home.Viewer) -> MarketAccount:
    """يقدّم الطلب لمشرف السوق (PLT-06) — كل بنود القائمة مكتملة؛ وإلا النقص مسمّى حقلاً حقلاً."""
    if not viewer.is_owner:
        raise MarketRejected("owner_required")
    acc = ensure_account()
    if acc.verification == MarketAccount.Verification.VERIFIED:
        return acc
    missing = [i["key"] for i in checklist(acc) if not i["done"]]
    if missing:
        raise MarketRejected("checklist_incomplete", "", {"missing": missing})
    acc.verification = MarketAccount.Verification.PENDING
    acc.submitted_at = timezone.now()
    acc.review_reasons = {}
    acc.save(update_fields=["verification", "submitted_at", "review_reasons", "updated_at"])
    audit.record(
        kind="market.verification_submitted",
        title="طلب تحقق البائع قُدِّم لمشرف السوق",
        actor=actor,
        ref_entity="market.MarketAccount",
        ref_id=acc.id,
    )
    return acc


def review_verification(
    acc: MarketAccount, *, reviewer_name: str, decision: str, reasons: dict[str, str] | None
) -> MarketAccount:
    """قرار المشرف: `verified` يفتح دور البائع (ولا ينشر شيئاً)، `needs_more` بأسباب حقلاً حقلاً،
    `rejected` نهائي بسبب."""
    if acc.verification not in {
        MarketAccount.Verification.PENDING,
        MarketAccount.Verification.NEEDS_MORE,
    }:
        raise MarketRejected("not_pending")
    now = timezone.now()
    acc.reviewed_at = now
    acc.reviewer_name = reviewer_name
    if decision == "verified":
        acc.verification = MarketAccount.Verification.VERIFIED
        acc.verified_until = timezone.localdate() + timedelta(days=VERIFIED_DAYS)
        acc.role = (
            MarketAccount.Role.BOTH
            if acc.role == MarketAccount.Role.BUYER
            else MarketAccount.Role.SELLER
            if acc.role == MarketAccount.Role.SELLER
            else acc.role
        )
        acc.review_reasons = {}
    elif decision == "needs_more":
        if not reasons:
            raise MarketRejected("reasons_required", "reasons")
        acc.verification = MarketAccount.Verification.NEEDS_MORE
        acc.review_reasons = {str(k): str(v) for k, v in reasons.items()}
    elif decision == "rejected":
        acc.verification = MarketAccount.Verification.REJECTED
        acc.review_reasons = {str(k): str(v) for k, v in (reasons or {}).items()}
    else:
        raise MarketRejected("decision_invalid", "decision")
    acc.save()
    audit.record(
        kind="market.verification_reviewed",
        title=f"مراجعة تحقق البائع: {MarketAccount.Verification(acc.verification).label}",
        actor=None,
        actor_role="platform",
        detail=reviewer_name,
        ref_entity="market.MarketAccount",
        ref_id=acc.id,
    )
    return acc


def badge_of(acc: MarketAccount | None) -> tuple[str, str]:
    """الشارة هوية لا تزكية: `verified` / `expired` (سقطت ويبقى الملف) / `suspended` (النشر
    معلَّق — ACC-135) / `none`."""
    if acc is None:
        return "none", "بلا شارة"
    if acc.publish_suspended_at is not None:
        return "suspended", "نشر معلَّق"
    if acc.verification == MarketAccount.Verification.VERIFIED:
        if acc.verified_until and acc.verified_until < timezone.localdate():
            return "expired", "التحقق منتهٍ"
        return "verified", "موثَّقة المستندات"
    return "none", "بلا شارة"


def is_verified_seller() -> bool:
    acc = MarketAccount.objects.first()
    return badge_of(acc)[0] == "verified"


# ------------------------------------------------------------------ MP-09 الصفحة


def public_profile(p: MarketProfile, acc: MarketAccount | None = None) -> dict[str, Any]:
    """كما يراها أي مشترٍ: الحقول المصرّح بها فقط (ACC-120) — من المنشور لا من المسوّدة."""
    pub = p.published or {}
    verified = bool(acc and acc.verification == MarketAccount.Verification.VERIFIED)
    return {
        "public_name": str(pub.get("public_name", "")),
        "category_line": str(pub.get("category_line", "")),
        "categories": list(pub.get("categories", [])),
        "service_areas": list(pub.get("service_areas", [])),
        "fulfilment": list(pub.get("fulfilment", [])),
        "verified": verified,
        "badge_label": MarketAccount.Verification.VERIFIED.label if verified else "",
        "badge_note": BADGE_PUBLIC if verified else "",
        "published_at": _iso(p.published_at),
        "is_published": bool(pub),
    }


def _followers_count() -> int:
    from market.follows import followers_count

    return followers_count(require_tenant())


def profile_payload(p: MarketProfile, viewer: home.Viewer) -> dict[str, Any]:
    acc = MarketAccount.objects.first()
    ch = PortalChannel.objects.first()
    return {
        "draft": {
            "public_name": p.public_name,
            "category_line": p.category_line,
            "categories": list(p.categories or []),
            "service_areas": list(p.service_areas or []),
            "fulfilment": list(p.fulfilment or []),
        },
        "public": public_profile(p, acc),
        "can_edit": can_edit_identity(viewer),
        "role_name": viewer.role_name,
        "portal_slug": ch.slug if ch else "",
        "updated_at": _iso(p.updated_at),
        "updated_by_name": p.updated_by_name,
        "seller_verified": bool(acc and acc.verification == MarketAccount.Verification.VERIFIED),
        "followers_count": _followers_count(),
        # ما لا يظهر هنا — يُعطى في الطلب لا في الدليل
        "not_published": ["العنوان التفصيلي", "الهاتف"],
    }


def _lines(v: Any) -> list[str]:
    if isinstance(v, str):
        parts = [x.strip() for x in v.replace("\n", "·").split("·")]
    elif isinstance(v, list):
        parts = [str(x).strip() for x in v]
    else:
        parts = []
    return [x for x in parts if x][:20]


def save_profile(
    *, actor: User, viewer: home.Viewer, data: dict[str, Any], publish: bool
) -> MarketProfile:
    """الحفظ للمسودة دائماً؛ النشر يحتاج منطقة خدمة واحدة على الأقل — «بلا منطقة لن تظهر في
    نتائج أحد» (نسمّي العاقبة لا الحقل)."""
    if not can_edit_identity(viewer):
        raise MarketRejected("owner_required")
    p = ensure_profile()
    if "public_name" in data:
        p.public_name = str(data.get("public_name") or "").strip()[:200]
    if "category_line" in data:
        p.category_line = str(data.get("category_line") or "").strip()[:120]
    if "categories" in data:
        p.categories = _lines(data.get("categories"))
    if "service_areas" in data:
        p.service_areas = _lines(data.get("service_areas"))
    if "fulfilment" in data:
        p.fulfilment = _lines(data.get("fulfilment"))
    p.updated_by_name = actor.display_name
    p.updated_at = timezone.now()
    if publish:
        if not p.service_areas:
            p.save()
            raise MarketRejected("service_areas_required", "service_areas")
        if not p.public_name:
            p.save()
            raise MarketRejected("public_name_required", "public_name")
        p.published = {
            "public_name": p.public_name,
            "category_line": p.category_line,
            "categories": list(p.categories),
            "service_areas": list(p.service_areas),
            "fulfilment": list(p.fulfilment),
        }
        p.published_at = timezone.now()
    p.save()
    audit.record(
        kind="market.profile_published" if publish else "market.profile_saved",
        title="نشر صفحة المنشأة" if publish else "حفظ مسوّدة صفحة المنشأة",
        actor=actor,
        ref_entity="market.MarketProfile",
        ref_id=p.id,
    )
    return p
