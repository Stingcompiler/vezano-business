import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import {
  readPendingReceiptsByParty,
  readReceiptCashRows,
  type ReceiptInput,
  saveReceiptLocally,
} from "./receipt-local";
import { bankReferenceUsed, readPartyPendingCredit } from "./sale-local";
import { openShiftLocally, readShiftCash } from "./shift-local";

async function setup() {
  const s = new DexieStorage({ databaseName: `rec-${Math.random()}` });
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
    businessDate: "2026-09-17",
    occurredAt: "2026-09-17T08:00:00Z",
  });
  // لقطة خادمية 100 على أحمد حتى 09:00
  await s.transaction((tx) =>
    tx.putProjection({
      key: "entity:parties.Party:p1",
      value: {
        id: "p1",
        name: "أحمد الطيب",
        balance_minor: "10000",
        balance_as_of: "2026-09-17T09:00:00Z",
      },
    }),
  );
  return { s, shift };
}

const input = (shift: ReceiptInput["shift"], over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  operationId: "op-rec-1",
  receiptId: "rec-1",
  partyId: "p1",
  partyName: "أحمد الطيب",
  kind: "receipt",
  method: "cash",
  amountMinor: "4000",
  shift,
  branchCode: "KRT",
  devicePrefix: "A2",
  deviceId: "d1",
  userId: "u1",
  userName: "سميرة ع.",
  businessDate: "2026-09-17",
  occurredAt: "2026-09-17T10:00:00Z",
  ...over,
});

/** ACC-03: لقطة 100 + سداد محلي 40 = 60؛ النقد يدخل الدرج فوراً؛ رقم REC ثابت عند إعادة الضغط. */
it("سداد نقدي محلي: الرصيد المركّب 60، الدرج +40، والسند برقمه لا يتكرر", async () => {
  const { s, shift } = await setup();
  const { receipt, alreadySaved } = await saveReceiptLocally(s, input(shift));
  expect(alreadySaved).toBe(false);
  expect(receipt.receipt_number).toBe("REC-KRT-A2-26-000001");
  const again = await saveReceiptLocally(s, input(shift));
  expect(again.alreadySaved).toBe(true);
  expect(again.receipt.receipt_number).toBe("REC-KRT-A2-26-000001");
  const ops = await s.read((tx) => tx.listOperationsByState("local"));
  const op = ops.find((o) => o.kind === "payment_receipt")!;
  expect(op.dependencies).toEqual(["op-open"]);
  expect(op.members[0]!.payload).toMatchObject({
    kind: "receipt",
    method: "cash",
    amount_minor: "4000",
    receipt_number: "REC-KRT-A2-26-000001",
  });
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: -4000n, count: 1 });
  const pend = await readPendingReceiptsByParty(s);
  expect(pend.get("p1")?.signedMinor).toBe(-4000n);
  const cash = await readShiftCash(s, shift, await readReceiptCashRows(s, "s1"));
  const row = cash.rows.find((r) => r.kind === "receipt")!;
  expect(row.inCashMinor).toBe("4000");
  expect(row.note).toBe("سداد من أحمد الطيب");
  // بعد تأكيد الخادم ووقوعه بعد تغطية الرصيد يبقى مركَّباً (§٢٤)
  await s.transaction(async (tx) => {
    const o = await tx.getOperation("op-rec-1");
    await tx.putOperation({ ...o!, state: "synced" });
  });
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: -4000n, count: 1 });
});

/** التحويل «مسجَّل» لا يُسقط الذمّة (ACC-133)، ومرجعه لا يُستهلك مرتين (ACC-15)، والردّ يحتاج سبباً. */
it("تحويل بنكي مسجَّل بلا أثر على الذمّة ومرجع لا يتكرر؛ الردّ بسبب يخرج من الدرج", async () => {
  const { s, shift } = await setup();
  await saveReceiptLocally(
    s,
    input(shift, { method: "bank", reference: "TRF-88214", amountMinor: "3000" }),
  );
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: 0n, count: 0 });
  expect(await bankReferenceUsed(s, "TRF-88214")).toBe(true);
  expect(await bankReferenceUsed(s, "TRF-1")).toBe(false);
  await expect(
    saveReceiptLocally(s, input(shift, { operationId: "op-r2", receiptId: "r2", method: "bank" })),
  ).rejects.toThrow("reference_required");
  await expect(
    saveReceiptLocally(s, input(shift, { operationId: "op-r3", receiptId: "r3", kind: "refund" })),
  ).rejects.toThrow("reason_required");
  const { receipt } = await saveReceiptLocally(
    s,
    input(shift, {
      operationId: "op-r4",
      receiptId: "r4",
      kind: "refund",
      reason: "بضاعة ناقصة",
      amountMinor: "1000",
    }),
  );
  expect(receipt.receipt_number).toBe("REC-KRT-A2-26-000002");
  expect(await readPartyPendingCredit(s, "p1")).toEqual({ pendingMinor: 1000n, count: 1 });
  const rows = await readReceiptCashRows(s, "s1");
  expect(rows.find((r) => r.kind === "refund")!.inCashMinor).toBe("-1000");
  expect(rows.find((r) => r.doc === "REC-KRT-A2-26-000001")!.outCashMinor).toBe("3000");
});
