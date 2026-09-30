"""`manage.py record_backup` (0005 §١٤٠): ما يأخذه `deploy/backup.sh` يظهر في «النسخ» بحالته."""

from __future__ import annotations

import pytest
from django.core.management import CommandError, call_command

from core.tenancy import platform_context
from stingops.models import ServerBackup

pytestmark = pytest.mark.django_db(transaction=True)


def test_record_backup_command() -> None:
    call_command("record_backup", kind="weekly", size=2048, status="ok", location="/backups/x.dump")
    call_command("record_backup", size=0, status="failed", note="pg_dump فشل")
    with platform_context():
        rows = list(ServerBackup.objects.order_by("created_at"))
    assert [(r.kind, r.status, r.size_bytes) for r in rows] == [
        ("weekly", "ok", 2048),
        ("nightly", "failed", 0),
    ]
    assert rows[0].table_counts and rows[1].table_counts == {}
    with pytest.raises(CommandError):
        call_command("record_backup", kind="hourly")
