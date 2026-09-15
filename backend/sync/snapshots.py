"""إنشاء لقطة ثابتة (§٨.٩ بند ١): بعد قفل المستأجر، عند نقطة قطع = العداد الحالي.

الأرصدة تُحسب من قيود الدفتر المقبولة حتى القطع (تأتي مع وحدة parties)؛ في المرحلة ٠ تُبنى
اللقطة بغلافها والقطع، والأرصدة تُمرَّر من المستدعي حتى تُربط بالدفتر في T1.6.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from django.db import transaction

from sync.counter import lock_and_reserve
from sync.models_log import Snapshot


def create_snapshot(tenant_id: uuid.UUID, *, balances: Sequence[dict[str, Any]] = ()) -> Snapshot:
    with transaction.atomic():
        state, _ = lock_and_reserve(tenant_id, 0)
        previous = (
            Snapshot.unscoped.filter(tenant_id=tenant_id, sync_epoch=state.sync_epoch)
            .order_by("-cutoff_server_seq")
            .first()
        )
        # لا تتراجع نقطة القطع داخل الجيل (بند ٨)
        assert previous is None or previous.cutoff_server_seq <= state.sync_counter
        snapshot = Snapshot.unscoped.create(
            tenant_id=tenant_id,
            sync_epoch=state.sync_epoch,
            cutoff_server_seq=state.sync_counter,
            balances=list(balances),
        )
        assert isinstance(snapshot, Snapshot)
        return snapshot
