"""محتوى العرض الكامل: `manage.py showcase reset` (محو ثم بذر) أو `wipe` — للتطوير فقط."""

from __future__ import annotations

import json
from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from core.scenario.showcase import ShowcaseError, seed_showcase, wipe_showcase


class Command(BaseCommand):
    help = "محتوى العرض: سوبرماركت الواحة وشركة الجزيرة للتوزيع — reset أو wipe (تطوير فقط)"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("action", choices=["reset", "wipe"])

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            if options["action"] == "wipe":
                self.stdout.write(f"محُيت {wipe_showcase()} منشأة عرض")
                return
            stats = seed_showcase(log=self.stdout.write)
        except ShowcaseError as e:
            raise SystemExit(f"مرفوض: {e}") from e
        self.stdout.write(json.dumps(stats, ensure_ascii=False, indent=2))
