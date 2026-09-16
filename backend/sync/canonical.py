"""التجزئة القانونية للمحتوى (§٨.٤).

- SHA-256 لتمثيل JSON قانوني: مفاتيح مرتبة، UTF-8، بلا مسافات، `null` صريح للحقول الاختيارية
  الغائبة، وسلاسل عددية قانونية كما وصلت (لا تطبيع بعد الاستقبال — §٦.١).
- تُستثنى حقول الخادم (`received_at`، أرقام الاستقبال) وحالة النقل المحلية: كل عقد كيان يعلن
  قائمة حقوله القانونية بإصدار، وما ليس في القائمة يُرفض لا يُتجاهل بصمت.
- الخادم لا يقبل تجزئة يدعيها الجهاز؛ يحسبها بنفسه دائماً.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

HASH_VERSION = 1


class CanonicalError(ValueError):
    pass


def canonical_json(payload: Mapping[str, Any], fields: tuple[str, ...]) -> bytes:
    """يبني التمثيل القانوني من الحقول المعلنة فقط؛ حقل غير معلن = خطأ عقد."""
    extra = set(payload) - set(fields)
    if extra:
        raise CanonicalError(f"unknown fields: {sorted(extra)}")
    doc = {name: payload.get(name) for name in fields}
    return json.dumps(
        doc, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def content_hash(payload: Mapping[str, Any], fields: tuple[str, ...]) -> str:
    return hashlib.sha256(canonical_json(payload, fields)).hexdigest()


def members_hash(member_hashes: Mapping[tuple[str, str], str]) -> str:
    """تجزئة العملية من أعضائها مرتّبين بـ(entity, id).

    ترتيب القائمة ليس جزءاً من المعنى (§٨.٣ بند ٣).
    """
    ordered = sorted(member_hashes.items())
    doc = [[entity, member_id, digest] for (entity, member_id), digest in ordered]
    return hashlib.sha256(json.dumps(doc, separators=(",", ":")).encode()).hexdigest()
