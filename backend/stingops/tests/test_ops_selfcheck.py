"""`manage.py ops_selfcheck` (0005 §١٤٨): نسخة ليلية صالحة حديثة = لا تنبيه؛ قديمة أو فاشلة =
بريد واحد في اليوم إلى `STING_ALERT_EMAIL`، ولا شيء بلا المتغيّر."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone

from core.tenancy import platform_context
from stingops.models import ServerBackup

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("STING_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("STING_EMAIL_FROM", "Vezano Plus <plus@vezano.app>")
    monkeypatch.setattr("core.management.commands.ops_selfcheck.MARKERS", tmp_path)
    # قرص جهاز الاختبار ليس موضوع الاختبار
    monkeypatch.setattr("core.management.commands.ops_selfcheck.DISK_WARN_RATIO", 1.01)


def _backup(hours_ago: int, status: str = "ok") -> None:
    with platform_context():
        ServerBackup.objects.create(
            taken_at=timezone.now() - timedelta(hours=hours_ago), size_bytes=10, status=status
        )


def test_recent_good_backup_sends_nothing() -> None:
    _backup(2)
    call_command("ops_selfcheck")
    assert mail.outbox == []


def test_stale_or_failed_backup_alerts_once_a_day() -> None:
    _backup(30)
    call_command("ops_selfcheck")
    call_command("ops_selfcheck")
    assert len(mail.outbox) == 1
    assert "النسخ الاحتياطي" in mail.outbox[0].subject
    assert mail.outbox[0].to == ["owner@example.com"]
    _backup(1, status="failed")
    call_command("ops_selfcheck")
    assert len(mail.outbox) == 1  # النوع نفسه في اليوم نفسه — بريد واحد


def test_no_alert_address_means_no_email(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STING_ALERT_EMAIL")
    call_command("ops_selfcheck")
    assert mail.outbox == []
