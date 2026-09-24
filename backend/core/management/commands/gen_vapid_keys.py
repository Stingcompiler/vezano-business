"""مفاتيح VAPID لإشعارات الويب (WEB-02؛ 0005 §١٢٥).

    uv run python manage.py gen_vapid_keys

يطبع ثلاثة أسطر بصيغة متغيّرات البيئة. العام يُرسَل للمتصفح. **الخاص سرّ**: يُلصق في إعدادات النشر
(Render ← Environment) أو في إعداد التشغيل المحلي، ولا يُلتزم في المستودع ولا يُرسل في محادثة.
شغّله على الخادم نفسه (Shell في Render) كي لا يمرّ الخاص بأي مكان آخر.

الصيغة ما يقبله pywebpush/py_vapid: الخاص 32 بايتاً base64url، والعام نقطة P-256 غير مضغوطة
(65 بايتاً) base64url — وهي `applicationServerKey` في المتصفح. تغيير المفاتيح بعد النشر يُبطل
اشتراكات الأجهزة القائمة (تُعاد عند فتح التطبيق)، فلا تُولَّد في الإنتاج إلا مرة.
"""

from __future__ import annotations

import base64
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand

DEFAULT_SUBJECT = "mailto:plus@vezano.app"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def generate() -> tuple[str, str]:
    """(العام، الخاص) بصيغة base64url."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64url(public), _b64url(private)


class Command(BaseCommand):
    help = "يولّد مفاتيح VAPID (عام/خاص) ويطبعها بصيغة متغيّرات البيئة."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--subject", default=DEFAULT_SUBJECT)

    def handle(self, *args: Any, **opts: Any) -> None:
        public, private = generate()
        self.stdout.write(f"STING_VAPID_PUBLIC_KEY={public}")
        self.stdout.write(f"STING_VAPID_PRIVATE_KEY={private}")
        self.stdout.write(f"STING_VAPID_SUBJECT={opts['subject']}")
