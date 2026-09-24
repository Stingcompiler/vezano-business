"""رسالة البريد التجريبية (0005 §١٢٦): تُرفض بمتغيّرات ناقصة بأسمائها، وتُرسل بالمسار نفسه لرمز
التحقق (المُرسِل من البيئة، والرمز في المتن) — بخلفية البريد في الذاكرة أثناء الاختبار."""

from __future__ import annotations

import pytest
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError

ENV = {
    "STING_EMAIL_FROM": "plus@vezano.app",
    "EMAIL_HOST": "smtp-relay.brevo.com",
    "EMAIL_HOST_USER": "login@smtp-brevo.com",
    "EMAIL_HOST_PASSWORD": "not-a-real-key",
}


def test_missing_settings_named(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ENV:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(CommandError) as e:
        call_command("send_test_email", to="owner@example.com")
    assert "EMAIL_HOST_PASSWORD" in str(e.value) and "STING_EMAIL_FROM" in str(e.value)


def test_sends_through_verification_path(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    call_command("send_test_email", to="owner@example.com")
    assert len(mail.outbox) == 1
    m = mail.outbox[0]
    assert m.from_email == "plus@vezano.app" and m.to == ["owner@example.com"]
    assert "رمز التحقق في فيزانو" in m.body and "not-a-real-key" not in m.body
