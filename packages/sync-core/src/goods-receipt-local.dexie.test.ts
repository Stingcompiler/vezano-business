import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import {
  baseQtyMilli,
  type GoodsReceiptInput,
  goodsReceiptDraft,
  readGoodsReceipts,
  saveGoodsReceiptLocally,
} from "./goods-receipt-local";
import { readPendingStockMovements } from "./inventory-local";
import { readLocalBalances } from "./pos-local";

const input = (over: Partial<GoodsReceiptInput> = {}): GoodsReceiptInput => ({
  operationId: "op-rcv-1",
  receiptId: "rcv-1",
  branchId: "b1",
  branchCode: "KRT",
  devicePrefix: "A2",
  deviceId: "d1",
  userId: "u1",
  userName: "هبة",
  supplierName: "مخزن البركة للجملة",
  reference: "فاتورة المورد 8841",
  lines: [
    {
      lineId: "ln-1",
      movementId: "mv-1",
      itemId: "sugar",
      itemName: "سكر أبيض",
      unitCode: "carton",
      unitName: "كرتونة 12×1كغ",
      factorMilli: "12000",
      qtyMilli: "40000",
    },
  ],
  businessDate: "2026-09-17",
  occurredAt: "2026-09-17T10:05:00Z",
  ...over,
});

it("40 كرتونة × 12 = 480 كيس: الرصيد المحلي يتحدّث فوراً ولو لم يكن معروفاً؛ الرقم RCV؛ التكلفة اختيارية", async () => {
  const s = new DexieStorage({ databaseName: `rcv-${Math.random()}` });
  expect(baseQtyMilli("40000", "12000")).toBe(480000n);
  const { receipt, alreadySaved } = await saveGoodsReceiptLocally(s, input());
  expect(alreadySaved).toBe(false);
  expect(receipt.receipt_number).toBe("RCV-KRT-A2-26-000001");
  expect(receipt.lines[0]!.base_qty_milli).toBe("480000");
  expect(receipt.lines[0]!.unit_cost_minor).toBe("");
  const balances = await readLocalBalances(s);
  expect(balances.get("sugar")?.qty_milli).toBe("480000");
  const pending = await readPendingStockMovements(s);
  expect(pending.map((m) => [m.reason, m.deltaMilli.toString(), m.sourceEntity])).toEqual([
    ["receive", "480000", "inventory.GoodsReceipt"],
  ]);
  // إعادة الضغط لا تنشئ هوية جديدة ولا تحرّك الرصيد مرتين
  const again = await saveGoodsReceiptLocally(s, input());
  expect(again.alreadySaved).toBe(true);
  expect((await readLocalBalances(s)).get("sugar")?.qty_milli).toBe("480000");
  expect((await readGoodsReceipts(s)).map((r) => r.receipt_number)).toEqual([
    "RCV-KRT-A2-26-000001",
  ]);
});

it("المورد والمرجع والكمية مطلوبة، والوحدة بلا معامل تُرفض — لا تخمين", () => {
  expect(() => goodsReceiptDraft(input({ supplierName: " " }), "x")).toThrow("supplier_required");
  expect(() => goodsReceiptDraft(input({ reference: "" }), "x")).toThrow("reference_required");
  expect(() =>
    goodsReceiptDraft(input({ lines: [{ ...input().lines[0]!, qtyMilli: "0" }] }), "x"),
  ).toThrow("qty_required");
  expect(() =>
    goodsReceiptDraft(input({ lines: [{ ...input().lines[0]!, factorMilli: "0" }] }), "x"),
  ).toThrow("unit_factor_undefined");
});
