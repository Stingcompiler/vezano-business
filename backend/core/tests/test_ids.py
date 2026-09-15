"""UUIDv7 — الإصدار والمتغيّر والترتيب الزمني (§٥.٢)."""

from core.ids import uuid7


def test_uuid7_version_and_variant() -> None:
    u = uuid7()
    assert u.version == 7
    assert u.variant == "specified in RFC 4122"


def test_uuid7_orders_by_time_and_is_unique() -> None:
    ids = [uuid7() for _ in range(1000)]
    assert len(set(ids)) == 1000
    # الطابع الزمني في أعلى 48 بت غير تنازلي عبر التوليد المتتابع
    stamps = [u.int >> 80 for u in ids]
    assert stamps == sorted(stamps)
