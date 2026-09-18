"""Web Push (WEB-02؛ §١١.٦، §١١.٨؛ ACC-107، 113): اشتراك واحد فعّال لكل جهاز؛ نقطة النهاية سرّ
تشغيلي لا يُعاد في الردود؛ الإرسال بمفاتيح VAPID من إعدادات النشر (`STING_VAPID_PUBLIC_KEY`،
`STING_VAPID_PRIVATE_KEY`، `STING_VAPID_SUBJECT`)؛ التنبيه بلا محتوى حساس — عنوان ثابت من قائمة
مغلقة ورابط داخل التطبيق. انتهاء الاشتراك عند المزوّد (404/410) يوسم لا يُحذف."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from typing import Any

from django.utils import timezone

from core.models import Device, DeviceEndpoint, User
from core.tenancy import require_tenant

# لا محتوى حساس: العناوين ثابتة ولا تحمل أسماء ولا مبالغ (ACC-113)
NOTIFICATION_KINDS: dict[str, dict[str, str]] = {
    "test": {
        "title": "Sting — تجربة الإشعارات",
        "body": "القناة تعمل. هذا إشعار تجريبي.",
        "url": "/notify",
    },
    "invoice": {"title": "فاتورة جديدة", "body": "وصلت فاتورة تحتاج نظرك.", "url": "/pos/invoices"},
    "stock_low": {"title": "مخزون منخفض", "body": "صنف بلغ حدّ التنبيه.", "url": "/inventory"},
    "sync": {"title": "المزامنة تحتاجك", "body": "بند محجوز ينتظر قرارك.", "url": "/sync/review"},
}


def vapid_public_key() -> str:
    return os.environ.get("STING_VAPID_PUBLIC_KEY", "")


def push_configured() -> bool:
    return bool(vapid_public_key() and os.environ.get("STING_VAPID_PRIVATE_KEY", ""))


def _sha(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def subscribe(
    *, device: Device, user: User, endpoint: str, p256dh: str, auth: str, user_agent: str = ""
) -> DeviceEndpoint:
    """يثبّت الاشتراك الفعّال الوحيد للجهاز: القديم يُنهى، والمكرّر بنقطته يُجدَّد."""
    digest = _sha(endpoint)
    now = timezone.now()
    existing: DeviceEndpoint | None = DeviceEndpoint.objects.filter(endpoint_sha256=digest).first()
    if existing is not None:
        existing.p256dh = p256dh
        existing.auth = auth
        existing.expired_at = None
        existing.last_error = ""
        existing.user = user.id
        existing.save(update_fields=["p256dh", "auth", "expired_at", "last_error", "user"])
        DeviceEndpoint.objects.filter(device=device, expired_at__isnull=True).exclude(
            id=existing.id
        ).update(expired_at=now, last_error="replaced")
        return existing
    DeviceEndpoint.objects.filter(device=device, expired_at__isnull=True).update(
        expired_at=now, last_error="replaced"
    )
    ep: DeviceEndpoint = DeviceEndpoint.objects.create(
        tenant_id=require_tenant(),
        device=device,
        user=user.id,
        endpoint=endpoint,
        endpoint_sha256=digest,
        p256dh=p256dh,
        auth=auth,
        user_agent=user_agent[:300],
    )
    return ep


def unsubscribe(*, device: Device, endpoint: str = "") -> int:
    qs = DeviceEndpoint.objects.filter(device=device, expired_at__isnull=True)
    if endpoint:
        qs = qs.filter(endpoint_sha256=_sha(endpoint))
    return qs.update(expired_at=timezone.now(), last_error="unsubscribed")


def active_endpoint(device: Device) -> DeviceEndpoint | None:
    return DeviceEndpoint.objects.filter(device=device, expired_at__isnull=True).first()


def status_payload(device: Device) -> dict[str, Any]:
    """الحالة بلا سرّ: هل ثمّة اشتراك فعّال ومتى استُعمل — لا نقطة نهاية ولا مفاتيح."""
    ep = active_endpoint(device)
    last_expired = (
        DeviceEndpoint.objects.filter(device=device, expired_at__isnull=False)
        .order_by("-expired_at")
        .first()
    )
    return {
        "configured": push_configured(),
        "public_key": vapid_public_key(),
        "subscribed": ep is not None,
        "created_at": ep.created_at.isoformat().replace("+00:00", "Z") if ep else "",
        "last_used_at": (
            ep.last_used_at.isoformat().replace("+00:00", "Z") if ep and ep.last_used_at else ""
        ),
        "expired": ep is None and last_expired is not None and last_expired.last_error == "expired",
    }


def send(ep: DeviceEndpoint, kind: str) -> dict[str, Any]:
    """يرسل تنبيهاً من القائمة المغلقة؛ 404/410 من المزوّد = انتهى الاشتراك (يوسم لا يُحذف)."""
    if kind not in NOTIFICATION_KINDS:
        raise ValueError("kind")
    if not push_configured():
        return {"sent": False, "reason": "push_not_configured"}
    payload = json.dumps({"kind": kind, **NOTIFICATION_KINDS[kind]})
    try:
        from pywebpush import WebPushException, webpush

        webpush(
            subscription_info={
                "endpoint": ep.endpoint,
                "keys": {"p256dh": ep.p256dh, "auth": ep.auth},
            },
            data=payload,
            vapid_private_key=os.environ.get("STING_VAPID_PRIVATE_KEY", ""),
            vapid_claims={
                "sub": os.environ.get("STING_VAPID_SUBJECT", "mailto:support@sting.example")
            },
            ttl=60,
        )
    except WebPushException as e:  # pragma: no cover — يحتاج مزوّداً حقيقياً
        status = getattr(getattr(e, "response", None), "status_code", 0) or 0
        if status in (404, 410):
            ep.expired_at = timezone.now()
            ep.last_error = "expired"
            ep.save(update_fields=["expired_at", "last_error"])
            return {"sent": False, "reason": "expired"}
        ep.last_error = f"provider_{status or 'error'}"[:120]
        ep.save(update_fields=["last_error"])
        return {"sent": False, "reason": ep.last_error}
    except Exception:  # noqa: BLE001 — مكتبة/شبكة: لا نُسقط الطلب
        return {"sent": False, "reason": "provider_error"}
    ep.last_used_at = timezone.now()
    ep.save(update_fields=["last_used_at"])
    return {"sent": True, "reason": ""}


def notify_device(device_id: uuid.UUID, kind: str) -> dict[str, Any]:
    ep = DeviceEndpoint.objects.filter(device_id=device_id, expired_at__isnull=True).first()
    if ep is None:
        return {"sent": False, "reason": "not_subscribed"}
    return send(ep, kind)
