/**
 * طابور الرفع وتطبيق ACK (§٨.٣ من جهة الجهاز).
 *
 * - يلتقط العمليات `local` بترتيب الإنشاء المحلي، ويرفق كل أب غير مؤكد موجود محلياً في النقل
 *   نفسه (بند ٦)، ويرسل غلافاً واحداً.
 * - يطبّق النتائج في **معاملة تخزين واحدة**: accepted/duplicate → synced بأرقام الأعضاء؛
 *   conflicted → conflict (يُحفظ الأصل)؛ rejected → quarantined؛ pending_dependency → يبقى local.
 * - العابر (شبكة/مهلة/429/5xx) لا يغيّر شيئاً ويعود بموعد المحاولة التالية بتراجع أُسّي.
 * - الدائم (4xx تحقق) يُحجر ولا يسدّ الطابور؛ المصادقة والجيل يوقفان الرفع ويعيدان إشارة.
 */

import type { StoragePort, StoredOperation } from "@sting/platform";

import { DEFAULT_RETRY, type RetryPolicy, retryDelayMs } from "./retry";
import {
  PROTOCOL_VERSION,
  type OperationResult,
  type PushEnvelope,
  type PushTransport,
  type TransportFailure,
} from "./types";

export interface PushOnceOptions {
  readonly transport: PushTransport;
  readonly syncEpoch: string;
  readonly requestId: string;
  readonly maxOperations?: number;
  readonly retry?: RetryPolicy;
  readonly random?: () => number;
}

export type PushOnceOutcome =
  | { readonly kind: "idle" }
  | {
      readonly kind: "applied";
      readonly synced: number;
      readonly conflicted: number;
      readonly quarantined: number;
      readonly waiting: number;
    }
  | {
      readonly kind: "retry";
      readonly failure: Extract<TransportFailure, { kind: "transient" }>;
      readonly delayMs: number;
    }
  | { readonly kind: "halt"; readonly failure: Exclude<TransportFailure, { kind: "transient" }> };

const ATTEMPTS_KEY = "push_attempts";

async function collectBatch(storage: StoragePort, max: number): Promise<StoredOperation[]> {
  return storage.read(async (tx) => {
    const local = await tx.listOperationsByState("local");
    const chosen = new Map<string, StoredOperation>();
    for (const op of local.slice(0, max)) chosen.set(op.operationId, op);
    // بند ٦: أب غير مؤكد يُرفق كاملاً في النقل نفسه
    const queue = [...chosen.values()];
    while (queue.length) {
      const op = queue.pop()!;
      for (const dep of op.dependencies) {
        if (chosen.has(dep)) continue;
        const parent = await tx.getOperation(dep);
        if (parent && parent.state !== "synced") {
          chosen.set(parent.operationId, parent);
          queue.push(parent);
        }
      }
    }
    return [...chosen.values()].sort((a, b) => a.createdLocalSeq - b.createdLocalSeq);
  });
}

function toEnvelope(
  ops: readonly StoredOperation[],
  epoch: string,
  requestId: string,
): PushEnvelope {
  return {
    protocol_version: PROTOCOL_VERSION,
    sync_epoch: epoch,
    request_id: requestId,
    operations: ops.map((op) => ({
      operation_id: op.operationId,
      kind: op.kind,
      op_version: op.opVersion,
      dependencies: op.dependencies,
      members: op.members.map((m) => ({
        entity: m.entity,
        id: m.id,
        schema_version: m.schemaVersion,
        payload: m.payload,
      })),
    })),
  };
}

/** يطبّق نتائج النقل على العمليات المحلية ذرياً؛ يُصدَّر لاستعماله من مسار PULL أيضاً (§٨.٧: ACK وPULL نفس الانتقال). */
export async function applyResults(
  storage: StoragePort,
  results: readonly OperationResult[],
): Promise<{ synced: number; conflicted: number; quarantined: number; waiting: number }> {
  return storage.transaction(async (tx) => {
    const counts = { synced: 0, conflicted: 0, quarantined: 0, waiting: 0 };
    for (const r of results) {
      const op = await tx.getOperation(r.operation_id);
      if (!op || op.state === "synced") continue; // الحدث الواحد لا يحسب مرتين (§٨.٨)
      switch (r.status) {
        case "accepted":
        case "duplicate": {
          const seqs = new Map(
            (r.member_receipts ?? []).map((m) => [`${m.entity}|${m.id}`, m.server_seq]),
          );
          await tx.putOperation({
            ...op,
            state: "synced",
            members: op.members.map((m) => ({
              ...m,
              serverSeq: seqs.get(`${m.entity}|${m.id}`) ?? m.serverSeq,
            })),
          });
          counts.synced++;
          break;
        }
        case "conflicted":
          await tx.putOperation({ ...op, state: "conflict" });
          counts.conflicted++;
          break;
        case "rejected":
          await tx.putOperation({ ...op, state: "quarantined" });
          await tx.putMeta(
            `quarantine:${op.operationId}`,
            JSON.stringify({ code: r.code ?? "", detail: r.detail ?? "" }),
          );
          counts.quarantined++;
          break;
        case "pending_dependency":
          counts.waiting++;
          break;
      }
    }
    return counts;
  });
}

export async function pushOnce(
  storage: StoragePort,
  options: PushOnceOptions,
): Promise<PushOnceOutcome> {
  const batch = await collectBatch(storage, options.maxOperations ?? 50);
  if (batch.length === 0) return { kind: "idle" };
  await storage.transaction(async (tx) => {
    for (const op of batch)
      if (op.state === "local") await tx.putOperation({ ...op, state: "pending" });
  });
  const outcome = await options.transport.push(
    toEnvelope(batch, options.syncEpoch, options.requestId),
  );
  if (!outcome.ok) {
    // إعادة الحالة إلى local: النقل لم يُطبَّق
    await storage.transaction(async (tx) => {
      for (const op of batch) {
        const current = await tx.getOperation(op.operationId);
        if (current?.state === "pending") await tx.putOperation({ ...current, state: "local" });
      }
    });
    if (outcome.kind === "transient") {
      const attempts = await storage.transaction(async (tx) => {
        const n = Number((await tx.getMeta(ATTEMPTS_KEY)) ?? "0") + 1;
        await tx.putMeta(ATTEMPTS_KEY, String(n));
        return n;
      });
      return {
        kind: "retry",
        failure: outcome,
        delayMs: retryDelayMs(attempts, options.retry ?? DEFAULT_RETRY, options.random),
      };
    }
    return { kind: "halt", failure: outcome };
  }
  await storage.transaction((tx) => tx.putMeta(ATTEMPTS_KEY, "0"));
  const counts = await applyResults(storage, outcome.response.results);
  // ما لم يرد له نتيجة (لا يحدث في العقد) يعود local
  await storage.transaction(async (tx) => {
    const answered = new Set(outcome.response.results.map((r) => r.operation_id));
    for (const op of batch) {
      const current = await tx.getOperation(op.operationId);
      if (current?.state === "pending" && !answered.has(op.operationId))
        await tx.putOperation({ ...current, state: "local" });
      else if (current?.state === "pending") await tx.putOperation({ ...current, state: "local" });
    }
  });
  return { kind: "applied", ...counts };
}
