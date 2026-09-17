import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import { type CartDraftLine, readLocalBalances, storeBalances } from "./pos-local";
import {
  readReturnCashRows,
  readReturnedQty,
  type ReturnInput,
  saveReturnLocally,
} from "./return-local";
import { saveSaleLocally, type SaleInput } from "./sale-local";
import { openShiftLocally, readShiftCash } from "./shift-local";

const sugar: CartDraftLine = {
  id: "l1",
  item_id: "i1",
  item_name: "سكر",
  unit_id: "u-kg",
  unit_code: "كغ",
  unit_name: "كيلوغرام",
  factor_milli: "1000",
  decimal_places: 3,
  qty_milli: "3000",
  unit_price_minor: "10000",
};

async function setup() {
  const s = new DexieStorage({ databaseName: `ret-${Math.random()}` });
  const { shift } = await openShiftLocally(s, {
    shiftId: "s1",
    operationId: "op-open",
    branchId: "b1",
    branchName: "الفرع الرئيسي",
    deviceId: "d1",
    deviceName: "كاشير 2",
    userId: "u1",
    userName: "سميرة ع.",
    openingFloatMinor: "184000",
    businessDate: "2026-09-16",
    occurredAt: "2026-09-16T08:00:00Z",
  });
  await storeBalances(s, "2026-09-16T09:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  const saleInput: SaleInput = {
    operationId: "op-sale-1",
    saleId: "sale-1",
    draft: { lines: [sugar], updated_at: "" },
    payments: [{ paymentId: "pay-1", method: "cash", amountMinor: "30000" }],
    shift,
    branchCode: "KRT",
    devicePrefix: "A2",
    deviceId: "d1",
    userId: "u1",
    userName: "سميرة ع.",
    businessDate: "2026-09-16",
    occurredAt: "2026-09-16T10:34:00Z",
    memberIds: { lines: ["ln-1"], movements: ["mv-1"] },
  };
  const { sale } = await saveSaleLocally(s, saleInput);
  return { s, shift, sale };
}

const retInput = (
  base: Awaited<ReturnType<typeof setup>>,
  over: Partial<ReturnInput> = {},
): ReturnInput => ({
  operationId: "op-ret-1",
  returnId: "ret-1",
  sale: base.sale,
  saleOperationId: base.sale.operation_id,
  lines: [{ saleLineId: "ln-1", qtyMilli: "2000" }],
  condition: "good",
  destination: "cash",
  shift: base.shift,
  branchCode: "KRT",
  devicePrefix: "A2",
  deviceId: "d1",
  userId: "u1",
  userName: "سميرة ع.",
  businessDate: "2026-09-16",
  occurredAt: "2026-09-16T11:00:00Z",
  memberIds: { lines: ["rl-1"], movements: ["rm-1"] },
  ...over,
});

/** مرتجع صالح جزئي نقداً تحت Dexie: مستند مستقل برقمه، المخزون +2، الصندوق −200، الأصل باقٍ (ACC-09). */
it("خط حفظ المرتجع: رقم RET-KRT-A2-26-000001، مخزون +2، الصندوق −200، والسقف التراكمي يُقرأ", async () => {
  const base = await setup();
  const { s } = base;
  expect((await readLocalBalances(s)).get("i1")?.qty_milli).toBe("7000");
  const { ret, alreadySaved } = await saveReturnLocally(s, retInput(base));
  expect(alreadySaved).toBe(false);
  expect(ret.return_number).toBe("RET-KRT-A2-26-000001");
  expect(ret.total_minor).toBe("20000");
  expect(ret.cash_minor).toBe("20000");
  expect(ret.credit_minor).toBe("0");
  const again = await saveReturnLocally(s, retInput(base));
  expect(again.alreadySaved).toBe(true);
  expect(again.ret.return_number).toBe("RET-KRT-A2-26-000001");
  const ops = await s.read((tx) => tx.listOperationsByState("local"));
  const op = ops.find((o) => o.kind === "sale_return")!;
  expect(op.members.map((m) => m.entity).sort()).toEqual([
    "inventory.StockMovement",
    "sales.SaleReturn",
    "sales.SaleReturnLine",
  ]);
  expect([...op.dependencies].sort()).toEqual(["op-open", "op-sale-1"]);
  expect(op.members.find((m) => m.entity === "inventory.StockMovement")!.payload).toMatchObject({
    delta_base_qty_milli: "2000",
    reason: "return",
    source_id: "ret-1",
  });
  // المخزون عاد بالمردود؛ الأصل لم يُمسّ
  expect((await readLocalBalances(s)).get("i1")?.qty_milli).toBe("9000");
  const sale = await s.read((tx) => tx.getProjection("entity:sales.Sale:sale-1"));
  expect((sale!.value as { total_minor: string }).total_minor).toBe("30000");
  // السقف التراكمي: رُدّ 2 من 3
  expect((await readReturnedQty(s, "sale-1")).get("ln-1")).toBe(2000n);
  // الصندوق: بيع +300 ومرتجع −200 لحظتها محلياً (SHIFT-02)
  const cash = await readShiftCash(s, base.shift, await readReturnCashRows(s, "s1"));
  const refund = cash.rows.find((r) => r.kind === "refund")!;
  expect(refund.inCashMinor).toBe("-20000");
  expect(refund.doc).toBe("RET-KRT-A2-26-000001");
});

/** تالف خصماً من الذمّة: الحجر لا المخزون الصالح (ACC-10)، ولا نقد؛ آجل بلا طرف مرفوض. */
it("المرتجع التالف يذهب إلى الحجر ولا يزيد المخزون الصالح؛ الخصم من الذمّة يحتاج طرفاً", async () => {
  const base = await setup();
  const { s } = base;
  await expect(
    saveReturnLocally(s, retInput(base, { condition: "damaged", destination: "credit" })),
  ).rejects.toThrow("party_required");
  const withParty = {
    ...base,
    sale: { ...base.sale, party_id: "p1", party_name: "أحمد الطيب" },
  };
  const { ret } = await saveReturnLocally(
    s,
    retInput(withParty, { condition: "damaged", destination: "credit" }),
  );
  expect(ret.cash_minor).toBe("0");
  expect(ret.credit_minor).toBe("20000");
  const ops = await s.read((tx) => tx.listOperationsByState("local"));
  const op = ops.find((o) => o.kind === "sale_return")!;
  expect(op.members.some((m) => m.entity === "inventory.StockMovement")).toBe(false);
  expect(
    op.members.find((m) => m.entity === "inventory.QuarantineMovement")!.payload,
  ).toMatchObject({ base_qty_milli: "2000", reason: "return_damaged" });
  expect((await readLocalBalances(s)).get("i1")?.qty_milli).toBe("7000");
});
