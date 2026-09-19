"""NOT-03/NOT-04 — قائمة الحملات وإنشاء حملة واختيار الجمهور (17-D12؛ 07-D3؛ 36-D28؛ §١١.٥،
§١١.٧، §١١.٨؛ ACC-103): الجمهور يُبنى من دفتر المنشأة وحدها — من أذن، من اشترى خلال 90 يوماً،
من عليه ذمة (تحذير لا منع)، من تابع صفحتها في السوق — بعد إزالة التكرار ومن أوقف التسويق، ويُحصى
خادمياً قبل الإرسال؛ جمهور مستأجر آخر يُرفض بلا تسريب عدد ولا اسم. الرسالة تحمل اسم المحل
إلزاماً (تُدرج تلقائياً وتُحرَّر لا تُحذف). الاعتماد والجدولة في NOT-05 بصلاحية منفصلة.
"""

from __future__ import annotations

import math
import uuid
from datetime import timedelta
from typing import Any

from django.db.models import Sum
from django.utils import timezone

from core import audit, home, org
from core.models import Campaign, Tenant, User
from core.subscription import ensure_subscription, plan_of
from core.tenancy import require_tenant

SEGMENTS: dict[str, dict[str, str]] = {
    "subscribed": {
        "label": "زبائن محلك المشتركون",
        "hint": "مشتركاً عبر رابط المحل أو QR",
    },
    "bought_90d": {
        "label": "زبائن اشتروا خلال 90 يوماً",
        "hint": "من فواتير دفترك — بلا زبائن عابرين بلا رقم",
    },
    "with_debt": {
        "label": "عليهم ذمم مستحقة",
        "hint": "رسالة تسويقية لمدين قد تُفهم مطالبةً — تحذير لا منع",
    },
    "market_followers": {
        "label": "متابعو صفحتك في السوق",
        "hint": "تابعوك طوعاً ويملكون إلغاء المتابعة",
    },
}
#: «زبائن تجّار آخرين في السوق — ليسوا جمهورك. غير متاح ولن يكون.»
BLOCKED_SEGMENTS = {"other_merchants", "other_tenants"}

#: أجزاء الرسالة كما في الإطار (164 حرفاً = رسالتان): 160 لرسالة واحدة ثم 153 لكل جزء — تقدير
#: حتى يُعتمد المزوّد (الترميز العربي الفعلي 70/67)
SINGLE_PART = 160
CONCAT_PART = 153
NIGHT_START, NIGHT_END = 22, 7


class CampaignRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field
        self.extra = extra or {}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def can_create(viewer: home.Viewer) -> bool:
    return viewer.is_owner or org.cell_for(viewer.role_code or "", "campaign_create").value == "yes"


def can_approve(viewer: home.Viewer) -> bool:
    return (
        viewer.is_owner or org.cell_for(viewer.role_code or "", "campaign_approve").value == "yes"
    )


def parts_for(text: str) -> int:
    n = len(text.strip())
    if n == 0:
        return 0
    if n <= SINGLE_PART:
        return 1
    return math.ceil(n / CONCAT_PART)


def quota() -> dict[str, int]:
    """الحصة الشهرية بالباقة (G-07): المستهلك = رسائل الحملات غير المسودة/الملغاة هذا الشهر."""
    plan = plan_of(ensure_subscription())
    now = timezone.localtime(timezone.now())
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = (
        Campaign.objects.filter(created_at__gte=start)
        .exclude(status__in=[Campaign.Status.DRAFT, Campaign.Status.CANCELLED])
        .aggregate(s=Sum("cost_messages"))["s"]
        or 0
    )
    return {
        "used": int(used),
        "max": int(plan.campaign_quota),
        "remaining": max(0, int(plan.campaign_quota) - int(used)),
    }


def audience(rules: dict[str, Any], *, count_only: bool = False) -> dict[str, Any]:
    """يحصي الجمهور خادمياً: لكل شريحة عددها، ثم الاتحاد بعد إزالة التكرار (بالرقم) واستبعاد من
    أوقف التسويق ومن بلا رقم؛ التفصيل يقول أيّ الشرطين أفرغ القائمة."""
    from parties.models import Party
    from parties.services import balance_minor
    from sales.models import Sale

    segments = [str(s) for s in (rules.get("segments") or [])]
    if any(s in BLOCKED_SEGMENTS for s in segments):
        # رفض بلا تسريب: لا عدد ولا أسماء
        raise CampaignRejected("audience_out_of_tenant", "segments")
    raw_ids = rules.get("party_ids") or []
    party_ids: list[uuid.UUID] = []
    for x in raw_ids:
        try:
            party_ids.append(uuid.UUID(str(x)))
        except ValueError as e:
            raise CampaignRejected("audience_out_of_tenant", "party_ids") from e
    if party_ids:
        known = set(Party.objects.filter(id__in=party_ids).values_list("id", flat=True))
        if known != set(party_ids):
            # ACC-103: طرف من منشأة أخرى على الجهاز نفسه — يُرفض بلا تسريب
            raise CampaignRejected("audience_out_of_tenant", "party_ids")
    base = Party.objects.filter(is_customer=True, is_active=True, merged_into__isnull=True)
    now = timezone.now()
    per_segment: dict[str, set[uuid.UUID]] = {}
    per_segment["subscribed"] = set(
        base.filter(marketing_consent_at__isnull=False).values_list("id", flat=True)
    )
    since = now - timedelta(days=90)
    bought = set(
        Sale.objects.filter(party_id__isnull=False, occurred_at__gte=since, reversals__isnull=True)
        .values_list("party_id", flat=True)
        .distinct()
    )
    per_segment["bought_90d"] = {p for p in bought if base.filter(id=p).exists()}
    per_segment["with_debt"] = {p.id for p in base if balance_minor(p) > 0}
    per_segment["market_followers"] = set()  # السوق لم يُبنَ بعد — العدد صفر لا رقم مخترع
    chosen: set[uuid.UUID] = set()
    for s in segments:
        if s in per_segment:
            chosen |= per_segment[s]
    if party_ids:
        chosen |= set(party_ids)
    parties = list(Party.objects.filter(id__in=list(chosen)))
    opted_out = [p for p in parties if p.marketing_opt_out_at is not None]
    no_phone = [p for p in parties if not p.phone_normalized and p.marketing_opt_out_at is None]
    eligible: dict[str, Party] = {}
    duplicates = 0
    for p in parties:
        if p.marketing_opt_out_at is not None or not p.phone_normalized:
            continue
        if p.phone_normalized in eligible:
            duplicates += 1
            continue
        eligible[p.phone_normalized] = p
    consented = sum(1 for p in eligible.values() if p.marketing_consent_at is not None)
    return {
        "segments": [
            {
                "key": k,
                "label": v["label"],
                "hint": v["hint"],
                "count": len(per_segment[k]),
                "selected": k in segments,
                "warning": k == "with_debt",
                "available": k != "market_followers",
            }
            for k, v in SEGMENTS.items()
        ],
        "blocked": {
            "key": "other_merchants",
            "label": "زبائن تجّار آخرين في السوق",
            "hint": "ليسوا جمهورك. غير متاح ولن يكون.",
        },
        "eligible": len(eligible),
        "consented": consented,
        "excluded_opt_out": len(opted_out),
        "excluded_no_phone": len(no_phone),
        "duplicates": duplicates,
        "with_debt_in_audience": sum(
            1 for p in eligible.values() if p.id in per_segment["with_debt"]
        ),
        "party_ids": [] if count_only else [str(p.id) for p in eligible.values()],
    }


def shop_name() -> str:
    return Tenant.unscoped.get(id=require_tenant()).name


def blockers(
    *,
    message: str,
    aud: dict[str, Any],
    parts: int,
    q: dict[str, int],
    scheduled_at: Any,
    night_confirmed: bool,
) -> list[dict[str, Any]]:
    """ما يمنع الجدولة — كلٌّ بسببه وبما يلزم لحلّه (17-D12)."""
    out: list[dict[str, Any]] = []
    name = shop_name()
    if not message.strip():
        out.append(
            {
                "code": "no_message",
                "title": "لا نص للرسالة",
                "detail": "المعاينة فارغة. لا نجدول رسالة لا نعرف ماذا تقول.",
            }
        )
    elif name and name not in message:
        out.append(
            {
                "code": "sender_identity_missing",
                "title": "رسالة بلا هوية المرسل",
                "detail": "نصٌّ لا يذكر اسم المحل. الزبون يتلقّى رسالة من رقم لا يعرفه.",
            }
        )
    if aud["eligible"] == 0:
        out.append(
            {"code": "no_audience", "title": "لا جمهور مطابق", "detail": "المرشّح لا يطابق أحداً."}
        )
    need = parts * aud["eligible"]
    if need > q["remaining"]:
        out.append(
            {
                "code": "quota_short",
                "title": "رصيد الرسائل لا يكفي",
                "detail": (
                    f"الحاجة {need} رسالة والرصيد {q['remaining']}. "
                    "نعرض العجز بالرقم قبل الجدولة لا بعد الفشل."
                ),
                "need": need,
                "remaining": q["remaining"],
            }
        )
    if scheduled_at is not None:
        h = timezone.localtime(scheduled_at).hour
        if (h >= NIGHT_START or h < NIGHT_END) and not night_confirmed:
            out.append(
                {
                    "code": "night_send",
                    "title": f"وقت الإرسال {timezone.localtime(scheduled_at):%H:%M}",
                    "detail": (
                        "ليس خطأً لكنه يوقظ زبائنك. نطلب تأكيداً صريحاً لأي إرسال بين 22:00 و07:00."
                    ),
                    "confirmable": True,
                }
            )
    return out


def preview(
    *, message: str, rules: dict[str, Any], scheduled_at: Any = None, night_confirmed: bool = False
) -> dict[str, Any]:
    aud = audience(rules, count_only=True)
    parts = parts_for(message)
    q = quota()
    return {
        "shop_name": shop_name(),
        "audience": aud,
        "chars": len(message.strip()),
        "parts": parts,
        "cost_messages": parts * aud["eligible"],
        "quota": q,
        "blockers": blockers(
            message=message,
            aud=aud,
            parts=parts,
            q=q,
            scheduled_at=scheduled_at,
            night_confirmed=night_confirmed,
        ),
    }


def campaign_payload(c: Campaign) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "name": c.name,
        "message": c.message,
        "channel": c.channel,
        "audience_rules": c.audience_rules,
        "audience_count": c.audience_count,
        "excluded_count": c.excluded_count,
        "parts": c.parts,
        "cost_messages": c.cost_messages,
        "status": c.status,
        "status_label": Campaign.Status(c.status).label,
        "scheduled_at": _iso(c.scheduled_at),
        "sent_at": _iso(c.sent_at),
        "results": c.results or {},
        "created_by_name": c.created_by_name,
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
    }


def list_payload(viewer: home.Viewer) -> dict[str, Any]:
    """NOT-03: مسؤول الحملات يرى الحملات والحصة المتبقية ولا يرى التكلفة ولا فاتورة الباقة."""
    from parties.models import Party

    rows = [campaign_payload(c) for c in Campaign.objects.order_by("-created_at")[:50]]
    # «٤٢ زبوناً أذنوا باستقبال رسائلك» — الموافقون الذين يمكن بلوغهم فعلاً (لهم رقم ولم يوقفوا)
    consented = (
        Party.objects.filter(
            is_customer=True,
            is_active=True,
            merged_into__isnull=True,
            marketing_consent_at__isnull=False,
            marketing_opt_out_at__isnull=True,
        )
        .exclude(phone_normalized="")
        .count()
    )
    total = Party.objects.filter(is_customer=True, is_active=True, merged_into__isnull=True).count()
    return {
        "campaigns": rows,
        "quota": quota(),
        "subscribers": consented,
        "parties_total": total,
        "can_create": can_create(viewer),
        "can_approve": can_approve(viewer),
        "can_see_billing": viewer.is_owner,
        "as_of": _iso(timezone.now()),
    }


def save(
    *,
    actor: User,
    viewer: home.Viewer,
    campaign: Campaign | None,
    name: str,
    message: str,
    rules: dict[str, Any],
    scheduled_at: Any = None,
    night_confirmed: bool = False,
) -> Campaign:
    """حفظ كمسودة (أو تحديثها) بعد إحصاء الجمهور خادمياً — لا اعتماد هنا (NOT-05)."""
    if not can_create(viewer):
        raise CampaignRejected("permission_denied")
    if not name.strip():
        raise CampaignRejected("name_required", "name")
    aud = audience(rules)  # يرفض جمهور مستأجر آخر قبل أي حفظ
    parts = parts_for(message)
    if campaign is None:
        campaign = Campaign(
            tenant_id=require_tenant(),
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
        )
    elif campaign.status not in {Campaign.Status.DRAFT, Campaign.Status.PENDING_APPROVAL}:
        raise CampaignRejected("campaign_locked")
    campaign.name = name.strip()
    campaign.message = message
    campaign.audience_rules = {
        "segments": [s for s in (rules.get("segments") or []) if s in SEGMENTS],
        "party_ids": [str(x) for x in (rules.get("party_ids") or [])],
    }
    campaign.audience_count = aud["eligible"]
    campaign.excluded_count = aud["excluded_opt_out"] + aud["excluded_no_phone"] + aud["duplicates"]
    campaign.parts = parts
    campaign.cost_messages = parts * aud["eligible"]
    campaign.scheduled_at = scheduled_at
    campaign.night_confirmed = bool(night_confirmed)
    campaign.status = Campaign.Status.DRAFT
    campaign.save()
    audit.record(
        kind="campaign.saved",
        title=f"حفظ حملة «{campaign.name}» كمسودة",
        actor=actor,
        detail=(
            f"الجمهور {campaign.audience_count} بعد استبعاد {campaign.excluded_count} · "
            f"{campaign.cost_messages} رسالة"
        ),
        ref_entity="core.Campaign",
        ref_id=campaign.id,
    )
    return campaign
