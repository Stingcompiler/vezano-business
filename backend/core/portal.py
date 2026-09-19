"""CUS-01/CUS-02 — بوابة زبون المحل (21-D16، 37-D29، 08-D4؛ §١٤.٤، §١١.٨).

الزبون يفتح رابطاً أو يمسح QR: لا حساب، لا كلمة مرور، ولا وصول لأي شيء من دفتر التاجر — الصفحة
محتوى منشور (الاسم والعنوان وساعات العمل وآخر إعلانات المحل) ولا شيء سواه. الاشتراك فعل صريح
بقناة محل محدَّد ولا يثبت ملكية هاتف مسجَّل في دفتر الأطراف؛ الرقم للإرسال وحده ونتساهل في صيغته؛
رفض إذن المتصفح لا يوقف الخدمة — تتحوّل إلى صندوق وارد داخل الصفحة ولا نطلب الإذن ثانيةً؛ الرابط
المؤقت المنتهي يحوّل إلى صفحة المحل الدائمة («هذا العرض انتهى — هذه صفحة المحل»)، ورابط محل لا
وجود له يعطي رسالة PUB-04 نفسها.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import audit
from core.models import Campaign, CampaignMessage, PortalChannel, PortalSubscriber, Tenant, User
from core.tenancy import require_tenant
from parties.models import normalize_phone

SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
UNDO_DAYS = 7
ANNOUNCEMENTS = 3


class PortalRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code, self.field, self.extra = code, field, extra or {}


def _slug() -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(8))


def ensure_channel() -> PortalChannel:
    """قناة المحل العامة — تُنشأ مرة واحدة بمعرّف قصير عشوائي (لا اسم ولا رقم منشأة في الرابط)."""
    ch: PortalChannel | None = PortalChannel.objects.first()
    if ch is None:
        ch = PortalChannel.objects.create(tenant_id=require_tenant(), slug=_slug())
    return ch


def channel_payload(ch: PortalChannel, *, base_url: str = "") -> dict[str, Any]:
    """للمالك (NOT-02/ORG): الرابط ورمز QR كـSVG — العنوان والساعات تُحرَّر هنا حتى MP-09."""
    import segno

    link = f"{base_url}/portal/{ch.slug}"
    qr = segno.make(link, error="m")
    return {
        "slug": ch.slug,
        "link": link,
        "qr_svg": qr.svg_inline(scale=4, dark="#111827", light=None),
        "address": ch.address,
        "hours": ch.hours,
        "subscribers": PortalSubscriber.objects.filter(opt_out_at__isnull=True).count(),
    }


def update_channel(*, actor: User, address: str | None, hours: str | None) -> PortalChannel:
    ch = ensure_channel()
    changed = []
    if address is not None and ch.address != address.strip():
        ch.address = address.strip()[:300]
        changed.append("العنوان")
    if hours is not None and ch.hours != hours.strip():
        ch.hours = hours.strip()[:200]
        changed.append("ساعات العمل")
    if changed:
        ch.save(update_fields=["address", "hours"])
        audit.record(
            kind="portal.updated",
            title="تحديث صفحة المحل العامة",
            actor=actor,
            detail="، ".join(changed),
            ref_entity="core.PortalChannel",
            ref_id=ch.id,
        )
    return ch


# ------------------------------------------------------------------------ الصفحة العامة


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def announcements(limit: int = ANNOUNCEMENTS) -> list[dict[str, Any]]:
    """ما نشره التاجر بنفسه ولا شيء سواه: آخر الحملات المرسلة بتواريخها؛ المنتهي يُوسم لا يختفي."""
    today = timezone.localdate()
    out = []
    qs = Campaign.objects.filter(
        status__in=[Campaign.Status.SENDING, Campaign.Status.DONE], sent_at__isnull=False
    ).order_by("-sent_at")[:limit]
    for c in qs:
        out.append(
            {
                "id": str(c.id),
                "title": c.name,
                "message": c.message,
                "sent_at": _iso(c.sent_at),
                "valid_until": c.valid_until.isoformat() if c.valid_until else "",
                "expired": bool(c.valid_until and c.valid_until < today),
            }
        )
    return out


def page_payload(ch: PortalChannel, *, campaign_id: str = "") -> dict[str, Any]:
    tenant = Tenant.unscoped.get(id=ch.tenant_id)
    today = timezone.localdate()
    link_state = ""
    if campaign_id:
        try:
            c = Campaign.objects.filter(id=uuid.UUID(campaign_id)).first()
        except ValueError:
            c = None
        # رابط مؤقت لعرضٍ انتهى أو حملةٍ مضت → «هذا العرض انتهى — هذه صفحة المحل»؛ ورابط لحملة
        # لا وجود لها يُعامل كالمنتهي — لا نكشف إن كانت موجودة
        if (
            c is None
            or (c.valid_until and c.valid_until < today)
            or c.status
            in {
                Campaign.Status.CANCELLED,
                Campaign.Status.DRAFT,
            }
        ):
            link_state = "expired"
    return {
        "shop": {"name": tenant.name, "address": ch.address, "hours": ch.hours, "slug": ch.slug},
        "announcements": announcements(),
        "link_state": link_state,
        "push_public_key": __import__(
            "core.push", fromlist=["vapid_public_key"]
        ).vapid_public_key(),
    }


# ------------------------------------------------------------------------ الاشتراك


def _token() -> str:
    return secrets.token_urlsafe(24)


def subscribe(
    *,
    phone: str,
    push_permission: str = "",
    push: dict[str, str] | None = None,
) -> PortalSubscriber:
    """اشتراك صريح: نتساهل في الصيغة (مسافات وشرطات ودولية أو محلية) ونطبّع نحن؛ رقم ناقص يُرفض
    بنصّه. الاشتراك من جديد يعيد تفعيل مشترك ألغى (لا صفّ ثانٍ للرقم نفسه)."""
    digits = normalize_phone(phone)
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) < 9 or len(digits) > 15:
        raise PortalRejected("phone_invalid", "phone")
    sub = PortalSubscriber.objects.filter(phone_normalized=digits).first()
    now = timezone.now()
    if sub is None:
        sub = PortalSubscriber(
            tenant_id=require_tenant(),
            phone=phone.strip(),
            phone_normalized=digits,
            token=_token(),
            consent_at=now,
        )
    else:
        sub.phone = phone.strip()
        sub.opt_out_at = None
        sub.consent_at = now
    sub.push_permission = (push_permission or "")[:12]
    if push and push.get("endpoint"):
        sub.push_endpoint = push["endpoint"]
        sub.push_p256dh = push.get("p256dh", "")[:200]
        sub.push_auth = push.get("auth", "")[:100]
    sub.save()
    return sub


def subscriber_payload(sub: PortalSubscriber) -> dict[str, Any]:
    unread = CampaignMessage.objects.filter(
        subscriber_id=sub.id,
        state__in=[CampaignMessage.State.SENT, CampaignMessage.State.DELIVERED],
        read_at__isnull=True,
    ).count()
    return {
        "token": sub.token,
        "phone": sub.phone,
        "active": sub.active,
        "consent_at": _iso(sub.consent_at),
        "opt_out_at": _iso(sub.opt_out_at),
        "push_permission": sub.push_permission,
        "push_enabled": bool(sub.push_endpoint)
        and sub.push_permission == "granted"
        and sub.channel_push,
        "unread": unread,
        "undo_until": _iso(sub.opt_out_at + timedelta(days=UNDO_DAYS)) if sub.opt_out_at else "",
    }


def by_token(token: str) -> PortalSubscriber | None:
    """بالرمز وحده — لا جلسة؛ رمز لا وجود له = لا شيء (PUB-04)."""
    return PortalSubscriber.unscoped.filter(token=token).first() if token else None


# ------------------------------------------------------------------ CUS-03/04/05 الرسائل والتفضيلات


def messages_payload(sub: PortalSubscriber) -> list[dict[str, Any]]:
    """ما وصل الزبون من هذا المحل وحده: كل رسالة باسم مرسلها وتاريخها؛ المنتهي موسوم لا يُمحى."""
    today = timezone.localdate()
    tenant = Tenant.unscoped.get(id=sub.tenant_id)
    out = []
    qs = (
        CampaignMessage.objects.filter(
            subscriber_id=sub.id,
            state__in=[CampaignMessage.State.SENT, CampaignMessage.State.DELIVERED],
        )
        .select_related("campaign")
        .order_by("-sent_at", "-id")
    )
    for m in qs:
        c = m.campaign
        out.append(
            {
                "id": str(m.id),
                "title": c.name,
                "message": c.message,
                "shop_name": tenant.name,
                "sent_at": _iso(m.sent_at),
                "valid_until": c.valid_until.isoformat() if c.valid_until else "",
                "expired": bool(c.valid_until and c.valid_until < today),
                "read_at": _iso(m.read_at),
            }
        )
    return out


def mark_read(sub: PortalSubscriber, message_id: uuid.UUID) -> CampaignMessage | None:
    m: CampaignMessage | None = CampaignMessage.objects.filter(
        id=message_id, subscriber_id=sub.id
    ).first()
    if m is None:
        return None
    if m.read_at is None:
        m.read_at = timezone.now()
        m.save(update_fields=["read_at", "updated_at"])
    return m


def update_prefs(sub: PortalSubscriber, *, push: bool, sms: bool, inbox: bool) -> PortalSubscriber:
    """قناة بقناة لمحل واحد؛ إيقاف كل القنوات والاشتراك قائم حالةٌ بلا معنى — نسأل عن القصد
    (`all_channels_off`) ولا نحفظ."""
    if not (push or sms or inbox):
        raise PortalRejected("all_channels_off", "channels")
    sub.channel_push, sub.channel_sms, sub.channel_inbox = push, sms, inbox
    sub.save(update_fields=["channel_push", "channel_sms", "channel_inbox", "updated_at"])
    return sub


def unsubscribe(sub: PortalSubscriber) -> PortalSubscriber:
    """إلغاء هذا المحل وحده: لا تصله رسائل جديدة، وسجلّ رسائله يبقى للقراءة؛ التراجع 7 أيام."""
    if sub.opt_out_at is None:
        sub.opt_out_at = timezone.now()
        sub.save(update_fields=["opt_out_at", "updated_at"])
    return sub


def resubscribe(sub: PortalSubscriber) -> PortalSubscriber:
    """«تراجع عن الإلغاء» خلال 7 أيام؛ بعدها يحتاج الرابط أو QR من جديد (`undo_expired`)."""
    if sub.opt_out_at is None:
        return sub
    if timezone.now() - sub.opt_out_at > timedelta(days=UNDO_DAYS):
        raise PortalRejected("undo_expired")
    sub.opt_out_at = None
    sub.consent_at = timezone.now()
    sub.save(update_fields=["opt_out_at", "consent_at", "updated_at"])
    return sub


def me_payload(sub: PortalSubscriber) -> dict[str, Any]:
    tenant = Tenant.unscoped.get(id=sub.tenant_id)
    ch = PortalChannel.objects.filter(tenant_id=sub.tenant_id).first()
    base = subscriber_payload(sub)
    undo_expired = bool(
        sub.opt_out_at and timezone.now() - sub.opt_out_at > timedelta(days=UNDO_DAYS)
    )
    return {
        **base,
        "shop_name": tenant.name,
        "slug": ch.slug if ch else "",
        "channels": {"push": sub.channel_push, "sms": sub.channel_sms, "inbox": sub.channel_inbox},
        "undo_expired": undo_expired,
    }
