"""PLT-11/PLT-12 — لوحة الاكتساب M0 (كل رقم بمقامه؛ قيمة التجارة مرة لا مرتين — ACC-142؛ غير
حاسم يُقال كذلك — ACC-146) وإدارة الاستحقاقات وإعدادات التشغيل (على مستوى الباقة، لا تجاوز عام
يكسر عزل المستأجرين)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from core import subscription
from core.models import SubscriptionProof, Tenant, User
from core.tenancy import platform_context
from market.models import MarketDispute, MarketOffer, MarketOrder
from stingops.models import DailyCounter, M0Snapshot, OperatorAccessLog, OpsFlag, PlanEntitlement
from stingops.review import ReviewRejected, _iso
from sync.models import Operation

ACTIVE_DAYS = 14
MIN_OPPORTUNITIES = 15
RESPONSE_TARGET_MIN = 24 * 60
EXECUTED = (MarketOrder.Status.DELIVERED, MarketOrder.Status.RECEIVED)
CONFIRMED = (
    MarketOrder.Status.ACCEPTED,
    MarketOrder.Status.PREPARING,
    MarketOrder.Status.DELIVERED,
    MarketOrder.Status.RECEIVED,
    MarketOrder.Status.DISPUTED,
)


# ------------------------------------------------------------------ العدّادات المجهولة
def bump(key: str, n: int = 1) -> None:
    """زيارة مجهولة — لا هوية ولا مقام سابق."""
    day = timezone.localdate()
    with platform_context(), transaction.atomic():
        obj, _ = DailyCounter.objects.get_or_create(day=day, key=key)
        DailyCounter.objects.filter(pk=obj.pk).update(count=F("count") + n)


def _pct(part: int, total: int) -> str:
    if total <= 0:
        return "—"
    v = round(part * 1000 / total) / 10
    return f"{v:g}%"


def _month_bounds(month: str) -> tuple[datetime, datetime, date]:
    y, m = int(month[:4]), int(month[5:7])
    start = timezone.make_aware(datetime(y, m, 1))
    end = timezone.make_aware(datetime(y + (m == 12), 1 if m == 12 else m + 1, 1))
    return start, end, date(y, m, 1)


def _received_value(o: MarketOrder) -> tuple[int, bool]:
    """قيمة المستلَم (مرة واحدة للطلب) وهل الطلب جزئي (مشحون غير مستلم)."""
    from market.order_flow import _versions, ladder

    rows = ladder(o, _versions(o, "buyer"))
    value = sum(int(r["received"]) * int(r["price_minor"]) for r in rows)
    partial = any(int(r["received"]) < int(r["confirmed"] or 0) for r in rows)
    return value, partial


# ------------------------------------------------------------------ PLT-11
def compute_m0(*, month: str, viewer: User | None = None) -> M0Snapshot:
    """تجميع عبر كل المستأجرين — يُخزَّن بختمه الزمني؛ كل مرحلة بمقامها ولا قمع واحد."""
    now = timezone.now()
    start, end, first_day = _month_bounds(month)
    active_since = now - timedelta(days=ACTIVE_DAYS)
    with platform_context():
        visits = sum(
            DailyCounter.objects.filter(
                key="market_visit", day__gte=first_day, day__lt=end.date()
            ).values_list("count", flat=True)
        )
        registered = Tenant.unscoped.filter(created_at__gte=start, created_at__lt=end).count()
        registered_total = Tenant.unscoped.filter(created_at__lt=end).count()
        selling = set(
            Operation.unscoped.filter(kind="sale", received_at__gte=active_since).values_list(
                "tenant_id", flat=True
            )
        )
        publishing = set(
            MarketOffer.unscoped.filter(published_at__gte=active_since).values_list(
                "tenant_id", flat=True
            )
        )
        active_ids = selling | publishing
        orders = list(
            MarketOrder.unscoped.filter(sent_at__gte=start, sent_at__lt=end).only(
                "id", "tenant_id", "supplier_tenant_id", "status", "sent_at", "paid_minor"
            )
        )
        disputed = [o for o in orders if o.status == MarketOrder.Status.DISPUTED]
        executed = [o for o in orders if o.status in EXECUTED]
        paid_tenants = set(
            SubscriptionProof.unscoped.filter(
                status="approved", reviewed_at__gte=start, reviewed_at__lt=end
            ).values_list("tenant_id", flat=True)
        )
        mediated = MarketDispute.unscoped.filter(
            mediator_requested_at__gte=start, mediator_requested_at__lt=end
        ).count()
        first_accept: list[float] = []
        for o in orders:
            if o.status in CONFIRMED:
                ev = o.events.filter(kind="accepted").order_by("at").first()
                if ev is not None:
                    first_accept.append((ev.at - o.sent_at).total_seconds() / 60)
    exec_value = 0
    partial_count = 0
    partial_value = 0
    for o in executed:
        v, partial = _received_value(o)
        exec_value += v
        if partial:
            partial_count += 1
            partial_value += v
    order_tenants = {o.tenant_id for o in executed} | {o.supplier_tenant_id for o in executed}
    opportunities = len(orders)
    avg_minutes = round(sum(first_accept) / len(first_accept)) if first_accept else None
    payload = {
        "month": month,
        "computed_at": _iso(now),
        "stages": [
            {
                "key": "visit",
                "label": "زيارة السوق",
                "value": visits,
                "note": "جلسة مجهولة · لا مقام سابق",
                "ratio": "",
            },
            {
                "key": "register",
                "label": "تسجيل حساب",
                "value": registered,
                "note": "حساب واحد لكل منشأة",
                "ratio": _pct(registered, visits) + " من الزيارات" if visits else "لا زيارات مسجَّلة",
            },
            {
                "key": "active",
                "label": "منشأة نشطة",
                "value": len(active_ids),
                "note": f"نشاط = بيع أو نشر خلال {ACTIVE_DAYS} يوماً",
                "ratio": _pct(len(active_ids), registered_total) + " من المسجَّلين",
            },
            {
                "key": "executed",
                "label": "طلب سوق منفَّذ",
                "value": len(executed),
                "note": "يُحتسب مرة واحدة للطلب",
                "ratio": _pct(len(order_tenants), len(active_ids)) + " من النشطة",
            },
            {
                "key": "paid",
                "label": "اشتراك مدفوع",
                "value": len(paid_tenants),
                "note": "لا يُقسم على الزيارات",
                "ratio": _pct(len(paid_tenants), len(active_ids)) + " من النشطة",
            },
        ],
        "trade": {
            "executed_value_minor": str(exec_value),
            "executed_count": len(executed),
            "partial_count": partial_count,
            "partial_value_minor": str(partial_value),
            "disputed_count": len(disputed),
        },
        "targets": {
            "opportunities": opportunities,
            "opportunities_min": MIN_OPPORTUNITIES,
            "conclusive": opportunities >= MIN_OPPORTUNITIES,
            "mediation": mediated,
            "avg_accept_minutes": avg_minutes,
            "accept_target_minutes": RESPONSE_TARGET_MIN,
            "campaign_messages": 0,
        },
    }
    with platform_context():
        snap, _ = M0Snapshot.objects.update_or_create(
            month=month,
            defaults={
                "computed_at": now,
                "payload": payload,
                "computed_by_name": viewer.display_name if viewer else "",
            },
        )
        if viewer is not None:
            OperatorAccessLog.objects.create(operator=viewer, action="m0_computed", detail=month)
    return snap


def m0_payload(*, month: str) -> dict[str, Any]:
    """يُقرأ بختمه الزمني: `stale` حين مضى على التجميع أكثر من يوم أو حُسب قبل اليوم."""
    now = timezone.now()
    with platform_context():
        snap = M0Snapshot.objects.filter(month=month).first()
    if snap is None:
        return {"state": "loading", "month": month, "snapshot": None}
    age = now - snap.computed_at
    stale = (
        age > timedelta(hours=24)
        or timezone.localtime(snap.computed_at).date() < timezone.localdate()
    )
    p = dict(snap.payload)
    conclusive = bool(p.get("targets", {}).get("conclusive"))
    return {
        "state": "stale" if stale else "ready" if conclusive else "empty",
        "month": month,
        "computed_at": _iso(snap.computed_at),
        "computed_by_name": snap.computed_by_name,
        "snapshot": p,
    }


# ------------------------------------------------------------------ PLT-12
ENTITLEMENT_ROWS: tuple[dict[str, str], ...] = (
    {
        "feature": "multi_branch",
        "label": "عدد الفروع",
        "note": "باقة فرع واحد / فرعين / متعدّد — حدّ صلب لكل باقة",
        "kind": "limit",
        "kind_label": "حسب الباقة",
    },
    {
        "feature": "market_private_prices",
        "label": "قوائم أسعار خاصة للسوق",
        "note": "",
        "kind": "toggle",
        "kind_label": "مفعّلة",
    },
    {
        "feature": "market_publish",
        "label": "أدوات البائع في السوق",
        "note": "تتطلّب تحقّق دور بائع منفصلاً",
        "kind": "conditional",
        "kind_label": "مشروطة",
    },
    {
        "feature": "campaigns",
        "label": "حملات التسويق الجماهيرية",
        "note": "محدودة بحصّة شهرية معلَنة لكل باقة",
        "kind": "quota",
        "kind_label": "بحصّة",
    },
)
FEATURE_LABELS = {r["feature"]: r["label"] for r in ENTITLEMENT_ROWS}


def plan_feature_enabled(plan_code: str, feature: str) -> bool | None:
    """تجاوز الباقة إن وُجد — يستدعيه `core.subscription.has_feature` فيتغيّر الاستحقاق فوراً."""
    with platform_context():
        e = PlanEntitlement.objects.filter(plan_code=plan_code, feature=feature).first()
    return None if e is None else bool(e.enabled)


def entitlements_payload() -> dict[str, Any]:
    with platform_context():
        overrides = {(e.plan_code, e.feature): e for e in PlanEntitlement.objects.all()}
        flags = list(OpsFlag.objects.order_by("key", "scope_kind", "scope"))
    plans = []
    for code in subscription.PLAN_ORDER:
        plan = subscription.PLANS[code]
        cells = []
        for r in ENTITLEMENT_ROWS:
            base = r["feature"] in plan.features
            ov = overrides.get((code, r["feature"]))
            enabled = bool(ov.enabled) if ov is not None else base
            cells.append(
                {
                    "feature": r["feature"],
                    "enabled": enabled,
                    "overridden": ov is not None,
                    "changed_by_name": ov.changed_by_name if ov else "",
                    "changed_at": _iso(ov.changed_at) if ov else "",
                    "limit": plan.max_branches if r["kind"] == "limit" else None,
                    "quota": plan.campaign_quota if r["kind"] == "quota" else None,
                }
            )
        plans.append({"code": code, "name": plan.name, "cells": cells})
    return {
        "rows": list(ENTITLEMENT_ROWS),
        "plans": plans,
        "flags": [
            {
                "key": f.key,
                "scope_kind": f.scope_kind,
                "scope": f.scope,
                "enabled": f.enabled,
                "note": f.note,
                "changed_by_name": f.changed_by_name,
                "changed_at": _iso(f.changed_at),
            }
            for f in flags
        ],
    }


def set_entitlement(*, viewer: User, body: dict[str, Any]) -> dict[str, Any]:
    """يُطبَّق على تعريف الباقة ثم يرثه كل مستأجر ضمن حدوده — لا «طبّق على الجميع» ولا فوق
    مستأجر بعينه."""
    if body.get("tenant_id") or body.get("apply_all") or body.get("all_tenants"):
        raise ReviewRejected("no_global_override", 403)
    plan_code = str(body.get("plan_code") or "")
    feature = str(body.get("feature") or "")
    if plan_code not in subscription.PLANS:
        raise ReviewRejected("plan_invalid", 400, {"field": "plan_code"})
    if feature not in FEATURE_LABELS or feature in {"multi_branch"}:
        raise ReviewRejected("feature_invalid", 400, {"field": "feature"})
    enabled = bool(body.get("enabled"))
    now = timezone.now()
    with platform_context():
        PlanEntitlement.objects.update_or_create(
            plan_code=plan_code,
            feature=feature,
            defaults={
                "enabled": enabled,
                "changed_at": now,
                "changed_by_name": viewer.display_name,
            },
        )
        OperatorAccessLog.objects.create(
            operator=viewer,
            action="entitlement_changed",
            detail=f"{plan_code}:{feature}={'on' if enabled else 'off'}",
        )
    return {
        "saved": {
            "plan_code": plan_code,
            "plan_name": subscription.PLANS[plan_code].name,
            "feature": feature,
            "feature_label": FEATURE_LABELS[feature],
            "enabled": enabled,
            "changed_by_name": viewer.display_name,
            "changed_at": _iso(now),
        },
        **entitlements_payload(),
    }


def set_flag(*, viewer: User, body: dict[str, Any]) -> dict[str, Any]:
    """علم تشغيل بنطاق صريح (باقة أو بيئة) — بلا نطاق يُمنع الحفظ."""
    if body.get("tenant_id") or body.get("apply_all"):
        raise ReviewRejected("no_global_override", 403)
    key = str(body.get("key") or "").strip()
    scope_kind = str(body.get("scope_kind") or "").strip()
    scope = str(body.get("scope") or "").strip()
    if not key:
        raise ReviewRejected("key_required", 400, {"field": "key"})
    if scope_kind not in OpsFlag.ScopeKind.values or not scope:
        raise ReviewRejected("scope_required", 400, {"field": "scope"})
    if scope_kind == OpsFlag.ScopeKind.PLAN and scope not in subscription.PLANS:
        raise ReviewRejected("plan_invalid", 400, {"field": "scope"})
    now = timezone.now()
    with platform_context():
        OpsFlag.objects.update_or_create(
            key=key[:40],
            scope_kind=scope_kind,
            scope=scope[:40],
            defaults={
                "enabled": bool(body.get("enabled")),
                "note": str(body.get("note") or "")[:300],
                "changed_at": now,
                "changed_by_name": viewer.display_name,
            },
        )
        OperatorAccessLog.objects.create(
            operator=viewer, action="flag_changed", detail=f"{key}@{scope_kind}:{scope}"
        )
    return entitlements_payload()
