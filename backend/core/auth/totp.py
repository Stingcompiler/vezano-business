"""TOTP (RFC 6238) بلا اعتماديات: HMAC-SHA1، 30 ثانية، 6 خانات، سرّ Base32 — لدخول المشغّل."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time

STEP = 30
DIGITS = 6


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def code_at(secret: str, ts: float | None = None) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    counter = int((time.time() if ts is None else ts) // STEP)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    num = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(num % (10**DIGITS)).zfill(DIGITS)


def verify(secret: str, code: str, *, window: int = 1) -> bool:
    """يقبل النافذة الحالية ±window خطوة — لا أكثر."""
    code = (code or "").strip()
    if not code.isdigit() or len(code) != DIGITS:
        return False
    now = time.time()
    return any(
        hmac.compare_digest(code_at(secret, now + i * STEP), code)
        for i in range(-window, window + 1)
    )
