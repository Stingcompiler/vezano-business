"""النسخ خارج الخادم (0005 §١٥١): النسخة الليلية تُشفَّر على الخادم ثم تُرفع إلى تخزين كائنات متوافق
مع S3 (OVH Object Storage افتراضاً) — فإن تعطّل الخادم أو ضاع قرصه بقيت النسخة.

- **التشفير قبل الرفع** بعبارة سرّ `STING_BACKUP_PASSPHRASE` يحفظها المالك خارج الخادم أيضاً؛ مزوّد
  التخزين لا يرى إلا بايتات مشفّرة. AES-256-GCM على قطع بـ1 MiB، والمفتاح من scrypt بملح لكل نسخة.
  كل قطعة موثَّقة برقمها وبعلامة «الأخيرة» داخل الـnonce، فلا تُعاد ترتيبها ولا تُبتر النسخة بصمت.
- **الاحتفاظ**: آخر 30 ليلية و12 أسبوعية في التخزين الخارجي (المحلي 14 يوماً كما كان).
- **بلا إعداد** لا شيء يُرفع، وشاشة النسخ تقول ذلك صراحة — لا «محميّ» مزيّف.

الصيغة (`.vzb`): `VZB1` · ملح 16 · بادئة nonce 7، ثم قطع: علامة 1 (0/1 الأخيرة) · طول 4 · نص مشفّر.
"""

from __future__ import annotations

import os
import secrets
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

MAGIC = b"VZB1"
CHUNK = 1024 * 1024
SALT_LEN = 16
PREFIX_LEN = 7
MIN_PASSPHRASE = 20
KEEP = {"nightly": 30, "weekly": 12}


class OffsiteError(Exception):
    """فشل رفع أو تنزيل أو فكّ — النص يُعرض للمشغّل كما هو."""


@dataclass(frozen=True)
class OffsiteConfig:
    endpoint: str
    region: str
    bucket: str
    access_key: str
    secret_key: str
    passphrase: str
    prefix: str

    @property
    def label(self) -> str:
        """ما يُعرض للمشغّل: المزوّد والحاوية — بلا مفاتيح."""
        host = self.endpoint.split("://", 1)[-1].rstrip("/")
        return f"{self.bucket} · {host}"


def config() -> OffsiteConfig | None:
    env = os.environ.get
    c = OffsiteConfig(
        endpoint=env("STING_OFFSITE_ENDPOINT", "").strip(),
        region=env("STING_OFFSITE_REGION", "").strip(),
        bucket=env("STING_OFFSITE_BUCKET", "").strip(),
        access_key=env("STING_OFFSITE_ACCESS_KEY", "").strip(),
        secret_key=env("STING_OFFSITE_SECRET_KEY", "").strip(),
        passphrase=env("STING_BACKUP_PASSPHRASE", ""),
        prefix=env("STING_OFFSITE_PREFIX", "vezano-plus").strip().strip("/") or "vezano-plus",
    )
    if not all((c.endpoint, c.region, c.bucket, c.access_key, c.secret_key, c.passphrase)):
        return None
    return c


def passphrase_problem(passphrase: str) -> str:
    if len(passphrase) < MIN_PASSPHRASE:
        return f"عبارة السرّ أقصر من {MIN_PASSPHRASE} حرفاً."
    return ""


# ------------------------------------------------------------------ التشفير


def _key(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase.encode("utf-8"))


def _nonce(prefix: bytes, index: int, last: bool) -> bytes:
    return prefix + struct.pack(">I", index) + (b"\x01" if last else b"\x00")


def encrypt_stream(src: IO[bytes], dst: IO[bytes], passphrase: str) -> None:
    salt = secrets.token_bytes(SALT_LEN)
    prefix = secrets.token_bytes(PREFIX_LEN)
    header = MAGIC + salt + prefix
    aead = AESGCM(_key(passphrase, salt))
    dst.write(header)
    index = 0
    current = src.read(CHUNK)
    while True:
        following = src.read(CHUNK)
        last = not following
        sealed = aead.encrypt(_nonce(prefix, index, last), current, header)
        dst.write((b"\x01" if last else b"\x00") + struct.pack(">I", len(sealed)) + sealed)
        if last:
            return
        current = following
        index += 1


def decrypt_stream(src: IO[bytes], dst: IO[bytes], passphrase: str) -> None:
    header = src.read(len(MAGIC) + SALT_LEN + PREFIX_LEN)
    if len(header) != len(MAGIC) + SALT_LEN + PREFIX_LEN or not header.startswith(MAGIC):
        raise OffsiteError("ليس ملف نسخة مشفّرة من فيزانو بلص.")
    salt = header[len(MAGIC) : len(MAGIC) + SALT_LEN]
    prefix = header[len(MAGIC) + SALT_LEN :]
    aead = AESGCM(_key(passphrase, salt))
    index = 0
    while True:
        head = src.read(5)
        if len(head) != 5:
            raise OffsiteError("النسخة مبتورة — لم تصل قطعتها الأخيرة.")
        last = head[0] == 1
        (size,) = struct.unpack(">I", head[1:])
        sealed = src.read(size)
        if len(sealed) != size:
            raise OffsiteError("النسخة مبتورة — قطعة ناقصة.")
        try:
            dst.write(aead.decrypt(_nonce(prefix, index, last), sealed, header))
        except InvalidTag as e:
            raise OffsiteError("فكّ التشفير فشل — عبارة السرّ خاطئة أو الملف معدَّل.") from e
        if last:
            if src.read(1):
                raise OffsiteError("بيانات زائدة بعد القطعة الأخيرة — الملف معدَّل.")
            return
        index += 1


def encrypt_file(src: Path, dst: Path, passphrase: str) -> None:
    with src.open("rb") as i, dst.open("wb") as o:
        encrypt_stream(i, o, passphrase)


def decrypt_file(src: Path, dst: Path, passphrase: str) -> None:
    with src.open("rb") as i, dst.open("wb") as o:
        decrypt_stream(i, o, passphrase)


# ------------------------------------------------------------------ التخزين


def client(c: OffsiteConfig) -> S3Client:
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=c.endpoint,
        region_name=c.region,
        aws_access_key_id=c.access_key,
        aws_secret_access_key=c.secret_key,
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
            # مزوّدو S3 المتوافقون لا يقبلون كلّهم مجاميع CRC الجديدة الافتراضية
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def object_key(c: OffsiteConfig, kind: str, local: Path) -> str:
    return f"{c.prefix}/{kind}/{local.name}.vzb"


def upload(c: OffsiteConfig, local: Path, kind: str, s3: Any = None) -> tuple[str, int]:
    """يشفّر `local` بجانبه ويرفعه ثم يتحقّق من حجمه هناك ويحذف المشفَّر المحلي.

    يعيد (المفتاح، الحجم)."""
    problem = passphrase_problem(c.passphrase)
    if problem:
        raise OffsiteError(problem)
    s3 = s3 or client(c)
    sealed = local.with_name(local.name + ".vzb.part")
    key = object_key(c, kind, local)
    try:
        encrypt_file(local, sealed, c.passphrase)
        size = sealed.stat().st_size
        try:
            s3.upload_file(str(sealed), c.bucket, key)
            remote = int(s3.head_object(Bucket=c.bucket, Key=key)["ContentLength"])
        except Exception as e:  # botocore يرمي أنواعاً كثيرة؛ النص يكفي للمشغّل
            raise OffsiteError(f"الرفع فشل: {type(e).__name__}: {e}"[:280]) from e
        if remote != size:
            raise OffsiteError(f"الحجم هناك {remote} لا يطابق {size} — أُعيد في الليلة التالية.")
        return key, size
    finally:
        sealed.unlink(missing_ok=True)


def listing(c: OffsiteConfig, kind: str, s3: Any = None) -> list[dict[str, Any]]:
    s3 = s3 or client(c)
    out: list[dict[str, Any]] = []
    token: str | None = None
    while True:
        kw: dict[str, Any] = {"Bucket": c.bucket, "Prefix": f"{c.prefix}/{kind}/"}
        if token:
            kw["ContinuationToken"] = token
        page = s3.list_objects_v2(**kw)
        out += [{"key": o["Key"], "size": int(o["Size"])} for o in page.get("Contents", [])]
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
    # أسماء الملفات تحمل الطابع الزمني بصيغة قابلة للترتيب
    return sorted(out, key=lambda o: str(o["key"]))


def prune(c: OffsiteConfig, kind: str, s3: Any = None) -> list[str]:
    s3 = s3 or client(c)
    keep = KEEP.get(kind, 30)
    objs = listing(c, kind, s3)
    old = [o["key"] for o in objs[: max(0, len(objs) - keep)]]
    for key in old:
        s3.delete_object(Bucket=c.bucket, Key=key)
    return old


def download(c: OffsiteConfig, key: str, out: Path, s3: Any = None) -> None:
    """ينزّل `key` ويفكّه إلى `out` (ملف pg_dump صالح لـ`pg_restore`)."""
    s3 = s3 or client(c)
    sealed = out.with_name(out.name + ".vzb.part")
    try:
        try:
            s3.download_file(c.bucket, key, str(sealed))
        except Exception as e:
            raise OffsiteError(f"التنزيل فشل: {type(e).__name__}: {e}"[:280]) from e
        decrypt_file(sealed, out, c.passphrase)
    finally:
        sealed.unlink(missing_ok=True)
