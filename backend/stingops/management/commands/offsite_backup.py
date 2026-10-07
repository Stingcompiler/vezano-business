"""`manage.py offsite_backup --file /backups/vezano-….dump` — يشفّر النسخة ويرفعها خارج الخادم ويحذف
الأقدم من حدّ الاحتفاظ (0005 §١٥١). يستدعيه `deploy/backup.sh` بعد نسخة صالحة.

بلا إعداد التخزين الخارجي يكتب «not configured» ويخرج بنجاح: النسخة تبقى «على الخادم وحده» وشاشة
النسخ تقول ذلك. الفشل يُسجَّل على النسخة نفسها، والفحص الذاتي يرسل تنبيهه.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from core.tenancy import platform_context
from stingops import offsite
from stingops.models import ServerBackup


class Command(BaseCommand):
    help = "يرفع نسخة مشفّرة إلى التخزين الخارجي"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--file", required=True)

    def handle(self, *args: Any, **opts: Any) -> None:
        local = Path(opts["file"])
        with platform_context():
            b = ServerBackup.objects.filter(location_ref=str(local)).order_by("-taken_at").first()
        if b is None or b.status != ServerBackup.Status.OK:
            raise CommandError(f"لا نسخة صالحة مسجّلة لـ{local}")
        c = offsite.config()
        if c is None:
            self.stdout.write("offsite: not configured")
            return
        try:
            key, size = offsite.upload(c, local, b.kind)
            pruned = offsite.prune(c, b.kind)
        except offsite.OffsiteError as e:
            with platform_context():
                ServerBackup.objects.filter(id=b.id).update(
                    offsite_status=ServerBackup.OffsiteStatus.FAILED,
                    offsite_note=str(e)[:300],
                )
            raise CommandError(f"offsite: {e}") from e
        with platform_context():
            ServerBackup.objects.filter(id=b.id).update(
                offsite_status=ServerBackup.OffsiteStatus.OK,
                offsite_key=key[:300],
                offsite_size=size,
                offsite_at=timezone.now(),
                offsite_note="",
            )
        self.stdout.write(f"offsite: ok {key} {size} (pruned {len(pruned)})")
