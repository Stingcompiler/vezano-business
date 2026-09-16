"""محرك قبول PUSH (§٨.٣) — يطبّق قواعد القبول العشر.

1. معاملة مستقلة لكل عملية (لا atomic خارجي يلف النقل).
2. الأعضاء قائمة كاملة وثابتة؛ الناقص يرفض العملية كلها؛ التحقق يتبع kind/op_version.
3. UNIQUE(tenant, operation_id) + تفرد الأعضاء يمنعان التكرار؛ الإعادة تُقارن بالمحتوى لا بالترتيب.
4. العضو الزائد/الناقص/المختلف → conflicted؛ لا عضو جديد تحت هوية معتمدة.
5. لكل أثر عملية مالكة واحدة؛ المرجع إلى أثر قديم تبعية لا عضو.
6. التبعية غير المؤكدة تُرفق كاملة في النقل نفسه أو تنتظر.
7. التبعيات بترتيب طوبولوجي مع كشف الدورات؛ رفض الأب يمنع التابع لا المستقل.
8. القيود المؤجلة داخل العملية (المفاتيح المركبة DEFERRABLE في الهجرات).
9. ACK بعد COMMIT الحقيقي؛ فشل الالتزام يُسجَّل رفضاً بعد التراجع.
10. انقطاع الرد ≠ فشل: الإعادة بنفس الهويات → duplicate للملتزم.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from django.db import DatabaseError, transaction

from core.tenancy import require_tenant
from sync.appliers import apply_member
from sync.canonical import HASH_VERSION, CanonicalError, content_hash, members_hash
from sync.counter import EpochMismatch, lock_and_reserve
from sync.kinds import KindError, KindSpec, get_kind
from sync.models import Member, Operation, QuarantinedOperation
from sync.models_log import SyncLog
from sync.scopes import scope_for

Status = Literal["accepted", "duplicate", "conflicted", "rejected", "pending_dependency"]

PROTOCOL_VERSION = 1


@dataclass(frozen=True)
class MemberReceipt:
    entity: str
    id: str
    server_seq: str


@dataclass
class OperationResult:
    operation_id: str
    status: Status
    code: str = ""
    detail: str = ""
    member_receipts: list[MemberReceipt] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"operation_id": self.operation_id, "status": self.status}
        if self.code:
            out["code"] = self.code
        if self.detail:
            out["detail"] = self.detail
        if self.member_receipts:
            out["member_receipts"] = [r.__dict__ for r in self.member_receipts]
        return out


@dataclass(frozen=True)
class PushResponse:
    protocol_version: int
    sync_epoch: str
    request_id: str
    results: list[OperationResult]
    server_seq_high: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "protocol_version": self.protocol_version,
            "sync_epoch": self.sync_epoch,
            "request_id": self.request_id,
            "results": [r.as_dict() for r in self.results],
            # معلومة تشخيص — لا يجوز تقديم مؤشرات PULL إليها (§٨.٣)
            "server_seq_high": self.server_seq_high,
        }


class PushError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        self.code, self.detail = code, detail
        super().__init__(f"{code}: {detail}")


# ------------------------------------------------------------------ التحقق البنيوي
def _uuid(value: Any, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as e:
        raise KindError(f"{what}: not a uuid") from e


@dataclass(frozen=True)
class ParsedMember:
    entity: str
    entity_id: uuid.UUID
    schema_version: int
    payload: Mapping[str, Any]
    content_hash: str


@dataclass(frozen=True)
class ParsedOperation:
    operation_id: uuid.UUID
    kind: str
    op_version: int
    spec: KindSpec
    dependencies: tuple[uuid.UUID, ...]
    members: tuple[ParsedMember, ...]
    members_hash: str
    raw: Mapping[str, Any]

    @property
    def member_keys(self) -> set[tuple[str, uuid.UUID]]:
        return {(m.entity, m.entity_id) for m in self.members}


def parse_operation(raw: Mapping[str, Any]) -> ParsedOperation:
    """يتحقق من الغلاف والأعضاء والحقول القانونية ويحسب التجزئات؛ أي خلل = KindError (رفض دائم)."""
    op_id = _uuid(raw.get("operation_id"), "operation_id")
    kind = str(raw.get("kind", ""))
    try:
        op_version = int(raw.get("op_version", 0))
    except (TypeError, ValueError) as e:
        raise KindError("op_version: not an int") from e
    spec = get_kind(kind, op_version)
    deps = tuple(_uuid(d, "dependency") for d in raw.get("dependencies", []) or [])
    raw_members = raw.get("members")
    if not isinstance(raw_members, list) or not raw_members:
        raise KindError("members: empty")

    parsed: list[ParsedMember] = []
    seen: set[tuple[str, uuid.UUID]] = set()
    for m in raw_members:
        entity = str(m.get("entity", ""))
        espec = spec.entities.get(entity)
        if espec is None:
            raise KindError(f"member entity {entity!r} not allowed for {kind}")
        entity_id = _uuid(m.get("id"), "member id")
        if (entity, entity_id) in seen:
            raise KindError(f"duplicate member {entity}:{entity_id}")
        seen.add((entity, entity_id))
        if int(m.get("schema_version", 0)) != espec.schema_version:
            raise KindError(f"{entity}: unsupported schema_version")
        payload = m.get("payload")
        if not isinstance(payload, dict):
            raise KindError(f"{entity}: payload must be an object")
        missing = [f for f in espec.required if payload.get(f) in (None, "")]
        if missing:
            raise KindError(f"{entity}: missing {missing}")
        try:
            digest = content_hash(payload, espec.fields)
        except CanonicalError as e:
            raise KindError(f"{entity}: {e}") from e
        espec.validate(payload)
        parsed.append(ParsedMember(entity, entity_id, espec.schema_version, payload, digest))

    counts: dict[str, int] = {}
    for m in parsed:
        counts[m.entity] = counts.get(m.entity, 0) + 1
    for entity, (lo, hi) in spec.members.items():
        n = counts.get(entity, 0)
        if n < lo or (hi is not None and n > hi):
            raise KindError(
                f"{entity}: expected {lo}..{hi if hi is not None else '∞'} members, got {n}"
            )

    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for m in parsed:
        grouped.setdefault(m.entity, []).append(m.payload)
    spec.validate_operation(grouped)

    return ParsedOperation(
        operation_id=op_id,
        kind=kind,
        op_version=op_version,
        spec=spec,
        dependencies=deps,
        members=tuple(parsed),
        members_hash=members_hash({(m.entity, str(m.entity_id)): m.content_hash for m in parsed}),
        raw=raw,
    )


# ------------------------------------------------------------------ الترتيب الطوبولوجي (بند ٧)
def order_operations(
    ops: list[ParsedOperation],
) -> tuple[list[ParsedOperation], dict[uuid.UUID, str]]:
    """يرتّب حسب التبعيات داخل النقل؛ يعيد (المرتّبة، الدورات المكتشفة كأخطاء)."""
    by_id = {op.operation_id: op for op in ops}
    # التبعية قد تشير إلى operation_id أو إلى entity_id لعضو في عملية داخل النقل
    entity_owner: dict[uuid.UUID, uuid.UUID] = {
        m.entity_id: op.operation_id for op in ops for m in op.members
    }
    graph: dict[uuid.UUID, set[uuid.UUID]] = {}
    for op in ops:
        edges: set[uuid.UUID] = set()
        for dep in op.dependencies:
            target = dep if dep in by_id else entity_owner.get(dep)
            if target is not None and target != op.operation_id:
                edges.add(target)
        graph[op.operation_id] = edges

    ordered: list[ParsedOperation] = []
    state: dict[uuid.UUID, int] = {}  # 0 unvisited, 1 visiting, 2 done
    cyclic: dict[uuid.UUID, str] = {}

    def visit(node: uuid.UUID, path: list[uuid.UUID]) -> None:
        st = state.get(node, 0)
        if st == 2:
            return
        if st == 1:
            cycle = path[path.index(node) :] + [node]
            for n in cycle:
                cyclic[n] = "dependency_cycle"
            return
        state[node] = 1
        for dep in sorted(graph[node], key=str):
            visit(dep, [*path, node])
        state[node] = 2
        ordered.append(by_id[node])

    for op in sorted(ops, key=lambda o: str(o.operation_id)):
        visit(op.operation_id, [])
    return ordered, cyclic


# ------------------------------------------------------------------ القبول
def _dependency_satisfied(
    tenant_id: uuid.UUID, dep: uuid.UUID, accepted_now: set[uuid.UUID], entities_now: set[uuid.UUID]
) -> bool:
    if dep in accepted_now or dep in entities_now:
        return True
    if Operation.unscoped.filter(tenant_id=tenant_id, operation_id=dep).exists():
        return True
    return Member.unscoped.filter(tenant_id=tenant_id, entity_id=dep).exists()


def _compare_existing(existing: Operation, op: ParsedOperation) -> OperationResult:
    """الإعادة: مطابقة كاملة → duplicate بأرقامها الأصلية؛ أي اختلاف → conflicted (بند ٣–٤)."""
    if existing.kind != op.kind or existing.op_version != op.op_version:
        return OperationResult(str(op.operation_id), "conflicted", "kind_mismatch")
    if existing.members_hash != op.members_hash:
        existing_keys = {(m.entity, m.entity_id) for m in existing.members.all()}
        if existing_keys != op.member_keys:
            return OperationResult(str(op.operation_id), "conflicted", "membership_mismatch")
        return OperationResult(str(op.operation_id), "conflicted", "content_mismatch")
    receipts = [
        MemberReceipt(m.entity, str(m.entity_id), str(m.server_seq))
        for m in existing.members.order_by("server_seq")
    ]
    return OperationResult(str(op.operation_id), "duplicate", member_receipts=receipts)


def _quarantine(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    raw: Mapping[str, Any],
    reason: str,
    code: str,
    detail: str,
) -> None:
    op_id = raw.get("operation_id")
    try:
        op_uuid = uuid.UUID(str(op_id))
    except (ValueError, TypeError):
        op_uuid = uuid.UUID(int=0)
    with transaction.atomic():
        QuarantinedOperation.unscoped.create(
            tenant_id=tenant_id,
            operation_id=op_uuid,
            device=device_id,
            reason=reason,
            code=code,
            detail=detail[:2000],
            original=dict(raw),
        )


def _commit_operation(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    op: ParsedOperation,
    expected_epoch: str,
    scope_id: str = "",
) -> OperationResult:
    """معاملة واحدة للعملية: قفل المستأجر → فحص التكرار → حجز الأرقام → إدراج → COMMIT → ACK.

    القفل يسبق فحص التكرار عمداً: إعادة النقل نفسه من مسارين متزامنين (بند ١٠) تجد الأول ملتزماً
    فتعود duplicate، لا تصطدم بقيد التفرد فتُرفض. لا يُحجز رقم للمكرر (الحجز بعد الفحص).
    """
    with transaction.atomic():
        lock_and_reserve(tenant_id, 0, expected_epoch=expected_epoch)
        existing = Operation.unscoped.filter(
            tenant_id=tenant_id, operation_id=op.operation_id
        ).first()
        if existing is not None:
            return _compare_existing(existing, op)
        # عضو يحمل هوية أثر معتمد تحت عملية أخرى (بند ٤–٥)
        taken = Member.unscoped.filter(
            tenant_id=tenant_id, entity_id__in=[m.entity_id for m in op.members]
        ).exists()
        if taken:
            return OperationResult(str(op.operation_id), "conflicted", "member_already_owned")
        state, first_seq = lock_and_reserve(
            tenant_id, len(op.members), expected_epoch=expected_epoch
        )
        operation = Operation.unscoped.create(
            tenant_id=tenant_id,
            operation_id=op.operation_id,
            kind=op.kind,
            op_version=op.op_version,
            device=device_id,
            actor_user=actor_user_id,
            members_hash=op.members_hash,
            hash_version=HASH_VERSION,
            sync_epoch=state.sync_epoch,
            server_seq=first_seq,
        )
        receipts: list[MemberReceipt] = []
        for offset, m in enumerate(sorted(op.members, key=lambda x: (x.entity, str(x.entity_id)))):
            seq = first_seq + offset
            Member.unscoped.create(
                tenant_id=tenant_id,
                operation=operation,
                entity=m.entity,
                entity_id=m.entity_id,
                schema_version=m.schema_version,
                payload=dict(m.payload),
                content_hash=m.content_hash,
                server_seq=seq,
            )
            receipts.append(MemberReceipt(m.entity, str(m.entity_id), str(seq)))
            apply_member(tenant_id, device_id, actor_user_id, m.entity, m.entity_id, m.payload)
            scope, group = scope_for(m.entity)
            SyncLog.unscoped.create(
                tenant_id=tenant_id,
                scope=scope,
                scope_id=scope_id if scope == "branch" else "",
                entity_group=group,
                entity=m.entity,
                entity_id=m.entity_id,
                server_seq=seq,
            )
    # هنا فقط — بعد COMMIT الحقيقي — يُعاد ACK (بند ٩)
    return OperationResult(str(op.operation_id), "accepted", member_receipts=receipts)


def push(
    *,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    envelope: Mapping[str, Any],
    branch_id: str = "",
) -> PushResponse:
    """يعالج نقلاً كاملاً. يُستدعى داخل سياق مستأجر مصادَق عليه؛ المستأجر من السياق لا من الحمولة.

    `branch_id` فرع الجهاز الناقل (من المصادقة): يحدد `scope_id` للكيانات الفرعية في sync_log.
    """
    tenant_id = require_tenant()
    if envelope.get("protocol_version") != PROTOCOL_VERSION:
        raise PushError("protocol_version_unsupported", str(envelope.get("protocol_version")))
    request_id = str(envelope.get("request_id", ""))
    epoch = str(envelope.get("sync_epoch", ""))
    from sync.counter import ensure_state

    state = ensure_state(tenant_id)
    if epoch != state.sync_epoch:
        # الجيل القديم لا يُقبل ولا يُطبَّق (§٨.١٢) — الجهاز ينتقل إلى مسار إعادة التهيئة
        raise PushError("epoch_mismatch", state.sync_epoch)

    raw_ops = envelope.get("operations")
    if not isinstance(raw_ops, list):
        raise PushError("operations_missing")

    results: dict[uuid.UUID, OperationResult] = {}
    parsed: list[ParsedOperation] = []
    failed_now: set[uuid.UUID] = set()
    # هويات أعضاء العمليات الفاشلة في هذا النقل — التابع الذي يشير إليها يُرفض لا ينتظر
    failed_entities: set[uuid.UUID] = set()
    for raw in raw_ops:
        try:
            parsed.append(parse_operation(raw))
        except KindError as e:
            op_id = str(raw.get("operation_id", "")) if isinstance(raw, Mapping) else ""
            _quarantine(
                tenant_id,
                device_id,
                raw if isinstance(raw, Mapping) else {"raw": raw},
                "rejected",
                "validation",
                str(e),
            )
            key = uuid.UUID(op_id) if _is_uuid(op_id) else uuid.uuid4()
            results[key] = OperationResult(op_id or str(key), "rejected", "validation", str(e))
            failed_now.add(key)
            if isinstance(raw, Mapping):
                for m in raw.get("members") or []:
                    mid = str(m.get("id", "")) if isinstance(m, Mapping) else ""
                    if _is_uuid(mid):
                        failed_entities.add(uuid.UUID(mid))

    ordered, cyclic = order_operations(parsed)
    for cyc_id, code in cyclic.items():
        op = next(o for o in parsed if o.operation_id == cyc_id)
        _quarantine(tenant_id, device_id, op.raw, "rejected", code, "")
        results[cyc_id] = OperationResult(str(cyc_id), "rejected", code)
        failed_now.add(cyc_id)
        failed_entities.update(m.entity_id for m in op.members)

    accepted_now: set[uuid.UUID] = set()
    entities_now: set[uuid.UUID] = set()
    for op in ordered:
        if op.operation_id in results:
            continue
        # بند ٦–٧: أب فاشل يمنع التابع؛ أب غائب عن القاعدة والنقل → انتظار قابل للاستئناف
        blocked = [d for d in op.dependencies if d in failed_now or d in failed_entities]
        if blocked:
            results[op.operation_id] = OperationResult(
                str(op.operation_id), "rejected", "dependency_rejected", str(blocked[0])
            )
            failed_now.add(op.operation_id)
            continue
        unmet = [
            d
            for d in op.dependencies
            if not _dependency_satisfied(tenant_id, d, accepted_now, entities_now)
        ]
        if unmet:
            results[op.operation_id] = OperationResult(
                str(op.operation_id), "pending_dependency", "dependency_unconfirmed", str(unmet[0])
            )
            continue
        try:
            result = _commit_operation(tenant_id, device_id, actor_user_id, op, epoch, branch_id)
        except EpochMismatch as e:
            raise PushError("epoch_mismatch", e.expected) from e
        except DatabaseError as e:
            # فشل الالتزام (قيد مؤجل مثلاً): تراجعت المعاملة؛ يُسجَّل رفضاً بأصله (بند ٩)
            _quarantine(tenant_id, device_id, op.raw, "rejected", "commit_failed", str(e)[:500])
            result = OperationResult(str(op.operation_id), "rejected", "commit_failed")
        if result.status == "conflicted":
            _quarantine(tenant_id, device_id, op.raw, "conflicted", result.code, result.detail)
        if result.status in ("accepted", "duplicate"):
            accepted_now.add(op.operation_id)
            entities_now.update(m.entity_id for m in op.members)
        else:
            failed_now.add(op.operation_id)
            failed_entities.update(m.entity_id for m in op.members)
        results[op.operation_id] = result

    # نحافظ على ترتيب الطلب في الرد
    ordered_results: list[OperationResult] = []
    for raw in raw_ops:
        rid = str(raw.get("operation_id", "")) if isinstance(raw, Mapping) else ""
        match = next((r for r in results.values() if r.operation_id == rid), None)
        if match is not None:
            ordered_results.append(match)
    known = {r.operation_id for r in ordered_results}
    ordered_results.extend(r for r in results.values() if r.operation_id not in known)

    state.refresh_from_db()
    return PushResponse(
        PROTOCOL_VERSION, state.sync_epoch, request_id, ordered_results, str(state.sync_counter)
    )


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False
