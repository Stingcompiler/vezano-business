"""PLT-07/PLT-08 — مراجعة بلاغ وتعليق نشر واعتراض (لا مساس بدفاتر الأطراف — ACC-135 · ACC-139)،
ومتابعة الخلافات (حدّ التدخّل وزمن الاستجابة، لا تسوية دفتر تلقائية — ACC-148)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone

from core import audit
from core.models import Tenant, User
from core.tenancy import platform_context, tenant_context
from market.models import (
    MarketDispute,
    MarketOffer,
    MarketOrder,
    MarketOrderVersion,
    MarketProfile,
    MarketReport,
)
from market.order_flow import record_event
from stingops.models import OperatorAccessLog
from stingops.review import ReviewRejected, _iso

SUSPENSION_REASONS = {
    "impersonation": "انتحال اسم منشأة موثَّقة",
    "misleading": "وصف مضلّل للمنتج أو وحدته",
    "harmful": "محتوى غير لائق أو ضارّ",
    "prohibited": "عرض لسلعة ممنوعة",
}
CONFIRMED_STATUSES = (
    MarketOrder.Status.ACCEPTED,
    MarketOrder.Status.PREPARING,
    MarketOrder.Status.DELIVERED,
    MarketOrder.Status.RECEIVED,
    MarketOrder.Status.DISPUTED,
)
# حدّ التدخّل: بعده يُحال الخلاف إلى مسار خارجي معلَن لا إلى قرار داخلي صامت
INTERVENTION_DAYS = 14
NEAR_LIMIT_HOURS = 48
RESPONSE_TARGET_HOURS = 8


def _log(viewer: User, tenant: Tenant | None, action: str, detail: str = "") -> None:
    with platform_context():
        OperatorAccessLog.objects.create(
            operator=viewer, tenant=tenant, action=action, detail=detail[:300]
        )


def _seller_name(tenant_id: Any) -> str:
    with platform_context():
        prof = MarketProfile.unscoped.filter(tenant_id=tenant_id).first()
        tenant = Tenant.unscoped.filter(id=tenant_id).first()
    pub = (prof.published if prof else {}) or {}
    return str(pub.get("public_name") or (tenant.name if tenant else ""))


# ------------------------------------------------------------------ PLT-07 البلاغات
def _confirmed_orders_on(offer: MarketOffer) -> int:
    with platform_context():
        versions = MarketOrderVersion.unscoped.filter(
            order__supplier_tenant_id=offer.tenant_id, order__status__in=CONFIRMED_STATUSES
        ).values_list("order_id", "lines")
    oid = str(offer.id)
    return len(
        {
            order_id
            for order_id, lines in versions
            if any(str(ln.get("offer_id")) == oid for ln in lines)
        }
    )


def _offer_summary(offer: MarketOffer | None) -> dict[str, Any] | None:
    if offer is None:
        return None
    return {
        "id": str(offer.id),
        "tenant_id": str(offer.tenant_id),
        "public_name": offer.public_name,
        "seller_name": _seller_name(offer.tenant_id),
        "status": offer.status,
        "suspended": offer.suspended_at is not None,
        "suspended_reason": offer.suspended_reason,
        "suspended_by_name": offer.suspended_by_name,
        "appeal_status": offer.appeal_status,
        "confirmed_orders": _confirmed_orders_on(offer),
    }


def report_row(r: MarketReport, now: Any) -> dict[str, Any]:
    with platform_context():
        reporter = Tenant.unscoped.filter(id=r.tenant_id).first()
        offer = (
            MarketOffer.unscoped.filter(id=r.target_offer_id).first() if r.target_offer_id else None
        )
    hours = int((now - r.created_at).total_seconds() // 3600)
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "number": r.number,
        "ref_label": f"RP-{r.number}",
        "reason": r.reason,
        "reason_label": MarketReport.Reason(r.reason).label,
        "target_label": r.target_label,
        "note": r.note,
        "evidence_name": r.evidence_name,
        "has_evidence": bool(r.evidence_data_url),
        "reporter_name": _seller_name(r.tenant_id) if reporter else "",
        "created_at": _iso(r.created_at),
        "hours_ago": hours,
        "status": r.status,
        "status_label": MarketReport.Status(r.status).label,
        "outcome": r.outcome,
        "decided_at": _iso(r.decided_at),
        "offer": _offer_summary(offer),
    }


def reports_payload(*, status: str = "under_review") -> dict[str, Any]:
    now = timezone.now()
    with platform_context():
        qs = MarketReport.unscoped.all().order_by("created_at")
        if status != "all":
            qs = qs.filter(status=status)
        rows = [report_row(r, now) for r in qs]
        appeals = list(
            MarketOffer.unscoped.filter(appeal_status="open").order_by("appeal_opened_at")
        )
    return {
        "reports": rows,
        "open_count": sum(1 for r in rows if r["status"] == "under_review"),
        "appeals": [appeal_row(o) for o in appeals],
        "reasons": [{"code": k, "label": v} for k, v in SUSPENSION_REASONS.items()],
        "fetched_at": _iso(now),
    }


def appeal_row(o: MarketOffer) -> dict[str, Any]:
    return {
        "offer_id": str(o.id),
        "tenant_id": str(o.tenant_id),
        "public_name": o.public_name,
        "seller_name": _seller_name(o.tenant_id),
        "suspended_at": _iso(o.suspended_at),
        "suspended_reason": o.suspended_reason,
        "suspended_reason_code": o.suspended_reason_code,
        "suspended_by_name": o.suspended_by_name,
        "appeal_status": o.appeal_status,
        "appeal_note": o.appeal_note,
        "appeal_doc_name": o.appeal_doc_name,
        "has_doc": bool(o.appeal_doc_data_url),
        "appeal_opened_at": _iso(o.appeal_opened_at),
        "appeal_reviewer_name": o.appeal_reviewer_name,
        "appeal_decision_note": o.appeal_decision_note,
    }


def _report(tenant_id: uuid.UUID, report_id: uuid.UUID) -> tuple[MarketReport, Tenant]:
    with platform_context():
        tenant = Tenant.unscoped.filter(id=tenant_id).first()
        r = MarketReport.unscoped.filter(tenant_id=tenant_id, id=report_id).first()
    if tenant is None or r is None:
        raise ReviewRejected("not_found", 404)
    return r, tenant


def decide_report(
    *,
    viewer: User,
    tenant_id: uuid.UUID,
    report_id: uuid.UUID,
    decision: str,
    reason_code: str,
    reason_text: str,
) -> dict[str, Any]:
    """`suspend` = تعليق نشر العرض بسبب مصنَّف ونصّ يراه البائع فوراً (إجراء نشر لا محاسبي)؛
    `close` = إغلاق البلاغ بلا إجراء؛ `ledger` = محاولة فتح دفتر البائع — تُرفض بنصّ صريح."""
    r, tenant = _report(tenant_id, report_id)
    now = timezone.now()
    if decision == "ledger":
        _log(viewer, tenant, "ledger_attempt_refused", r.target_label)
        raise ReviewRejected("operator_scope_publish_only", 403)
    if r.status != MarketReport.Status.UNDER_REVIEW:
        raise ReviewRejected("already_decided", 409)
    if decision == "close":
        with platform_context():
            r.status = MarketReport.Status.CLOSED
            r.outcome = "أُغلق بلا إجراء"
            r.decided_at = now
            r.save(update_fields=["status", "outcome", "decided_at"])
        _log(viewer, tenant, "report_closed", f"RP-{r.number}")
        return report_row(r, now)
    if decision != "suspend":
        raise ReviewRejected("decision_invalid")
    reason_text = reason_text.strip()
    if reason_code not in SUSPENSION_REASONS or not reason_text:
        raise ReviewRejected("reason_required", 400, {"field": "reason"})
    with platform_context():
        offer = (
            MarketOffer.unscoped.filter(id=r.target_offer_id).first() if r.target_offer_id else None
        )
    if offer is None:
        raise ReviewRejected("offer_missing")
    label = SUSPENSION_REASONS[reason_code]
    with tenant_context(offer.tenant_id):
        offer.suspended_at = now
        offer.suspended_reason_code = reason_code
        offer.suspended_reason = f"{label} — {reason_text}"[:400]
        offer.suspended_by_name = viewer.display_name
        offer.appeal_status = ""
        offer.save()
        # يظهر للبائع فوراً في سجلّه (MP-14) — بلا تعليق صامت
        audit.record(
            kind="market.offer_suspended",
            title=f"علّق المشغّل نشر العرض: {offer.public_name}",
            actor=None,
            actor_role="platform",
            detail=offer.suspended_reason,
            ref_entity="market.MarketOffer",
            ref_id=offer.id,
        )
    with platform_context():
        r.status = MarketReport.Status.ACTIONED
        r.outcome = f"تعليق النشر — {label}"
        r.decided_at = now
        r.save(update_fields=["status", "outcome", "decided_at"])
    _log(viewer, tenant, "offer_suspended", f"RP-{r.number} · {offer.public_name} · {reason_code}")
    return report_row(r, now)


def decide_appeal(
    *, viewer: User, tenant_id: uuid.UUID, offer_id: uuid.UUID, decision: str, note: str
) -> dict[str, Any]:
    """الاعتراض يذهب لمراجِع مختلف عن من علّق؛ حتى حسمه يبقى القرار الأول سارياً ومعلَناً."""
    with platform_context():
        tenant = Tenant.unscoped.filter(id=tenant_id).first()
        offer = MarketOffer.unscoped.filter(tenant_id=tenant_id, id=offer_id).first()
    if tenant is None or offer is None:
        raise ReviewRejected("not_found", 404)
    if offer.appeal_status != "open":
        raise ReviewRejected("no_open_appeal", 409)
    if offer.suspended_by_name == viewer.display_name:
        raise ReviewRejected("same_reviewer", 409)
    if decision not in {"uphold", "reverse"}:
        raise ReviewRejected("decision_invalid")
    now = timezone.now()
    with tenant_context(offer.tenant_id):
        offer.appeal_status = "upheld" if decision == "uphold" else "reversed"
        offer.appeal_decided_at = now
        offer.appeal_reviewer_name = viewer.display_name
        offer.appeal_decision_note = note.strip()[:400]
        if decision == "reverse":
            offer.suspended_at = None
            offer.suspended_reason_code = ""
            offer.suspended_reason = ""
            offer.suspended_by_name = ""
        offer.save()
        audit.record(
            kind="market.suspension_appeal_decided",
            title="حُسم الاعتراض: " + ("أُلغي التعليق" if decision == "reverse" else "بقي التعليق"),
            actor=None,
            actor_role="platform",
            detail=offer.appeal_decision_note,
            ref_entity="market.MarketOffer",
            ref_id=offer.id,
        )
    _log(viewer, tenant, f"appeal_{decision}", offer.public_name)
    return appeal_row(offer)


# ------------------------------------------------------------------ PLT-08 الخلافات
def _response_hours(d: MarketDispute) -> list[float]:
    """أزمنة الردّ: الفارق بين دليل طرف ودليل الطرف الآخر التالي له."""
    out: list[float] = []
    prev_side, prev_at = "", None
    for e in d.evidence:
        side, at = str(e.get("side") or ""), str(e.get("at") or "")
        if not at:
            continue
        try:
            t = datetime.fromisoformat(at.replace("Z", "+00:00"))
        except ValueError:
            continue
        if prev_at is not None and side and side != prev_side:
            out.append(max(0.0, (t - prev_at).total_seconds() / 3600))
        prev_side, prev_at = side, t
    return out


def dispute_row(d: MarketDispute, now: Any) -> dict[str, Any]:
    o = d.order
    limit_at = d.opened_at + timedelta(days=INTERVENTION_DAYS)
    to_limit_h = (limit_at - now).total_seconds() / 3600
    remaining = (d.turn_deadline - now).total_seconds() / 3600 if d.turn_deadline else 0.0
    referred = d.referred_external_at is not None
    over = to_limit_h <= 0 and not referred
    near = 0 < to_limit_h <= NEAR_LIMIT_HOURS and not referred
    has_images = any(e.get("kind") == "evidence" for e in d.evidence)
    if referred:
        limit_note = "أُحيل لمسار خارجي معلَن — المنصة لا تُصدر حكماً مالياً بين طرفين."
    elif over:
        limit_note = "تجاوز حدّ التدخّل — يُحال إلى مسار خارجي مُعلَن لا إلى قرار داخلي صامت."
    elif near:
        limit_note = "قرب الحدّ — تُيسَّر القناة وتُحفظ الأدلة، دون تحريك رصيد أي طرف."
    elif d.mediator_note:
        limit_note = f"ضمن الحدّ — مسار مقترَح: {d.mediator_note}"
    elif has_images:
        limit_note = "المنصة تحفظ الصور المرفوعة فقط؛ الحكم على الجودة بين الطرفين لا علينا."
    else:
        limit_note = "ضمن الحدّ — تُيسَّر القناة وتُحفظ الأدلة، دون تحريك رصيد أي طرف."
    return {
        "id": str(d.id),
        "tenant_id": str(d.tenant_id),
        "order_id": str(o.id),
        "ref_label": f"DSP-{d.number}",
        "parties": f"{o.supplier_name} ↔ {o.buyer_name}",
        "supplier_name": o.supplier_name,
        "buyer_name": o.buyer_name,
        "subject": d.title,
        "turn": d.turn,
        "turn_label": "بانتظار رد المورد" if d.turn == "supplier" else "بانتظار رد المشتري",
        "turn_deadline": _iso(d.turn_deadline),
        "remaining_hours": int(remaining) if remaining > 0 else 0,
        "overdue_hours": int(-remaining) if remaining < 0 else 0,
        "opened_at": _iso(d.opened_at),
        "days_open": max(0, (now - d.opened_at).days),
        "limit_at": _iso(limit_at),
        "hours_to_limit": int(to_limit_h) if to_limit_h > 0 else 0,
        "near_limit": near,
        "over_limit": over,
        "referred": referred,
        "referred_by_name": d.referred_by_name,
        "mediator_requested": d.mediator_requested_at is not None,
        "mediator_note": d.mediator_note,
        "evidence_count": len(d.evidence),
        "limit_note": limit_note,
        "status": d.status,
    }


def disputes_payload() -> dict[str, Any]:
    """الخلافات المفتوحة مرتّبة بزمن الاستجابة المتبقّي؛ حدّ التدخّل ثابت في كل صف."""
    now = timezone.now()
    with platform_context():
        open_ds = list(
            MarketDispute.unscoped.filter(status=MarketDispute.Status.OPEN)
            .select_related("order")
            .order_by("turn_deadline", "opened_at")
        )
        week_ago, month_ago = now - timedelta(days=7), now - timedelta(days=30)
        referred_week = MarketDispute.unscoped.filter(referred_external_at__gte=week_ago).count()
        closed_30 = MarketDispute.unscoped.filter(
            status=MarketDispute.Status.CLOSED, closed_at__gte=month_ago
        ).count()
        recent = list(
            MarketDispute.unscoped.filter(opened_at__gte=month_ago).only("evidence", "opened_at")
        )
    rows = [dispute_row(d, now) for d in open_ds]
    samples = [h for d in recent for h in _response_hours(d)]
    avg = round(sum(samples) / len(samples), 1) if samples else 0.0
    near = sum(1 for r in rows if r["near_limit"] or r["over_limit"])
    return {
        "state": "empty" if not rows else "partial" if near else "ready",
        "disputes": rows,
        "open_count": len(rows),
        "near_limit_count": near,
        "avg_response_hours": avg,
        "response_target_hours": RESPONSE_TARGET_HOURS,
        "within_target": avg <= RESPONSE_TARGET_HOURS,
        "referred_week": referred_week,
        "closed_30d": closed_30,
        "intervention_days": INTERVENTION_DAYS,
        "fetched_at": _iso(now),
    }


def _dispute(tenant_id: uuid.UUID, dispute_id: uuid.UUID) -> tuple[MarketDispute, Tenant]:
    with platform_context():
        tenant = Tenant.unscoped.filter(id=tenant_id).first()
        d = (
            MarketDispute.unscoped.filter(tenant_id=tenant_id, id=dispute_id)
            .select_related("order")
            .first()
        )
    if tenant is None or d is None:
        raise ReviewRejected("not_found", 404)
    if d.status == MarketDispute.Status.CLOSED:
        raise ReviewRejected("dispute_closed", 409)
    return d, tenant


def suggest_path(
    *, viewer: User, tenant_id: uuid.UUID, dispute_id: uuid.UUID, note: str
) -> dict[str, Any]:
    """مسار مقترَح يُسجَّل في الخلاف ويراه الطرفان — لا يُحرّك رصيداً ولا يُلزم طرفاً بمبلغ."""
    d, tenant = _dispute(tenant_id, dispute_id)
    note = note.strip()
    if not note:
        raise ReviewRejected("note_required", 400, {"field": "note"})
    with platform_context():
        d.mediator_note = note[:400]
        d.save(update_fields=["mediator_note", "updated_at"])
    record_event(
        d.order,
        kind="mediator_suggested",
        side="platform",
        title=f"مسار مقترَح من المنصة في DSP-{d.number}",
        detail=note[:200],
        ref_label=f"DSP-{d.number}",
    )
    _log(viewer, tenant, "dispute_suggest", f"DSP-{d.number}")
    return dispute_row(d, timezone.now())


def refer_external(*, viewer: User, tenant_id: uuid.UUID, dispute_id: uuid.UUID) -> dict[str, Any]:
    """تجاوز حدّ التدخّل → إحالة إلى مسار خارجي مُعلَن، باسم من أحال — لا قرار داخلي صامت."""
    d, tenant = _dispute(tenant_id, dispute_id)
    now = timezone.now()
    if d.referred_external_at is not None:
        raise ReviewRejected("already_referred", 409)
    with platform_context():
        d.referred_external_at = now
        d.referred_by_name = viewer.display_name
        d.save(update_fields=["referred_external_at", "referred_by_name", "updated_at"])
    record_event(
        d.order,
        kind="dispute_referred",
        side="platform",
        title=f"أُحيل DSP-{d.number} إلى مسار خارجي معلَن",
        detail="تجاوز حدّ تدخّل المنصة — لا تسوية دفتر آلية",
        ref_label=f"DSP-{d.number}",
    )
    _log(viewer, tenant, "dispute_referred", f"DSP-{d.number}")
    return dispute_row(d, now)
