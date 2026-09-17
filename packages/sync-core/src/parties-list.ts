/**
 * قوائم الأطراف (PTY-01/02؛ §٧.٦، ACC-02): الأسماء من الإسقاط المحلي فوراً، والأرصدة من آخر مطابقة
 * خادمية مركَّبةً مع ما لم يُغطَّ من هذا الجهاز («خادمي X + معلّق على جهازك Y = Z»). الخادمي يُخزَّن
 * إسقاطاً بوقت تغطيته ليبقى صادقاً بلا اتصال.
 */
import type { StoragePort } from "@sting/platform";

import { type LocalParty, PARTY_PREFIX } from "./parties-local";
import { type LocalSale, SALE_PREFIX } from "./sale-local";

export const PARTIES_MATCH_META = "parties.matched_at";

/** صف كما يعيده `GET /api/parties/list` — يُكتب إسقاطاً كما هو. */
export type ServerParty = Omit<LocalParty, "operation_id"> & {
  readonly aliases?: readonly string[] | undefined;
  readonly balance_as_of?: string | undefined;
  readonly last_movement_at?: string | undefined;
  readonly supplier_owed_minor?: string | undefined;
  readonly market_linked?: boolean | undefined;
};

/** يخزّن صفوف الخادم إسقاطات (بوقت تغطيتها) ووقت المطابقة — الأسماء والأرصدة معاً. */
export async function storeParties(
  storage: StoragePort,
  rows: readonly ServerParty[],
  asOf: string,
): Promise<void> {
  await storage.transaction(async (tx) => {
    for (const r of rows) {
      const { id, ...rest } = r;
      const existing = await tx.getProjection(PARTY_PREFIX + id);
      const prev = existing?.value ?? {};
      await tx.putProjection({ key: PARTY_PREFIX + id, value: { ...prev, ...rest, id } });
    }
    await tx.putMeta(PARTIES_MATCH_META, asOf);
  });
}

export async function readPartiesMatchedAt(storage: StoragePort): Promise<string | null> {
  return (await storage.read((tx) => tx.getMeta(PARTIES_MATCH_META))) ?? null;
}

/** المعلّق على هذا الجهاز لكل طرف: آجل البيع بعد وقت تغطية رصيده الخادمي أو غير المؤكَّد (ACC-02). */
export async function readPendingCreditByParty(
  storage: StoragePort,
): Promise<Map<string, { readonly pendingMinor: bigint; readonly count: number }>> {
  return storage.read(async (tx) => {
    const out = new Map<string, { pendingMinor: bigint; count: number }>();
    const sales = (await tx.listProjections(SALE_PREFIX))
      .map((r) => r.value as unknown as LocalSale)
      .filter((s) => s.party_id && BigInt(s.credit_minor) > 0n);
    const asOfByParty = new Map<string, string>();
    for (const s of sales) {
      if (asOfByParty.has(s.party_id)) continue;
      const row = await tx.getProjection(PARTY_PREFIX + s.party_id);
      asOfByParty.set(
        s.party_id,
        (row?.value as { balance_as_of?: string } | undefined)?.balance_as_of ?? "",
      );
    }
    for (const s of sales) {
      const op = await tx.getOperation(s.operation_id);
      const asOf = asOfByParty.get(s.party_id) ?? "";
      const covered = op?.state === "synced" && (!asOf || s.occurred_at <= asOf);
      if (covered) continue;
      const cur = out.get(s.party_id) ?? { pendingMinor: 0n, count: 0 };
      out.set(s.party_id, {
        pendingMinor: cur.pendingMinor + BigInt(s.credit_minor),
        count: cur.count + 1,
      });
    }
    return out;
  });
}
