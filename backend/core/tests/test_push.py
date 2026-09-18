"""WEB-02 (T1.41): اشتراك واحد فعّال لكل جهاز؛ نقطة النهاية سرّ لا يُعاد في الردود؛ الإلغاء يوسم لا
يحذف؛ الإشعار التجريبي بلا مفاتيح يقول `push_not_configured` لا نجاحاً كاذباً؛ المحتوى بلا أسرار."""

from __future__ import annotations

from typing import Any

import pytest

from core import push
from core.models import DeviceEndpoint
from core.tenancy import tenant_context
from parties.tests.test_parties import api, ctx  # noqa: F401
from sync.tests.test_review import _hdr

pytestmark = pytest.mark.django_db(transaction=True)

SUB = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
    "p256dh": "BPk-p256dh-key",
    "auth": "auth-secret",
}


def test_subscribe_status_test_and_unsubscribe(
    ctx: dict[str, Any],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STING_VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("STING_VAPID_PRIVATE_KEY", raising=False)
    c, h = api(ctx)
    st = c.get("/api/push/status", headers=_hdr(h)).json()
    assert st == {
        "configured": False,
        "public_key": "",
        "subscribed": False,
        "created_at": "",
        "last_used_at": "",
        "expired": False,
    }
    r = c.post("/api/push/subscribe", SUB, content_type="application/json", headers=_hdr(h))
    assert r.status_code == 200, r.content
    body = r.json()
    assert (
        body["subscribed"] is True and "endpoint" not in body and "abc123" not in r.content.decode()
    )
    # اشتراك جديد للجهاز نفسه يُنهي القديم — اشتراك واحد فعّال
    r = c.post(
        "/api/push/subscribe",
        {**SUB, "endpoint": "https://fcm.googleapis.com/fcm/send/def456"},
        content_type="application/json",
        headers=_hdr(h),
    )
    assert r.status_code == 200
    with tenant_context(ctx["tenant"].id):
        rows = list(DeviceEndpoint.objects.order_by("created_at"))
        assert len(rows) == 2
        assert rows[0].expired_at is not None and rows[0].last_error == "replaced"
        assert rows[1].expired_at is None
    # الإشعار التجريبي بلا مفاتيح: لا نجاح كاذب
    r = c.post("/api/push/test", content_type="application/json", headers=_hdr(h))
    assert r.status_code == 200 and r.json()["sent"] is False
    assert r.json()["reason"] == "push_not_configured"
    # المحتوى بلا أسرار — عناوين ثابتة
    assert all("{" not in v["title"] for v in push.NOTIFICATION_KINDS.values())
    # الإلغاء يوسم لا يحذف
    r = c.post("/api/push/unsubscribe", {}, content_type="application/json", headers=_hdr(h))
    assert r.json()["subscribed"] is False
    with tenant_context(ctx["tenant"].id):
        assert DeviceEndpoint.objects.filter(expired_at__isnull=True).count() == 0
        assert DeviceEndpoint.objects.count() == 2
    r = c.post("/api/push/test", content_type="application/json", headers=_hdr(h))
    assert r.json()["reason"] == "not_subscribed"


def test_expired_endpoint_reported_and_silent_renewal(
    ctx: dict[str, Any],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STING_VAPID_PUBLIC_KEY", "BPUBLIC")
    monkeypatch.setenv("STING_VAPID_PRIVATE_KEY", "PRIVATE")
    c, h = api(ctx)
    c.post("/api/push/subscribe", SUB, content_type="application/json", headers=_hdr(h))
    with tenant_context(ctx["tenant"].id):
        ep = DeviceEndpoint.objects.get(expired_at__isnull=True)

        class _Resp:
            status_code = 410

        import pywebpush

        def boom(**_kwargs: Any) -> None:
            raise pywebpush.WebPushException("gone", response=_Resp())

        monkeypatch.setattr(pywebpush, "webpush", boom)
        out = push.send(ep, "test")
        assert out == {"sent": False, "reason": "expired"}
        ep.refresh_from_db()
        assert ep.expired_at is not None and ep.last_error == "expired"
    st = c.get("/api/push/status", headers=_hdr(h)).json()
    assert st["subscribed"] is False and st["expired"] is True and st["public_key"] == "BPUBLIC"
    # التجديد الصامت: الاشتراك بنقطة النهاية نفسها يعيدها فعّالة بلا صف جديد
    r = c.post("/api/push/subscribe", SUB, content_type="application/json", headers=_hdr(h))
    assert r.json()["subscribed"] is True and r.json()["expired"] is False
    with tenant_context(ctx["tenant"].id):
        assert DeviceEndpoint.objects.count() == 1
