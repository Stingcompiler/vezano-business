"""أول مدير منصة في الإنتاج (0005 §١١٨) — يعمل مرة واحدة فقط: يُرفض إن وُجد مدير منصة فعّال.

    uv run python manage.py create_first_admin --email you@domain --name "اسمك"

كلمة المرور من المتغيّر `FIRST_ADMIN_PASSWORD` (لا في سطر الأوامر فتبقى في سجل الصدفة)، 12 حرفاً
على الأقل. بعده يُدار كل مشغّل من شاشة المشغّلين باسم من أنشأه.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from core.auth import totp
from core.auth.accounts import create_account, normalize_identifier
from core.models import Account, User
from core.tenancy import platform_context
from stingops.models import OperatorProfile

MIN_PASSWORD = 12


class Command(BaseCommand):
    help = "ينشئ أول مدير منصة؛ يُرفض إن وُجد مدير فعّال."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--email", required=True)
        parser.add_argument("--name", required=True)

    def handle(self, *args: Any, **opts: Any) -> None:
        password = os.environ.get("FIRST_ADMIN_PASSWORD", "")
        if len(password) < MIN_PASSWORD:
            raise CommandError(f"FIRST_ADMIN_PASSWORD مطلوب ({MIN_PASSWORD} حرفاً على الأقل)")
        try:
            identifier, kind = normalize_identifier(str(opts["email"]))
        except ValueError:
            raise CommandError("بريد غير صالح") from None
        if kind != Account.Kind.EMAIL:
            raise CommandError("المعرّف يجب أن يكون بريداً")
        with platform_context():
            if OperatorProfile.objects.filter(
                role=OperatorProfile.Role.ADMIN, user__is_active=True
            ).exists():
                raise CommandError("يوجد مدير منصة فعّال — أنشئ المشغّلين من شاشة المشغّلين")
            if Account.unscoped.filter(identifier=identifier).exists():
                raise CommandError("البريد مستعمل لحساب قائم")
            name = str(opts["name"]).strip()[:200]
            account = create_account(identifier, password, name)
            user = User.unscoped.create(
                tenant=None,
                username=f"ops-{uuid.uuid4().hex[:10]}",
                display_name=name,
                is_platform_staff=True,
                account=account,
            )
            OperatorProfile.objects.create(
                user=user, totp_secret=totp.new_secret(), role=OperatorProfile.Role.ADMIN
            )
        self.stdout.write(f"أُنشئ مدير المنصة {name} <{identifier}> — ادخل من /platform/login")
