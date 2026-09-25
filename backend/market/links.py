"""MP-07/MP-14/MP-15 — مشاركة رابط ودعوة منشأة، منع الجديد دون محو السابق، وبلاغ عن عرض أو انتحال
(§١٤.٦، §٩.٥؛ ACC-06، ACC-118، ACC-121، ACC-135، ACC-139، ACC-150).

الرابط يخرج عن سيطرتك لحظة إرساله: المعاينة عامة دوماً ولا سعر خاص فيها؛ الرابط له عمر ولا يُحيا؛
القبول لا ينشر أحداً. القياس بأقل بيانات: عدّادات مفصولة بلا هوية. طلب التخويل يصل المورد بمعلومة
واحدة: من أنت — ورفضه بلا سبب. البلاغ سبب ودليل ورقم متابعة لصاحبه وحده ولا يُعلِّق شيئاً بنفسه.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import audit, home
from core.models import Tenant, User
from core.tenancy import platform_context, require_tenant
from market.models import MarketAccount, MarketInvite, MarketOffer, MarketProfile, MarketReport
from market.offers import can_publish
from market.public import offer_card, supplier_card, tenant_name
from market.services import MarketRejected, badge_of

SHARE_DAYS = 7
REACHES = [
    "اسم منشأتك ومنطقتها وأنها متحققة الهوية.",
    "رسالتك القصيرة إن كتبتها — اختيارية.",
]
NOT_REACHES = [
    "حجم مبيعاتك ولا مورّدوك الآخرون ولا أسعارك.",
    "أنك طلبت تخويلاً من منافسه أيضاً.",
]
BLOCKED = [
    ("طلب جديد من هذه المنشأة", "زرّ الطلب موقوف بنصّ يشرح السبب، لا زرّ رمادي صامت."),
]
KEPT = [
    (
        "الطلبات المؤكَّدة قبل التعليق",
        "اتفاق قائم بين طرفين — لا تفسخه المنصة. التسليم والاستلام والمرتجع تمضي.",
    ),
    ("تصدير مستنداتك وسجلّك", "حتى لو طال التعليق. حجب التصدير يحتجز بيانات ليست ملكنا."),
    ("دفتر البائع ومخزونه كما هو", "التعليق إجراء نشر لا إجراء محاسبي — لا كمية ولا مبلغ يتغيّر."),
]
SUSPENDED_LINE = (
    "التعليق إجراء نشر بعد بلاغ قيد المراجعة، وللبائع مسار اعتراض مفتوح. "
    "لا حكم نهائي في هذه الحالة."
)
REASONS: list[dict[str, Any]] = [
    {
        "code": MarketReport.Reason.IMPERSONATION,
        "label": MarketReport.Reason.IMPERSONATION.label,
        "hint": "يحتاج دليلاً — مقارنة اسم أو مستند",
        "needs_evidence": True,
    },
    {
        "code": MarketReport.Reason.MISLEADING,
        "label": MarketReport.Reason.MISLEADING.label,
        "hint": "مثال: «كرتونة 12» والمحتوى 10",
        "needs_evidence": False,
    },
    {
        "code": MarketReport.Reason.HARMFUL,
        "label": MarketReport.Reason.HARMFUL.label,
        "hint": "يُراجَع بأولوية",
        "needs_evidence": False,
    },
    {
        "code": MarketReport.Reason.PROHIBITED,
        "label": MarketReport.Reason.PROHIBITED.label,
        "hint": "يُحال فوراً لمشرف السوق",
        "needs_evidence": False,
    },
]
MAY_HAPPEN = ["تعليق نشر الملف المنتحل، ومطالبته بدليل ملكية الاسم."]
WONT_HAPPEN = ["لا مساس بدفاتر تلك المنشأة ولا بطلباتها القائمة مع غيرك."]
NOT_GIVEN = ["لا بيانات عن صاحب الملف ولا مراسلاته. تصل إليك النتيجة لا الملف."]


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def can_invite(viewer: home.Viewer) -> bool:
    """الدعوة باسم المنشأة فعل باسم منشأتك — بصلاحية النشر (`market_publish`)."""
    return can_publish(viewer)


# ------------------------------------------------------------------ المعاينة العامة (ACC-150)


def _public_offer(offer_id: Any) -> tuple[MarketOffer, str] | None:
    with platform_context():
        o = MarketOffer.unscoped.filter(id=offer_id).first()
        if o is None or o.status not in {MarketOffer.Status.PUBLISHED, MarketOffer.Status.EXPIRED}:
            return None
        return o, tenant_name(o.tenant_id)


def _public_supplier(tenant_id: Any) -> dict[str, Any] | None:
    with platform_context():
        p = MarketProfile.unscoped.filter(tenant_id=tenant_id).first()
        if p is None or not (p.published or {}):
            return None
        acc = MarketAccount.unscoped.filter(tenant_id=tenant_id).first()
        n = MarketOffer.unscoped.filter(
            tenant_id=tenant_id,
            status=MarketOffer.Status.PUBLISHED,
            audience=MarketOffer.Audience.PUBLIC,
        ).count()
        return supplier_card(p, p.published or {}, acc, n)


def share_preview(*, offer_id: Any = None, supplier_tenant_id: Any = None) -> dict[str, Any] | None:
    """ما سيراه المستلم حرفياً: الاسم والصنف والسعر العام — ولا سعر خاص أبداً ولو رآه المرسل."""
    if offer_id:
        found = _public_offer(offer_id)
        if found is None:
            return None
        o, seller = found
        card = offer_card(o, seller)
        if o.audience != MarketOffer.Audience.PUBLIC:
            card["price_minor"] = ""
            card["price_line"] = "السعر للمشترين المخوَّلين · اطلب تأكيد سعر"
        return {
            "kind": "offer",
            "title": card["public_name"]
            + (f" — {card['pack_label']}" if card["pack_label"] else ""),
            "subtitle": seller,
            "price_minor": card["price_minor"],
            "price_line": card["price_line"],
            "path": f"/market/offers/public/{o.id}",
            "card": card,
        }
    if supplier_tenant_id:
        s = _public_supplier(supplier_tenant_id)
        if s is None:
            return None
        return {
            "kind": "supplier",
            "title": s["public_name"],
            "subtitle": " · ".join(
                x for x in (s["category_line"], (s["service_areas"] or [""])[0]) if x
            ),
            "price_minor": "",
            "price_line": "",
            "path": f"/market/suppliers/{s['tenant_id']}",
            "card": s,
        }
    return None


# ------------------------------------------------------------------ MP-07 الروابط والدعوات


def invite_payload(i: MarketInvite) -> dict[str, Any]:
    now = timezone.now()
    status = i.status
    if status == MarketInvite.Status.SENT and i.expires_at is not None and i.expires_at <= now:
        status = MarketInvite.Status.EXPIRED
    return {
        "id": str(i.id),
        "kind": i.kind,
        "kind_label": MarketInvite.Kind(i.kind).label,
        "target_offer_id": str(i.target_offer_id) if i.target_offer_id else "",
        "target_tenant_id": str(i.target_tenant_id) if i.target_tenant_id else "",
        "target_name": i.target_name,
        "message": i.message,
        "status": status,
        "status_label": MarketInvite.Status(status).label,
        "expires_at": _iso(i.expires_at),
        "created_at": _iso(i.created_at),
        "decided_at": _iso(i.decided_at),
        "counts": {
            "visits": i.visits,
            "signups": i.signups,
            "publishes": i.publishes,
            "first_orders": i.first_orders,
        },
    }


def invites_payload(viewer: home.Viewer) -> dict[str, Any]:
    rows = list(MarketInvite.objects.order_by("-created_at"))
    return {
        "invites": [invite_payload(i) for i in rows],
        "can_invite": can_invite(viewer),
        "share_days": SHARE_DAYS,
        "reaches": REACHES,
        "not_reaches": NOT_REACHES,
    }


def _new_link(
    *, actor: User, viewer: home.Viewer, kind: str, offer_id: Any = None, tenant_id: Any = None
) -> tuple[MarketInvite, str]:
    if not can_invite(viewer):
        raise MarketRejected("publish_permission_required")
    preview = None
    if kind == MarketInvite.Kind.SHARE:
        preview = share_preview(offer_id=offer_id, supplier_tenant_id=tenant_id)
        if preview is None:
            raise MarketRejected("target_unknown", "target")
    raw = secrets.token_urlsafe(24)
    inv = MarketInvite.objects.create(
        tenant_id=require_tenant(),
        kind=kind,
        target_offer_id=offer_id if kind == MarketInvite.Kind.SHARE else None,
        target_tenant_id=tenant_id if kind == MarketInvite.Kind.SHARE else None,
        target_name=preview["title"] if preview else tenant_name(require_tenant()),
        token_hash=_hash(raw),
        expires_at=timezone.now() + timedelta(days=SHARE_DAYS),
        created_by_name=actor.display_name,
    )
    audit.record(
        kind="market.link_shared" if kind == MarketInvite.Kind.SHARE else "market.invite_sent",
        title=(
            f"مشاركة رابط: {inv.target_name}"
            if kind == MarketInvite.Kind.SHARE
            else "دعوة منشأة باسم منشأتك"
        ),
        actor=actor,
        detail=f"الرابط يسري {SHARE_DAYS} أيام ولا يُمدَّد — المنتهي يُستبدل بجديد.",
        ref_entity="market.MarketInvite",
        ref_id=inv.id,
    )
    return inv, raw


def share(
    *, actor: User, viewer: home.Viewer, offer_id: Any = None, supplier_tenant_id: Any = None
) -> tuple[MarketInvite, str]:
    return _new_link(
        actor=actor,
        viewer=viewer,
        kind=MarketInvite.Kind.SHARE,
        offer_id=offer_id,
        tenant_id=supplier_tenant_id,
    )


def invite(*, actor: User, viewer: home.Viewer, message: str = "") -> tuple[MarketInvite, str]:
    """دعوة منشأة أخرى إلى علاقة تجارية — رابط جديد بعمر جديد؛ القديم لا يُمدَّد (ACC-06)."""
    inv, raw = _new_link(actor=actor, viewer=viewer, kind=MarketInvite.Kind.INVITE)
    if message:
        inv.message = message[:300]
        inv.save(update_fields=["message"])
    return inv, raw


def revoke(*, actor: User, viewer: home.Viewer, inv: MarketInvite) -> MarketInvite:
    if not can_invite(viewer):
        raise MarketRejected("publish_permission_required")
    if inv.status == MarketInvite.Status.SENT:
        inv.status = MarketInvite.Status.REVOKED
        inv.revoked_at = timezone.now()
        inv.save(update_fields=["status", "revoked_at"])
        audit.record(
            kind="market.invite_revoked",
            title=f"إلغاء رابط: {inv.target_name}",
            actor=actor,
            ref_entity="market.MarketInvite",
            ref_id=inv.id,
        )
    return inv


def request_authorization(
    *, actor: User, viewer: home.Viewer, supplier_tenant_id: uuid.UUID, message: str = ""
) -> MarketInvite:
    """طلب تخويل يصل المورد بمعلومة واحدة: من أنت؛ قراره بشري بلا مهلة ورفضه بلا سبب (ACC-121)."""
    if not can_invite(viewer):
        raise MarketRejected("publish_permission_required")
    if supplier_tenant_id == require_tenant():
        raise MarketRejected("supplier_is_self")
    s = _public_supplier(supplier_tenant_id)
    if s is None:
        raise MarketRejected("supplier_unknown")
    existing: MarketInvite | None = MarketInvite.objects.filter(
        kind=MarketInvite.Kind.AUTHORIZATION,
        target_tenant_id=supplier_tenant_id,
        status=MarketInvite.Status.SENT,
    ).first()
    if existing is not None:
        return existing
    inv: MarketInvite = MarketInvite.objects.create(
        tenant_id=require_tenant(),
        kind=MarketInvite.Kind.AUTHORIZATION,
        target_tenant_id=supplier_tenant_id,
        target_name=s["public_name"],
        message=message[:300],
        created_by_name=actor.display_name,
    )
    audit.record(
        kind="market.authorization_requested",
        title=f"طلب تخويل من {s['public_name']}",
        actor=actor,
        detail="يصله اسم منشأتك ومنطقتها وشارتها ورسالتك — لا مبيعاتك ولا مورّدوك.",
        ref_entity="market.MarketInvite",
        ref_id=inv.id,
    )
    return inv


def _requester_card(inv: MarketInvite) -> dict[str, Any]:
    """ما يصل المورد عن طالب التخويل: الاسم والمنطقة والشارة — لا أكثر."""
    with platform_context():
        t = Tenant.unscoped.filter(id=inv.tenant_id).first()
        p = MarketProfile.unscoped.filter(tenant_id=inv.tenant_id).first()
        acc = MarketAccount.unscoped.filter(tenant_id=inv.tenant_id).first()
    pub = (p.published if p else {}) or {}
    badge, badge_label = badge_of(acc)
    return {
        "id": str(inv.id),
        "buyer_name": str(pub.get("public_name") or (t.name if t else "")),
        "area": (list(pub.get("service_areas", [])) or [""])[0],
        "verified": badge == "verified",
        "message": inv.message,
        "status": inv.status,
        "status_label": MarketInvite.Status(inv.status).label,
        "created_at": _iso(inv.created_at),
    }


def incoming_authorizations() -> list[dict[str, Any]]:
    """طلبات التخويل الواصلة إلى منشأتي (المورد)."""
    me = require_tenant()
    with platform_context():
        rows = list(
            MarketInvite.unscoped.filter(
                kind=MarketInvite.Kind.AUTHORIZATION, target_tenant_id=me
            ).order_by("-created_at")
        )
    return [_requester_card(i) for i in rows]


def decide_authorization(
    *, actor: User, viewer: home.Viewer, invite_id: uuid.UUID, accept: bool
) -> dict[str, Any]:
    """قرار المورد؛ الرفض عام بلا سبب يُعرض للطالب."""
    if not can_invite(viewer):
        raise MarketRejected("publish_permission_required")
    me = require_tenant()
    with platform_context():
        inv = MarketInvite.unscoped.filter(
            id=invite_id, kind=MarketInvite.Kind.AUTHORIZATION, target_tenant_id=me
        ).first()
        if inv is None:
            raise MarketRejected("invite_unknown")
        if inv.status == MarketInvite.Status.SENT:
            inv.status = MarketInvite.Status.ACCEPTED if accept else MarketInvite.Status.DECLINED
            inv.decided_at = timezone.now()
            inv.save(update_fields=["status", "decided_at"])
    audit.record(
        kind="market.authorization_decided",
        title=("قبول" if accept else "رفض") + " طلب تخويل",
        actor=actor,
        ref_entity="market.MarketInvite",
        ref_id=inv.id,
    )
    return _requester_card(inv)


def resolve(token: str) -> tuple[str, dict[str, Any] | None]:
    """فتح الرابط: `ok` بما يُرى عاماً (وزيارة تُعدّ)، أو `expired` — المنتهي والملغى لا يُحييان."""
    with platform_context():
        inv = MarketInvite.unscoped.filter(token_hash=_hash(token)).first()
        if inv is None:
            return "unknown", None
        now = timezone.now()
        if inv.status == MarketInvite.Status.SENT and inv.expires_at and inv.expires_at <= now:
            inv.status = MarketInvite.Status.EXPIRED
            inv.save(update_fields=["status"])
        if inv.status in {MarketInvite.Status.EXPIRED, MarketInvite.Status.REVOKED}:
            return "expired", {"kind": inv.kind, "expired_at": _iso(inv.expires_at)}
        inv.visits += 1
        inv.save(update_fields=["visits"])
        preview = (
            share_preview(offer_id=inv.target_offer_id, supplier_tenant_id=inv.target_tenant_id)
            if inv.kind == MarketInvite.Kind.SHARE
            else share_preview(supplier_tenant_id=inv.tenant_id)
        )
    if preview is None:
        # المدعِي لم ينشر ملفه بعد: الدعوة تبقى بالاسم وحده
        preview = {
            "kind": "supplier",
            "title": tenant_name(inv.tenant_id),
            "subtitle": "",
            "price_minor": "",
            "price_line": "",
            "path": "",
            "card": None,
        }
    return "ok", {
        "id": str(inv.id),
        "kind": inv.kind,
        "message": inv.message if inv.kind == MarketInvite.Kind.INVITE else "",
        "expires_at": _iso(inv.expires_at),
        "preview": preview,
    }


def accept(*, token: str, actor: User) -> str:
    """قبول دعوة منشأة بحساب المدعوّ نفسه: يفتح باباً ولا ينشر ملفه ولا كتالوجه (ACC-06 · ACC-118)."""
    me = require_tenant()
    with platform_context():
        inv = MarketInvite.unscoped.filter(
            token_hash=_hash(token), kind=MarketInvite.Kind.INVITE
        ).first()
        if inv is None:
            return "unknown"
        if inv.tenant_id == me:
            return "self"
        now = timezone.now()
        if inv.status == MarketInvite.Status.REVOKED or (inv.expires_at and inv.expires_at <= now):
            return "expired"
        if inv.status == MarketInvite.Status.SENT:
            inv.status = MarketInvite.Status.ACCEPTED
            inv.accepted_tenant_id = me
            inv.decided_at = now
            t = Tenant.unscoped.filter(id=me).first()
            if t is not None and t.created_at >= inv.created_at:
                inv.signups += 1
            inv.save(update_fields=["status", "accepted_tenant_id", "decided_at", "signups"])
    audit.record(
        kind="market.invite_accepted",
        title=f"قبول دعوة من {tenant_name(inv.tenant_id)}",
        actor=actor,
        detail="لا نشر ولا اشتراك نيابةً عنك — الباب مفتوح فقط.",
        ref_entity="market.MarketInvite",
        ref_id=inv.id,
    )
    return "ok"


def attribute(tenant_id: Any, counter: str) -> None:
    """قياس المصدر بأقل بيانات: أول نشر/أول طلب للمنشأة التي قبلت دعوة يُعدّ عند الداعي بلا هوية."""
    with platform_context():
        inv = (
            MarketInvite.unscoped.filter(
                kind=MarketInvite.Kind.INVITE, accepted_tenant_id=tenant_id
            )
            .order_by("decided_at")
            .first()
        )
        if inv is None:
            return
        setattr(inv, counter, getattr(inv, counter) + 1)
        inv.save(update_fields=[counter])


# ------------------------------------------------------------------ MP-14 منع الجديد دون محو السابق


def supplier_status(tenant_id: Any) -> dict[str, Any] | None:
    with platform_context():
        p = MarketProfile.unscoped.filter(tenant_id=tenant_id).first()
        if p is None or not (p.published or {}):
            return None
        acc = MarketAccount.unscoped.filter(tenant_id=tenant_id).first()
    badge, badge_label = badge_of(acc)
    return {
        "tenant_id": str(tenant_id),
        "public_name": str((p.published or {}).get("public_name", "")),
        "suspended": badge == "suspended",
        "suspended_line": SUSPENDED_LINE if badge == "suspended" else "",
        "badge": badge,
        "badge_label": badge_label,
        "blocked": [{"title": t, "detail": d} for t, d in BLOCKED],
        "kept": [{"title": t, "detail": d} for t, d in KEPT],
    }


# ------------------------------------------------------------------ MP-15 البلاغ


def report_payload(r: MarketReport) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "number": r.number,
        "number_label": f"RP-{r.number}",
        "target_offer_id": str(r.target_offer_id) if r.target_offer_id else "",
        "target_tenant_id": str(r.target_tenant_id) if r.target_tenant_id else "",
        "target_label": r.target_label,
        "reason": r.reason,
        "reason_label": MarketReport.Reason(r.reason).label,
        "note": r.note,
        "evidence_name": r.evidence_name,
        "status": r.status,
        "status_label": MarketReport.Status(r.status).label,
        "outcome": r.outcome,
        "created_at": _iso(r.created_at),
        "decided_at": _iso(r.decided_at),
        "may_happen": MAY_HAPPEN,
        "wont_happen": WONT_HAPPEN,
        "not_given": NOT_GIVEN,
    }


def reports_payload() -> dict[str, Any]:
    rows = list(MarketReport.objects.order_by("-created_at"))
    return {"reports": [report_payload(r) for r in rows], "reasons": REASONS}


def _target_label(offer_id: Any, tenant_id: Any) -> str:
    if offer_id:
        found = _public_offer(offer_id)
        if found is None:
            raise MarketRejected("target_unknown", "target")
        o, _seller = found
        return f"«{o.public_name} — {o.pack_label}»" if o.pack_label else f"«{o.public_name}»"
    s = _public_supplier(tenant_id) if tenant_id else None
    if s is None:
        raise MarketRejected("target_unknown", "target")
    return str(s["public_name"])


def report(
    *,
    actor: User,
    offer_id: Any = None,
    supplier_tenant_id: Any = None,
    reason: str,
    note: str = "",
    evidence_data_url: str = "",
    evidence_name: str = "",
) -> MarketReport:
    """بلاغ بسبب من القائمة؛ «انتحال» بلا دليل لا يُرسل — والبلاغ لا يُعلِّق شيئاً بنفسه."""
    codes = {str(r["code"]) for r in REASONS}
    if reason not in codes:
        raise MarketRejected("reason_required", "reason")
    if reason == MarketReport.Reason.IMPERSONATION and not evidence_data_url:
        raise MarketRejected("evidence_required", "evidence")
    label = _target_label(offer_id, supplier_tenant_id)
    if supplier_tenant_id and supplier_tenant_id == require_tenant():
        raise MarketRejected("target_is_self", "target")
    r: MarketReport = MarketReport.objects.create(
        tenant_id=require_tenant(),
        number=MarketReport.objects.count() + 1,
        target_offer_id=offer_id or None,
        target_tenant_id=supplier_tenant_id or None,
        target_label=label,
        reason=reason,
        note=note[:600],
        evidence_data_url=evidence_data_url,
        evidence_name=evidence_name[:200],
        created_by_name=actor.display_name,
    )
    audit.record(
        kind="market.reported",
        title=f"بلاغ RP-{r.number}: {MarketReport.Reason(reason).label}",
        actor=actor,
        detail="البلاغ لا يُعلِّق شيئاً بنفسه — المراجعة بشرية لدى مشرف السوق.",
        ref_entity="market.MarketReport",
        ref_id=r.id,
    )
    return r


def decide_report(*, r: MarketReport, status: str, outcome: str = "") -> MarketReport:
    """قرار المراجِع (PLT-07 لاحقاً؛ الآن عبر الخدمة): «أُجري إجراء» أو «أُغلق بلا إجراء» مع سبب."""
    r.status = MarketReport.Status(status)
    r.outcome = outcome[:300]
    r.decided_at = timezone.now()
    r.save(update_fields=["status", "outcome", "decided_at"])
    return r
