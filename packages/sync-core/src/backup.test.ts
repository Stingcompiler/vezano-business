import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import {
  applyRestore,
  backupCounts,
  collectBackup,
  inspectBackup,
  openBackup,
  previewRestore,
  readRestoreProgress,
  sealBackup,
} from "./backup";
import { saveOperation } from "./local-save";
import type { OperationDraft } from "./types";

let n = 0;
const uid = () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;

const sale = (item: string, id = uid()): OperationDraft => ({
  operationId: id,
  kind: "sale",
  opVersion: 1,
  dependencies: [],
  members: [
    { entity: "sales.Sale", id: uid(), schemaVersion: 1, payload: { total_minor: "100" } },
    {
      entity: "inventory.StockMovement",
      id: uid(),
      schemaVersion: 1,
      payload: { item_id: item, delta_base_qty_milli: "-1000" },
    },
  ],
});

async function seeded(): Promise<MemoryStorage> {
  const s = new MemoryStorage();
  await s.transaction(async (tx) => {
    await tx.putProjection({ key: "entity:catalog.Item:i1", value: { id: "i1", server_seq: "5" } });
    await tx.putProjection({
      key: "entity:parties.Party:p1",
      value: { id: "p1", server_seq: "3" },
    });
    await tx.putMeta("invoice_seq", "7");
    await tx.putMeta("device.registration", "SECRET");
    await tx.putMeta("pin_verifiers", "SECRET");
  });
  await saveOperation(s, sale("i1"));
  const pending = await saveOperation(s, sale("i1"));
  await s.transaction(async (tx) => {
    const first = (await tx.listOperationsByState("local"))[0]!;
    await tx.putOperation({ ...first, state: "synced" });
  });
  void pending;
  return s;
}

describe("النسخة المحلية المشفّرة (SYS-05/06؛ §١٣.٣)", () => {
  it("تُصدَّر بلا أسرار، مغلّفة بكلمة حماية، وتُرفض لمنشأة أخرى أو إصدار أحدث قبل فكّ التشفير", async () => {
    const s = await seeded();
    const content = await collectBackup(s);
    expect(backupCounts(content)).toMatchObject({
      operations: 2,
      pending: 1,
      parties: 1,
      items: 1,
    });
    expect(content.counters).toEqual({ invoice_seq: "7" });
    expect(JSON.stringify(content)).not.toContain("SECRET");
    await expect(
      sealBackup({
        content,
        password: "123",
        tenantId: "t1",
        deviceId: "d1",
        syncEpoch: "e",
        exportedAt: "2026-09-18T10:00:00Z",
      }),
    ).rejects.toThrow("password_short");
    const env = await sealBackup({
      content,
      password: "sting-2026",
      tenantId: "t1",
      deviceId: "d1",
      syncEpoch: "e",
      exportedAt: "2026-09-18T10:00:00Z",
      iterations: 1000,
    });
    const raw = JSON.stringify(env);
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("sales.Sale"); // المحتوى مشفَّر
    expect(inspectBackup("{not json", "t1")).toEqual({ ok: false, reason: "corrupt" });
    expect(inspectBackup(raw, "t2")).toEqual({ ok: false, reason: "other_tenant" });
    expect(inspectBackup(JSON.stringify({ ...env, version: 99 }), "t1")).toEqual({
      ok: false,
      reason: "newer_version",
    });
    const ok = inspectBackup(raw, "t1");
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await openBackup(ok.envelope, "wrong")).toEqual({ ok: false, reason: "wrong_password" });
    const opened = await openBackup(ok.envelope, "sting-2026");
    expect(opened.ok && opened.content.operations.length).toBe(2);
  });

  it("المعاينة تقول الفرق لا المحتوى؛ الاستعادة دمجٌ بالهويات على دفعات قابلة للاستئناف؛ مرتين = لا تكرار؛ الصنف الناقص يُحجز", async () => {
    const source = await seeded();
    // جهاز بديل: صنف i1 قائم لكن i9 لا — وعملية أخرى في النسخة تشير إليه
    await saveOperation(source, sale("i9"));
    const content2 = await collectBackup(source);
    const target = new MemoryStorage();
    await target.transaction(async (tx) => {
      await tx.putProjection({
        key: "entity:catalog.Item:i1",
        value: { id: "i1", server_seq: "9" },
      });
      await tx.putMeta("invoice_seq", "3");
    });
    await saveOperation(target, sale("i1")); // معلّق محلي لا تمسّه الاستعادة
    const preview = await previewRestore(target, content2);
    expect(preview).toMatchObject({
      addOperations: 3,
      addPending: 2,
      updateProjections: 0,
      addProjections: 1,
      heldOperations: 1,
      deletes: 0,
    });
    expect(preview.localPending).toHaveLength(1);

    // انقطاع بعد الدفعة الأولى ثم استئناف
    const bigContent = {
      ...content2,
      operations: [
        ...content2.operations,
        ...Array.from({ length: 60 }, () => ({
          ...content2.operations[0]!,
          operationId: uid(),
          createdLocalSeq: 999,
        })),
      ],
    };
    const first = await applyRestore(target, "f1", bigContent, { stopAfter: 1 });
    expect(first.done).toBe(false);
    expect((await readRestoreProgress(target))?.nextBatch).toBe(1);
    const second = await applyRestore(target, "f1", bigContent);
    expect(second.done).toBe(true);
    expect(second.progress.added).toBe(63);
    expect(second.progress.held).toHaveLength(1);
    expect(await readRestoreProgress(target)).toBeNull();
    expect(
      (await target.read((tx) => tx.getProjection("entity:catalog.Item:i1")))?.value["server_seq"],
    ).toBe("9"); // الأحدث يفوز
    expect(await target.read((tx) => tx.getMeta("invoice_seq"))).toBe("7");
    expect((await target.read((tx) => tx.listOperationsByState("local"))).length).toBe(3); // معلّق الجهاز + معلّقا النسخة

    // مرة ثانية: لا تكرار
    const again = await applyRestore(target, "f1-again", bigContent);
    expect(again.progress.added).toBe(0);
    const all = await target.read(async (tx) => [
      ...(await tx.listOperationsByState("local")),
      ...(await tx.listOperationsByState("synced")),
    ]);
    expect(all).toHaveLength(64);
  });
});
