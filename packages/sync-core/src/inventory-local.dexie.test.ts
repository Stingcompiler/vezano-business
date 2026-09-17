import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import {
  pendingByItem,
  readPendingStockMovements,
  readStockCache,
  storeStockCache,
} from "./inventory-local";

const op = (
  id: string,
  state: "pending" | "synced" | "local",
  items: [string, string][],
  seq: number,
) => ({
  operationId: id,
  kind: "sale",
  opVersion: 1,
  dependencies: [],
  members: items.map(([itemId, delta], i) => ({
    entity: "inventory.StockMovement",
    id: `${id}-m${i}`,
    schemaVersion: 1,
    payload: {
      movement_id: `${id}-m${i}`,
      branch_id: "b1",
      item_id: itemId,
      delta_base_qty_milli: delta,
      reason: "sale",
      source_entity: "sales.Sale",
      source_id: `${id}-sale`,
      occurred_at: `2026-09-17T10:0${i}:00Z`,
    },
    serverSeq: null,
  })),
  state,
  createdLocalSeq: seq,
  snapshotRelation: "none" as const,
});

it("المعلّق من هذا الجهاز يُقرأ ويُجمَّع لكل صنف؛ المؤكَّد لا يُحسب (SYS-03)", async () => {
  const s = new DexieStorage({ databaseName: `inv-${Math.random()}` });
  await s.transaction(async (tx) => {
    await tx.putOperation(op("op-1", "pending", [["sugar", "-1000"]], 1));
    await tx.putOperation(
      op(
        "op-2",
        "local",
        [
          ["sugar", "-12000"],
          ["tea", "-2000"],
        ],
        2,
      ),
    );
    await tx.putOperation(op("op-3", "synced", [["sugar", "-5000"]], 3));
  });
  const pending = await readPendingStockMovements(s);
  expect(pending.map((m) => [m.itemId, m.deltaMilli.toString()])).toEqual([
    ["sugar", "-1000"],
    ["sugar", "-12000"],
    ["tea", "-2000"],
  ]);
  const byItem = pendingByItem(pending, "b1");
  expect(byItem.get("sugar")).toEqual({ deltaMilli: -13000n, count: 2 });
  expect(byItem.get("tea")).toEqual({ deltaMilli: -2000n, count: 1 });
  expect(pendingByItem(pending, "b9").size).toBe(0);
});

it("لقطة أرصدة الفرع تُخزَّن وتُقرأ بوقتها", async () => {
  const s = new DexieStorage({ databaseName: `inv-${Math.random()}` });
  expect(await readStockCache(s, "b1")).toBeNull();
  await storeStockCache(s, "b1", { as_of: "2026-09-17T10:30:00Z", rows: [] });
  expect(await readStockCache<{ as_of: string }>(s, "b1")).toEqual({
    as_of: "2026-09-17T10:30:00Z",
    rows: [],
  });
});
