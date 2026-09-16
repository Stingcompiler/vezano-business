"""إسقاطات خادمية من أعضاء العمليات المقبولة (§١٠.٣: «يمكن للخادم بناء إسقاط للتقارير»).

الأحداث تبقى مصدر الحقيقة (Member)؛ الإسقاط مشتق ويُبنى داخل معاملة القبول نفسها فلا يُرى
عضو بلا إسقاطه. كل وحدة (shifts، sales…) تسجّل مُطبِّقها لكيانها؛ المُطبِّق متكرّر الأثر لأن
النقل قد يُعاد (§٨.٣ بند ١٠) — لكن القبول نفسه لا يكرّر الاستدعاء (المكرر يعود duplicate قبله).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from typing import Any

#: (tenant_id, device_id, actor_user_id, entity_id, payload) → None
Applier = Callable[[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, Mapping[str, Any]], None]
APPLIERS: dict[str, list[Applier]] = {}


def register_applier(entity: str, fn: Applier) -> None:
    APPLIERS.setdefault(entity, []).append(fn)


def apply_member(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity: str,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    for fn in APPLIERS.get(entity, []):
        fn(tenant_id, device_id, actor_user_id, entity_id, payload)
