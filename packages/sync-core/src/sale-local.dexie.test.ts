import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import { readShiftCash, openShiftLocally } from "./shift-local";
import { type CartDraftLine, readCartDraft, storeBalances, writeCartDraft } from "./pos-local";
import {
  bankReferenceUsed,
  readPartyPendingCredit,
  readSaleCashRows,
  readSales,
  recordCreditOverride,
  saleDraft,
  saveSaleLocally,
  type SaleInput,
} from "./sale-local";

const sugar: CartDraftLine = {
  id: "l1",
  item_id: "i1",
  item_name: "سكر",
  unit_id: "u-kg",
  unit_code: "كغ",
  unit_name: "كيلوغرام",
  factor_milli: "1000",
  decimal_places: 3,
  qty_milli: "1000",
  unit_price_minor: "10000",
};
const carton: CartDraftLine = {
  ...sugar,
  id: "l2",
  unit_id: "u-ctn",
  unit_code: "كرتونة",
  unit_name: "كرتونة",
  factor_milli: "12000",
  decimal_places: 0,
  qty_milli: "2000",
  unit_price_minor: "120000",
};

async function openShift(s: DexieStorage) {
  return (
    await openShiftLocally(s, {
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
    })
  ).shift;
}

const input = (shift: SaleInput["shift"], draft: SaleInput["draft"]): SaleInput => ({
  operationId: "op-sale-1",
  saleId: "sale-1",
  draft,
  payments: [
    {
      paymentId: "pay-1",
      method: "cash",
      amountMinor: "10000",
      receivedMinor: "20000",
      changeMinor: "10000",
    },
  ],
  shift,
  branchCode: "KRT",
  devicePrefix: "A2",
  deviceId: "d1",
  userId: "u1",
  userName: "سميرة ع.",
  businessDate: "2026-09-16",
  occurredAt: "2026-09-16T10:34:00Z",
  memberIds: { lines: ["ln-1"], movements: ["mv-1"] },
});

/** بيع نقدي 100 لقطعة تحت Dexie: عملية واحدة بأعضائها ورقم فاتورة وإسقاط ورصيد وسلة فارغة (§٧.٢). */
it("خط حفظ البيع: معاملة واحدة، رقم INV-KRT-A2-26-000001، مخزون −1، صندوق +100، السلة تُفرَّغ", async () => {
  const s = new DexieStorage({ databaseName: `sale-${Math.random()}` });
  const shift = await openShift(s);
  await storeBalances(s, "2026-09-16T09:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  await writeCartDraft(s, { lines: [sugar] });
  const { sale, alreadySaved } = await saveSaleLocally(
    s,
    input(shift, { lines: [sugar], updated_at: "" }),
  );
  expect(alreadySaved).toBe(false);
  expect(sale.invoice_number).toBe("INV-KRT-A2-26-000001");
  expect(sale.total_minor).toBe("10000");
  expect(sale.cash_minor).toBe("10000");
  expect(sale.credit_minor).toBe("0");
  expect(sale.change_minor).toBe("10000");
  // إعادة الضغط بالمعرّف نفسه لا تنشئ هوية جديدة ولا رقماً ثانياً (§٨.٢)
  const again = await saveSaleLocally(s, input(shift, { lines: [sugar], updated_at: "" }));
  expect(again.alreadySaved).toBe(true);
  expect(again.sale.invoice_number).toBe("INV-KRT-A2-26-000001");
  // العملية بأعضائها الأربعة والرقم مثبَّت في الحدث نفسه
  const ops = await s.read((tx) => tx.listOperationsByState("local"));
  const op = ops.find((o) => o.kind === "sale")!;
  expect(op.members.map((m) => m.entity).sort()).toEqual([
    "inventory.StockMovement",
    "sales.Payment",
    "sales.Sale",
    "sales.SaleLine",
  ]);
  expect(op.members.find((m) => m.entity === "sales.Sale")!.payload["invoice_number"]).toBe(
    "INV-KRT-A2-26-000001",
  );
  expect(op.members.find((m) => m.entity === "inventory.StockMovement")!.payload).toMatchObject({
    delta_base_qty_milli: "-1000",
    reason: "sale",
  });
  expect(op.dependencies).toEqual(["op-open"]);
  // الرصيد المحلي تحرّك، والسلة فُرِّغت
  const bal = await s.read((tx) => tx.getProjection("entity:inventory.Balance:i1"));
  expect((bal!.value as { qty_milli: string }).qty_milli).toBe("9000");
  expect((await readCartDraft(s)).lines).toEqual([]);
  // النقد يدخل درج الوردية (SHIFT-02 عبر extraRows) — والمتوقَّع 1,840 + 100
  const cash = await readShiftCash(s, shift, await readSaleCashRows(s, "s1"));
  expect(cash.totals.cashSalesMinor).toBe(10000n);
  expect(cash.expectedCashMinor).toBe(184000n + 10000n);
  expect(cash.rows.find((r) => r.kind === "sale")?.doc).toBe("INV-KRT-A2-26-000001");
  expect((await readSales(s)).map((x) => x.id)).toEqual(["sale-1"]);
});

it("الخصم والآجل والكرتونة: الإجمالي بعد الخصم يساوي التسوية، والمخزون بالوحدة الأساسية ×12", () => {
  const shift = {
    id: "s1",
    number: "OPEN-0001",
    branch_id: "b1",
    branch_name: "",
    device_id: "d1",
    device_name: "",
    user_id: "u1",
    user_name: "",
    opening_float_minor: "0",
    business_date: "2026-09-16",
    opened_at: "",
    state: "open" as const,
    closed_at: "",
    operation_id: "op-open",
  };
  const draft = {
    lines: [sugar, carton], // 100 + 2 × 1,200 = 2,500
    discount: { mode: "percent" as const, value: "10", reason: "عميل دائم" }, // 250
    customer: { id: "p1", name: "أحمد" },
    updated_at: "",
  };
  const d = saleDraft(
    {
      ...input(shift, draft),
      payments: [
        { paymentId: "pay-1", method: "cash", amountMinor: "100000" },
        { paymentId: "pay-2", method: "credit", amountMinor: "125000" },
      ],
      memberIds: { lines: ["ln-1", "ln-2"], movements: ["mv-1", "mv-2"] },
    },
    "INV-X",
  );
  const head = d.members[0]!.payload;
  expect(head).toMatchObject({
    subtotal_minor: "250000",
    discount_minor: "25000",
    total_minor: "225000",
    party_id: "p1",
  });
  const moves = d.members.filter((m) => m.entity === "inventory.StockMovement");
  expect(moves.map((m) => m.payload["delta_base_qty_milli"])).toEqual(["-1000", "-24000"]);
  // آجل بلا طرف مرفوض قبل الحفظ؛ تسوية لا تساوي الإجمالي مرفوضة
  expect(() =>
    saleDraft(
      {
        ...input(shift, { ...draft, customer: undefined }),
        payments: [{ paymentId: "p", method: "credit", amountMinor: "225000" }],
        memberIds: { lines: ["a", "b"], movements: ["c", "d"] },
      },
      "INV-X",
    ),
  ).toThrow("party_required");
  expect(() =>
    saleDraft(
      {
        ...input(shift, draft),
        payments: [{ paymentId: "p", method: "cash", amountMinor: "1" }],
        memberIds: { lines: ["a", "b"], movements: ["c", "d"] },
      },
      "INV-X",
    ),
  ).toThrow("settlement_mismatch");
});

it("آجل ومختلط تحت Dexie: الرصيد المركّب يرى المعلّق فوراً، والتجاوز حدث يعتمد على البيع، ومرجع التحويل لا يتكرر", async () => {
  const s = new DexieStorage({ databaseName: `sale-${Math.random()}` });
  const shift = await openShift(s);
  const draft = { lines: [sugar], customer: { id: "p1", name: "مطعم الواحة" }, updated_at: "" };
  const { sale } = await saveSaleLocally(s, {
    ...input(shift, draft),
    payments: [
      { paymentId: "pay-1", method: "cash", amountMinor: "4000" },
      { paymentId: "pay-2", method: "credit", amountMinor: "6000" },
    ],
  });
  expect(sale.cash_minor).toBe("4000");
  expect(sale.credit_minor).toBe("6000");
  // «معلّق هذا الجهاز» = 60 حتى يؤكّده الخادم (ACC-02)
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: 6000n, count: 1 });
  expect(await readPartyPendingCredit(s, "p9")).toEqual({ pendingMinor: 0n, count: 0 });
  // بعد تأكيد الخادم: البيع ما زال بعد وقت تغطية الرصيد الخادمي (`balance_as_of`) فيبقى مركَّباً
  // فوقه — الرقم لا يتراجع من 180 إلى 120 حتى تُطابَق الأرصدة (§١٤.١، ACC-02)؛ وبتغطية أحدث يسقط
  await s.transaction(async (tx) => {
    const op = await tx.getOperation(sale.operation_id);
    await tx.putOperation({ ...op!, state: "synced" });
    await tx.putProjection({
      key: "entity:parties.Party:p1",
      value: { id: "p1", balance_minor: "12000", balance_as_of: "2026-09-16T09:00:00Z" },
    });
  });
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: 6000n, count: 1 });
  await s.transaction((tx) =>
    tx.putProjection({
      key: "entity:parties.Party:p1",
      value: { id: "p1", balance_minor: "18000", balance_as_of: "2026-09-16T11:00:00Z" },
    }),
  );
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: 0n, count: 0 });
  await s.transaction(async (tx) => {
    const op = await tx.getOperation(sale.operation_id);
    await tx.putOperation({ ...op!, state: "local" });
  });
  // الدرج: 40 داخل الصندوق و60 خارجه (ACC-08/13)
  const rows = await readSaleCashRows(s, "s1");
  expect(rows[0]).toMatchObject({ inCashMinor: "4000", outCashMinor: "6000" });
  const ov = await recordCreditOverride(s, {
    operationId: "op-ov-1",
    overrideId: "ov-1",
    saleId: sale.id,
    saleOperationId: sale.operation_id,
    partyId: "p1",
    branchId: "b1",
    creditLimitMinor: "5000",
    balanceAfterMinor: "6000",
    reason: "زبون معروف",
    occurredAt: "2026-09-16T10:35:00Z",
  });
  expect(ov.alreadySaved).toBe(false);
  const ops = await s.read((tx) => tx.listOperationsByState("local"));
  const o = ops.find((x) => x.kind === "credit_override")!;
  expect(o.dependencies).toEqual([sale.operation_id]);
  expect(o.members[0]!.payload).toMatchObject({
    balance_after_minor: "6000",
    reason: "زبون معروف",
  });
  // مرجع تحويل مستخدم
  const bank = await saveSaleLocally(s, {
    ...input(shift, { lines: [sugar], updated_at: "" }),
    operationId: "op-sale-2",
    saleId: "sale-2",
    payments: [
      { paymentId: "pay-3", method: "bank", amountMinor: "10000", reference: "TRF-88214" },
    ],
    memberIds: { lines: ["ln-2"], movements: ["mv-2"] },
  });
  expect(bank.sale.bank_minor).toBe("10000");
  expect(await bankReferenceUsed(s, "TRF-88214")).toBe(true);
  expect(await bankReferenceUsed(s, "TRF-1")).toBe(false);
});
