/**
 * التقليم الآمن (§٨.١١) — لا يُقلَّم حدث إلا إذا اجتمعت الشروط:
 * 1. تأكيد مطابق في الجيل الحالي.
 * 2. تغطيته بلقطة كل إسقاط يحتاج أثره (ذمة، مخزون، صندوق): رقمه ≤ قطع كل لقطة معنية.
 * 3. لا اعتماد عملية معلقة أو حجر أو إسقاط غير مكتمل عليه.
 * 4. خروجه من نافذة العرض (90 يوماً هدف أولي).
 * سقف الصفوف عتبة قياس وتنبيه، لا أمر حذف.
 */

import type { StoredOperation } from "@sting/platform";

export type ProjectionName = "ledger" | "stock" | "cash";

export interface PruneContext {
  readonly currentEpoch: string;
  /** جيل العملية كما سُجّل عند تأكيدها */
  readonly operationEpoch: string;
  /** قطع اللقطة النشطة لكل إسقاط يحتاج أثر هذه العملية؛ غياب إسقاط مطلوب = غير مغطى */
  readonly coverage: Readonly<Partial<Record<ProjectionName, string>>>;
  readonly requiredProjections: readonly ProjectionName[];
  /** هل يعتمد عليها معلّق/محجور/إسقاط ناقص */
  readonly hasDependents: boolean;
  /** خارج نافذة العرض المطلوبة */
  readonly outsideDisplayWindow: boolean;
}

export type PruneVerdict =
  | { readonly prune: true }
  | {
      readonly prune: false;
      readonly reason:
        "unconfirmed" | "stale_epoch" | "uncovered" | "has_dependents" | "in_display_window";
    };

export function pruneVerdict(op: StoredOperation, ctx: PruneContext): PruneVerdict {
  if (op.state !== "synced") return { prune: false, reason: "unconfirmed" };
  if (ctx.operationEpoch !== ctx.currentEpoch) return { prune: false, reason: "stale_epoch" };
  const seqs = op.members.map((m) => m.serverSeq).filter((s): s is string => s !== null);
  if (seqs.length !== op.members.length) return { prune: false, reason: "unconfirmed" };
  const maxSeq = seqs.reduce((a, s) => (BigInt(s) > a ? BigInt(s) : a), 0n);
  for (const projection of ctx.requiredProjections) {
    const cutoff = ctx.coverage[projection];
    if (cutoff === undefined || BigInt(cutoff) < maxSeq)
      return { prune: false, reason: "uncovered" };
  }
  if (ctx.hasDependents) return { prune: false, reason: "has_dependents" };
  if (!ctx.outsideDisplayWindow) return { prune: false, reason: "in_display_window" };
  return { prune: true };
}
