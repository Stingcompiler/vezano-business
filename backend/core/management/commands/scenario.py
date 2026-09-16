"""أمر إعادة الضبط: `manage.py scenario reset` — الأمر الواحد الذي تطلبه §١٥.٤."""

from __future__ import annotations

import json
from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from core.scenario.guard import ProductionGuard
from core.scenario.seed import reset_scenario, wipe_scenario


class Command(BaseCommand):
    help = "إدارة السيناريو التجريبي: reset (محو ثم بذر) أو wipe (محو فقط) — مرفوض على الإنتاج"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("action", choices=["reset", "wipe"])

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            if options["action"] == "wipe":
                n = wipe_scenario()
                self.stdout.write(f"محُي {n} مستأجراً من السيناريو")
                return
            result = reset_scenario()
        except ProductionGuard as e:
            raise SystemExit(f"مرفوض: {e}") from e
        self.stdout.write(json.dumps(result.summary(), ensure_ascii=False, indent=2))
