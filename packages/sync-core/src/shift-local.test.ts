import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import { saveOperation } from "./local-save";
import { openShiftLocally, readOpenShift, readShiftCash } from "./shift-local";

const input = (over: Partial<Parameters<typeof openShiftLocally>[1]> = {}) => ({
  shiftId: "s1",
  operationId: "op1",
  branchId: "b1",
  branchName: "فرع النور",
  deviceId: "d1",
  deviceName: "كاشير 2",
  userId: "u1",
  userName: "سالم",
  openingFloatMinor: "50000",
  businessDate: "2026-09-11",
  occurredAt: "2026-09-11T08:00:00Z",
  ...over,
});

describe("الوردية محلياً (SHIFT-01/02؛ §١٠.٣)", () => {
  it("الفتح يحفظ العملية والإسقاط وmeta في معاملة واحدة، وإعادة الضغط لا تنشئ وردية ثانية", async () => {
    const s = new MemoryStorage();
    const a = await openShiftLocally(s, input());
    expect(a.alreadySaved).toBe(false);
    expect(a.shift.number).toBe("OPEN-0001");
    expect(a.shift.state).toBe("open");
    const b = await openShiftLocally(s, input());
    expect(b.alreadySaved).toBe(true);
    expect(b.shift.number).toBe("OPEN-0001");
    const open = await readOpenShift(s);
    expect(open?.id).toBe("s1");
    const ops = await s.read((tx) => tx.listOperationsByState("local"));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.members[0]!.payload).toMatchObject({
      shift_id: "s1",
      opening_float_minor: "50000",
      business_date: "2026-09-11",
    });
  });

  it("الصفر يُدخَل صراحةً ويُحفظ «0» لا فراغاً", async () => {
    const s = new MemoryStorage();
    const { shift } = await openShiftLocally(s, input({ openingFloatMinor: "0" }));
    expect(shift.opening_float_minor).toBe("0");
  });

  it("المتوقَّع = الافتتاح + إيداعات − سحوبات؛ الحركات المحلية معلّقة والافتتاح كذلك حتى ACK", async () => {
    const s = new MemoryStorage();
    const { shift } = await openShiftLocally(s, input());
    await saveOperation(s, {
      operationId: "op2",
      kind: "cash_movement",
      opVersion: 1,
      dependencies: ["op1"],
      members: [
        {
          entity: "shifts.CashMovement",
          id: "m1",
          schemaVersion: 1,
          payload: {
            movement_id: "m1",
            shift_id: "s1",
            kind: "withdrawal",
            signed_amount_minor: "-2500",
            reason: "صرف",
            actor_user_id: "u1",
            occurred_at: "2026-09-11T09:00:00Z",
          },
        },
      ],
    });
    const cash = await readShiftCash(s, shift, [
      {
        doc: "INV-1043",
        time: "2026-09-11T10:34:00Z",
        kind: "sale",
        note: "نقداً 40.00 · آجل 60.00",
        inCashMinor: "4000",
        outCashMinor: "6000",
        sync: "pending",
      },
    ]);
    expect(cash.expectedCashMinor).toBe(50000n - 2500n + 4000n);
    expect(cash.rows.map((r) => r.kind)).toEqual(["opening", "withdrawal", "sale"]);
    expect(cash.pendingCount).toBe(3);
    expect(cash.openingSync).toBe("pending");
  });
});
