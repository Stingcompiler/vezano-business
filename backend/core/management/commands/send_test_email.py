"""رسالة بريد تجريبية عبر قناة رمز التحقق نفسها (G-02 — 0005 §١٢٦).

    uv run python manage.py send_test_email --to plus@vezano.app

يستعمل `core.auth.senders.EmailSender` بإعدادات البيئة (`STING_EMAIL_FROM` و`EMAIL_HOST`…) —
المسار نفسه الذي يرسل رمز التحقق فعلاً. لا يطبع أي سرّ؛ الفشل يقول أين (اتصال، مصادقة، مُرسِل).
"""

from __future__ import annotations

import os
import secrets
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.auth.senders import EmailSender
from core.auth.verify import SendFailed


class Command(BaseCommand):
    help = "يرسل رمز تحقق تجريبياً إلى بريد عبر SMTP المضبوط في البيئة."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--to", required=True)

    def handle(self, *args: Any, **opts: Any) -> None:
        sender = os.environ.get("STING_EMAIL_FROM", "")
        missing = [
            k
            for k in ("STING_EMAIL_FROM", "EMAIL_HOST", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD")
            if not os.environ.get(k)
        ]
        if missing:
            raise CommandError(f"متغيّرات ناقصة: {', '.join(missing)} — راجع backend/.env.example")
        self.stdout.write(
            f"الإرسال من {sender} عبر {settings.EMAIL_HOST}:{settings.EMAIL_PORT} "
            f"(TLS={'نعم' if settings.EMAIL_USE_TLS else 'لا'}) إلى {opts['to']}…"
        )
        code = f"{secrets.randbelow(1_000_000):06d}"
        try:
            EmailSender(from_email=sender).send(opts["to"], code)
        except SendFailed as e:
            cause = e.__cause__
            raise CommandError(f"تعذّر الإرسال: {type(cause).__name__}: {cause}") from None
        self.stdout.write(self.style.SUCCESS(f"أُرسل — الرمز التجريبي في الرسالة {code}"))
