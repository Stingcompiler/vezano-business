"""`manage.py ops_selfcheck` — فحص ذاتي على الخادم كل ساعة من `worker` (0005 §١٤٨).

ما لا تراه المراقبة الخارجية: آخر نسخة ليلية (موجودة وصالحة خلال 26 ساعة)، ومساحة القرص (≥ 85٪
تنبيه). عند مشكلة يُرسل بريد واحد في اليوم لكل نوع إلى `STING_ALERT_EMAIL` (لا شيء بلا المتغيّر).
"""

from __future__ import annotations

import os
import shutil
from datetime import timedelta
from pathlib import Path
from typing import Any

from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.tenancy import platform_context
from stingops.models import ServerBackup

DISK_WARN_RATIO = 0.85
BACKUP_MAX_AGE = timedelta(hours=26)
#: علامات «أُرسل اليوم» — في بيت مستخدم الحاوية لا في /tmp المشترك
MARKERS = Path(os.environ.get("STING_SELFCHECK_DIR", str(Path.home() / ".selfcheck")))


def problems() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    usage = shutil.disk_usage("/")
    ratio = usage.used / usage.total
    if ratio >= DISK_WARN_RATIO:
        found.append(
            ("disk", f"القرص ممتلئ بنسبة {ratio:.0%} — حرّر مساحة قبل أن تتوقّف النسخ والتسجيل.")
        )
    with platform_context():
        last = ServerBackup.objects.order_by("-taken_at").first()
    if last is None:
        found.append(("backup", "لا نسخة ليلية مسجّلة بعد."))
    elif last.status != ServerBackup.Status.OK:
        found.append(
            ("backup", f"آخر نسخة ليلية ({last.taken_at:%Y-%m-%d %H:%M}) حالتها {last.status}.")
        )
    elif timezone.now() - last.taken_at > BACKUP_MAX_AGE:
        found.append(
            (
                "backup",
                f"آخر نسخة ليلية صالحة منذ {last.taken_at:%Y-%m-%d %H:%M} — أقدم من 26 ساعة.",
            )
        )
    return found


class Command(BaseCommand):
    help = "فحص ذاتي للنسخ والقرص مع تنبيه بالبريد"

    def handle(self, *args: Any, **opts: Any) -> None:
        to = os.environ.get("STING_ALERT_EMAIL", "").strip()
        sender = os.environ.get("STING_EMAIL_FROM", "").strip()
        found = problems()
        if not found:
            self.stdout.write("selfcheck: ok")
            return
        MARKERS.mkdir(parents=True, exist_ok=True)
        today = timezone.localdate().isoformat()
        for kind, text in found:
            self.stdout.write(f"selfcheck: {kind}: {text}")
            marker = MARKERS / f"{kind}-{today}"
            if not to or not sender or marker.exists():
                continue
            send_mail(
                f"تنبيه فيزانو بلص — {'النسخ الاحتياطي' if kind == 'backup' else 'مساحة القرص'}",
                f"{text}\n\nالخادم: plus.vezano.app\nالوقت: {timezone.now():%Y-%m-%d %H:%M} UTC",
                sender,
                [to],
            )
            marker.touch()
