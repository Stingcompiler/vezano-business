"""PLT-03/PLT-04 — مراجعة دفع الاشتراك (الازدواج يُمنع قبل الاعتماد) وإعلانات المنصة والصيانة
(الجمهور المتأثّر قبل الجدولة؛ لا وعد بميزة لباقة لا تشملها — ACC-104)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone

from core import subscription
from core.models import (
    Device,
    Session,
    SubscriptionProof,
    SubscriptionReceipt,
    Tenant,
    TenantSubscription,
    User,
)
from core.tenancy import platform_context, tenant_context
from stingops.models import OperatorAccessLog, PlatformAnnouncement, ProofClaim

CLAIM_MINUTES = 15
ONLINE_MINUTES = 15
MARKET_PHRASES = ("ميزة سوق مميّزة", "السوق")


class ReviewRejected(Exception):
    def __init__(self, code: str, status: int = 400, extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code, self.status, self.extra = code, status, extra or {}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------ PLT-03 الإيصالات


def _active_claim(proof_id: Any, now: Any) -> ProofClaim | None:
    return (
        ProofClaim.objects.filter(proof_id=proof_id, released_at__isnull=True, expires_at__gt=now)
        .select_related("operator", "handover_requested_by")
        .order_by("-claimed_at")
        .first()
    )


def _due_for(tenant: Tenant, plan_code: str, cycle: str = "monthly") -> int:
    with tenant_context(tenant.id):
        return int(subscription.due_payload(plan_code, cycle)["amount_minor"])


def proof_payload(p: SubscriptionProof, tenant: Tenant, *, viewer: User) -> dict[str, Any]:
    now = timezone.now()
    claim = _active_claim(p.id, now)
    with platform_context():
        prior = (
            SubscriptionProof.unscoped.filter(
                reference=p.reference, status=SubscriptionProof.Status.APPROVED
            )
            .exclude(id=p.id)
            .select_related("tenant")
            .order_by("reviewed_at")
            .first()
        )
    due = _due_for(tenant, p.plan_code, p.cycle)
    return {
        "id": str(p.id),
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "plan_code": p.plan_code,
        "plan_label": subscription.PLANS.get(p.plan_code, subscription.PLANS["single"]).name,
        "amount_minor": str(p.amount_minor),
        "due_minor": str(due),
        "shortfall_minor": str(max(0, due - p.amount_minor)),
        "reference": p.reference,
        "period_label": p.period_label,
        "cycle_label": subscription.CYCLES.get(p.cycle, subscription.CYCLES["monthly"])[1],
        "receipt_number": (
            SubscriptionReceipt.unscoped.filter(proof=p).values_list("number", flat=True).first()
            or ""
        ),
        "note": p.note,
        "has_image": bool(p.image_data),
        "image_name": p.image_name,
        "submitted_at": _iso(p.submitted_at),
        "submitted_by_name": p.submitted_by_name,
        "status": p.status,
        "reviewed_at": _iso(p.reviewed_at),
        "reviewed_by_name": p.reviewed_by_name,
        "rejection_reason": p.rejection_reason,
        "claim": (
            {
                "by_name": claim.operator.display_name,
                "mine": claim.operator_id == viewer.id,
                "claimed_at": _iso(claim.claimed_at),
                "expires_at": _iso(claim.expires_at),
                "minutes_ago": int((now - claim.claimed_at).total_seconds() // 60),
                "handover_requested": claim.handover_requested_by_id is not None,
            }
            if claim
            else None
        ),
        "reference_used": (
            {
                "approved_at": _iso(prior.reviewed_at),
                "approved_by_name": prior.reviewed_by_name,
                "same_tenant": prior.tenant_id == tenant.id,
                "tenant_name": tenant.name if prior.tenant_id == tenant.id else "",
            }
            if prior
            else None
        ),
    }


def proofs_payload(*, viewer: User, status: str = "pending") -> dict[str, Any]:
    with platform_context():
        qs = SubscriptionProof.unscoped.select_related("tenant").order_by("submitted_at")
        if status != "all":
            qs = qs.filter(status=status)
        rows = [proof_payload(p, p.tenant, viewer=viewer) for p in qs]
    return {
        "proofs": rows,
        "pending_count": sum(1 for r in rows if r["status"] == "pending"),
        "claim_minutes": CLAIM_MINUTES,
    }


def _proof(tenant_id: uuid.UUID, proof_id: uuid.UUID) -> tuple[SubscriptionProof, Tenant]:
    with platform_context():
        p = (
            SubscriptionProof.unscoped.filter(id=proof_id, tenant_id=tenant_id)
            .select_related("tenant")
            .first()
        )
    if p is None:
        raise ReviewRejected("not_found", 404)
    return p, p.tenant


def open_proof(*, viewer: User, tenant_id: uuid.UUID, proof_id: uuid.UUID) -> dict[str, Any]:
    """فتح المراجعة يحجزها لشخص واحد 15 دقيقة؛ زميل يحملها = تعارض يظهر باسمه."""
    p, tenant = _proof(tenant_id, proof_id)
    now = timezone.now()
    claim = _active_claim(p.id, now)
    if claim is None and p.status == SubscriptionProof.Status.PENDING:
        ProofClaim.objects.create(
            proof_id=p.id,
            tenant=tenant,
            operator=viewer,
            expires_at=now + timedelta(minutes=CLAIM_MINUTES),
        )
    OperatorAccessLog.objects.create(
        operator=viewer, tenant=tenant, action="proof_opened", detail=f"إيصال {p.reference}"
    )
    return proof_payload(p, tenant, viewer=viewer)


def proof_image(*, viewer: User, tenant_id: uuid.UUID, proof_id: uuid.UUID) -> dict[str, Any]:
    """الصورة لا تُحمَّل إلا عند فتح المراجعة وتُسجَّل كل مشاهدة في الأثر."""
    p, tenant = _proof(tenant_id, proof_id)
    OperatorAccessLog.objects.create(
        operator=viewer, tenant=tenant, action="proof_image_viewed", detail=f"إيصال {p.reference}"
    )
    return {"image_name": p.image_name, "image_data": p.image_data, "image_size": p.image_size}


def request_handover(*, viewer: User, tenant_id: uuid.UUID, proof_id: uuid.UUID) -> dict[str, Any]:
    p, tenant = _proof(tenant_id, proof_id)
    claim = _active_claim(p.id, timezone.now())
    if claim is None:
        raise ReviewRejected("no_claim")
    if claim.operator_id == viewer.id:
        raise ReviewRejected("own_claim")
    claim.handover_requested_by = viewer
    claim.save(update_fields=["handover_requested_by"])
    OperatorAccessLog.objects.create(
        operator=viewer, tenant=tenant, action="proof_handover_requested", detail=p.reference
    )
    return proof_payload(p, tenant, viewer=viewer)


def review(
    *, viewer: User, tenant_id: uuid.UUID, proof_id: uuid.UUID, approve: bool, reason: str
) -> dict[str, Any]:
    """الاعتماد يكتب المدة مرة واحدة؛ رقم العملية يُفحص قبل الاعتماد؛ الرفض بسبب يقرأه التاجر."""
    p, tenant = _proof(tenant_id, proof_id)
    now = timezone.now()
    claim = _active_claim(p.id, now)
    if claim is not None and claim.operator_id != viewer.id:
        raise ReviewRejected(
            "claimed_by_other",
            409,
            {
                "by_name": claim.operator.display_name,
                "minutes_ago": int((now - claim.claimed_at).total_seconds() // 60),
            },
        )
    if p.status != SubscriptionProof.Status.PENDING:
        raise ReviewRejected("already_reviewed", 409, {"status": p.status})
    if approve:
        with platform_context():
            prior = (
                SubscriptionProof.unscoped.filter(
                    reference=p.reference, status=SubscriptionProof.Status.APPROVED
                )
                .exclude(id=p.id)
                .order_by("reviewed_at")
                .first()
            )
        if prior is not None:
            raise ReviewRejected(
                "reference_used",
                400,
                {
                    "approved_at": _iso(prior.reviewed_at),
                    "approved_by_name": prior.reviewed_by_name,
                    "same_tenant": prior.tenant_id == tenant.id,
                },
            )
    if not approve and not reason.strip():
        raise ReviewRejected("reason_required")
    with tenant_context(tenant.id):
        try:
            subscription.review_proof(
                p, reviewer_name=viewer.display_name, approve=approve, reason=reason.strip()
            )
        except subscription.ProofRejected as e:
            raise ReviewRejected(e.code, 409) from None
    if claim is not None:
        claim.released_at = now
        claim.save(update_fields=["released_at"])
    OperatorAccessLog.objects.create(
        operator=viewer,
        tenant=tenant,
        action="proof_approved" if approve else "proof_rejected",
        detail=f"إيصال {p.reference}" + (f" — {reason.strip()[:200]}" if reason.strip() else ""),
    )
    return proof_payload(p, tenant, viewer=viewer)


# ------------------------------------------------------------------ PLT-04 الإعلانات


def _market_tenant_ids() -> set[Any]:
    with platform_context():
        subs = TenantSubscription.unscoped.filter(expires_at__gt=timezone.now())
        ids = set()
        for s in subs:
            plan = subscription.PLANS.get(s.plan_code)
            feats = set(plan.features if plan else ()) | set(s.extra_features or [])
            if "market" in feats:
                ids.add(s.tenant_id)
        return ids


def audience_preview(*, audience: str, body: str, kind: str) -> dict[str, Any]:
    """الجمهور المتأثّر قبل الجدولة — حيّ مع كل تعديل؛ ونصّ يَعِد بميزة سوق لجمهور لا يملكها يُمنع."""
    now = timezone.now()
    with platform_context():
        all_ids = set(Tenant.unscoped.values_list("id", flat=True))
        market_ids = _market_tenant_ids()
        target = market_ids if audience == PlatformAnnouncement.Audience.MARKET else all_ids
        online = (
            Session.unscoped.filter(
                tenant_id__in=target,
                device__isnull=False,
                last_seen_at__gte=now - timedelta(minutes=ONLINE_MINUTES),
            )
            .values("device_id")
            .distinct()
            .count()
        )
        devices_total = Device.unscoped.filter(
            branch__tenant_id__in=target, status=Device.Status.ACTIVE
        ).count()
    promise = any(ph in (body or "") for ph in MARKET_PHRASES)
    outside = promise and audience == PlatformAnnouncement.Audience.ALL and (all_ids - market_ids)
    return {
        "targeted": len(target),
        "segments": [
            {
                "label": "متاجر ذات مزامنة سوق فعّالة",
                "count": len(market_ids & target),
                "note": "المتأثّرون مباشرة بنافذة الصيانة",
                "included": True,
            },
            {
                "label": "أجهزة تعمل الآن في هذه المتاجر",
                "count": online,
                "note": "ستتلقّى الإشعار داخل التطبيق",
                "included": True,
                "devices_total": devices_total,
            },
            {
                "label": "متاجر بلا نشاط سوق",
                "count": len(all_ids - market_ids)
                if audience == PlatformAnnouncement.Audience.ALL
                else 0,
                "note": "لا نزعجها بإعلان لا يخصّها",
                "included": audience == PlatformAnnouncement.Audience.ALL,
            },
            {
                "label": "زبائن نهائيون",
                "count": 0,
                "note": "لا يُرسل لهم شيء — هذه صيانة تشغيل داخلية",
                "included": False,
                "fixed": True,
            },
        ],
        "promise_outside_plan": bool(outside),
        "outside_count": len(all_ids - market_ids) if outside else 0,
        "kind": kind,
    }


def announcement_payload(a: PlatformAnnouncement) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "kind": a.kind,
        "kind_label": PlatformAnnouncement.Kind(a.kind).label,
        "title": a.title,
        "body": a.body,
        "audience": a.audience,
        "audience_label": PlatformAnnouncement.Audience(a.audience).label,
        "starts_at": _iso(a.starts_at),
        "ends_at": _iso(a.ends_at),
        "status": a.status,
        "status_label": PlatformAnnouncement.Status(a.status).label,
        "audience_count": a.audience_count,
        "created_by_name": a.created_by_name,
        "created_at": _iso(a.created_at),
        "scheduled_at": _iso(a.scheduled_at),
        "cancelled_at": _iso(a.cancelled_at),
        "cancelled_by_name": a.cancelled_by_name,
    }


def announcements_payload() -> dict[str, Any]:
    rows = list(PlatformAnnouncement.objects.order_by("-created_at")[:50])
    return {"announcements": [announcement_payload(a) for a in rows]}


def _parse_dt(raw: str, field: str) -> datetime:
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        raise ReviewRejected(f"{field}_invalid", 400) from None
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def save_announcement(*, viewer: User, body: dict[str, Any]) -> PlatformAnnouncement:
    """مسودة — الحفظ لا يجدول ولا يُرسل."""
    title = str(body.get("title") or "").strip()
    text = str(body.get("body") or "").strip()
    if not title or not text:
        raise ReviewRejected("title_and_body_required")
    kind = str(body.get("kind") or PlatformAnnouncement.Kind.MAINTENANCE)
    audience = str(body.get("audience") or PlatformAnnouncement.Audience.MARKET)
    starts = _parse_dt(str(body.get("starts_at") or ""), "starts_at")
    ends = _parse_dt(str(body.get("ends_at") or ""), "ends_at")
    if ends <= starts:
        raise ReviewRejected("window_invalid")
    aid = str(body.get("id") or "")
    a = PlatformAnnouncement.objects.filter(id=aid).first() if aid else None
    if a is None:
        a = PlatformAnnouncement(created_by_name=viewer.display_name)
    if a.status not in {PlatformAnnouncement.Status.DRAFT, PlatformAnnouncement.Status.SCHEDULED}:
        raise ReviewRejected("not_editable", 409)
    a.kind, a.title, a.body, a.audience = kind, title[:200], text[:600], audience
    a.starts_at, a.ends_at = starts, ends
    a.save()
    OperatorAccessLog.objects.create(operator=viewer, action="announcement_saved", detail=a.title)
    return a


def schedule_announcement(*, viewer: User, announcement_id: uuid.UUID) -> PlatformAnnouncement:
    """الجدولة تُسجَّل ولا تُرسل؛ تُمنع إن وعد النصّ بميزة خارج باقة الجمهور (ACC-104)."""
    a = PlatformAnnouncement.objects.filter(id=announcement_id).first()
    if a is None:
        raise ReviewRejected("not_found", 404)
    if a.status != PlatformAnnouncement.Status.DRAFT:
        raise ReviewRejected("not_schedulable", 409, {"status": a.status})
    preview = audience_preview(audience=a.audience, body=a.body, kind=a.kind)
    if preview["promise_outside_plan"]:
        raise ReviewRejected(
            "promise_outside_plan", 400, {"outside_count": preview["outside_count"]}
        )
    if a.starts_at <= timezone.now():
        raise ReviewRejected("window_in_past")
    a.status = PlatformAnnouncement.Status.SCHEDULED
    a.audience_count = int(preview["targeted"])
    a.scheduled_at = timezone.now()
    a.save(update_fields=["status", "audience_count", "scheduled_at"])
    OperatorAccessLog.objects.create(
        operator=viewer, action="announcement_scheduled", detail=f"{a.title} — {a.audience_count}"
    )
    return a


def cancel_announcement(*, viewer: User, announcement_id: uuid.UUID) -> PlatformAnnouncement:
    a = PlatformAnnouncement.objects.filter(id=announcement_id).first()
    if a is None:
        raise ReviewRejected("not_found", 404)
    if a.status != PlatformAnnouncement.Status.SCHEDULED:
        raise ReviewRejected("not_cancellable", 409)
    a.status = PlatformAnnouncement.Status.CANCELLED
    a.cancelled_at = timezone.now()
    a.cancelled_by_name = viewer.display_name
    a.save(update_fields=["status", "cancelled_at", "cancelled_by_name"])
    OperatorAccessLog.objects.create(
        operator=viewer, action="announcement_cancelled", detail=a.title
    )
    return a


def public_maintenance_notice(now: Any = None) -> dict[str, Any] | None:
    """ما يغذّي PUB-03: أقرب نافذة صيانة مجدولة أو جارية."""
    now = now or timezone.now()
    a = (
        PlatformAnnouncement.objects.filter(
            status=PlatformAnnouncement.Status.SCHEDULED, ends_at__gte=now
        )
        .order_by("starts_at")
        .first()
    )
    if a is None:
        return None
    return {
        "title": a.title,
        "body": a.body,
        "starts_at": _iso(a.starts_at),
        "ends_at": _iso(a.ends_at),
        "active": a.starts_at <= now,
        "kind": a.kind,
    }
