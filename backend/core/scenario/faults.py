"""مفاتيح محاكاة الأعطال (§١٥.٤): فقد ACK، تجميد المصالحة، قطع الشبكة، فشل الطابعة،
فشل إرسال رمز التحقق، وأعطال مزوّد الرسائل (NOT-05/06).

معزولة عن الإنتاج: لا تُقرأ إلا حين STING_FAULTS_ENABLED=1 وبيئة غير إنتاجية؛ في الإنتاج الدالة
`active()` تعيد فارغاً دائماً فلا يوجد مسار كود يمكن تفعيله بالخطأ.
"""

from __future__ import annotations

import os
from typing import Literal

FaultKey = Literal[
    "drop_ack",
    "freeze_reconciliation",
    "network_cut",
    "printer_fail",
    "verify_send_fail",
    # NOT-05/06 (T2.12): مزوّد الرسائل لا يردّ؛ رفض مؤقت لبعض الأرقام؛ انقطاع عامل الجدولة
    "sms_provider_silent",
    "sms_temp_reject",
    "sms_worker_cut",
    # PUR-02 (T2.13): فشل إرسال أمر الشراء إلى المورد
    "po_send_fail",
    # PUB-03 (T2.16): إعلان صيانة على صفحة الحالة
    "maintenance",
]
ALL_FAULTS: tuple[FaultKey, ...] = (
    "drop_ack",
    "freeze_reconciliation",
    "network_cut",
    "printer_fail",
    "verify_send_fail",
    "sms_provider_silent",
    "sms_temp_reject",
    "sms_worker_cut",
    "po_send_fail",
    "maintenance",
)

_state: set[FaultKey] = set()


def enabled() -> bool:
    return os.environ.get("STING_FAULTS_ENABLED") == "1" and os.environ.get(
        "STING_ENV", "development"
    ) in {"development", "test", "ci"}


def active() -> frozenset[FaultKey]:
    return frozenset(_state) if enabled() else frozenset()


def set_fault(key: FaultKey, on: bool) -> frozenset[FaultKey]:
    if not enabled():
        raise RuntimeError("مفاتيح الأعطال معطّلة — STING_FAULTS_ENABLED=1 في بيئة غير إنتاجية فقط")
    if key not in ALL_FAULTS:
        raise ValueError(key)
    (_state.add if on else _state.discard)(key)
    return active()


def clear() -> None:
    _state.clear()
