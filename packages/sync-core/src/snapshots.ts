/**
 * مرشح اللقطة وتفعيلها أثناء استمرار البيع (§٨.٩).
 *
 * 2. عند وصول المرشح يُسجَّل `local_frontier` (آخر رقم إنشاء محلي) داخل معاملة؛ كل عملية غير مؤكدة
 *    موجودة حينها تدخل مجموعة الفحص (`before_candidate`).
 * 3. ما يُنشأ بعده يُوسم `after_candidate` عند حفظه (لا يمكن أن يكون ضمن لقطة وُلدت قبله).
 * 4. اللقطة القديمة تبقى نشطة أثناء المصالحة.
 * 5. مجموعة الفحص تُعاد عبر PUSH: duplicate/accepted تحسم موضعها.
 * 6. التفعيل والتصنيف في معاملة واحدة.
 * 7. تعارض حساب واحد يجمّد ذلك الحساب وحده وتستمر البقية.
 * 8. لا تتراجع نقطة القطع داخل الجيل؛ مرشح أقدم يُلغى.
 */

import type { SnapshotRow, StoragePort, StorageTransaction } from "@sting/platform";

import type { EffectExtractor } from "./balance";

export const ACTIVE_SNAPSHOT_KEY = "active_snapshot";
export const FROZEN_ACCOUNTS_KEY = "frozen_accounts";

export interface SnapshotCandidateEnvelope {
  readonly sync_epoch: string;
  readonly snapshot_id: string;
  readonly cutoff_server_seq: string;
  readonly schema_version: number;
  readonly as_of: string;
  readonly balances: readonly Record<string, string>[];
}

export type RecordOutcome = "recorded" | "already_known" | "discarded_older" | "discarded_epoch";

async function activeSnapshot(tx: StorageTransaction): Promise<SnapshotRow | null> {
  const id = await tx.getMeta(ACTIVE_SNAPSHOT_KEY);
  return id ? tx.getSnapshot(id) : null;
}

/** يسجل مرشحاً وارداً مع حدّ الاستقبال المحلي؛ الأقدم من النشط أو من جيل آخر يُلغى (بند ٨). */
export async function recordCandidate(
  storage: StoragePort,
  envelope: SnapshotCandidateEnvelope,
  currentEpoch: string,
): Promise<RecordOutcome> {
  return storage.transaction(async (tx) => {
    if (envelope.sync_epoch !== currentEpoch) return "discarded_epoch";
    if (await tx.getSnapshot(envelope.snapshot_id)) return "already_known";
    const active = await activeSnapshot(tx);
    if (active && BigInt(envelope.cutoff_server_seq) < BigInt(active.cutoffServerSeq))
      return "discarded_older";
    const frontier = await tx.currentLocalSeq();
    await tx.putSnapshot({
      snapshotId: envelope.snapshot_id,
      syncEpoch: envelope.sync_epoch,
      cutoffServerSeq: envelope.cutoff_server_seq,
      state: "candidate",
      balances: envelope.balances,
      localFrontier: frontier,
    });
    // مجموعة الفحص: كل غير مؤكد موجود الآن
    for (const state of ["local", "pending"] as const) {
      for (const op of await tx.listOperationsByState(state)) {
        if (op.snapshotRelation === "none")
          await tx.putOperation({ ...op, snapshotRelation: "before_candidate" });
      }
    }
    return "recorded";
  });
}

/** يُستدعى من مسار الحفظ بعد وجود مرشح: العملية الجديدة خارج المرشح بالضرورة (بند ٣). */
export async function markAfterCandidate(
  tx: StorageTransaction,
  operationId: string,
): Promise<void> {
  const candidates = (await tx.listSnapshots()).filter((s) => s.state === "candidate");
  if (candidates.length === 0) return;
  const op = await tx.getOperation(operationId);
  if (op && op.snapshotRelation === "none")
    await tx.putOperation({ ...op, snapshotRelation: "after_candidate" });
}

export interface ActivationOutcome {
  readonly activated: boolean;
  /** عمليات غامضة ما زالت غير محسومة — تُعاد عبر PUSH أولاً (بند ٥) */
  readonly unresolved: readonly string[];
  /** حسابات جُمّدت لتعارض فيها؛ البقية فُعّلت (بند ٧) */
  readonly frozenAccounts: readonly string[];
}

/** يفعّل المرشح إن حُسمت مجموعة فحصه؛ الحساب المتعارض يُجمّد وحده. كله في معاملة واحدة (بند ٦). */
export async function activateCandidate(
  storage: StoragePort,
  snapshotId: string,
  extract: EffectExtractor,
): Promise<ActivationOutcome> {
  return storage.transaction(async (tx) => {
    const candidate = await tx.getSnapshot(snapshotId);
    if (!candidate || candidate.state !== "candidate")
      return { activated: false, unresolved: [], frozenAccounts: [] };
    const unresolved: string[] = [];
    for (const state of ["local", "pending"] as const) {
      for (const op of await tx.listOperationsByState(state)) {
        if (op.snapshotRelation === "before_candidate") unresolved.push(op.operationId);
      }
    }
    if (unresolved.length > 0) return { activated: false, unresolved, frozenAccounts: [] };

    const frozen = new Set<string>();
    for (const state of ["conflict", "quarantined"] as const) {
      for (const op of await tx.listOperationsByState(state)) {
        for (const e of extract(op)) frozen.add(e.accountKey);
      }
    }
    const previous = await activeSnapshot(tx);
    if (previous && previous.snapshotId !== snapshotId)
      await tx.putSnapshot({ ...previous, state: "discarded" });
    await tx.putSnapshot({ ...candidate, state: "active" });
    await tx.putMeta(ACTIVE_SNAPSHOT_KEY, snapshotId);
    await tx.putMeta(FROZEN_ACCOUNTS_KEY, JSON.stringify([...frozen].sort()));
    // بعد التفعيل تعود علاقة العمليات المؤكدة إلى none؛ تصنيفها يُحسب من رقمها مقابل القطع الجديد
    for (const op of await tx.listOperationsByState("synced")) {
      if (op.snapshotRelation !== "none")
        await tx.putOperation({ ...op, snapshotRelation: "none" });
    }
    return { activated: true, unresolved: [], frozenAccounts: [...frozen].sort() };
  });
}

export async function frozenAccounts(storage: StoragePort): Promise<string[]> {
  const raw = await storage.read((tx) => tx.getMeta(FROZEN_ACCOUNTS_KEY));
  return raw ? (JSON.parse(raw) as string[]) : [];
}
