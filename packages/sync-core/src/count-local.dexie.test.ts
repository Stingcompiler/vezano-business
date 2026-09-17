import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import {
  clearCountEntry,
  closeCountSession,
  readLocalCountSession,
  readOpenCountSession,
  saveCountEntry,
  startCountSession,
} from "./count-local";
import { readPendingStockMovements } from "./inventory-local";
import { readLocalBalances } from "./pos-local";

const close = {
  branchCode: "KRT",
  devicePrefix: "A2",
  deviceId: "d1",
  userId: "u1",
  totalItems: 3,
  itemNames: { sugar: { name: "سكر أبيض", unit: "كيس" }, tea: { name: "شاي", unit: "علبة" } },
  closedAt: "2026-09-17T11:40:00Z",
};

it("العدّ يُحفظ بعد كل صنف ويُستأنف؛ الإغلاق يوثّق بلا حركة مخزون ويمحو الجلسة المفتوحة", async () => {
  const s = new DexieStorage({ databaseName: `cnt-${Math.random()}` });
  await s.transaction((tx) =>
    tx.putProjection({
      key: "entity:inventory.Balance:sugar",
      value: { item_id: "sugar", qty_milli: "1842000", as_of: "2026-09-17T09:00:00Z" },
    }),
  );
  expect(await readOpenCountSession(s)).toBeNull();
  const open = await startCountSession(s, {
    branchId: "b1",
    userName: "عثمان ك.",
    startedAt: "2026-09-17T09:15:00Z",
  });
  // البدء مرتين لا يفتح جلسة ثانية
  expect(
    (await startCountSession(s, { branchId: "b1", userName: "x", startedAt: "" })).sessionId,
  ).toBe(open.sessionId);
  await saveCountEntry(s, "sugar", {
    countedMilli: "1834000",
    systemMilli: "1842000",
    countedAt: "2026-09-17T09:20:00Z",
  });
  await saveCountEntry(s, "tea", {
    countedMilli: "346000",
    systemMilli: "",
    countedAt: "2026-09-17T09:21:00Z",
  });
  await saveCountEntry(s, "oil", {
    countedMilli: "1000",
    systemMilli: "",
    countedAt: "2026-09-17T09:22:00Z",
  });
  await clearCountEntry(s, "oil");
  const resumed = await readOpenCountSession(s);
  expect(Object.keys(resumed!.counts).sort()).toEqual(["sugar", "tea"]);
  const out = await closeCountSession(s, close);
  expect(out!.alreadySaved).toBe(false);
  expect(out!.session.session_number).toBe("CNT-KRT-A2-26-000001");
  expect(
    out!.session.lines.map((l) => [l.item_name, l.counted_qty_milli, l.system_qty_milli]),
  ).toEqual([
    ["سكر أبيض", "1834000", "1842000"],
    ["شاي", "346000", ""],
  ]);
  expect(await readOpenCountSession(s)).toBeNull();
  // الإغلاق لا يُسوّي: لا حركة مخزون ولا تغيّر في الرصيد
  expect(await readPendingStockMovements(s)).toEqual([]);
  expect((await readLocalBalances(s)).get("sugar")?.qty_milli).toBe("1842000");
  expect((await readLocalCountSession(s, open.sessionId))?.total_items).toBe(3);
  expect(await closeCountSession(s, close)).toBeNull();
});
