/**
 * المخزون محلياً (INV-01/INV-02): ما لم يُرفع من هذا الجهاز من حركات المخزون — يُفصل عن المؤكَّد
 * خادمياً برقمين لا برقم واحد (SYS-03)، ويدخل الأرصدة المعروضة بوسمه. لقطة الأرصدة الخادمية
 * تُخزَّن لكل فرع لتُعرض «قديمة» بوقتها حين تتعثّر المطابقة.
 */
import type { StoragePort } from "@sting/platform";

/** حركة مخزون معلّقة من هذا الجهاز (لم تُؤكَّد خادمياً). */
export interface PendingStockMovement {
  readonly movementId: string;
  readonly operationId: string;
  readonly kind: string;
  readonly itemId: string;
  readonly branchId: string;
  readonly deltaMilli: bigint;
  readonly reason: string;
  readonly sourceEntity: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly createdLocalSeq: number;
}

const PENDING_STATES = new Set(["local", "pending", "conflict"]);

/** كل حركات المخزون في عمليات لم تُؤكَّد بعد — مرتّبة بوقتها. */
export async function readPendingStockMovements(
  storage: StoragePort,
): Promise<PendingStockMovement[]> {
  const out: PendingStockMovement[] = [];
  await storage.read(async (tx) => {
    for (const state of PENDING_STATES) {
      const ops = await tx.listOperationsByState(state as "pending");
      for (const op of ops) {
        for (const m of op.members) {
          if (m.entity !== "inventory.StockMovement") continue;
          const p = m.payload;
          const str = (k: string, fallback = ""): string =>
            typeof p[k] === "string" ? p[k] : fallback;
          out.push({
            movementId: m.id,
            operationId: op.operationId,
            kind: op.kind,
            itemId: str("item_id"),
            branchId: str("branch_id"),
            deltaMilli: BigInt(str("delta_base_qty_milli", "0")),
            reason: str("reason"),
            sourceEntity: str("source_entity"),
            sourceId: str("source_id"),
            occurredAt: str("occurred_at"),
            createdLocalSeq: op.createdLocalSeq,
          });
        }
      }
    }
  });
  return out.sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdLocalSeq - b.createdLocalSeq,
  );
}

/** المعلّق مجمَّعاً لكل صنف: الأثر وعدد الحركات — لعرض «منه N من حركات لم تُرفع بعد». */
export function pendingByItem(
  movements: readonly PendingStockMovement[],
  branchId?: string,
): Map<string, { readonly deltaMilli: bigint; readonly count: number }> {
  const out = new Map<string, { deltaMilli: bigint; count: number }>();
  for (const m of movements) {
    if (branchId && m.branchId !== branchId) continue;
    const cur = out.get(m.itemId) ?? { deltaMilli: 0n, count: 0 };
    out.set(m.itemId, { deltaMilli: cur.deltaMilli + m.deltaMilli, count: cur.count + 1 });
  }
  return out;
}

const STOCK_CACHE_META = "inventory.stock_cache.";

/** لقطة أرصدة فرع كما وصلت من الخادم — بوقتها، لتُعرض «قديمة» حين تتعثّر المطابقة. */
export async function storeStockCache(
  storage: StoragePort,
  branchId: string,
  body: unknown,
): Promise<void> {
  await storage.transaction((tx) => tx.putMeta(STOCK_CACHE_META + branchId, JSON.stringify(body)));
}

export async function readStockCache<T>(storage: StoragePort, branchId: string): Promise<T | null> {
  const raw = await storage.read((tx) => tx.getMeta(STOCK_CACHE_META + branchId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
