import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import { openShiftLocally, readOpenShift } from "./shift-local";

/** المُسقِط يعمل تحت Dexie فعلاً (لا MemoryStorage فقط): كل await على المعاملة مباشرةً. */
it("فتح الوردية تحت Dexie: العملية والإسقاط وmeta في معاملة واحدة", async () => {
  const s = new DexieStorage({ databaseName: `shift-${Math.random()}` });
  const { shift } = await openShiftLocally(s, {
    shiftId: "s1",
    operationId: "op1",
    branchId: "b",
    branchName: "فرع",
    deviceId: "d",
    deviceName: "جهاز",
    userId: "u",
    userName: "سالم",
    openingFloatMinor: "50000",
    businessDate: "2026-09-11",
    occurredAt: "2026-09-11T08:00:00Z",
  });
  expect(shift.number).toBe("OPEN-0001");
  expect((await readOpenShift(s))?.id).toBe("s1");
});

it("حركة صندوق ثم عكسها ثم إقفال بالعدّ — تحت Dexie، واللقطة والمعدود في الإسقاط", async () => {
  const {
    closeShiftLocally,
    readMovements,
    readPendingClosedShifts,
    readShiftCash,
    saveCashMovement,
  } = await import("./shift-local");
  const s = new DexieStorage({ databaseName: `shift-${Math.random()}` });
  const { shift } = await openShiftLocally(s, {
    shiftId: "s1",
    operationId: "op1",
    branchId: "b",
    branchName: "فرع",
    deviceId: "d",
    deviceName: "جهاز",
    userId: "u",
    userName: "سالم",
    openingFloatMinor: "243000",
    businessDate: "2026-09-11",
    occurredAt: "2026-09-11T08:00:00Z",
  });
  const { movement } = await saveCashMovement(s, {
    movementId: "m1",
    operationId: "op2",
    shift,
    kind: "expense",
    amountMinor: "30000",
    reason: "شراء أكياس وأشرطة تغليف من محل الهدى",
    actorUserId: "u",
    actorName: "سالم",
    occurredAt: "2026-09-11T11:40:00Z",
  });
  expect(movement.number).toBe("101");
  expect(movement.signed_amount_minor).toBe("-30000");
  let cash = await readShiftCash(s, shift);
  expect(cash.expectedCashMinor).toBe(213000n);
  expect(cash.rows[1]?.doc).toBe("101");
  // العكس: حركة مضادّة تشير إلى الأصل — الأصل يبقى
  await saveCashMovement(s, {
    movementId: "m2",
    operationId: "op3",
    shift,
    kind: "expense",
    amountMinor: "30000",
    reason: "تصحيح — الحركة تخصّ وردية أمس",
    actorUserId: "u",
    actorName: "سالم",
    reversesMovementId: "m1",
    occurredAt: "2026-09-11T11:50:00Z",
  });
  cash = await readShiftCash(s, shift);
  expect(cash.expectedCashMinor).toBe(243000n);
  expect((await readMovements(s, "s1")).map((m) => m.number)).toEqual(["101", "102"]);
  expect(cash.rows.filter((r) => r.reversal)).toHaveLength(1);
  // الإقفال بالعدّ: اللقطة ثابتة والمعدود باسم من عدّ؛ لا وردية مفتوحة بعده
  const closed = await closeShiftLocally(s, {
    operationId: "op4",
    countId: "c1",
    closeId: "x1",
    shift,
    countedCashMinor: "238500",
    denominations: [{ face_minor: "50000", count: 4 }],
    expectedCashAtCloseMinor: cash.expectedCashMinor.toString(),
    actorUserId: "u",
    actorName: "سالم",
    occurredAt: "2026-09-11T20:42:00Z",
  });
  expect(closed.shift.state).toBe("closed");
  expect(await readOpenShift(s)).toBeNull();
  const ops = await s.read((tx) => tx.listOperationsByState("local"));
  const close = ops.find((o) => o.kind === "shift_close")!;
  expect(close.members.map((m) => m.entity).sort()).toEqual([
    "shifts.CashCounted",
    "shifts.ShiftClosed",
  ]);
  expect(close.dependencies).toEqual(["op1"]);
  // SHIFT-05 stale: مقفلة محلياً وإقفالها لم يُرفع — تُسمّى؛ وبعد التأكيد تخرج من القائمة
  expect((await readPendingClosedShifts(s)).map((x) => x.id)).toEqual(["s1"]);
  await s.transaction(async (tx) => {
    const op = (await tx.getOperation("op4"))!;
    await tx.putOperation({ ...op, state: "synced" });
  });
  expect(await readPendingClosedShifts(s)).toEqual([]);
});
