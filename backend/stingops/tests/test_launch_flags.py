"""أعلام الإطلاق (0005 §١١٨): M3 مرفوع وM4 منخفض للبيئة، ولا يُمسّ علم ضبطه المشغّل."""

from __future__ import annotations

import pytest
from django.core.management import call_command

from core.tenancy import platform_context
from stingops.models import OpsFlag

pytestmark = pytest.mark.django_db(transaction=True)


def test_launch_flags_idempotent_and_respect_operator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STING_ENV", "production")
    call_command("apply_launch_flags")
    with platform_context():
        flags = {f.key: f.enabled for f in OpsFlag.objects.filter(scope="production")}
        assert flags == {"market_m3": True, "market_m4": False}
        # المشغّل يخفض M3 — النشر التالي لا يعيده
        OpsFlag.objects.filter(key="market_m3", scope="production").update(enabled=False)
    call_command("apply_launch_flags")
    with platform_context():
        assert not OpsFlag.objects.get(key="market_m3", scope="production").enabled
        assert OpsFlag.objects.filter(scope="production").count() == 2


def test_create_first_admin_once(monkeypatch: pytest.MonkeyPatch) -> None:
    from django.core.management.base import CommandError

    monkeypatch.setenv("FIRST_ADMIN_PASSWORD", "short")
    with pytest.raises(CommandError):
        call_command("create_first_admin", email="boss@vezano.example", name="المالك")
    monkeypatch.setenv("FIRST_ADMIN_PASSWORD", "a-long-launch-password")
    call_command("create_first_admin", email="boss@vezano.example", name="المالك")
    from stingops.models import OperatorProfile

    with platform_context():
        prof = OperatorProfile.objects.get(user__account__identifier="boss@vezano.example")
        assert prof.role == "admin" and prof.user.is_platform_staff
    # مرة واحدة فقط
    with pytest.raises(CommandError):
        call_command("create_first_admin", email="second@vezano.example", name="ثانٍ")
