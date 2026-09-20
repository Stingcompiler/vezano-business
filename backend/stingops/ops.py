"""PLT-05/PLT-06 — تشغيل الإرسال والإخفاقات (حصص وقنوات دون كشف أسرار المزوّدين) وطلبات تحقق
منشآت السوق (الشارة هوية لا تزكية — MK-4؛ التحقق يُسجَّل بمن قرّر ومتى)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from core.models import Campaign, CampaignMessage, DeviceEndpoint, Tenant, User
from core.tenancy import platform_context, tenant_context
from market import services as market_services
from market.models import MarketAccount, MarketProfile
from stingops.models import ChannelState, OperatorAccessLog, PlatformAnnouncement
from stingops.review import ReviewRejected, _iso

# الحصة اليومية لرسائل الحملات عبر المنصة كلّها (لا سرّ فيها) — يُعاد ضبطها منتصف الليل
DEFAULT_CAMPAIGN_DAILY_QUOTA = 5_000
BADGE_TEXT = "منشأة موثَّقة المستندات — التوثيق لا يشمل جودة السلع أو الالتزام بالتسليم"


def _quota_max() -> int:
    return int(getattr(settings, "STING_CAMPAIGN_DAILY_QUOTA", DEFAULT_CAMPAIGN_DAILY_QUOTA))


def _channel_states() -> dict[str, ChannelState]:
    return {c.key: c for c in ChannelState.objects.all()}


def _pct(part: int, total: int) -> str:
    if total <= 0:
        return "0"
    v = round(part * 1000 / total) / 10
    return f"{v:.1f}".rstrip("0").rstrip(".") if v != int(v) else str(int(v))


# ------------------------------------------------------------------ PLT-05
def outbound_payload() -> dict[str, Any]:
    """لوحة الإرسال: القنوات والحصص والطابور — بلا مفتاح أو سرّ مزوّد واحد."""
    now = timezone.now()
    local = timezone.localtime(now)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)
    st = CampaignMessage.State
    with platform_context():
        msgs = CampaignMessage.unscoped
        sent_today = msgs.filter(sent_at__gte=day_start).exclude(
            state__in=[st.QUEUED, st.CANCELLED, st.OPTED_OUT]
        )
        used = sent_today.count()
        quota_max = _quota_max()
        remaining = max(0, quota_max - used)
        queued = msgs.filter(state=st.QUEUED).count()
        unconfirmed = msgs.filter(state__in=[st.SENT, st.UNCONFIRMED]).count()
        temp_failed = msgs.filter(state=st.FAILED_TEMPORARY).count()
        deferred_campaigns = (
            Campaign.unscoped.filter(
                status__in=[Campaign.Status.SCHEDULED, Campaign.Status.SENDING],
                messages__state=st.QUEUED,
            )
            .distinct()
            .count()
            if remaining == 0
            else 0
        )
        last_hour = msgs.filter(sent_at__gte=hour_ago).exclude(
            state__in=[st.QUEUED, st.CANCELLED, st.OPTED_OUT]
        )
        hour_total = last_hour.count()
        hour_delivered = last_hour.filter(state=st.DELIVERED).count()
        push_total = DeviceEndpoint.unscoped.filter(expired_at__isnull=True).count()
        push_failed = (
            DeviceEndpoint.unscoped.filter(expired_at__isnull=True).exclude(last_error="").count()
        )
        announcements_due = PlatformAnnouncement.objects.filter(
            status=PlatformAnnouncement.Status.SCHEDULED,
            starts_at__lte=now + timedelta(hours=1),
            ends_at__gte=now,
        ).count()
        states = _channel_states()

    def down(key: str) -> bool:
        c = states.get(key)
        return c is not None and c.state == ChannelState.State.DOWN

    def _note(key: str) -> str:
        c = states.get(key)
        return c.note if c is not None else ""

    primary_down, fallback_down = down("sms_primary"), down("sms_fallback")
    both_down = primary_down and fallback_down
    exhausted = remaining == 0
    fallback_receiving = exhausted or primary_down
    push_pct = _pct(push_failed, push_total)
    push_status = "ok" if push_failed == 0 else "partial"

    channels = [
        {
            "key": "sms_primary",
            "label": "الرسائل النصية — المزوّد الأساسي",
            "purpose": "حصة الحملات",
            "quota_line": f"{used} / {quota_max}",
            "used": used,
            "max": quota_max,
            "status": "down" if primary_down else "exhausted" if exhausted else "ok",
            "status_label": "متعذّر" if primary_down else "حصة منتهية" if exhausted else "يعمل",
            "behaviour": "نفدت حصة الحملات لليوم. رسائل التشغيل الحرجة تُحوَّل إلى الاحتياطي تلقائياً."
            if exhausted
            else "الحصة اليومية · يُعاد ضبطها منتصف الليل",
            "note": _note("sms_primary"),
        },
        {
            "key": "sms_fallback",
            "label": "الرسائل النصية — الاحتياطي",
            "purpose": "يستقبل التحويل" if fallback_receiving else "احتياط",
            "quota_line": "—",
            "used": 0,
            "max": 0,
            "status": "down" if fallback_down else "receiving" if fallback_receiving else "ready",
            "status_label": "متعذّر" if fallback_down else "يعمل" if fallback_receiving else "جاهز",
            "behaviour": "يعمل ضمن سعته. التحويل من الأساسي يُسجَّل ولا يحدث صامتاً."
            if fallback_receiving
            else "يُستعمل تلقائياً عند تعثّر الأساسي؛ التحويل يُسجَّل ولا يحدث صامتاً",
            "note": _note("sms_fallback"),
        },
        {
            "key": "push",
            "label": "إشعارات التطبيق",
            "purpose": "قناة مباشرة",
            "quota_line": "—",
            "used": push_failed,
            "max": push_total,
            "status": push_status,
            "status_label": "سليم" if push_status == "ok" else "جزئي",
            "behaviour": f"{push_pct}% فشل: أجهزة أوقفت الإشعارات من نظامها"
            " — لا يُعدّ عطلاً في المنصة.",
            "failure_pct": push_pct,
            "note": "",
        },
        {
            "key": "email",
            "label": "البريد التشغيلي",
            "purpose": "تقارير وإيصالات",
            "quota_line": "—",
            "used": 0,
            "max": 0,
            "status": "ok",
            "status_label": "سليم",
            "behaviour": "سليم. لا يُستعمل للتسويق الجماهيري بل للمستندات التشغيلية.",
            "note": "",
        },
    ]
    state = (
        "server_error"
        if both_down
        else "partial"
        if exhausted
        else "empty"
        if (queued + unconfirmed + temp_failed) == 0
        else "ready"
    )
    return {
        "state": state,
        "sent_today": used,
        "quota": {"used": used, "max": quota_max, "remaining": remaining},
        "queue": {
            "queued": queued,
            "unconfirmed": unconfirmed,
            "temp_failed": temp_failed,
            "held_waiting_channel": queued if both_down else 0,
            "deferred_campaigns": deferred_campaigns,
            "announcements_due": announcements_due,
        },
        "delivery_rate_hour": _pct(hour_delivered, hour_total),
        "delivery_hour_total": hour_total,
        "channels": channels,
        "fetched_at": _iso(now),
    }


def set_channel_state(*, viewer: User, key: str, state: str, note: str) -> dict[str, Any]:
    """إعلان تعطّل/عودة قناة — يُسجَّل باسم من نفّذه؛ لا يُحذف حدث صامتاً."""
    if key not in ChannelState.Key.values:
        raise ReviewRejected("channel_invalid")
    if state not in ChannelState.State.values:
        raise ReviewRejected("state_invalid")
    now = timezone.now()
    with platform_context():
        c, _ = ChannelState.objects.get_or_create(key=key)
        c.state, c.note, c.changed_at, c.changed_by_name = (
            state,
            note[:300],
            now,
            viewer.display_name,
        )
        c.save()
        OperatorAccessLog.objects.create(
            operator=viewer, action=f"channel_{state}", detail=f"{key}: {note}"[:300]
        )
    return outbound_payload()


# ------------------------------------------------------------------ PLT-06
STATUS_LABELS = {
    MarketAccount.Verification.PENDING: "مكتمل المستندات",
    MarketAccount.Verification.NEEDS_MORE: "ناقص",
    MarketAccount.Verification.VERIFIED: "موثَّقة",
    MarketAccount.Verification.REJECTED: "مرفوض",
}


def _docs_line(acc: MarketAccount) -> str:
    parts = []
    if acc.registry_doc_data_url:
        parts.append("سجل تجاري")
    if acc.business_address and acc.service_area_note:
        parts.append("عنوان النشاط ومنطقة الخدمة")
    if acc.terms_accepted_at is not None:
        parts.append("موافقة على شروط البائع")
    return " + ".join(parts) if parts else "بلا مستندات"


def verification_row(acc: MarketAccount, tenant: Tenant, now: Any) -> dict[str, Any]:
    with tenant_context(tenant.id):
        prof = MarketProfile.objects.first()
    submitted = acc.submitted_at
    waiting_h = (
        int((now - submitted).total_seconds() // 3600)
        if submitted is not None and acc.verification in {"pending", "needs_more"}
        else 0
    )
    reasons = acc.review_reasons or {}
    items = market_services.checklist(acc)
    titles = {str(i["key"]): str(i["title"]) for i in items}
    return {
        "tenant_id": str(tenant.id),
        "name": (prof.public_name if prof and prof.public_name else tenant.name),
        "docs_line": _docs_line(acc),
        "status": acc.verification,
        "status_label": STATUS_LABELS.get(MarketAccount.Verification(acc.verification), ""),
        "note": " · ".join(f"{titles.get(k, k)}: {v}" for k, v in reasons.items())
        if reasons
        else "",
        "reasons": reasons,
        "submitted_at": _iso(submitted),
        "waiting_hours": waiting_h,
        "reviewed_at": _iso(acc.reviewed_at),
        "reviewer_name": acc.reviewer_name,
        "has_doc": bool(acc.registry_doc_data_url),
        "doc_name": acc.registry_doc_name,
        "checklist": [
            {"key": i["key"], "title": i["title"], "done": i["done"], "reason": i["reason"]}
            for i in items
        ],
    }


def verifications_payload() -> dict[str, Any]:
    """الطابور بالأقدم أولاً — الانتظار الطويل هنا يعطّل تاجراً عن البيع؛ ومتوسط المراجعة مقياس
    يُحاسَب عليه المشغّل لا تهنئة."""
    now = timezone.now()
    week_ago = now - timedelta(days=7)
    with platform_context():
        accs = list(
            MarketAccount.unscoped.filter(
                Q(verification__in=["pending", "needs_more"])
                | Q(verification__in=["verified", "rejected"], reviewed_at__gte=week_ago)
            ).order_by("submitted_at", "created_at")
        )
        tenants = {t.id: t for t in Tenant.unscoped.filter(id__in=[a.tenant_id for a in accs])}
        reviewed = list(
            MarketAccount.unscoped.filter(
                reviewed_at__gte=week_ago, submitted_at__isnull=False
            ).values_list("submitted_at", "reviewed_at")
        )
    rows = [verification_row(a, tenants[a.tenant_id], now) for a in accs]
    pending = [r for r in rows if r["status"] in {"pending", "needs_more"}]
    pending.sort(key=lambda r: r["submitted_at"] or "")
    decided = [r for r in rows if r["status"] not in {"pending", "needs_more"}]
    avg_h = (
        round(sum((r - s).total_seconds() for s, r in reviewed) / 3600 / len(reviewed))
        if reviewed
        else 0
    )
    return {
        "requests": pending + decided,
        "pending_count": len(pending),
        "oldest_waiting_hours": max((r["waiting_hours"] for r in pending), default=0),
        "avg_review_hours_week": int(avg_h),
        "badge_text": BADGE_TEXT,
        "fetched_at": _iso(now),
    }


def _account(tenant_id: uuid.UUID) -> tuple[MarketAccount, Tenant]:
    with platform_context():
        tenant = Tenant.unscoped.filter(id=tenant_id).first()
    if tenant is None:
        raise ReviewRejected("not_found", 404)
    with tenant_context(tenant.id):
        acc = MarketAccount.objects.first()
    if acc is None:
        raise ReviewRejected("not_found", 404)
    return acc, tenant


def verification_document(*, viewer: User, tenant_id: uuid.UUID) -> dict[str, Any]:
    """المستند يُفتح عند الحاجة وتُسجَّل كل مشاهدة."""
    acc, tenant = _account(tenant_id)
    with platform_context():
        OperatorAccessLog.objects.create(
            operator=viewer,
            tenant=tenant,
            action="verification_doc_view",
            detail=acc.registry_doc_name,
        )
    return {"doc_name": acc.registry_doc_name, "doc_data": acc.registry_doc_data_url}


def decide_verification(
    *, viewer: User, tenant_id: uuid.UUID, decision: str, reasons: dict[str, str] | None
) -> dict[str, Any]:
    """`verified` يفتح النشر والبيع والشارة؛ `needs_more` بسبب محدّد يُعيد التاجر إلى أول الطابور
    بلا ذنب؛ `rejected` يبقي الحساب عاملاً بلا شارة. القرار باسم من قرّر ومتى."""
    acc, tenant = _account(tenant_id)
    with tenant_context(tenant.id):
        try:
            market_services.review_verification(
                acc, reviewer_name=viewer.display_name, decision=decision, reasons=reasons
            )
        except market_services.MarketRejected as e:
            raise ReviewRejected(e.code, 400, {"field": e.field}) from e
    with platform_context():
        OperatorAccessLog.objects.create(
            operator=viewer,
            tenant=tenant,
            action=f"verification_{decision}",
            detail=" · ".join(f"{k}: {v}" for k, v in (reasons or {}).items())[:300],
        )
    return {"request": verification_row(acc, tenant, timezone.now()), "badge_text": BADGE_TEXT}
