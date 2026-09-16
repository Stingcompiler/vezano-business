/**
 * معادلة الرصيد المعتمدة (§٨.٨) — لكل مفتاح K=(party, role, currency) وفي جيل واحد:
 *
 *   balance(K) = snapshot_balance(K, S)                       ①
 *              + Σ confirmed_effects(K) where server_seq > S   ②
 *              + Σ unconfirmed_effects(K) proven outside snapshot ③
 *
 * | الأثر                                   | موضعه الوحيد |
 * | مؤكد ومطابق ورقمه ≤ S                    | ① (لا يُحسب هنا) |
 * | مؤكد ومطابق ورقمه > S                    | ② |
 * | غير مؤكد وثبت أنه خارج اللقطة            | ③ |
 * | غامض أو متعارض                           | يُحفظ للمصالحة؛ لا يقدَّم كرصيد موثوق |
 *
 * «ثبت أنه خارج اللقطة»: رقم إنشائه المحلي > local_frontier المسجل عند استقبال المرشح (§٨.٩ بند ٢–٣)،
 * أو لم يكن هناك مرشح أصلاً. لا اعتماد على ساعة الجهاز ولا على birth_snapshot_id وحده.
 *
 * ③ يجمع قيود الحساب بهوياتها لا رأس العملية: بيع 100 منه 60 آجلاً يضيف 60 (§٨.٨).
 */

import type { LocalOpState, SnapshotRow, StoredOperation } from "@sting/platform";

export type Direction = "debit" | "credit";

export interface AccountEffect {
  /** "party|role|currency" */
  readonly accountKey: string;
  /** هوية القيد — الحدث الواحد لا يُحسب مرتين لو وصل عبر PULL ثم ACK أو العكس */
  readonly entryId: string;
  readonly direction: Direction;
  /** سلسلة قانونية بالوحدة الصغرى، > 0 */
  readonly amountMinor: string;
}

/** يستخرج آثار الحساب من عملية محفوظة — يُحقن بحسب الأنواع (sales/parties في المرحلة ١). */
export type EffectExtractor = (op: StoredOperation) => readonly AccountEffect[];

export type EffectBucket =
  "snapshot" | "confirmed_delta" | "local_delta" | "reconciling" | "conflict";

export interface ClassifiedEffect extends AccountEffect {
  readonly operationId: string;
  readonly bucket: EffectBucket;
}

export interface AccountBalance {
  readonly accountKey: string;
  /** ① + ② — «خادمي» */
  readonly serverMinor: bigint;
  /** ③ — «معلّق هذا الجهاز» */
  readonly localPendingMinor: bigint;
  /** ① + ② + ③ */
  readonly totalMinor: bigint;
  /** وجود أثر غامض أو متعارض: الرقم غير موثوق حتى المصالحة (§٨.٩ بند ٧) */
  readonly trusted: boolean;
  readonly effects: readonly ClassifiedEffect[];
}

export interface ActiveSnapshot {
  readonly row: SnapshotRow;
  readonly balances: ReadonlyMap<string, bigint>;
}

export const accountKey = (partyId: string, role: string, currency: string): string =>
  `${partyId}|${role}|${currency}`;

export function snapshotFromRow(row: SnapshotRow): ActiveSnapshot {
  const balances = new Map<string, bigint>();
  for (const b of row.balances) {
    const key = accountKey(b.party_id ?? "", b.account_role ?? "", b.currency ?? "");
    balances.set(key, BigInt(b.amount_minor ?? "0"));
  }
  return { row, balances };
}

const signed = (e: AccountEffect): bigint =>
  e.direction === "debit" ? BigInt(e.amountMinor) : -BigInt(e.amountMinor);

function classify(op: StoredOperation, snapshot: ActiveSnapshot | null): EffectBucket {
  const state: LocalOpState = op.state;
  if (state === "conflict" || state === "quarantined") return "conflict";
  const cutoff = snapshot ? BigInt(snapshot.row.cutoffServerSeq) : -1n;
  if (state === "synced") {
    const seq = op.members.find((m) => m.serverSeq !== null)?.serverSeq;
    if (seq === undefined || seq === null) return "reconciling";
    return BigInt(seq) > cutoff ? "confirmed_delta" : "snapshot";
  }
  // local | pending — غير مؤكد
  if (snapshot === null) return "local_delta";
  if (op.snapshotRelation === "after_candidate") return "local_delta";
  if (op.createdLocalSeq > snapshot.row.localFrontier) return "local_delta";
  // موجود وقت وصول المرشح وعلاقته به غير محسومة → مجموعة الفحص (§٨.٩ بند ٢)
  return "reconciling";
}

/** يحسب رصيد حساب واحد من العمليات المحلية واللقطة النشطة. */
export function computeBalance(
  key: string,
  snapshot: ActiveSnapshot | null,
  operations: readonly StoredOperation[],
  extract: EffectExtractor,
): AccountBalance {
  const seen = new Set<string>();
  const effects: ClassifiedEffect[] = [];
  let confirmed = 0n;
  let local = 0n;
  let trusted = true;
  for (const op of operations) {
    const bucket = classify(op, snapshot);
    for (const e of extract(op)) {
      if (e.accountKey !== key || seen.has(e.entryId)) continue;
      seen.add(e.entryId);
      effects.push({ ...e, operationId: op.operationId, bucket });
      switch (bucket) {
        case "confirmed_delta":
          confirmed += signed(e);
          break;
        case "local_delta":
          local += signed(e);
          break;
        case "reconciling":
        case "conflict":
          trusted = false;
          break;
        case "snapshot":
          break;
      }
    }
  }
  const base = snapshot?.balances.get(key) ?? 0n;
  const server = base + confirmed;
  return {
    accountKey: key,
    serverMinor: server,
    localPendingMinor: local,
    totalMinor: server + local,
    trusted,
    effects,
  };
}
