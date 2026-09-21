"""PLT-13 — إدارة اشتراك المستأجر من مساحة المشغّل (بأمر المالك 2026-09-21؛ 0005 §١٠٠).

كل تصرّف بسبب مكتوب، ويُسجَّل مرتين: `SubscriptionEvent` على مستوى المنصة (الخط الزمني)، وحدث تدقيق
في دفتر المستأجر نفسه ليراه المالك (ACC-60: لا تصرّف خفي). الإيقاف يوقف الميزات المدفوعة كالانتهاء
ولا يحجب الدفتر ولا البيع النقدي (§١١.٢).
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core.models import SubscriptionProof, Tenant, TenantSubscription
from core.subscription import PLANS, TRIAL_DAYS, ensure_subscription
from core.tenancy import platform_context, tenant_context
from stingops.models import SubscriptionEvent

MAX_EXTEND_DAYS = 365


class SubscriptionOpRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _audit(tenant_id: uuid.UUID, *, kind: str, title: str, detail: str, reason: str) -> None:
    from core import audit

    with tenant_context(tenant_id):
        audit.record(
            kind=kind,
            title=title,
            actor=None,
            actor_role="مشغّل المنصة",
            detail=detail,
            reason=reason,
        )


def _event(tenant: Tenant, **kw: Any) -> SubscriptionEvent:
    with platform_context():
        return SubscriptionEvent.objects.create(tenant=tenant, **kw)


def _plan_name(code: str) -> str:
    return PLANS[code].name if code in PLANS else code


def _require_reason(reason: str) -> str:
    r = reason.strip()
    if not r:
        raise SubscriptionOpRejected("reason_required")
    return r[:300]


def extend(tenant: Tenant, *, days: int, reason: str, by_name: str) -> dict[str, Any]:
    """تمديد يدوي (دفع نقدي أو استثناء): من تاريخ الانتهاء إن لم يمضِ، وإلا من الآن."""
    reason = _require_reason(reason)
    if not 1 <= days <= MAX_EXTEND_DAYS:
        raise SubscriptionOpRejected("days_out_of_range")
    now = timezone.now()
    with tenant_context(tenant.id):
        sub = ensure_subscription()
        before = sub.expires_at
        base = sub.expires_at if sub.expires_at > now else now
        sub.expires_at = base + timedelta(days=days)
        if sub.state == TenantSubscription.State.EXPIRED:
            sub.state = TenantSubscription.State.ACTIVE
        sub.save(update_fields=["expires_at", "state", "updated_at"])
    _event(
        tenant,
        kind=SubscriptionEvent.Kind.EXTEND,
        days=days,
        expires_before=before,
        expires_after=sub.expires_at,
        reason=reason,
        by_name=by_name,
    )
    _audit(
        tenant.id,
        kind="subscription.extended",
        title=f"مُدِّد الاشتراك {days} يوماً من مشغّل المنصة",
        detail=f"حتى {sub.expires_at:%Y-%m-%d} · بواسطة {by_name}",
        reason=reason,
    )
    return {"expires_at": _iso(sub.expires_at)}


def change_plan(tenant: Tenant, *, plan_code: str, reason: str, by_name: str) -> dict[str, Any]:
    """تغيير الباقة بأثر فوري على `has_feature`؛ التجريبية لا تُعاد بعد باقة مدفوعة."""
    reason = _require_reason(reason)
    if plan_code not in PLANS:
        raise SubscriptionOpRejected("unknown_plan")
    with tenant_context(tenant.id):
        sub = ensure_subscription()
        if sub.plan_code == plan_code:
            raise SubscriptionOpRejected("same_plan", 409)
        if PLANS[plan_code].trial and sub.state != TenantSubscription.State.TRIAL:
            raise SubscriptionOpRejected("trial_not_reassignable", 409)
        from_plan = sub.plan_code
        sub.plan_code = plan_code
        if not PLANS[plan_code].trial and sub.state == TenantSubscription.State.TRIAL:
            # من تجريبية إلى مدفوعة: تصير سارية حتى تاريخ الانتهاء القائم (التمديد تصرّف منفصل)
            sub.state = TenantSubscription.State.ACTIVE
        sub.renewal_amount_minor = PLANS[plan_code].price_minor
        sub.save(update_fields=["plan_code", "state", "renewal_amount_minor", "updated_at"])
    _event(
        tenant,
        kind=SubscriptionEvent.Kind.PLAN_CHANGE,
        from_plan=from_plan,
        to_plan=plan_code,
        reason=reason,
        by_name=by_name,
    )
    _audit(
        tenant.id,
        kind="subscription.plan_changed",
        title=f"غُيِّرت الباقة إلى «{PLANS[plan_code].name}» من مشغّل المنصة",
        detail=f"كانت «{_plan_name(from_plan)}» · بواسطة {by_name}",
        reason=reason,
    )
    return {"plan_code": plan_code}


def suspend(tenant: Tenant, *, reason: str, by_name: str) -> dict[str, Any]:
    reason = _require_reason(reason)
    now = timezone.now()
    with tenant_context(tenant.id):
        sub = ensure_subscription()
        if sub.suspended_at is not None:
            raise SubscriptionOpRejected("already_suspended", 409)
        sub.suspended_at = now
        sub.suspended_reason = reason
        sub.save(update_fields=["suspended_at", "suspended_reason", "updated_at"])
    _event(tenant, kind=SubscriptionEvent.Kind.SUSPEND, reason=reason, by_name=by_name)
    _audit(
        tenant.id,
        kind="subscription.suspended",
        title="أوقف مشغّل المنصة الاشتراك — البيع والقراءة والتصدير مستمرة",
        detail=f"بواسطة {by_name}",
        reason=reason,
    )
    return {"suspended_at": _iso(now)}


def resume(tenant: Tenant, *, reason: str, by_name: str) -> dict[str, Any]:
    reason = _require_reason(reason)
    with tenant_context(tenant.id):
        sub = ensure_subscription()
        if sub.suspended_at is None:
            raise SubscriptionOpRejected("not_suspended", 409)
        sub.suspended_at = None
        sub.suspended_reason = ""
        sub.save(update_fields=["suspended_at", "suspended_reason", "updated_at"])
    _event(tenant, kind=SubscriptionEvent.Kind.RESUME, reason=reason, by_name=by_name)
    _audit(
        tenant.id,
        kind="subscription.resumed",
        title="استأنف مشغّل المنصة الاشتراك",
        detail=f"بواسطة {by_name}",
        reason=reason,
    )
    return {"suspended_at": ""}


def note(tenant: Tenant, *, text: str, by_name: str) -> dict[str, Any]:
    """ملاحظة تشغيلية على المستأجر — في الخط الزمني فقط (لا تدقيق عنده: لا أثر عليه)."""
    text = _require_reason(text)
    ev = _event(tenant, kind=SubscriptionEvent.Kind.NOTE, reason=text, by_name=by_name)
    return {"id": str(ev.id)}


def record_proof_review(p: SubscriptionProof, *, approve: bool, reviewer_name: str) -> None:
    """يُستدعى من `core.subscription.review_proof` ليظهر الإثبات في الخط الزمني."""
    with platform_context():
        tenant = Tenant.unscoped.get(id=p.tenant_id)
    _event(
        tenant,
        kind=(
            SubscriptionEvent.Kind.PROOF_APPROVED
            if approve
            else SubscriptionEvent.Kind.PROOF_REJECTED
        ),
        days=p.extension_days if approve else 0,
        to_plan=p.plan_code if approve else "",
        reason=(f"رقم العملية {p.reference}" if approve else p.rejection_reason),
        by_name=reviewer_name,
    )


def timeline(tenant: Tenant) -> list[dict[str, Any]]:
    """الخط الزمني: بدء التجريبية ثم أحداث المنصة بترتيب زمني تنازلي."""
    with platform_context():
        sub = TenantSubscription.unscoped.filter(tenant=tenant).first()
        events = list(SubscriptionEvent.objects.filter(tenant=tenant).order_by("-at")[:50])
    rows: list[dict[str, Any]] = [
        {
            "id": str(e.id),
            "kind": e.kind,
            "kind_label": SubscriptionEvent.Kind(e.kind).label,
            "days": e.days,
            "from_plan": _plan_name(e.from_plan) if e.from_plan else "",
            "to_plan": _plan_name(e.to_plan) if e.to_plan else "",
            "expires_after": _iso(e.expires_after),
            "reason": e.reason,
            "by_name": e.by_name,
            "at": _iso(e.at),
        }
        for e in events
    ]
    if sub is not None:
        rows.append(
            {
                "id": "start",
                "kind": "start",
                "kind_label": "بدء التجريبية" if sub.plan_code == "trial" else "بدء الاشتراك",
                "days": TRIAL_DAYS if sub.plan_code == "trial" else 0,
                "from_plan": "",
                "to_plan": _plan_name(sub.plan_code),
                "expires_after": "",
                "reason": "",
                "by_name": "",
                "at": _iso(sub.started_at),
            }
        )
    return rows


def apply(tenant: Tenant, *, action: str, body: dict[str, Any], by_name: str) -> dict[str, Any]:
    reason = str(body.get("reason") or "")
    if action == "extend":
        try:
            days = int(body.get("days") or 0)
        except (TypeError, ValueError):
            raise SubscriptionOpRejected("days_out_of_range") from None
        return extend(tenant, days=days, reason=reason, by_name=by_name)
    if action == "plan":
        return change_plan(
            tenant, plan_code=str(body.get("plan_code") or ""), reason=reason, by_name=by_name
        )
    if action == "suspend":
        return suspend(tenant, reason=reason, by_name=by_name)
    if action == "resume":
        return resume(tenant, reason=reason, by_name=by_name)
    if action == "note":
        return note(tenant, text=reason, by_name=by_name)
    raise SubscriptionOpRejected("unknown_action")
