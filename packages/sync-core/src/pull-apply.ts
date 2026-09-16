/**
 * تطبيق صفحة PULL (§٨.٧) في معاملة واحدة:
 * - المرجعيات: تُطبَّق النسخة إن كان رقمها أحدث؛ تساوي الرقم مع اختلاف المحتوى شذوذ يُسجَّل.
 * - العمليات: الحدث الثابت المحلي لا يُستبدل؛ إسقاط عملية محلية مكتمل الجزء المخوَّل يثبت قبولها
 *   (ACK وPULL نفس الانتقال — applyResults).
 * - staging للإسقاط الناقص حتى يكتمل؛ لا تُعرض فاتورة ناقصة.
 * - شواهد الحذف صريحة؛ المؤشرات مطلقة لا تتراجع؛ المرشحات تُسجَّل مع local_frontier.
 */

import type { StoragePort } from "@sting/platform";

import { applyResults } from "./pusher";
import { recordCandidate, type SnapshotCandidateEnvelope } from "./snapshots";
import type { MemberReceipt } from "./types";

export interface PullEntity {
  readonly entity: string;
  readonly id: string;
  readonly schema_version: number;
  readonly payload: Record<string, unknown>;
  readonly server_seq: string;
  readonly operation_id: string;
}

export interface PullProjection {
  readonly operation_id: string;
  readonly kind: string;
  readonly op_version: number;
  readonly members: readonly { readonly entity: string; readonly id: string }[];
  readonly authorized_complete: boolean;
  readonly members_hash: string;
}

export interface PullPage {
  readonly protocol_version: number;
  readonly sync_epoch: string;
  readonly request_id: string;
  readonly entities: readonly PullEntity[];
  readonly operation_projections: readonly PullProjection[];
  readonly tombstones: readonly {
    readonly entity: string;
    readonly id: string;
    readonly server_seq: string;
  }[];
  readonly access_manifest_version: string;
  readonly cursors: readonly {
    readonly scope: string;
    readonly entity_group: string;
    readonly scope_id?: string;
    readonly server_seq: string;
  }[];
  readonly has_more: boolean;
  readonly snapshot_candidates: readonly SnapshotCandidateEnvelope[];
}

export interface PullApplyOutcome {
  readonly applied: number;
  readonly skippedOlder: number;
  readonly anomalies: readonly string[];
  readonly confirmedLocal: number;
  readonly staged: number;
  readonly activatedProjections: number;
  readonly tombstoned: number;
  readonly candidates: number;
}

const entityKey = (entity: string, id: string) => `entity:${entity}:${id}`;
const stagingKey = (operationId: string) => `staging:${operationId}`;

export async function applyPullPage(
  storage: StoragePort,
  page: PullPage,
  currentEpoch: string,
): Promise<PullApplyOutcome> {
  if (page.sync_epoch !== currentEpoch) throw new Error(`epoch_mismatch:${page.sync_epoch}`);
  const outcome = {
    applied: 0,
    skippedOlder: 0,
    anomalies: [] as string[],
    confirmedLocal: 0,
    staged: 0,
    activatedProjections: 0,
    tombstoned: 0,
    candidates: 0,
  };

  await storage.transaction(async (tx) => {
    // 1) المرجعيات والأحداث الواردة
    const receiptsByOp = new Map<string, MemberReceipt[]>();
    for (const e of page.entities) {
      const key = entityKey(e.entity, e.id);
      const current = await tx.getProjection(key);
      const storedSeq = current?.value.server_seq;
      const currentSeq = typeof storedSeq === "string" ? BigInt(storedSeq) : -1n;
      const incoming = BigInt(e.server_seq);
      if (incoming < currentSeq) {
        outcome.skippedOlder++;
      } else if (incoming === currentSeq) {
        if (JSON.stringify(current?.value.payload) !== JSON.stringify(e.payload)) {
          outcome.anomalies.push(`${e.entity}:${e.id}@${e.server_seq}`);
        }
      } else {
        await tx.putProjection({
          key,
          value: {
            entity: e.entity,
            id: e.id,
            schema_version: e.schema_version,
            payload: e.payload,
            server_seq: e.server_seq,
            operation_id: e.operation_id,
            deleted: false,
          },
        });
        outcome.applied++;
      }
      const list = receiptsByOp.get(e.operation_id) ?? [];
      list.push({ entity: e.entity, id: e.id, server_seq: e.server_seq });
      receiptsByOp.set(e.operation_id, list);
    }

    // 2) إسقاطات العمليات: تأكيد المحلي، أو staging حتى يكتمل الجزء المخوَّل
    for (const p of page.operation_projections) {
      const local = await tx.getOperation(p.operation_id);
      const received = new Map<string, MemberReceipt>();
      const stagedRaw = await tx.getMeta(stagingKey(p.operation_id));
      if (stagedRaw)
        for (const r of JSON.parse(stagedRaw) as MemberReceipt[])
          received.set(`${r.entity}|${r.id}`, r);
      for (const r of receiptsByOp.get(p.operation_id) ?? [])
        received.set(`${r.entity}|${r.id}`, r);
      const complete =
        p.authorized_complete && p.members.every((m) => received.has(`${m.entity}|${m.id}`));
      if (local && local.state !== "synced") {
        // الحدث الثابت المحلي لا يُستبدل؛ يُثبت قبوله إذا تطابقت العضوية المخوَّلة كاملة
        const sameMembership = p.members.every((m) =>
          local.members.some((lm) => lm.entity === m.entity && lm.id === m.id),
        );
        if (complete && sameMembership) {
          await tx.putMeta(stagingKey(p.operation_id), JSON.stringify([...received.values()]));
          outcome.confirmedLocal++;
        }
        continue;
      }
      if (complete) {
        await tx.putProjection({
          key: `operation:${p.operation_id}`,
          value: {
            kind: p.kind,
            op_version: p.op_version,
            members: p.members,
            members_hash: p.members_hash,
            complete: true,
          },
        });
        await tx.putMeta(stagingKey(p.operation_id), "");
        outcome.activatedProjections++;
      } else {
        await tx.putMeta(stagingKey(p.operation_id), JSON.stringify([...received.values()]));
        outcome.staged++;
      }
    }

    // 3) شواهد الحذف صريحة
    for (const t of page.tombstones) {
      const key = entityKey(t.entity, t.id);
      const current = await tx.getProjection(key);
      await tx.putProjection({
        key,
        value: {
          ...(current?.value ?? { entity: t.entity, id: t.id }),
          deleted: true,
          server_seq: t.server_seq,
        },
      });
      outcome.tombstoned++;
    }

    // 4) المؤشرات مطلقة ولا تتراجع
    for (const c of page.cursors) {
      await tx.advanceCursor({
        scope: c.scope,
        scopeId: c.scope_id ?? "",
        entityGroup: c.entity_group,
        serverSeq: c.server_seq,
      });
    }
    await tx.putMeta("access_manifest_version", page.access_manifest_version);
  });

  // 5) تأكيد العمليات المحلية التي اكتمل جزؤها المخوَّل — نفس انتقال ACK (§٨.٧)
  const confirmations: {
    operation_id: string;
    status: "duplicate";
    member_receipts: MemberReceipt[];
  }[] = [];
  for (const p of page.operation_projections) {
    const stagedRaw = await storage.read((tx) => tx.getMeta(stagingKey(p.operation_id)));
    const local = await storage.read((tx) => tx.getOperation(p.operation_id));
    if (local && local.state !== "synced" && stagedRaw) {
      confirmations.push({
        operation_id: p.operation_id,
        status: "duplicate",
        member_receipts: JSON.parse(stagedRaw) as MemberReceipt[],
      });
    }
  }
  if (confirmations.length) await applyResults(storage, confirmations);

  // 6) المرشحات
  for (const c of page.snapshot_candidates) {
    if ((await recordCandidate(storage, c, currentEpoch)) === "recorded") outcome.candidates++;
  }
  return outcome;
}
