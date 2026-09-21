"""LINK-01/LINK-02 (M3 — T3.25): ربط الطرف المحلي بمنشأة في السوق (موافقة وهوية، لا دمج بالاسم —
ACC-131) ومطابقة الأصناف والوحدات بمعامل تحويل صريح (لا يُخمَّن من الاسم). كل شيء خلف علم
`market_m3` الذي يرفعه المشغّل من PLT-12 — لا تفعيل في الشيفرة."""

from __future__ import annotations

import os
import uuid
from typing import Any

from django.db.models import Q
from django.utils import timezone

from catalog.models import Item, ItemUnit
from core import audit, home
from core.models import Tenant, User
from core.search_normalize import normalize_search
from core.subscription import ensure_subscription
from core.tenancy import platform_context, require_tenant, tenant_context
from market.models import (
    MarketAccount,
    MarketItemMapping,
    MarketOffer,
    MarketPartyLink,
    MarketProfile,
)
from market.services import MarketRejected, badge_of
from parties.models import Party

M3_FLAG = "market_m3"


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------ علم التفعيل
def m3_enabled() -> bool:
    """يقرأ علم `market_m3` من PLT-12: بنطاق البيئة أو بنطاق باقة المستأجر الحالي."""
    from stingops.models import OpsFlag

    plan_code = ensure_subscription().plan_code
    env = os.environ.get("STING_ENV", "")
    with platform_context():
        return OpsFlag.objects.filter(
            Q(key=M3_FLAG, scope_kind="env", scope=env, enabled=True)
            | Q(key=M3_FLAG, scope_kind="plan", scope=plan_code, enabled=True)
        ).exists()


def m3_env_enabled() -> bool:
    """للصفحات العامة بلا مستأجر: علم `market_m3` بنطاق البيئة وحده."""
    from stingops.models import OpsFlag

    env = os.environ.get("STING_ENV", "")
    with platform_context():
        return OpsFlag.objects.filter(
            key=M3_FLAG, scope_kind="env", scope=env, enabled=True
        ).exists()


def require_m3() -> None:
    if not m3_enabled():
        raise MarketRejected("phase_locked", "", {"phase": "M3"})


def can_link(viewer: home.Viewer) -> bool:
    """الربط للمالك — أثرٌ مالي مباشر (38-D30)."""
    return viewer.is_owner


# ------------------------------------------------------------------ LINK-01 الأطراف
def _party_stats(party: Party) -> dict[str, Any]:
    """الرصيد وعدد المستندات من كشف الطرف نفسه — لا يتغيّران بالربط."""
    from parties.services import balance_minor, statement_lines

    return {
        "balance_minor": str(balance_minor(party)),
        "documents": len(statement_lines(party)),
    }


def link_payload(link: MarketPartyLink) -> dict[str, Any]:
    return {
        "id": str(link.id),
        "party_id": str(link.party_id),
        "party_name": link.party_name,
        "counterparty_tenant_id": str(link.counterparty_tenant_id),
        "counterparty_name": link.counterparty_name,
        "status": link.status,
        "status_label": MarketPartyLink.Status(link.status).label,
        "requested_by_name": link.requested_by_name,
        "requested_at": _iso(link.requested_at),
        "decided_at": _iso(link.decided_at),
        "decided_by_name": link.decided_by_name,
        "note": link.note,
    }


def _candidate(tid: Any) -> dict[str, Any]:
    with platform_context():
        prof = MarketProfile.unscoped.filter(tenant_id=tid).first()
        acc = MarketAccount.unscoped.filter(tenant_id=tid).first()
        tenant = Tenant.unscoped.filter(id=tid).first()
        offers = MarketOffer.unscoped.filter(
            tenant_id=tid, status=MarketOffer.Status.PUBLISHED, suspended_at__isnull=True
        ).count()
    pub = (prof.published if prof else {}) or {}
    badge, badge_label = badge_of(acc)
    return {
        "tenant_id": str(tid),
        "public_name": str(pub.get("public_name") or (tenant.name if tenant else "")),
        "badge": badge,
        "badge_label": badge_label,
        "offers": offers,
        "category_line": str(pub.get("category_line") or ""),
        "service_areas": list(pub.get("service_areas") or []),
    }


def candidates(*, q: str) -> list[dict[str, Any]]:
    """كل المنشآت المنشورة ذات الاسم القريب — بمعرّفاتها، بلا ترتيب «الأرجح» (LINK-01
    validation_error)."""
    me = require_tenant()
    qn = normalize_search(q, unify_ta_marbuta=True, strip_al=True)
    if not qn:
        return []
    with platform_context():
        profiles = list(
            MarketProfile.unscoped.filter(published_at__isnull=False).exclude(tenant_id=me)
        )
    out = []
    for p in profiles:
        name = str(((p.published or {}).get("public_name")) or p.public_name or "")
        n = normalize_search(name, unify_ta_marbuta=True, strip_al=True)
        if qn and (qn in n or n in qn or _shares_token(qn, n)):
            out.append(_candidate(p.tenant_id))
    return out


def _shares_token(a: str, b: str) -> bool:
    ta = {t for t in a.split() if len(t) >= 3}
    tb = {t for t in b.split() if len(t) >= 3}
    return bool(ta & tb)


def links_payload(viewer: home.Viewer) -> dict[str, Any]:
    """الأطراف الموردون في دفتري بحالة ربط كلٍّ منهم."""
    parties = list(
        Party.objects.filter(is_supplier=True, merged_into__isnull=True).order_by("name")
    )
    links = {
        str(x.party_id): x
        for x in MarketPartyLink.objects.exclude(
            status__in=[MarketPartyLink.Status.REJECTED, MarketPartyLink.Status.CANCELLED]
        )
    }
    rows = []
    for p in parties:
        link = links.get(str(p.id))
        stats = _party_stats(p)
        rows.append(
            {
                "party_id": str(p.id),
                "party_name": p.name,
                "created_at": _iso(p.created_at),
                "documents": stats["documents"],
                "balance_minor": stats["balance_minor"],
                "link": link_payload(link) if link else None,
            }
        )
    return {
        "state": "ready" if m3_enabled() else "phase_locked",
        "can_link": can_link(viewer),
        "parties": rows,
        "linked_count": sum(1 for r in rows if r["link"] and r["link"]["status"] == "accepted"),
    }


def request_link(
    *, actor: User, viewer: home.Viewer, party_id: uuid.UUID, body: dict[str, Any]
) -> MarketPartyLink:
    """يُرسل طلب ربط تراه المنشأة وتقبله — بلا قبولها لا ربط ولو تطابق الاسم حرفاً بحرف."""
    require_m3()
    if not can_link(viewer):
        raise MarketRejected("permission_denied")
    party = Party.objects.filter(id=party_id).first()
    if party is None:
        raise MarketRejected("not_found")
    raw = str(body.get("counterparty_tenant_id") or "").strip()
    if not raw:
        # بلا اختيار صريح: لا نختار عنك — نعرض المرشّحين بمعرّفاتهم
        found = candidates(q=party.name)
        raise MarketRejected("ambiguous_name", "counterparty_tenant_id", {"candidates": found})
    try:
        cid = uuid.UUID(raw)
    except ValueError as e:
        raise MarketRejected("counterparty_invalid", "counterparty_tenant_id") from e
    if cid == require_tenant():
        raise MarketRejected("self_link", "counterparty_tenant_id")
    with platform_context():
        prof = MarketProfile.unscoped.filter(tenant_id=cid, published_at__isnull=False).first()
    if prof is None:
        raise MarketRejected("counterparty_not_published", "counterparty_tenant_id")
    if MarketPartyLink.objects.filter(
        party_id=party.id,
        status__in=[MarketPartyLink.Status.REQUESTED, MarketPartyLink.Status.ACCEPTED],
    ).exists():
        raise MarketRejected("link_exists", "party_id")
    link: MarketPartyLink = MarketPartyLink.objects.create(
        tenant_id=require_tenant(),
        party_id=party.id,
        party_name=party.name,
        counterparty_tenant_id=cid,
        counterparty_name=str(((prof.published or {}).get("public_name")) or prof.public_name),
        requested_by_name=actor.display_name,
    )
    audit.record(
        kind="market.link_requested",
        title=f"طلب ربط «{party.name}» بمنشأة في السوق",
        actor=actor,
        detail=link.counterparty_name,
        ref_entity="market.MarketPartyLink",
        ref_id=link.id,
    )
    return link


def cancel_link(*, actor: User, viewer: home.Viewer, link: MarketPartyLink) -> MarketPartyLink:
    if not can_link(viewer):
        raise MarketRejected("permission_denied")
    if link.status == MarketPartyLink.Status.CANCELLED:
        return link
    link.status = MarketPartyLink.Status.CANCELLED
    link.decided_at = timezone.now()
    link.decided_by_name = actor.display_name
    link.save(update_fields=["status", "decided_at", "decided_by_name"])
    return link


def incoming_payload(viewer: home.Viewer) -> dict[str, Any]:
    """طلبات الربط الواردة إلى منشأتي (أنا الطرف الآخر) — أقبلها أو أرفضها بصفة المالك."""
    me = require_tenant()
    with platform_context():
        rows = list(
            MarketPartyLink.unscoped.filter(counterparty_tenant_id=me).order_by("-requested_at")
        )
    out = []
    for x in rows:
        with platform_context():
            t = Tenant.unscoped.filter(id=x.tenant_id).first()
        out.append(
            {
                **link_payload(x),
                "requester_tenant_id": str(x.tenant_id),
                "requester_name": t.name if t else "",
            }
        )
    return {
        "state": "ready" if m3_enabled() else "phase_locked",
        "can_decide": viewer.is_owner,
        "requests": out,
        "pending_count": sum(1 for r in out if r["status"] == "requested"),
    }


def decide_incoming(
    *, actor: User, viewer: home.Viewer, link_id: uuid.UUID, accept: bool
) -> MarketPartyLink:
    require_m3()
    if not viewer.is_owner:
        raise MarketRejected("permission_denied")
    me = require_tenant()
    with platform_context():
        link: MarketPartyLink | None = MarketPartyLink.unscoped.filter(
            id=link_id, counterparty_tenant_id=me
        ).first()
    if link is None:
        raise MarketRejected("not_found")
    if link.status != MarketPartyLink.Status.REQUESTED:
        raise MarketRejected("already_decided", "status")
    with platform_context():
        link.status = MarketPartyLink.Status.ACCEPTED if accept else MarketPartyLink.Status.REJECTED
        link.decided_at = timezone.now()
        link.decided_by_name = actor.display_name
        link.save(update_fields=["status", "decided_at", "decided_by_name"])
    return link


def linked_counterparties() -> list[MarketPartyLink]:
    return list(MarketPartyLink.objects.filter(status=MarketPartyLink.Status.ACCEPTED))


# ------------------------------------------------------------------ LINK-02 الأصناف والوحدات
def mapping_payload(m: MarketItemMapping) -> dict[str, Any]:
    changed = False
    with platform_context():
        offer = MarketOffer.unscoped.filter(id=m.offer_id).first()
    if offer is not None and offer.version != m.offer_version:
        changed = True
    status = MarketItemMapping.Status.NEEDS_REVIEW if changed else m.status
    return {
        "id": str(m.id),
        "counterparty_tenant_id": str(m.counterparty_tenant_id),
        "item_id": str(m.item_id),
        "item_name": m.item_name,
        "unit_code": m.unit_code,
        "unit_name": m.unit_name,
        "offer_id": str(m.offer_id),
        "offer_name": offer.public_name if offer else m.offer_name,
        "offer_unit_name": offer.unit_name if offer else m.offer_unit_name,
        "offer_pack_label": offer.pack_label if offer else m.offer_pack_label,
        "factor_milli": str(m.factor_milli),
        "status": status,
        "status_label": MarketItemMapping.Status(status).label,
        "supplier_changed": changed,
        "confirmed_by_name": m.confirmed_by_name,
        "confirmed_at": _iso(m.confirmed_at),
    }


def _supplier_offers(counterparty_tenant_id: Any) -> list[MarketOffer]:
    with platform_context():
        return list(
            MarketOffer.unscoped.filter(
                tenant_id=counterparty_tenant_id,
                status__in=[MarketOffer.Status.PUBLISHED, MarketOffer.Status.EXPIRED],
                suspended_at__isnull=True,
            ).order_by("public_name")
        )


def _offer_defined(o: MarketOffer) -> bool:
    """وحدة المورد معرَّفة حين تحمل عبوته عدداً (×N) أو تساوي وحدة أساسية بلا تجميع."""
    return "×" in (o.pack_label or "") or "x" in (o.pack_label or "").lower()


def mappings_payload(*, counterparty_tenant_id: uuid.UUID | None) -> dict[str, Any]:
    links = linked_counterparties()
    if counterparty_tenant_id is None and links:
        counterparty_tenant_id = links[0].counterparty_tenant_id
    rows = (
        [
            mapping_payload(m)
            for m in MarketItemMapping.objects.filter(
                counterparty_tenant_id=counterparty_tenant_id
            ).order_by("item_name")
        ]
        if counterparty_tenant_id
        else []
    )
    mapped_offer_ids = {r["offer_id"] for r in rows}
    offers = _supplier_offers(counterparty_tenant_id) if counterparty_tenant_id else []
    unmapped_offers = [
        {
            "offer_id": str(o.id),
            "public_name": o.public_name,
            "unit_name": o.unit_name,
            "pack_label": o.pack_label,
            "defined": _offer_defined(o),
        }
        for o in offers
        if str(o.id) not in mapped_offer_ids
    ]
    items = [
        {
            "item_id": str(i.id),
            "name": i.name,
            "base_unit_code": i.base_unit.code,
            "base_unit_name": i.base_unit.name,
            "units": [
                {"code": u.unit.code, "name": u.unit.name, "factor_milli": str(u.factor_milli)}
                for u in i.units.select_related("unit")
            ],
        }
        for i in Item.objects.filter(is_active=True).select_related("base_unit").order_by("name")
    ]
    return {
        "state": "ready" if m3_enabled() else "phase_locked",
        "counterparties": [
            {"tenant_id": str(x.counterparty_tenant_id), "name": x.counterparty_name} for x in links
        ],
        "counterparty_tenant_id": str(counterparty_tenant_id) if counterparty_tenant_id else "",
        "mappings": rows,
        "matched_count": sum(1 for r in rows if r["status"] == "matched"),
        "review_count": sum(1 for r in rows if r["status"] == "needs_review"),
        "unmapped_offers": unmapped_offers,
        "items": items,
    }


def save_mapping(*, actor: User, viewer: home.Viewer, body: dict[str, Any]) -> MarketItemMapping:
    """المطابقة بمعامل صريح: وحدة المورد = N من وحدتي. وحدتان مختلفتان بلا معامل →
    `factor_required`؛ عبوة المورد بلا عدد معلَن → `needs_definition` (لا نخمّن 4 أو 6)."""
    require_m3()
    if not (viewer.is_owner or viewer.role_code == "manager"):
        raise MarketRejected("permission_denied")
    try:
        cid = uuid.UUID(str(body.get("counterparty_tenant_id") or ""))
        item_id = uuid.UUID(str(body.get("item_id") or ""))
        offer_id = uuid.UUID(str(body.get("offer_id") or ""))
    except ValueError as e:
        raise MarketRejected("mapping_invalid") from e
    if not MarketPartyLink.objects.filter(
        counterparty_tenant_id=cid, status=MarketPartyLink.Status.ACCEPTED
    ).exists():
        raise MarketRejected("not_linked", "counterparty_tenant_id")
    item = Item.objects.filter(id=item_id, is_active=True).select_related("base_unit").first()
    if item is None:
        raise MarketRejected("item_not_found", "item_id")
    with platform_context():
        offer = MarketOffer.unscoped.filter(id=offer_id, tenant_id=cid).first()
    if offer is None:
        raise MarketRejected("offer_not_found", "offer_id")
    unit_code = str(body.get("unit_code") or item.base_unit.code)
    unit_name = item.base_unit.name
    if unit_code != item.base_unit.code:
        iu = ItemUnit.objects.filter(item=item, unit__code=unit_code).select_related("unit").first()
        if iu is None:
            raise MarketRejected("unit_not_found", "unit_code")
        unit_name = iu.unit.name
    raw_factor = body.get("factor_milli")
    same_unit = normalize_search(unit_name) == normalize_search(offer.unit_name or "")
    factor = 0
    if raw_factor not in (None, ""):
        try:
            factor = int(str(raw_factor))
        except ValueError as e:
            raise MarketRejected("factor_invalid", "factor_milli") from e
        if factor <= 0:
            raise MarketRejected("factor_invalid", "factor_milli")
    if not factor and not same_unit:
        if not _offer_defined(offer):
            status = MarketItemMapping.Status.NEEDS_DEFINITION
        else:
            raise MarketRejected(
                "factor_required",
                "factor_milli",
                {"unit_name": unit_name, "offer_unit_name": offer.unit_name},
            )
    else:
        status = MarketItemMapping.Status.MATCHED
        if not factor:
            factor = 1000
    m: MarketItemMapping
    m, _ = MarketItemMapping.objects.update_or_create(
        tenant_id=require_tenant(),
        counterparty_tenant_id=cid,
        offer_id=offer.id,
        defaults={
            "item_id": item.id,
            "item_name": item.name,
            "unit_code": unit_code,
            "unit_name": unit_name,
            "offer_name": offer.public_name,
            "offer_unit_name": offer.unit_name,
            "offer_pack_label": offer.pack_label,
            "offer_version": offer.version,
            "factor_milli": factor,
            "status": status,
            "confirmed_by_name": actor.display_name if status == "matched" else "",
            "confirmed_at": timezone.now() if status == "matched" else None,
        },
    )
    audit.record(
        kind="market.item_mapped",
        title=f"مطابقة «{item.name}» بـ«{offer.public_name}»",
        actor=actor,
        detail=f"{unit_name} × {factor} · {status}",
        ref_entity="market.MarketItemMapping",
        ref_id=m.id,
    )
    return m


def confirm_mapping(*, actor: User, viewer: home.Viewer, m: MarketItemMapping) -> MarketItemMapping:
    """بعد تغيّر تعريف المورد: المراجعة قرارك — نثبّت الإصدار الجديد ولا نمرّره بافتراض أنه كما كان."""
    require_m3()
    if not (viewer.is_owner or viewer.role_code == "manager"):
        raise MarketRejected("permission_denied")
    with platform_context():
        offer = MarketOffer.unscoped.filter(id=m.offer_id).first()
    if offer is not None:
        m.offer_version = offer.version
        m.offer_name = offer.public_name
        m.offer_unit_name = offer.unit_name
        m.offer_pack_label = offer.pack_label
    if m.status == MarketItemMapping.Status.NEEDS_DEFINITION and m.factor_milli <= 0:
        raise MarketRejected("factor_required", "factor_milli")
    m.status = MarketItemMapping.Status.MATCHED
    m.confirmed_by_name = actor.display_name
    m.confirmed_at = timezone.now()
    m.save()
    return m


def remove_mapping(*, viewer: home.Viewer, m: MarketItemMapping) -> None:
    if not (viewer.is_owner or viewer.role_code == "manager"):
        raise MarketRejected("permission_denied")
    m.delete()


def mapping_for(counterparty_tenant_id: Any, offer_id: Any) -> MarketItemMapping | None:
    """يستعمله LINK-03: مطابقة مؤكَّدة أو لا شيء (المراجعة المعلَّقة ليست مطابقة)."""
    m: MarketItemMapping | None = MarketItemMapping.objects.filter(
        counterparty_tenant_id=counterparty_tenant_id, offer_id=offer_id
    ).first()
    if m is None or m.status != MarketItemMapping.Status.MATCHED:
        return None
    with platform_context():
        offer = MarketOffer.unscoped.filter(id=offer_id).first()
    if offer is not None and offer.version != m.offer_version:
        return None
    return m


def tenant_context_for(tid: Any) -> Any:  # pragma: no cover — مساعد للاختبارات
    return tenant_context(tid)
