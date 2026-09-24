"""مفاتيح VAPID (0005 §١٢٥): الأمر يولّد زوجاً صالحاً يقبله py_vapid ويطابق عامُّه خاصَّه."""

from __future__ import annotations

import base64
from io import StringIO

from django.core.management import call_command
from py_vapid import Vapid

from core.management.commands.gen_vapid_keys import generate


def _dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def test_generated_pair_is_valid_and_matches() -> None:
    public, private = generate()
    assert len(_dec(public)) == 65 and _dec(public)[0] == 4  # نقطة غير مضغوطة
    assert len(_dec(private)) == 32
    v = Vapid.from_string(private_key=private)  # ما يستعمله pywebpush فعلاً
    from cryptography.hazmat.primitives import serialization

    derived = v.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    assert derived == _dec(public)
    # يوقّع ترويسة VAPID بلا خطأ
    headers = v.sign({"sub": "mailto:plus@vezano.app", "aud": "https://fcm.googleapis.com"})
    assert headers["Authorization"].startswith("vapid ")


def test_command_prints_env_lines_and_pairs_differ() -> None:
    out = StringIO()
    call_command("gen_vapid_keys", stdout=out)
    lines = out.getvalue().strip().splitlines()
    assert [ln.split("=", 1)[0] for ln in lines] == [
        "STING_VAPID_PUBLIC_KEY",
        "STING_VAPID_PRIVATE_KEY",
        "STING_VAPID_SUBJECT",
    ]
    assert lines[2] == "STING_VAPID_SUBJECT=mailto:plus@vezano.app"
    assert generate()[1] != generate()[1]
