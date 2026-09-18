import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import { readPendingStockMovements } from "./inventory-local";
import { readLocalBalances } from "./pos-local";
import {
  readLocalTransfers,
  saveTransferLocally,
  transferDraft,
  type TransferInput,
} from "./transfer-local";

const input = (over: Partial<TransferInput> = {}): TransferInput => ({
  operationId: "op-trf-1",
  transferId: "trf-1",
  branchFromId: "b1",
  branchFromName: "المخزن الرئيسي",
  branchToId: "b2",
  branchToName: "فرع بحري",
  branchCode: "KRT",
  devicePrefix: "A2",
  deviceId: "d1",
  userId: "u1",
  userName: "عثمان",
  lines: [
    {
      lineId: "ln-1",
      movementId: "mv-1",
      itemId: "sugar",
      itemName: "سكر أبيض",
      unitCode: "bag",
      unitName: "كيس 1كغ",
      factorMilli: "1000",
      qtyMilli: "200000",
      availableMilli: "1834000",
    },
  ],
  sentAt: "2026-09-17T16:20:00Z",
  ...over,
});

it("الإرسال يخصم من المصدر محلياً ولا يضيف للمستقبِل؛ الرقم TRF؛ الحركة transfer_out معلّقة", async () => {
  const s = new DexieStorage({ databaseName: `trf-${Math.random()}` });
  await s.transaction((tx) =>
    tx.putProjection({
      key: "entity:inventory.Balance:sugar",
      value: { item_id: "sugar", qty_milli: "1834000", as_of: "2026-09-17T09:00:00Z" },
    }),
  );
  const { transfer, alreadySaved } = await saveTransferLocally(s, input());
  expect(alreadySaved).toBe(false);
  expect(transfer.transfer_number).toBe("TRF-KRT-A2-26-000001");
  expect(transfer.status).toBe("sent");
  expect(transfer.lines[0]!.base_qty_milli).toBe("200000");
  expect((await readLocalBalances(s)).get("sugar")?.qty_milli).toBe("1634000");
  const pending = await readPendingStockMovements(s);
  expect(pending.map((m) => [m.reason, m.deltaMilli.toString(), m.branchId])).toEqual([
    ["transfer_out", "-200000", "b1"],
  ]);
  expect((await saveTransferLocally(s, input())).alreadySaved).toBe(true);
  expect((await readLocalBalances(s)).get("sugar")?.qty_milli).toBe("1634000");
  expect((await readLocalTransfers(s)).map((t) => t.transfer_number)).toEqual([
    "TRF-KRT-A2-26-000001",
  ]);
});

it("لا نسمح بتحويل ما ليس موجوداً، ولا بين الفرع ونفسه", () => {
  expect(() =>
    transferDraft(
      input({ lines: [{ ...input().lines[0]!, qtyMilli: "60000", availableMilli: "42000" }] }),
      "x",
    ),
  ).toThrow("exceeds_available");
  expect(() => transferDraft(input({ branchToId: "b1" }), "x")).toThrow("same_branch");
  expect(() => transferDraft(input({ lines: [] }), "x")).toThrow("lines_required");
});
