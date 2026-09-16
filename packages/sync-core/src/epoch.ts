/**
 * تبدّل جيل المزامنة (§٨.١٢): بعد استعادة الخادم يصل جيل جديد عبر استجابة مصادَق عليها.
 * يُحفظ المحتوى المحلي الأصلي، وتُعزل أرقام الجيل القديم (مؤشرات ولقطات)، ثم تُعاد التهيئة
 * والمصالحة؛ الأحداث المؤكدة سابقاً تُعاد بهوياتها الأصلية (الخادم يعيد duplicate لما يملكه).
 * الرد القديم بعد اعتماد الجيل الجديد يُهمل.
 */

import type { StoragePort } from "@sting/platform";

export const EPOCH_KEY = "sync_epoch";

export interface EpochChangeOutcome {
  readonly changed: boolean;
  readonly previousEpoch: string | null;
  readonly requeued: number;
}

export async function currentEpoch(storage: StoragePort): Promise<string | null> {
  return storage.read((tx) => tx.getMeta(EPOCH_KEY));
}

export async function adoptEpoch(
  storage: StoragePort,
  newEpoch: string,
): Promise<EpochChangeOutcome> {
  return storage.transaction(async (tx) => {
    const previous = await tx.getMeta(EPOCH_KEY);
    if (previous === newEpoch) return { changed: false, previousEpoch: previous, requeued: 0 };
    let requeued = 0;
    if (previous) {
      // عزل أرقام الجيل القديم: أرشفة المؤشرات واللقطات لا محوها
      const snapshots = await tx.listSnapshots();
      for (const s of snapshots)
        if (s.syncEpoch === previous && s.state !== "discarded")
          await tx.putSnapshot({ ...s, state: "discarded" });
      await tx.putMeta("active_snapshot", "");
      await tx.putMeta(
        `epoch_archive:${previous}`,
        JSON.stringify({ archivedAt: "epoch_change", snapshots: snapshots.length }),
      );
      // المؤكد سابقاً يعود للرفع بهويته الأصلية؛ أرقامه القديمة لا تُقدَّم كرصيد
      for (const op of await tx.listOperationsByState("synced")) {
        await tx.putOperation({
          ...op,
          state: "local",
          snapshotRelation: "none",
          members: op.members.map((m) => ({ ...m, serverSeq: null })),
        });
        requeued++;
      }
    }
    await tx.putMeta(EPOCH_KEY, newEpoch);
    return { changed: true, previousEpoch: previous, requeued };
  });
}

/** رد يحمل جيلاً غير المعتمد يُهمل (§٨.١٢، معيار §١٨ ACC-56). */
export function isStaleEpoch(responseEpoch: string, adopted: string | null): boolean {
  return adopted !== null && responseEpoch !== adopted;
}
