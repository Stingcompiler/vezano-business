"""`manage.py offsite_restore --list` أو `--key … --out /backups/restore.dump` (0005 §١٥١).

ينزّل نسخة من التخزين الخارجي ويفكّ تشفيرها إلى ملف pg_dump؛ الاستعادة نفسها بـ`pg_restore` كما في
`docs/deploy-ovh.md` — هذا الأمر لا يلمس قاعدة البيانات.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from stingops import offsite


class Command(BaseCommand):
    help = "يسرد النسخ الخارجية أو ينزّل واحدة ويفكّها"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--list", action="store_true")
        parser.add_argument("--key", default="")
        parser.add_argument("--out", default="")

    def handle(self, *args: Any, **opts: Any) -> None:
        c = offsite.config()
        if c is None:
            raise CommandError("التخزين الخارجي غير مضبوط — راجع STING_OFFSITE_* في .env")
        if opts["list"]:
            for kind in offsite.KEEP:
                for o in offsite.listing(c, kind):
                    self.stdout.write(f"{o['key']}\t{o['size']}")
            return
        if not opts["key"] or not opts["out"]:
            raise CommandError("--key و--out معاً، أو --list")
        out = Path(opts["out"])
        try:
            offsite.download(c, opts["key"], out)
        except offsite.OffsiteError as e:
            out.unlink(missing_ok=True)
            raise CommandError(str(e)) from e
        self.stdout.write(f"restored {out} {out.stat().st_size}")
