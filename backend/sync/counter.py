"""عداد المستأجر وقفله (§٨.٥).

مسار الكتابة الوحيد: يضبط السياق ثم يأخذ قفل صف `SyncState` **قبل** أي قفل صف أعمال أو تخصيص
أرقام. العدد المحجوز هو عدد الكتابات الجديدة داخل العملية، لا عدد صفوف النقل كله.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from sync.models import SyncState


class EpochMismatch(Exception):
    def __init__(self, expected: str, got: str) -> None:
        self.expected, self.got = expected, got
        super().__init__(f"epoch mismatch: expected {expected}, got {got}")


def new_epoch() -> str:
    return f"epoch-{uuid.uuid4().hex[:12]}"


def ensure_state(tenant_id: uuid.UUID) -> SyncState:
    state, _ = SyncState.unscoped.get_or_create(
        tenant_id=tenant_id, defaults={"sync_epoch": new_epoch()}
    )
    return state


def lock_and_reserve(
    tenant_id: uuid.UUID, count: int, *, expected_epoch: str | None = None
) -> tuple[SyncState, int]:
    """يأخذ قفل المستأجر ويحجز `count` رقماً؛ يعيد (الحالة، أول رقم محجوز).

    يجب أن يُستدعى داخل معاملة.
    """
    assert transaction.get_connection().in_atomic_block, "reserve requires an open transaction"
    assert count >= 0
    state = SyncState.unscoped.select_for_update().get(tenant_id=tenant_id)
    if expected_epoch is not None and state.sync_epoch != expected_epoch:
        raise EpochMismatch(state.sync_epoch, expected_epoch)
    first = state.sync_counter + 1
    state.sync_counter += count
    state.save(update_fields=["sync_counter"])
    return state, first
