/**
 * اختبارات عقد التخزين على Dexie فوق fake-indexeddb (Node).
 * الطبقة الثانية — IndexedDB متصفح حقيقي — تُضاف في T0.19 عبر Playwright (§٤.٦ بند ٦).
 */
import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { runStorageContractTests } from "./contract-tests/index";
import { DexieStorage } from "./dexie/index";

let counter = 0;
const fresh = () =>
  new DexieStorage({
    databaseName: `sting-test-${Date.now()}-${counter++}`,
    indexedDB: new IDBFactory(),
  });

runStorageContractTests("dexie (fake-indexeddb)", () => Promise.resolve(fresh()));

describe("خصائص Dexie الإضافية", () => {
  it("قاعدتان باسمين مختلفين لا تتشاركان بيانات (§٨.١٣: هوية وتخزين مستقلان)", async () => {
    const factory = new IDBFactory();
    const a = new DexieStorage({ databaseName: "sting-a", indexedDB: factory });
    const b = new DexieStorage({ databaseName: "sting-b", indexedDB: factory });
    await a.transaction((tx) => tx.putMeta("device_id", "A"));
    expect(await b.read((tx) => tx.getMeta("device_id"))).toBeNull();
    expect(await a.read((tx) => tx.getMeta("device_id"))).toBe("A");
  });

  it("البيانات تبقى بعد الإغلاق وإعادة الفتح بنفس الاسم", async () => {
    const factory = new IDBFactory();
    const first = new DexieStorage({ databaseName: "sting-persist", indexedDB: factory });
    await first.transaction(async (tx) => {
      await tx.putMeta("k", "v");
      await tx.advanceCursor({
        scope: "enterprise",
        scopeId: "",
        entityGroup: "probe",
        serverSeq: "42",
      });
    });
    await first.close();
    const second = new DexieStorage({ databaseName: "sting-persist", indexedDB: factory });
    expect(await second.read((tx) => tx.getMeta("k"))).toBe("v");
    expect((await second.read((tx) => tx.getCursor("enterprise", "", "probe")))!.serverSeq).toBe(
      "42",
    );
  });
});
