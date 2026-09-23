"""قنوات رمز التحقق (G-02 — 0005 §١١٧): بلا إعداد يبقى مرسِل التطوير؛ الهاتف واتساب ثم نصية
بالترتيب ويفشل فقط إن فشلت كلها؛ البريد عبر SMTP؛ الأرقام السودانية المحلية تُحوَّل إلى E.164."""

from __future__ import annotations

from typing import Any

import pytest
from django.core import mail

from core.auth.senders import RoutedSender, build_sender, to_e164_sd
from core.auth.verify import SendFailed, StoredSender

ENV = {
    "STING_WHATSAPP_TOKEN": "wa-token",
    "STING_WHATSAPP_PHONE_ID": "12345",
    "STING_SMS_URL": "https://sms.example/send",
    "STING_SMS_TOKEN": "sms-token",
    "STING_EMAIL_FROM": "no-reply@vezano.example",
}


class Recorder:
    def __init__(self, fail_hosts: tuple[str, ...] = ()) -> None:
        self.calls: list[tuple[str, dict[str, Any], dict[str, str]]] = []
        self.fail_hosts = fail_hosts

    def __call__(self, url: str, body: dict[str, Any], headers: dict[str, str]) -> None:
        self.calls.append((url, body, headers))
        if any(h in url for h in self.fail_hosts):
            raise SendFailed


def test_unconfigured_keeps_dev_sender() -> None:
    assert isinstance(build_sender({}), StoredSender)


def test_e164() -> None:
    assert to_e164_sd("0912345678") == "+249912345678"
    assert to_e164_sd("249912345678") == "+249912345678"
    assert to_e164_sd("+966500000000") == "+966500000000"


def test_whatsapp_first_then_sms_fallback() -> None:
    post = Recorder()
    s = build_sender(ENV, post=post)
    assert isinstance(s, RoutedSender)
    s.send("0912345678", "482913")
    assert len(post.calls) == 1
    url, body, headers = post.calls[0]
    assert "graph.facebook.com" in url and url.endswith("/12345/messages")
    assert body["to"] == "249912345678" and body["type"] == "template"
    assert body["template"]["components"][0]["parameters"][0]["text"] == "482913"
    assert headers["Authorization"] == "Bearer wa-token"
    # واتساب يفشل → نصية بالنص العربي والرمز
    post = Recorder(fail_hosts=("graph.facebook.com",))
    build_sender(ENV, post=post).send("0912345678", "482913")
    assert [c[0] for c in post.calls] == [
        "https://graph.facebook.com/v21.0/12345/messages",
        "https://sms.example/send",
    ]
    msg = post.calls[1][1]["messages"][0]
    assert msg["from"] == "VEZANO" and msg["destinations"] == [{"to": "249912345678"}]
    assert "482913" in msg["text"] and "https://" not in msg["text"]
    # كلها تفشل → SendFailed (فيُحصى الفشل ويُقترح التحقق اليدوي بعد 3)
    post = Recorder(fail_hosts=("graph.facebook.com", "sms.example"))
    with pytest.raises(SendFailed):
        build_sender(ENV, post=post).send("0912345678", "482913")


def test_channel_order_and_email() -> None:
    post = Recorder()
    build_sender({**ENV, "STING_VERIFY_PHONE_CHANNELS": "sms"}, post=post).send(
        "+249912345678", "111111"
    )
    assert [c[0] for c in post.calls] == ["https://sms.example/send"]
    build_sender(ENV, post=post).send("owner@example.com", "222222")
    assert len(mail.outbox) == 1 and "222222" in mail.outbox[0].body
    assert mail.outbox[0].from_email == "no-reply@vezano.example"
    # بريد بلا قناة بريد مضبوطة → فشل صريح لا إرسال خاطئ عبر الهاتف
    with pytest.raises(SendFailed):
        build_sender({"STING_SMS_URL": "https://s", "STING_SMS_TOKEN": "t"}, post=post).send(
            "a@b.co", "1"
        )
