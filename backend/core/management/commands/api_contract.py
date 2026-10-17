"""`manage.py api_contract infer --samples DIR` — يبني `core/api_contract.json` من العيّنات.

الرصد: `STING_API_CONTRACT=capture STING_API_CONTRACT_SAMPLES=DIR pytest`
(التفاصيل في `core/api_contract.py`).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from core.api_contract import CONTRACT_PATH, build_contract


class Command(BaseCommand):
    help = "يستنتج عقد ردود الـAPI من عيّنات الرصد"

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("action", choices=["infer"])
        parser.add_argument("--samples", required=True)

    def handle(self, *args: Any, **opts: Any) -> None:
        folder = Path(opts["samples"])
        files = sorted(folder.glob("*.jsonl"))
        if not files:
            raise CommandError(f"لا عيّنات في {folder}")
        samples = (
            json.loads(line) for f in files for line in f.read_text(encoding="utf-8").splitlines()
        )
        contract = build_contract(samples)
        CONTRACT_PATH.write_text(
            json.dumps(contract, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        typed, errors = len(contract["responses"]), len(contract["errors"])
        self.stdout.write(f"{typed} عملية بمخطط، {errors} برموز أخطاء ← {CONTRACT_PATH}")
