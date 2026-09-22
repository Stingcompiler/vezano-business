"""PLT-01/PLT-02 — دخول المشغّل (حساب منفصل وتحقّق ثنائي دائماً) وقائمة المستأجرين بحدود وصول
(ACC-60 · ACC-62): الاستحقاق والأجهزة وصحة المزامنة وحجم التخزين — لا مبيعات ولا زبائن ولا ذمم."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Max
from django.utils import timezone

from core.auth import totp
from core.auth.accounts import normalize_identifier
from core.auth.tokens import issue_session_tokens
from core.models import (
    Account,
    Device,
    Session,
    SubscriptionProof,
    Tenant,
    TenantSubscription,
    User,
)
from core.subscription import PLAN_ORDER, PLANS
from core.tenancy import platform_context
from stingops import subscriptions as _subscriptions
from stingops.models import OperatorAccessLog, OperatorProfile, SupportGrant

SYNC_STUCK_DAYS = 3
DUE_SOON_DAYS = 14
ACCESS_RULE = (
    "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه، ونطاقاً زمنياً، وسبباً مكتوباً، وتظهر في "
    "سجل تدقيقه هو — لا في سجلنا فقط. ما تراه في هذا الجدول حقول تشغيل وفوترة، وليس مبيعات ولا "
    "عملاء ولا أسعاراً."
)


class OperatorLoginRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code, self.status = code, status


@dataclass(frozen=True)
class OperatorLogin:
    access: str
    refresh: str
    session_id: str
    display_name: str


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------ PLT-01 الدخول


def ensure_operator(user: User) -> OperatorProfile:
    prof, _ = OperatorProfile.objects.get_or_create(
        user=user, defaults={"totp_secret": totp.new_secret()}
    )
    return prof


def login(*, email: str, password: str, otp: str = "", user_agent: str = "") -> OperatorLogin:
    """بريد ومرور — التحقّق الثنائي أُلغي نهائياً بأمر المالك (2026-09-22؛ 0005 §١٠٨)؛ حساب مالك
    متجر لا يترقّى. `otp` يُقبل ويُهمل للتوافق."""
    try:
        identifier, _ = normalize_identifier(email)
    except ValueError:
        raise OperatorLoginRejected("invalid_credentials") from None
    with platform_context():
        account = Account.unscoped.filter(identifier=identifier, is_active=True).first()
        if account is None or not check_password(password, account.password):
            check_password(password, make_password("x"))
            raise OperatorLoginRejected("invalid_credentials")
        operator = User.unscoped.filter(
            account=account, is_platform_staff=True, tenant__isnull=True, is_active=True
        ).first()
        if operator is None:
            if User.unscoped.filter(account=account, tenant__isnull=False, is_active=True).exists():
                # بيانات صحيحة كمالك متجر — مساحة المشغّل حساب من نوع آخر تماماً
                raise OperatorLoginRejected("tenant_account", 403)
            raise OperatorLoginRejected("invalid_credentials")
        prof = ensure_operator(operator)
        del otp  # لا تحقّق ثنائي
        session, refresh = issue_session_tokens(operator, user_agent=user_agent)
        prof.last_login_at = timezone.now()
        prof.save(update_fields=["last_login_at"])
        OperatorAccessLog.objects.create(operator=operator, action="login", detail=user_agent[:300])
    return OperatorLogin(
        access=str(refresh.access_token),
        refresh=str(refresh),
        session_id=str(session.id),
        display_name=operator.display_name,
    )


# ------------------------------------------------------------------ PLT-02 المستأجرون


def _sub_status(sub: TenantSubscription | None, now: Any) -> tuple[str, str, str]:
    """(الرمز، التسمية، سطر الاستحقاق)."""
    if sub is None:
        return "trial", "تجريبي", "بلا اشتراك مسجَّل"
    if sub.suspended_at is not None:
        return (
            "suspended",
            "موقوف",
            f"أوقفه المشغّل {sub.suspended_at:%d/%m} · {sub.suspended_reason}",
        )
    days = (sub.expires_at - now).days
    if sub.state == TenantSubscription.State.TRIAL:
        return (
            "trial",
            "تجريبي",
            (f"تنتهي بعد {days} يوماً" if days >= 0 else f"انتهت قبل {-days} يوماً"),
        )
    if sub.expires_at < now:
        return "expired", "منتهي الاشتراك", f"انتهى {sub.expires_at:%d/%m} · متأخر {-days} يوماً"
    return "active", "نشط", f"يُجدَّد بعد {days} يوماً · حتى {sub.expires_at:%d/%m}"


def tenant_row(t: Tenant, now: Any) -> dict[str, Any]:
    with platform_context():
        sub = TenantSubscription.unscoped.filter(tenant=t).first()
        pending_proof = SubscriptionProof.unscoped.filter(
            tenant=t, status=SubscriptionProof.Status.PENDING
        ).exists()
        devices = Device.unscoped.filter(branch__tenant=t)
        dev_count = devices.filter(status=Device.Status.ACTIVE).count()
        last_seen = Session.unscoped.filter(tenant=t, device__isnull=False).aggregate(
            m=Max("last_seen_at")
        )["m"]
        grant = (
            SupportGrant.objects.filter(tenant=t, revoked_at__isnull=True, expires_at__gt=now)
            .order_by("-granted_at")
            .first()
        )
    code, label, due_line = _sub_status(sub, now)
    plan = PLANS.get(sub.plan_code, PLANS["trial"]) if sub else PLANS["trial"]
    stale_days = (now - last_seen).days if last_seen else None
    sync_stuck = stale_days is not None and stale_days >= SYNC_STUCK_DAYS
    if pending_proof and code != "suspended":
        code, label = "payment_pending", "دفع معلّق"
    elif sync_stuck and code == "active":
        code, label = "sync_late", "مزامنة متأخرة"
    tech = (
        "لم يُدخل بيانات بعد — لا نلاحقه بعروض"
        if last_seen is None
        else (f"جهاز لم يزامن {stale_days} أيام" if sync_stuck else "كل الأجهزة متزامنة")
    )
    if pending_proof and code != "suspended":
        tech = "إيصال دفع بانتظار المراجعة"
    return {
        "id": str(t.id),
        "name": t.name,
        "plan_label": plan.name,
        "plan_code": sub.plan_code if sub else "trial",
        "due_line": due_line,
        "expires_at": _iso(sub.expires_at) if sub else "",
        "days_left": (sub.expires_at - now).days if sub else None,
        "devices": dev_count,
        "last_sync_at": _iso(last_seen),
        "sync_stuck": sync_stuck,
        "technical": tech,
        "status": code,
        "status_label": label,
        "support_access": (
            f"مصرَّح {grant.hours} ساعة · تذكرة {grant.ticket_ref}" if grant else "لا وصول فعّال"
        ),
        "support_grant": (
            {
                "ticket_ref": grant.ticket_ref,
                "hours": grant.hours,
                "expires_at": _iso(grant.expires_at),
                "reason": grant.reason,
            }
            if grant
            else None
        ),
        "actions": _actions(code, sub),
    }


def _actions(code: str, sub: TenantSubscription | None) -> str:
    """«ما يمكنك فعله» — بلا «دخول كالمالك»."""
    if code == "payment_pending":
        return "مراجعة دفع PLT-03 · لا حجب بيانات ولا حذف"
    if code == "expired":
        return "مراجعة دفع PLT-03 · لا حجب بيانات ولا حذف"
    if code == "sync_late":
        return "فتح تذكرة تشخيص · القراءة تحتاج تذكرة من المالك"
    if sub and "market" in list(sub.extra_features or []):
        return "مراجعة طلب تحقق PLT-06 · تعليق نشر بمسار PLT-07"
    return "مراجعة استحقاق · إعلان صيانة · لا قراءة دفاتر"


def tenants_payload(*, q: str = "", filter_code: str = "all") -> dict[str, Any]:
    now = timezone.now()
    with platform_context():
        qs = Tenant.unscoped.all().order_by("name")
        if q.strip():
            term = q.strip()
            qs = qs.filter(id=term) if _is_uuid(term) else qs.filter(name__icontains=term)
        total = Tenant.unscoped.count()
        rows = [tenant_row(t, now) for t in qs]
    if filter_code == "due14":
        rows = [
            r for r in rows if r["days_left"] is not None and 0 <= r["days_left"] <= DUE_SOON_DAYS
        ]
    elif filter_code == "sync_stuck":
        rows = [r for r in rows if r["sync_stuck"]]
    elif filter_code == "late":
        rows = [r for r in rows if r["status"] in {"expired", "payment_pending"}]
    elif filter_code == "suspended":
        rows = [r for r in rows if r["status"] == "suspended"]
    active = sum(1 for r in rows if r["status"] == "active")
    return {
        "tenants": rows,
        "total": total,
        "shown": len(rows),
        "active_count": active,
        "filter": filter_code,
        "q": q,
        "access_rule": ACCESS_RULE,
        "fetched_at": _iso(now),
    }


def _is_uuid(v: str) -> bool:
    try:
        uuid.UUID(v.strip())
        return True
    except ValueError:
        return False


def tenant_detail(*, operator: User, tenant_id: uuid.UUID) -> dict[str, Any] | None:
    """تفاصيل الاستحقاق والحالة التقنية — كل فتح يُدقَّق؛ لا مبيعات ولا أصناف ولا عملاء."""
    now = timezone.now()
    with platform_context():
        t = Tenant.unscoped.filter(id=tenant_id).first()
        if t is None:
            return None
        row = tenant_row(t, now)
        sub = TenantSubscription.unscoped.filter(tenant=t).first()
        proofs = list(SubscriptionProof.unscoped.filter(tenant=t).order_by("-submitted_at")[:5])
        devices = list(
            Device.unscoped.filter(branch__tenant=t)
            .select_related("branch")
            .order_by("registered_at")
        )
        branches = t.branches.count() if hasattr(t, "branches") else 0
        users = User.unscoped.filter(tenant=t, is_active=True).count()
        ops = 0
        try:
            from sync.models import Operation

            ops = Operation.unscoped.filter(tenant=t).count()
        except Exception:  # noqa: BLE001 — حجم التخزين تقريبي
            ops = 0
        grants = list(SupportGrant.objects.filter(tenant=t).order_by("-granted_at")[:5])
        OperatorAccessLog.objects.create(
            operator=operator, tenant=t, action="tenant_detail", detail="استحقاق وحالة تقنية"
        )
    dev_rows = []
    for d in devices:
        with platform_context():
            seen = Session.unscoped.filter(device=d).aggregate(m=Max("last_seen_at"))["m"]
        dev_rows.append(
            {
                "id": str(d.id),
                "name": d.name,
                "branch": d.branch.name,
                "status": d.status,
                "last_seen_at": _iso(seen),
            }
        )
    return {
        **row,
        "entitlement": {
            "plan_code": sub.plan_code if sub else "trial",
            "plan_label": row["plan_label"],
            "state": sub.state if sub else "trial",
            "started_at": _iso(sub.started_at) if sub else "",
            "expires_at": _iso(sub.expires_at) if sub else "",
            "extra_features": list(sub.extra_features or []) if sub else [],
            "renewal_amount_minor": str(sub.renewal_amount_minor) if sub else "0",
            "suspended": bool(sub and sub.suspended_at is not None),
            "suspended_reason": sub.suspended_reason if sub else "",
        },
        # PLT-13: الباقات المتاحة للتغيير والخط الزمني
        "plans": [{"code": c, "name": PLANS[c].name, "trial": PLANS[c].trial} for c in PLAN_ORDER],
        "timeline": _subscriptions.timeline(t),
        "proofs": [
            {
                "id": str(p.id),
                "status": p.status,
                "amount_minor": str(p.amount_minor),
                "reference": p.reference,
                "submitted_at": _iso(p.submitted_at),
            }
            for p in proofs
        ],
        "devices_list": dev_rows,
        "branches": branches,
        "users": users,
        "storage": {"operations": ops},
        "support_grants": [
            {
                "ticket_ref": g.ticket_ref,
                "hours": g.hours,
                "reason": g.reason,
                "granted_by_name": g.granted_by_name,
                "granted_at": _iso(g.granted_at),
                "expires_at": _iso(g.expires_at),
                "active": g.revoked_at is None and g.expires_at > now,
            }
            for g in grants
        ],
        "limits": [
            "لا زر «دخول كالمالك».",
            ACCESS_RULE,
            "موظف الدعم يرى تشخيصاً بلا بيانات (SYS-11) — ولا باباً خلفياً إلى الدفاتر.",
        ],
    }


def grant_support(
    *, tenant: Tenant, ticket_ref: str, reason: str, hours: int, by_name: str
) -> SupportGrant:
    """المالك يمنح وصول دعم مقيّداً بتذكرة ونطاق زمني وسبب — يُسجَّل في تدقيقه."""
    now = timezone.now()
    return SupportGrant.objects.create(
        tenant=tenant,
        ticket_ref=ticket_ref[:40],
        reason=reason[:300],
        hours=max(1, min(hours, 168)),
        granted_by_name=by_name,
        expires_at=now + timedelta(hours=max(1, min(hours, 168))),
    )
