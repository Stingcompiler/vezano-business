/**
 * الحفظ المحلي (§٨.٢): في معاملة واحدة تُحفظ العملية وأعضاؤها وحالة الرفع ورقم الإنشاء
 * المحلي، وتُحدَّث الإسقاطات عبر `projector` إن وُجد. لا نجاح قبل اكتمال المعاملة (§٣.٢).
 */

import type { StoragePort, StorageTransaction, StoredOperation } from "@sting/platform";

import { markAfterCandidate } from "./snapshots";
import { attemptsKey } from "./sync-log";
import type { OperationDraft } from "./types";

export interface SaveOutcome {
  readonly operation: StoredOperation;
  /** true إن كانت الهوية محفوظة من قبل — إعادة ضغط لنفس الحفظ (§٨.٢). */
  readonly alreadySaved: boolean;
}

export type Projector = (tx: StorageTransaction, op: StoredOperation) => Promise<void>;

export async function saveOperation(
  storage: StoragePort,
  draft: OperationDraft,
  projector?: Projector,
): Promise<SaveOutcome> {
  return storage.transaction(async (tx) => {
    const existing = await tx.getOperation(draft.operationId);
    if (existing) return { operation: existing, alreadySaved: true };
    const seq = await tx.nextLocalSeq();
    const op: StoredOperation = {
      operationId: draft.operationId,
      kind: draft.kind,
      opVersion: draft.opVersion,
      dependencies: [...draft.dependencies],
      members: draft.members.map((m) => ({
        entity: m.entity,
        id: m.id,
        schemaVersion: m.schemaVersion,
        payload: m.payload,
        serverSeq: null,
      })),
      state: "local",
      createdLocalSeq: seq,
      snapshotRelation: "none",
    };
    await tx.putOperation(op);
    // عملية تُنشأ بعد وصول مرشح لا يمكن أن تكون ضمنه (§٨.٩ بند ٣)
    await markAfterCandidate(tx, op.operationId);
    // خطّ العملية الزمني (SYS-02): «حُفظت محلياً» بوقتها — على المعاملة مباشرةً (Dexie)
    await tx.putMeta(
      attemptsKey(op.operationId),
      JSON.stringify([{ at: new Date().toISOString(), event: "saved" }]),
    );
    if (projector) await projector(tx, op);
    return { operation: op, alreadySaved: false };
  });
}
