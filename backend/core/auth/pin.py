"""PIN المحلي (§٩.١): ٤–٦ خانات، متحقق مشتق بـPBKDF2-SHA256 وملح خاص لكل مستخدم، بلا PIN نصي.

- المعلمات تُقاس على العتاد المستهدف (0002 المفتوح في §١٩.٢)؛ القيمة الأولية هنا 210_000 دورة
  (توصية OWASP 2023 لـSHA-256) وتُسجَّل داخل المتحقق فتتغير دون إبطال القديم.
- التحقق يجري **على الجهاز** (packages/sync-core لاحقاً)؛ الخادم يولّد ويوزّع فقط.
- المتحققات تنزل إلى أجهزة أصحابها فقط (§٨.٦: «بيانات الدخول ومتحققات PIN → الأجهزة والمستخدمون
  المصرح لهم تحديداً») — انظر `verifiers_for_device`.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from dataclasses import dataclass

from core.models import Device, PinVerifier, User, UserBranchAccess

PIN_PATTERN = re.compile(r"^[0-9]{4,6}$")
PBKDF2_ITERATIONS = 210_000
SALT_BYTES = 16
DK_LEN = 32
ALGORITHM = "pbkdf2_sha256"


class InvalidPin(ValueError):
    pass


@dataclass(frozen=True)
class Verifier:
    algorithm: str
    iterations: int
    salt_b64: str
    hash_b64: str

    def encode(self) -> str:
        return f"{self.algorithm}${self.iterations}${self.salt_b64}${self.hash_b64}"

    @classmethod
    def decode(cls, encoded: str) -> Verifier:
        algorithm, iterations, salt, digest = encoded.split("$", 3)
        return cls(algorithm, int(iterations), salt, digest)


def _derive(pin: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, iterations, dklen=DK_LEN)


def derive_verifier(
    pin: str, *, required_length: int = 6, iterations: int = PBKDF2_ITERATIONS
) -> Verifier:
    """يشتق متحققاً؛ الطول يحكمه إعداد المؤسسة (٤–٦؛ الافتراضي ٦)."""
    if not PIN_PATTERN.fullmatch(pin) or len(pin) != required_length:
        raise InvalidPin(f"pin must be exactly {required_length} digits")
    salt = os.urandom(SALT_BYTES)
    digest = _derive(pin, salt, iterations)
    return Verifier(
        ALGORITHM, iterations, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def check_pin(pin: str, verifier: Verifier) -> bool:
    """للاختبار والمرجع: التحقق الفعلي على الجهاز بنفس الخوارزمية (يُنسخ إلى TS في sync-core)."""
    if verifier.algorithm != ALGORITHM:
        return False
    expected = base64.b64decode(verifier.hash_b64)
    actual = _derive(pin, base64.b64decode(verifier.salt_b64), verifier.iterations)
    return hmac.compare_digest(expected, actual)


def set_user_pin(user: User, pin: str, *, required_length: int = 6) -> PinVerifier:
    """يستبدل متحقق المستخدم؛ لا يُحفظ PIN نصي.

    إعادة التعيين لا تبطل متحققاً قديماً على جهاز لم يتصل (§٩.٣).
    """
    v = derive_verifier(pin, required_length=required_length)
    obj, _ = PinVerifier.objects.update_or_create(
        user=user,
        defaults={
            "tenant": user.tenant,
            "encoded": v.encode(),
            "version": PinVerifier.next_version(user),
        },
    )
    assert isinstance(obj, PinVerifier)
    return obj


def verifiers_for_device(device: Device) -> list[PinVerifier]:
    """المتحققات التي يحق للجهاز تنزيلها: مستخدمو فرعه المخوَّلون (تخويل غير مسحوب) فقط."""
    user_ids = UserBranchAccess.objects.filter(
        branch=device.branch, revoked_at__isnull=True
    ).values_list("user_id", flat=True)
    return list(
        PinVerifier.objects.filter(user_id__in=user_ids, user__is_active=True).select_related(
            "user"
        )
    )
