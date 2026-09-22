"""بيئة التطوير: إنشاء/تحديث حساب مشغّل للمنصة (PLT-01) — بريد وكلمة مرور (بلا تحقّق ثنائي).

    manage.py seed_operator --email ops@vezano.local --password '...' --name 'هدى — تشغيل'

يُرفض خارج بيئة التطوير/الاختبار.
"""

from __future__ import annotations

import os
from typing import Any

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from core.auth.accounts import create_account, normalize_identifier
from core.models import Account, User
from core.tenancy import platform_context
from stingops.services import ensure_operator


class Command(BaseCommand):
    help = "حساب مشغّل للتطوير"

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", default="")
        parser.add_argument("--name", default="مشغّل التطوير")

    def handle(self, *args: Any, **opts: Any) -> None:
        if os.environ.get("STING_ENV", "development") not in {"development", "test", "ci"}:
            raise CommandError("للتطوير فقط — STING_ENV غير تطويري")
        identifier, _ = normalize_identifier(opts["email"])
        with platform_context():
            account = Account.unscoped.filter(identifier=identifier).first()
            if account is None:
                if not opts["password"]:
                    raise CommandError("لا حساب بهذا البريد — مرّر --password لإنشائه")
                account = create_account(opts["email"], opts["password"], opts["name"])
            elif opts["password"]:
                account.password = make_password(opts["password"])
                account.save(update_fields=["password"])
            user = User.unscoped.filter(account=account, is_platform_staff=True).first()
            if user is None:
                user = User.unscoped.create(
                    tenant=None,
                    username=f"ops-{identifier.split('@')[0]}"[:40],
                    display_name=opts["name"],
                    is_platform_staff=True,
                    account=account,
                )
            ensure_operator(user)
        self.stdout.write(f"المشغّل: {user.display_name} · البريد: {identifier}")
