"""PLT-09/PLT-10 — صحة المزامنة والخادم (تشخيص مخوّل لا نافذة على الدفاتر) ونسخ خادمية وتجربة
استعادة (RPO/RTO نتيجةً لا وعداً، ولا زرّ مدمّر بلا مسار مخوَّل — ACC-75)."""

from __future__ import annotations

import os
import socket
import time
import uuid
from datetime import timedelta
from typing import Any

from django.db import connection
from django.db.models import Sum
from django.utils import timezone

from core.models import Notification, Session, Tenant, User
from core.tenancy import platform_context
from stingops import metrics
from stingops.models import OperatorAccessLog, PlatformAnnouncement, RestoreDrill, ServerBackup
from stingops.review import ReviewRejected, _iso
from sync.models import Operation, QuarantinedOperation

ONLINE_MINUTES = 15
LATE_HOURS = 24
STALLED_MINUTES = 30
P95_LIMIT_MS = 800
WRITE_SUCCESS_FLOOR = 99.0
# جداول التحقّق في تجربة الاستعادة — عدّادات صفوف لا محتوى
INTEGRITY_TABLES = (
    "core_tenant",
    "core_user",
    "sync_operation",
    "sync_member",
    "sales_sale",
    "inventory_stockmovement",
    "parties_party",
)


def node_name() -> str:
    return os.environ.get("STING_NODE_NAME") or socket.gethostname()


def _table_counts() -> dict[str, int]:
    out: dict[str, int] = {}
    with connection.cursor() as cur:
        for t in INTEGRITY_TABLES:
            try:
                cur.execute(f'SELECT count(*) FROM "{t}"')  # noqa: S608 — أسماء ثابتة
                out[t] = int(cur.fetchone()[0])
            except Exception:  # noqa: BLE001 — جدول غير موجود في هذه النسخة
                connection.rollback()
                out[t] = -1
    return out


# ------------------------------------------------------------------ PLT-09
def _oldest_meaning(shop: str, days_word: str, nudges: int) -> str:
    told = (
        "لم يُبلَّغ التاجر بعد"
        if nudges == 0
        else "أُبلغ التاجر مرة"
        if nudges == 1
        else "أُبلغ التاجر مرتين"
        if nudges == 2
        else f"أُبلغ التاجر {nudges} مرات"
    )
    return f"جهاز واحد في {shop} لم يزامن {days_word} — {told}، بلا محو صامت."


def health_payload() -> dict[str, Any]:
    """عدّادات وأطوار وأزمنة — لا معرّف معاملة ولا مبلغ ولا اسم زبون."""
    now = timezone.now()
    with platform_context():
        live = Session.objects.filter(revoked_at__isnull=True, device__isnull=False)
        online = live.filter(last_seen_at__gte=now - timedelta(minutes=ONLINE_MINUTES)).count()
        late_qs = live.filter(
            reported_pending__gt=0, last_seen_at__lt=now - timedelta(hours=LATE_HOURS)
        )
        late_devices = late_qs.values("device_id").distinct().count()
        late_tenants = late_qs.values("tenant_id").distinct().count()
        pending_total = int(live.aggregate(s=Sum("reported_pending"))["s"] or 0)
        ops = Operation.unscoped
        received_hour = ops.filter(received_at__gte=now - timedelta(hours=1)).count()
        received_5m = ops.filter(received_at__gte=now - timedelta(minutes=5)).count()
        received_day = ops.filter(received_at__gte=now - timedelta(days=1)).count()
        last_op = ops.order_by("-received_at").values_list("received_at", flat=True).first()
        quarantined_day = QuarantinedOperation.unscoped.filter(
            received_at__gte=now - timedelta(days=1)
        ).count()
        conflicts = QuarantinedOperation.unscoped.filter(
            reason=QuarantinedOperation.Reason.CONFLICTED, reviewed_at__isnull=True
        ).count()
        stale_replies = QuarantinedOperation.unscoped.filter(
            code__in=["epoch_mismatch", "stale_generation", "sync_epoch"], reviewed_at__isnull=True
        ).count()
        oldest = (
            live.filter(reported_pending__gt=0)
            .order_by("reported_pending_at", "last_seen_at")
            .select_related("tenant")
            .first()
        )
        oldest_tenant = oldest.tenant if oldest and oldest.tenant_id else None
        nudges = (
            Notification.unscoped.filter(
                tenant_id=oldest.tenant_id,
                kind__in=["pending_upload", "quarantine_pending"],
            ).count()
            if oldest and oldest.tenant_id
            else 0
        )
    p95_ms, samples = metrics.p95()
    total_writes = received_day + quarantined_day
    write_pct = round(received_day * 1000 / total_writes) / 10 if total_writes else 100.0
    oldest_days = (
        max(0, (now - (oldest.reported_pending_at or oldest.last_seen_at)).days) if oldest else 0
    )
    last_ok_age_min = int((now - last_op).total_seconds() // 60) if last_op else None
    stalled = pending_total > 0 and (last_ok_age_min is None or last_ok_age_min >= STALLED_MINUTES)
    queue_trend = (
        "لا معلّق"
        if pending_total == 0
        else "يتناقص بمعدل سليم"
        if received_hour >= pending_total
        else "يتراكم"
    )
    days_unit = (
        "يوم"
        if oldest_days == 1
        else "يومين"
        if oldest_days == 2
        else "أيام"
        if oldest_days <= 10
        else "يوماً"
    )
    days_word = (
        "يوماً واحداً"
        if oldest_days == 1
        else "يومين"
        if oldest_days == 2
        else f"{oldest_days} أيام"
        if oldest_days <= 10
        else f"{oldest_days} يوماً"
    )
    rows = [
        {
            "key": "phases",
            "label": "أطوار المزامنة (محلي · قيد الرفع · مؤكَّد)",
            "value": f"{pending_total} · {received_5m} · {received_day}",
            "value_note": "",
            "status": "ok",
            "status_label": "يُقرأ",
            "meaning": "ثلاثة أطوار صريحة في كل مستأجر؛ الرقم أدناه يفصّل المتعثّر منها.",
        },
        {
            "key": "oldest",
            "label": "أقدم حدث معلّق",
            "value": str(oldest_days) if oldest else "—",
            "value_note": days_unit if oldest else "",
            "status": "stuck" if oldest_days >= 3 else "ok",
            "status_label": "متعثّر" if oldest_days >= 3 else "سليم",
            "meaning": _oldest_meaning(
                oldest_tenant.name if oldest_tenant else "متجر", days_word, nudges
            )
            if oldest
            else "لا أحداث معلّقة على أي جهاز.",
        },
        {
            "key": "write_success",
            "label": "نسبة نجاح الكتابة الخادمية",
            "value": f"{write_pct:g}%",
            "value_note": "",
            "status": "ok" if write_pct >= WRITE_SUCCESS_FLOOR else "degraded",
            "status_label": "سليم" if write_pct >= WRITE_SUCCESS_FLOOR else "متدهور",
            "meaning": "الفشل النادر يُمنع معه البيع بالذمة ولا تُعرض رسالة حفظ ناجح كاذبة.",
        },
        {
            "key": "conflicts",
            "label": "تعارضات بانتظار حسم مالك",
            "value": str(conflicts),
            "value_note": "",
            "status": "waiting" if conflicts else "ok",
            "status_label": "بانتظار" if conflicts else "لا شيء",
            "meaning": "النسختان محفوظتان كاملتين؛ الحسم صلاحية مالك المتجر لا المشغّل.",
        },
        {
            "key": "node_last_ok",
            "label": "آخر نجاح لكل عقدة خادمية",
            "value": node_name(),
            "value_note": (
                f"قبل {last_ok_age_min} دقيقة" if last_ok_age_min is not None else "لا كتابة بعد"
            ),
            "status": "stalled" if stalled else "ok",
            "status_label": "متعثّرة" if stalled else "محدَّث",
            "meaning": "يُعرض زمن آخر نجاح لا «الآن» دائماً؛ التقادم يُعلَن ولا يُخفى.",
        },
    ]
    return {
        "state": "server_error" if stalled else "ready",
        "measured_at": _iso(now),
        "cards": {
            "online_devices": online,
            "late_devices": late_devices,
            "late_tenants": late_tenants,
            "queue_pending": pending_total,
            "queue_trend": queue_trend,
            "p95_ms": p95_ms,
            "p95_samples": samples,
            "p95_within_limit": p95_ms <= P95_LIMIT_MS,
            "p95_limit_ms": P95_LIMIT_MS,
            "generation": os.environ.get("STING_SERVER_GENERATION", "g1"),
            "stale_replies_pending": stale_replies,
        },
        "rows": rows,
        "node": {
            "name": node_name(),
            "stalled": stalled,
            "last_ok_at": _iso(last_op),
            "tenants_scope": Tenant.unscoped.count(),
            "held_queue": pending_total if stalled else 0,
        },
    }


def sync_component_state() -> str:
    """PUB-03: «affected» حين تتأخر أجهزة، و«down» حين تتعثّر العقدة — من القياس نفسه."""
    try:
        h = health_payload()
    except Exception:  # noqa: BLE001 — صفحة الحالة لا تسقط
        return "down"
    if h["node"]["stalled"]:
        return "down"
    return "affected" if h["cards"]["late_devices"] else "ok"


# ------------------------------------------------------------------ PLT-10
def backup_row(b: ServerBackup) -> dict[str, Any]:
    last = b.drills.filter(target=RestoreDrill.Target.ISOLATED).order_by("-started_at").first()
    tested_ok = last is not None and last.result == RestoreDrill.Result.OK
    return {
        "id": str(b.id),
        "kind": b.kind,
        "kind_label": ServerBackup.Kind(b.kind).label,
        "taken_at": _iso(b.taken_at),
        "size_bytes": b.size_bytes,
        "status": b.status,
        "status_label": ServerBackup.Status(b.status).label,
        "note": b.note,
        "integrity_label": "فشلت"
        if b.status == ServerBackup.Status.FAILED
        else "صالحة ومختبَرة"
        if tested_ok
        else "صالحة",
        "last_drill": {
            "at": _iso(last.started_at),
            "result": last.result,
            "integrity_pct": last.integrity_pct,
            "by_name": last.by_name,
        }
        if last
        else None,
        "usable": b.status == ServerBackup.Status.OK,
    }


def backups_payload() -> dict[str, Any]:
    now = timezone.now()
    with platform_context():
        backups = list(ServerBackup.objects.order_by("-taken_at")[:30])
        last_ok_drill = (
            RestoreDrill.objects.filter(
                result=RestoreDrill.Result.OK, target=RestoreDrill.Target.ISOLATED
            )
            .select_related("backup")
            .order_by("-finished_at")
            .first()
        )
        latest_nightly = (
            ServerBackup.objects.filter(kind=ServerBackup.Kind.NIGHTLY)
            .order_by("-taken_at")
            .first()
        )
        last_valid = (
            ServerBackup.objects.filter(status=ServerBackup.Status.OK).order_by("-taken_at").first()
        )
        rows = [backup_row(b) for b in backups]
    nightly_failed = latest_nightly is not None and latest_nightly.status != ServerBackup.Status.OK
    return {
        "state": "server_error" if nightly_failed else "ready",
        "measured_at": _iso(now),
        "achieved": {
            "rpo_minutes": last_ok_drill.rpo_minutes if last_ok_drill else None,
            "rto_minutes": last_ok_drill.rto_minutes if last_ok_drill else None,
            "integrity_pct": last_ok_drill.integrity_pct if last_ok_drill else None,
            "drill_at": _iso(last_ok_drill.finished_at) if last_ok_drill else "",
            "drill_by_name": last_ok_drill.by_name if last_ok_drill else "",
            "backup_taken_at": _iso(last_ok_drill.backup.taken_at) if last_ok_drill else "",
        },
        "nightly_failed": nightly_failed,
        "last_valid_at": _iso(last_valid.taken_at) if last_valid else "",
        "backups": rows,
        "live_restore_requirements": [
            "تأكيد كتابيّ لاسم البيئة",
            "موافقة مشغّل ثانٍ",
            "نافذة صيانة معلَنة للتجار",
            "أثر كامل",
        ],
    }


def record_backup(
    *,
    kind: str,
    taken_at: Any,
    size_bytes: int,
    status: str,
    note: str = "",
    location_ref: str = "",
) -> ServerBackup:
    """يستدعيه مسار النسخ الفعلي بعد `pg_dump` (أو الاختبار) — مع عدّادات الصفوف مرجعاً للتحقّق."""
    with platform_context():
        return ServerBackup.objects.create(
            kind=kind,
            taken_at=taken_at,
            size_bytes=size_bytes,
            status=status,
            note=note[:300],
            location_ref=location_ref[:200],
            table_counts=_table_counts() if status == ServerBackup.Status.OK else {},
        )


def _backup(backup_id: uuid.UUID) -> ServerBackup:
    with platform_context():
        b = ServerBackup.objects.filter(id=backup_id).first()
    if b is None:
        raise ReviewRejected("not_found", 404)
    return b


def run_isolated_drill(*, viewer: User, backup_id: uuid.UUID) -> dict[str, Any]:
    """تجربة استعادة معزولة: تحقّق سلامة الجداول مقابل عدّادات النسخة، وقياس RPO (عمر النسخة) وRTO
    (زمن التحقّق) — نتيجة مقاسة تُسجَّل بمن نفّذها؛ لا تمسّ الإنتاج."""
    b = _backup(backup_id)
    if b.status != ServerBackup.Status.OK:
        raise ReviewRejected("backup_unusable", 400, {"status": b.status})
    started = timezone.now()
    t0 = time.monotonic()
    now_counts = _table_counts()
    ref = {k: int(v) for k, v in (b.table_counts or {}).items() if int(v) >= 0}
    checked = [k for k in ref if now_counts.get(k, -1) >= 0]
    ok = [k for k in checked if now_counts[k] >= ref[k]]
    integrity = round(len(ok) * 100 / len(checked)) if checked else 0
    elapsed_min = max(1, int(round((time.monotonic() - t0) / 60)))
    rpo = max(0, int((started - b.taken_at).total_seconds() // 60))
    result = RestoreDrill.Result.OK if integrity == 100 else RestoreDrill.Result.FAILED
    with platform_context():
        d = RestoreDrill.objects.create(
            backup=b,
            target=RestoreDrill.Target.ISOLATED,
            started_at=started,
            finished_at=timezone.now(),
            result=result,
            rpo_minutes=rpo,
            rto_minutes=elapsed_min,
            integrity_pct=integrity,
            detail=f"تحقّق {len(ok)}/{len(checked)} جدولاً على بيئة معزولة",
            by_name=viewer.display_name,
        )
        OperatorAccessLog.objects.create(
            operator=viewer, action="restore_drill", detail=f"{b} → {result} · {integrity}%"
        )
    return {
        "drill": {
            "id": str(d.id),
            "result": d.result,
            "rpo_minutes": d.rpo_minutes,
            "rto_minutes": d.rto_minutes,
            "integrity_pct": d.integrity_pct,
            "detail": d.detail,
            "by_name": d.by_name,
            "finished_at": _iso(d.finished_at),
        },
        **backups_payload(),
    }


def request_live_restore(
    *, viewer: User, backup_id: uuid.UUID, environment: str, second_approver: str
) -> dict[str, Any]:
    """لا زرّ واحد يستبدل قاعدة الإنتاج: يُسجَّل الطلب فقط حين تكتمل الشروط الأربعة، ولا يُنفَّذ
    من هنا — التنفيذ بمسار مخوَّل خارج الواجهة (ACC-75)."""
    b = _backup(backup_id)
    now = timezone.now()
    env_name = os.environ.get("STING_ENV", "")
    missing: list[str] = []
    if not environment.strip() or environment.strip() != env_name:
        missing.append("تأكيد كتابيّ لاسم البيئة")
    with platform_context():
        approver = (
            User.unscoped.filter(is_platform_staff=True, display_name=second_approver.strip())
            .exclude(id=viewer.id)
            .first()
            if second_approver.strip()
            else None
        )
        window = PlatformAnnouncement.objects.filter(
            kind=PlatformAnnouncement.Kind.MAINTENANCE,
            status=PlatformAnnouncement.Status.SCHEDULED,
            starts_at__lte=now,
            ends_at__gte=now,
        ).exists()
    if approver is None:
        missing.append("موافقة مشغّل ثانٍ")
    if not window:
        missing.append("نافذة صيانة معلَنة للتجار")
    if b.status != ServerBackup.Status.OK:
        missing.append("نسخة صالحة — الفاشلة لا تُستعاد")
    with platform_context():
        RestoreDrill.objects.create(
            backup=b,
            target=RestoreDrill.Target.LIVE,
            started_at=now,
            finished_at=now,
            result=RestoreDrill.Result.BLOCKED if missing else RestoreDrill.Result.OK,
            detail=("مُنعت: " + " · ".join(missing))
            if missing
            else "سُجّل طلب استعادة حيّة — التنفيذ بمسار مخوَّل",
            by_name=viewer.display_name,
            second_approver_name=approver.display_name if approver else "",
            environment_confirmation=environment.strip()[:120],
        )
        OperatorAccessLog.objects.create(
            operator=viewer,
            action="live_restore_blocked" if missing else "live_restore_requested",
            detail=" · ".join(missing) or str(b),
        )
    if missing:
        raise ReviewRejected("live_restore_requirements", 400, {"missing": missing})
    return {"queued": True, "detail": "سُجّل الطلب بأثر كامل؛ التنفيذ بمسار مخوَّل خارج هذه الواجهة."}
