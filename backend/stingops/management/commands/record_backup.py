"""`manage.py record_backup --kind nightly|weekly --size N --status ok|failed|incomplete`
(واختيارياً `--note` و`--location`).

يسجّل نسخة خادمية أخذها `deploy/backup.sh` لتظهر في «النسخ» عند المشغّل (PLT-10؛ 0005 §١٤٠).
"""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from stingops.health import record_backup
from stingops.models import ServerBackup


class Command(BaseCommand):
    help = "يسجّل نسخة خادمية بحجمها وحالتها"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--kind", default=ServerBackup.Kind.NIGHTLY)
        parser.add_argument("--size", type=int, default=0)
        parser.add_argument("--status", default=ServerBackup.Status.OK)
        parser.add_argument("--note", default="")
        parser.add_argument("--location", default="")

    def handle(self, *args: Any, **opts: Any) -> None:
        if opts["kind"] not in ServerBackup.Kind.values:
            raise CommandError(f"kind: {ServerBackup.Kind.values}")
        if opts["status"] not in ServerBackup.Status.values:
            raise CommandError(f"status: {ServerBackup.Status.values}")
        b = record_backup(
            kind=opts["kind"],
            taken_at=timezone.now(),
            size_bytes=max(0, int(opts["size"])),
            status=opts["status"],
            note=opts["note"],
            location_ref=opts["location"],
        )
        self.stdout.write(f"backup {b.id} {b.status} {b.size_bytes}")
