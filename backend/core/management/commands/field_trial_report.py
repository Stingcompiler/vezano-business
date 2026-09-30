"""`manage.py field_trial_report [--showcase | --tenant ID ...] [--end YYYY-MM-DD] [--weeks 4]`

التقرير الأسبوعي للتجربة الميدانية (`docs/field-trial.md`؛ 0005 §١٣٩) جدولاً بصيغة Markdown.
`--showcase` يقيسه على منشأتي العرض التجريبيتين (`manage.py showcase reset`) للتجربة قبل الميدان.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from core.field_trial import report_markdown
from core.scenario.showcase import FIXED


class Command(BaseCommand):
    help = "تقرير التجربة الميدانية الأسبوعي من السجلّ"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--tenant", action="append", default=[], help="معرّف منشأة (يتكرّر)")
        parser.add_argument("--showcase", action="store_true", help="منشأتا العرض التجريبيتان")
        parser.add_argument("--end", default="", help="آخر يوم (افتراضاً اليوم)")
        parser.add_argument("--weeks", type=int, default=4)

    def handle(self, *args: Any, **opts: Any) -> None:
        ids = [uuid.UUID(t) for t in opts["tenant"]]
        if opts["showcase"]:
            ids += [FIXED["shop"], FIXED["dist"]]
        if not ids:
            raise CommandError("حدّد --tenant أو --showcase")
        end = date.fromisoformat(opts["end"]) if opts["end"] else timezone.localdate()
        self.stdout.write(report_markdown(ids, end=end, weeks=max(1, int(opts["weeks"]))))
