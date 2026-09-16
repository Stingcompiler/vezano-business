/**
 * مجموعة اختبارات عقد التخزين المشتركة (§٤.٦ بند ٦): تُشغَّل على المحوّل الذاكري هنا،
 * وعلى Dexie في T0.11، وعلى SQLite (Expo/Tauri) في مرحلتيهما — نفس الضمانات.
 */

import { describe, expect, it } from "vitest";

import type { StoragePort, StoredOperation } from "../storage";

const op = (
  id: string,
  seq: number,
  state: StoredOperation["state"] = "local",
): StoredOperation => ({
  operationId: id,
  kind: "probe",
  opVersion: 1,
  dependencies: [],
  members: [
    {
      entity: "probe.Head",
      id: `${id}-head`,
      schemaVersion: 1,
      payload: { value: "9007199254740993" },
      serverSeq: null,
    },
  ],
  state,
  createdLocalSeq: seq,
  snapshotRelation: "none",
});

export function runStorageContractTests(name: string, make: () => Promise<StoragePort>): void {
  describe(`عقد التخزين: ${name}`, () => {
    it("المعاملة ذرّية: الاستثناء يتراجع عن كل الكتابات", async () => {
      const storage = await make();
      await storage.transaction(async (tx) => {
        await tx.putOperation(op("op-1", await tx.nextLocalSeq()));
      });
      await expect(
        storage.transaction(async (tx) => {
          await tx.putOperation(op("op-2", await tx.nextLocalSeq()));
          await tx.putMeta("device_id", "d-1");
          await tx.advanceCursor({
            scope: "enterprise",
            scopeId: "",
            entityGroup: "probe",
            serverSeq: "9",
          });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await storage.read(async (tx) => {
        expect(await tx.getOperation("op-1")).not.toBeNull();
        expect(await tx.getOperation("op-2")).toBeNull();
        expect(await tx.getMeta("device_id")).toBeNull();
        expect(await tx.getCursor("enterprise", "", "probe")).toBeNull();
      });
    });

    it("nextLocalSeq متزايد داخل المعاملات وعبرها، والفاشلة لا تستهلك رقماً دائماً", async () => {
      const storage = await make();
      const first = await storage.transaction((tx) => tx.nextLocalSeq());
      await storage
        .transaction(async (tx) => {
          await tx.nextLocalSeq();
          throw new Error("rollback");
        })
        .catch(() => undefined);
      const second = await storage.transaction((tx) => tx.nextLocalSeq());
      expect(first).toBe(1);
      expect(second).toBe(2);
      expect(await storage.read((tx) => tx.currentLocalSeq())).toBe(2);
    });

    it("الأعداد فوق Number.MAX_SAFE_INTEGER تعود حرفياً (ACC-21/97)", async () => {
      const storage = await make();
      await storage.transaction((tx) => tx.putOperation(op("big", 1)));
      const stored = await storage.read((tx) => tx.getOperation("big"));
      expect(stored!.members[0]!.payload.value).toBe("9007199254740993");
      await storage.transaction((tx) =>
        tx.advanceCursor({
          scope: "enterprise",
          scopeId: "",
          entityGroup: "probe",
          serverSeq: "9223372036854775807",
        }),
      );
      const cur = await storage.read((tx) => tx.getCursor("enterprise", "", "probe"));
      expect(cur!.serverSeq).toBe("9223372036854775807");
    });

    it("المؤشر لا يتراجع (§٨.٧)", async () => {
      const storage = await make();
      const row = { scope: "enterprise", scopeId: "", entityGroup: "probe" };
      await storage.transaction((tx) => tx.advanceCursor({ ...row, serverSeq: "120" }));
      await storage.transaction((tx) => tx.advanceCursor({ ...row, serverSeq: "80" }));
      await storage.transaction((tx) => tx.advanceCursor({ ...row, serverSeq: "121" }));
      const cur = await storage.read((tx) => tx.getCursor("enterprise", "", "probe"));
      expect(cur!.serverSeq).toBe("121");
    });

    it("قائمة المعلّق مرتبة برقم الإنشاء المحلي", async () => {
      const storage = await make();
      await storage.transaction(async (tx) => {
        await tx.putOperation(op("b", 2, "pending"));
        await tx.putOperation(op("a", 1, "pending"));
        await tx.putOperation(op("c", 3, "local"));
      });
      const pending = await storage.read((tx) => tx.listOperationsByState("pending"));
      expect(pending.map((o) => o.operationId)).toEqual(["a", "b"]);
    });

    it("معاملات متزامنة تتسلسل: لا رقم محلي مكرر (§٨.٢ كاتب واحد)", async () => {
      const storage = await make();
      const seqs = await Promise.all(
        Array.from({ length: 20 }, () =>
          storage.transaction(async (tx) => {
            const seq = await tx.nextLocalSeq();
            await tx.putOperation(op(`op-${seq}`, seq));
            return seq;
          }),
        ),
      );
      expect([...new Set(seqs)].length).toBe(20);
      expect(Math.max(...seqs)).toBe(20);
    });

    it("اللقطات والإسقاطات تُحفظ وتُقرأ", async () => {
      const storage = await make();
      await storage.transaction(async (tx) => {
        await tx.putSnapshot({
          snapshotId: "s-1",
          syncEpoch: "epoch-A",
          cutoffServerSeq: "120",
          state: "candidate",
          balances: [
            { party_id: "p1", account_role: "customer", currency: "SDG", amount_minor: "125000" },
          ],
          localFrontier: 7,
        });
        await tx.putProjection({ key: "shift:current", value: { expected_cash: "7000" } });
      });
      await storage.read(async (tx) => {
        const snap = await tx.getSnapshot("s-1");
        expect(snap!.balances[0]!.amount_minor).toBe("125000");
        expect(snap!.localFrontier).toBe(7);
        expect((await tx.getProjection("shift:current"))!.value.expected_cash).toBe("7000");
        expect(await tx.listProjections("shift:")).toHaveLength(1);
        expect(await tx.listProjections("none:")).toHaveLength(0);
        expect(await tx.listSnapshots()).toHaveLength(1);
      });
    });
  });
}
