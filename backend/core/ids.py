"""UUIDv7 (RFC 9562): تُولَّد محلياً للعمليات والأحداث دون انتظار الخادم (§٥.٢).

الاختيار تنظيمي وفهرسي؛ لا تُجعل ساعة الجهاز مرجع ترتيب موثوقاً.
"""

from __future__ import annotations

import os
import time
import uuid


def uuid7() -> uuid.UUID:
    ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")  # 80 bit: 12 لـ rand_a و62 لـ rand_b
    value = (ms & ((1 << 48) - 1)) << 80  # unix_ts_ms (48)
    value |= 0x7 << 76  # ver = 7 (4)
    value |= ((rand >> 62) & 0x0FFF) << 64  # rand_a (12)
    value |= 0b10 << 62  # var = RFC 4122 (2)
    value |= rand & ((1 << 62) - 1)  # rand_b (62)
    return uuid.UUID(int=value)
