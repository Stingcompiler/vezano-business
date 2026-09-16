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
