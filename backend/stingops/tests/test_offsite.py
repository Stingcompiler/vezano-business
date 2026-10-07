"""النسخ خارج الخادم (0005 §١٥١):

- التشفير ذهاباً وإياباً على قطع متعدّدة، ورفض: عبارة خاطئة، وتعديل بايت، وبتر القطعة الأخيرة،
  وإعادة ترتيب القطع، وملف غريب.
- `offsite_backup` بلا إعداد لا يرفع شيئاً؛ مع الإعداد يرفع المشفَّر وحده ويسجّل المفتاح والحجم،
  ويحذف الأقدم من حدّ الاحتفاظ؛ والفشل يُسجَّل على النسخة.
- `offsite_restore` يعيد الملف الأصلي بايتاً ببايت.
- الفحص الذاتي ينبّه حين لم تُرفع آخر نسخة صالحة بعد مهلة الرفع، وشاشة النسخ تقول الحالة.
"""

from __future__ import annotations

import io
import os
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from django.core import mail
from django.core.management import CommandError, call_command
from django.test import Client
from django.utils import timezone

from core.tenancy import platform_context
from stingops import offsite
from stingops.models import ServerBackup

pytestmark = pytest.mark.django_db(transaction=True)

PASS = "correct horse battery staple 2026"  # noqa: S105 — عبارة اختبار


class FakeS3:
    """ما يستعمله `offsite` من عميل S3 — في الذاكرة."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail = False

    def upload_file(self, filename: str, bucket: str, key: str) -> None:
        if self.fail:
            raise ConnectionError("endpoint unreachable")
        self.objects[key] = Path(filename).read_bytes()

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        return {"ContentLength": len(self.objects[Key])}

    def list_objects_v2(self, Bucket: str, Prefix: str, **_: Any) -> dict[str, Any]:  # noqa: N803
        hits = [{"Key": k, "Size": len(v)} for k, v in self.objects.items() if k.startswith(Prefix)]
        return {"Contents": hits, "IsTruncated": False}

    def delete_object(self, Bucket: str, Key: str) -> None:  # noqa: N803
        self.objects.pop(Key, None)

    def download_file(self, bucket: str, key: str, filename: str) -> None:
        Path(filename).write_bytes(self.objects[key])


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    fake = FakeS3()
    monkeypatch.setattr(offsite, "client", lambda c: fake)
    return fake


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in {
        "STING_OFFSITE_ENDPOINT": "https://s3.de.io.cloud.ovh.net",
        "STING_OFFSITE_REGION": "de",
        "STING_OFFSITE_BUCKET": "vezano-backups",
        "STING_OFFSITE_ACCESS_KEY": "AK",
        "STING_OFFSITE_SECRET_KEY": "sk-unique-secret-value",
        "STING_BACKUP_PASSPHRASE": PASS,
    }.items():
        monkeypatch.setenv(k, v)


def _seal(data: bytes, passphrase: str = PASS) -> bytes:
    out = io.BytesIO()
    offsite.encrypt_stream(io.BytesIO(data), out, passphrase)
    return out.getvalue()


def _open(sealed: bytes, passphrase: str = PASS) -> bytes:
    out = io.BytesIO()
    offsite.decrypt_stream(io.BytesIO(sealed), out, passphrase)
    return out.getvalue()


@pytest.mark.parametrize("size", [0, 10, offsite.CHUNK, offsite.CHUNK * 2 + 7])
def test_roundtrip(size: int) -> None:
    data = os.urandom(size)
    sealed = _seal(data)
    assert data[:64] not in sealed[23:] or size == 0  # لا نص صريح
    assert _open(sealed) == data


def test_tampering_is_refused() -> None:
    data = os.urandom(offsite.CHUNK * 2 + 100)
    sealed = _seal(data)
    with pytest.raises(offsite.OffsiteError, match="عبارة السرّ خاطئة"):
        _open(sealed, "another passphrase of length")
    flipped = bytearray(sealed)
    flipped[-10] ^= 1
    with pytest.raises(offsite.OffsiteError):
        _open(bytes(flipped))
    # بتر القطعة الأخيرة كاملة: ما بقي قطع سليمة لكن بلا «الأخيرة»
    header = 4 + offsite.SALT_LEN + offsite.PREFIX_LEN
    first = 5 + offsite.CHUNK + 16
    with pytest.raises(offsite.OffsiteError, match="مبتورة"):
        _open(sealed[: header + first * 2])
    # تبديل القطعتين الأوليين
    c1 = sealed[header : header + first]
    c2 = sealed[header + first : header + first * 2]
    swapped = sealed[:header] + c2 + c1 + sealed[header + first * 2 :]
    with pytest.raises(offsite.OffsiteError):
        _open(swapped)
    with pytest.raises(offsite.OffsiteError, match="ليس ملف نسخة"):
        _open(b"PGDMP not ours")
    with pytest.raises(offsite.OffsiteError, match="بيانات زائدة"):
        _open(sealed + b"x")


def _local_backup(tmp_path: Path, name: str, kind: str = "nightly", hours_ago: int = 0) -> Path:
    f = tmp_path / name
    f.write_bytes(b"PGDMP" + os.urandom(3000))
    with platform_context():
        ServerBackup.objects.create(
            kind=kind,
            taken_at=timezone.now() - timedelta(hours=hours_ago),
            size_bytes=f.stat().st_size,
            location_ref=str(f),
        )
    return f


def test_not_configured_uploads_nothing(tmp_path: Path, s3: FakeS3) -> None:
    f = _local_backup(tmp_path, "vezano-20261007-0100.dump")
    out = io.StringIO()
    call_command("offsite_backup", file=str(f), stdout=out)
    assert "not configured" in out.getvalue()
    assert s3.objects == {}
    with platform_context():
        assert ServerBackup.objects.get().offsite_status == "none"


def test_upload_records_prunes_and_restores(
    tmp_path: Path, s3: FakeS3, configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(offsite.KEEP, "nightly", 2)
    files = [_local_backup(tmp_path, f"vezano-2026100{d}-0100.dump") for d in (5, 6, 7)]
    for f in files:
        call_command("offsite_backup", file=str(f), stdout=io.StringIO())
    keys = sorted(s3.objects)
    assert keys == [
        "vezano-plus/nightly/vezano-20261006-0100.dump.vzb",
        "vezano-plus/nightly/vezano-20261007-0100.dump.vzb",
    ]
    # المرفوع مشفّر، ولا ملفات مؤقتة بجانب النسخة
    assert not s3.objects[keys[-1]].startswith(b"PGDMP")
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(f.name for f in files)
    with platform_context():
        last = ServerBackup.objects.get(location_ref=str(files[-1]))
    assert last.offsite_status == "ok" and last.offsite_key == keys[-1]
    assert last.offsite_size == len(s3.objects[keys[-1]]) and last.offsite_at

    out = tmp_path / "restore.dump"
    call_command("offsite_restore", key=keys[-1], out=str(out), stdout=io.StringIO())
    assert out.read_bytes() == files[-1].read_bytes()
    listed = io.StringIO()
    call_command("offsite_restore", list=True, stdout=listed)
    assert keys[0] in listed.getvalue()


def test_failure_is_recorded_and_alerted(
    tmp_path: Path, s3: FakeS3, configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STING_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("STING_EMAIL_FROM", "Vezano Plus <plus@vezano.app>")
    monkeypatch.setattr("core.management.commands.ops_selfcheck.MARKERS", tmp_path / "m")
    monkeypatch.setattr("core.management.commands.ops_selfcheck.DISK_WARN_RATIO", 1.01)
    s3.fail = True
    f = _local_backup(tmp_path, "vezano-20261007-0100.dump", hours_ago=3)
    with pytest.raises(CommandError, match="الرفع فشل"):
        call_command("offsite_backup", file=str(f))
    with platform_context():
        b = ServerBackup.objects.get()
    assert b.offsite_status == "failed" and "endpoint unreachable" in b.offsite_note
    call_command("ops_selfcheck", stdout=io.StringIO())
    assert len(mail.outbox) == 1 and "النسخ خارج الخادم" in mail.outbox[0].subject
    assert "endpoint unreachable" in mail.outbox[0].body


def test_short_passphrase_refused(
    tmp_path: Path, s3: FakeS3, configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STING_BACKUP_PASSPHRASE", "short")
    f = _local_backup(tmp_path, "vezano-20261007-0100.dump")
    with pytest.raises(CommandError, match="أقصر من"):
        call_command("offsite_backup", file=str(f))
    assert s3.objects == {}


def test_backups_screen_says_offsite_state(
    tmp_path: Path, s3: FakeS3, monkeypatch: pytest.MonkeyPatch
) -> None:
    from stingops.tests.test_operator import _operator_headers

    oh = _operator_headers("ops9", "هدى — تشغيل")
    f = _local_backup(tmp_path, "vezano-20261007-0100.dump")
    d = Client().get("/api/platform/backups", headers=oh).json()
    assert d["offsite"] == {"configured": False, "label": "", "last_ok_at": ""}
    assert d["backups"][0]["offsite_label"] == "على الخادم وحده"
    for k, v in {
        "STING_OFFSITE_ENDPOINT": "https://s3.de.io.cloud.ovh.net",
        "STING_OFFSITE_REGION": "de",
        "STING_OFFSITE_BUCKET": "vezano-backups",
        "STING_OFFSITE_ACCESS_KEY": "AK",
        "STING_OFFSITE_SECRET_KEY": "sk-unique-secret-value",
        "STING_BACKUP_PASSPHRASE": PASS,
    }.items():
        monkeypatch.setenv(k, v)
    call_command("offsite_backup", file=str(f), stdout=io.StringIO())
    d = Client().get("/api/platform/backups", headers=oh).json()
    assert d["offsite"]["configured"] is True
    assert d["offsite"]["label"] == "vezano-backups · s3.de.io.cloud.ovh.net"
    assert d["offsite"]["last_ok_at"]
    row = d["backups"][0]
    assert row["offsite_status"] == "ok" and row["offsite_label"] == "خارج الخادم"
    assert "sk-unique-secret-value" not in str(d) and PASS not in str(d)


def test_cloudflare_r2_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """R2 (اختيار المالك؛ 0005 §١٥٢): المنطقة `auto` والـEndpoint لكل حساب — والعميل يُبنى بها."""
    for k, v in {
        "STING_OFFSITE_ENDPOINT": "https://abc123.r2.cloudflarestorage.com",
        "STING_OFFSITE_REGION": "auto",
        "STING_OFFSITE_BUCKET": "vezano-plus-backups",
        "STING_OFFSITE_ACCESS_KEY": "AK",
        "STING_OFFSITE_SECRET_KEY": "sk-unique-secret-value",
        "STING_BACKUP_PASSPHRASE": PASS,
    }.items():
        monkeypatch.setenv(k, v)
    c = offsite.config()
    assert c is not None
    assert c.label == "vezano-plus-backups · abc123.r2.cloudflarestorage.com"
    real = offsite.client(c)
    assert real.meta.endpoint_url == "https://abc123.r2.cloudflarestorage.com"
    assert real.meta.region_name == "auto"
