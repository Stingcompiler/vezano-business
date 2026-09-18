import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import { readPendingStockMovements } from "./inventory-local";
import { readLocalBalances } from "./pos-local";
import { readLocalTransfers, saveTransferLocally } from "./transfer-local";
import {
  saveTransferReceiptLocally,
  type TransferReceiptInput,
  transferReceiptDraft,
} from "./transfer-receipt-local";

const input = (over: Partial<TransferReceiptInput> = {}): TransferReceiptInput => ({
  operationId: "op-trn-1",
  receiptId: "trn-1",
  transferId: "trf-1",
  branchId: "b2",
  branchCode: "BHR",
  devicePrefix: "B1",
  deviceId: "d2",
  userId: "u2",
  userName: "هبة",
  reason: "ثلاثة أكياس ممزقة رُفضت عند الاستلام",
  lines: [
    {
      lineId: "rl-1",
      movementId: "rm-1",
      transferLineId: "ln-1",
      itemId: "flour",
      sentBaseMilli: "10000",
      receivedBaseMilli: "7000",
    },
  ],
  receivedAt: "2026-09-17T10:00:00Z",
  ...over,
});

it("يدخل المستلم فعلاً رصيد الوجهة، والباقي يبقى على التحويل «استُلم جزئياً»؛ الرقم TRR؛ لا مضاعفة", async () => {
  const s = new DexieStorage({ databaseName: `trn-${Math.random()}` });
  // تحويل محلي (كما يصل الوجهة عبر PULL لاحقاً) — هنا مباشرة كإسقاط
  await saveTransferLocally(s, {
    operationId: "op-trf-1",
    transferId: "trf-1",
    branchFromId: "b1",
    branchFromName: "بحري",
    branchToId: "b2",
    branchToName: "الرئيسي",
    branchCode: "KRT",
    devicePrefix: "A2",
    deviceId: "d1",
    userId: "u1",
    userName: "عثمان",
    lines: [
      {
        lineId: "ln-1",
        movementId: "mv-1",
        itemId: "flour",
        itemName: "دقيق 5 كغ",
        unitCode: "sack",
        unitName: "كيس",
        factorMilli: "1000",
        qtyMilli: "10000",
        availableMilli: "50000",
      },
    ],
    sentAt: "2026-09-10T14:20:00Z",
  });
  const { receipt, alreadySaved } = await saveTransferReceiptLocally(s, input());
  expect(alreadySaved).toBe(false);
  expect(receipt.receipt_number).toBe("TRR-BHR-B1-26-000001");
  expect((await readLocalBalances(s)).get("flour")?.qty_milli).toBe("7000");
  const t = (await readLocalTransfers(s)).find((x) => x.id === "trf-1")!;
  expect(t.status).toBe("partially_received");
  expect(t.lines[0]!.received_base_milli).toBe("7000");
  const pending = await readPendingStockMovements(s);
  expect(
    pending.map((m) => [m.reason, m.deltaMilli.toString(), m.branchId, m.sourceEntity]),
  ).toEqual([
    ["transfer_out", "-10000", "b1", "inventory.StockTransfer"],
    ["transfer_in", "7000", "b2", "inventory.TransferReceipt"],
  ]);
  // إعادة الضغط بالمعرّف نفسه لا تضاعف
  expect((await saveTransferReceiptLocally(s, input())).alreadySaved).toBe(true);
  expect((await readLocalBalances(s)).get("flour")?.qty_milli).toBe("7000");
});

it("الفرق يحتاج سبباً مكتوباً؛ الاستلام الكامل لا يحتاجه", () => {
  expect(() => transferReceiptDraft(input({ reason: " " }), "x")).toThrow("reason_required");
  const full = input({ reason: "", lines: [{ ...input().lines[0]!, receivedBaseMilli: "10000" }] });
  expect(
    transferReceiptDraft(full, "x").members.filter((m) => m.entity === "inventory.StockMovement"),
  ).toHaveLength(1);
  const zero = input({ lines: [{ ...input().lines[0]!, receivedBaseMilli: "0" }] });
  expect(
    transferReceiptDraft(zero, "x").members.filter((m) => m.entity === "inventory.StockMovement"),
  ).toHaveLength(0);
});
