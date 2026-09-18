import { MemoryStorage } from "@sting/platform/memory";
import type { StorageTransaction } from "@sting/platform";
import { describe, expect, it } from "vitest";

import { nextInvoiceNumber } from "./invoice-number";
import { saveOperation } from "./local-save";
import { applyResults, pushOnce } from "./pusher";
import { retryDelayMs } from "./retry";
import type { OperationDraft, PushEnvelope, PushTransport, TransportOutcome } from "./types";

let n = 0;
const uid = () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;

const draft = (deps: string[] = [], id = uid()): OperationDraft => ({
  operationId: id,
  kind: "probe",
  opVersion: 1,
  dependencies: deps,
  members: [{ entity: "probe.Head", id: uid(), schemaVersion: 1, payload: { value: "1" } }],
});

/** خادم مزيّف يقبل كل شيء ويعطي أرقاماً متسلسلة، مع إمكان حقن أعطال. */
function fakeServer(
  script: (env: PushEnvelope, call: number) => TransportOutcome | null = () => null,
) {
  let seq = 0;
  let calls = 0;
  const envelopes: PushEnvelope[] = [];
  const transport: PushTransport = {
    push: (env) => {
      calls++;
      envelopes.push(env);
      const injected = script(env, calls);
      if (injected) return Promise.resolve(injected);
      return Promise.resolve({
        ok: true as const,
        response: {
          protocol_version: 1,
          sync_epoch: env.sync_epoch,
          request_id: env.request_id,
          results: env.operations.map((op) => ({
            operation_id: op.operation_id,
            status: "accepted" as const,
            member_receipts: op.members.map((m) => ({
              entity: m.entity,
              id: m.id,
              server_seq: String(++seq),
            })),
          })),
          server_seq_high: String(seq),
        },
      });
    },
  };
  return { transport, envelopes, calls: () => calls };
}

describe("الحفظ المحلي (§٨.٢)", () => {
  it("إعادة الضغط بنفس الهوية لا تنشئ عملية ثانية ولا رقماً محلياً جديداً", async () => {
    const storage = new MemoryStorage();
    const d = draft();
    const first = await saveOperation(storage, d);
    const again = await saveOperation(storage, d);
    expect(first.alreadySaved).toBe(false);
    expect(again.alreadySaved).toBe(true);
    expect(again.operation.createdLocalSeq).toBe(first.operation.createdLocalSeq);
    expect(await storage.read((tx) => tx.listOperationsByState("local"))).toHaveLength(1);
  });

  it("الإسقاط يُحدَّث في المعاملة نفسها ويتراجع معها", async () => {
    const storage = new MemoryStorage();
    await expect(
      saveOperation(storage, draft(), async (tx) => {
        await tx.putProjection({ key: "cash", value: { total: "100" } });
        throw new Error("projection failed");
      }),
    ).rejects.toThrow("projection failed");
    expect(await storage.read((tx) => tx.getProjection("cash"))).toBeNull();
    expect(await storage.read((tx) => tx.listOperationsByState("local"))).toHaveLength(0);
  });
});

describe("قتل التطبيق عشوائياً أثناء 1000 عملية (ACC-01)", () => {
  it("لا فقد لعملية اكتمل حفظها، ولا نجاح لما لم يكتمل", async () => {
    const storage = new MemoryStorage();
    const completed = new Set<string>();
    const failed = new Set<string>();
    let rnd = 42;
    const random = () => (rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 1000; i++) {
      const d = draft();
      const killAt = random() < 0.3 ? random() : null;
      try {
        await saveOperation(storage, d, async (tx: StorageTransaction) => {
          await tx.putProjection({ key: `p:${d.operationId}`, value: { i } });
          if (killAt !== null && killAt < 0.5) throw new Error("killed before commit");
          await tx.putMeta(`m:${d.operationId}`, "1");
          if (killAt !== null) throw new Error("killed after writes, before commit");
        });
        completed.add(d.operationId);
      } catch {
        failed.add(d.operationId);
      }
    }
    expect(completed.size + failed.size).toBe(1000);
    expect(failed.size).toBeGreaterThan(200);
    await storage.read(async (tx) => {
      for (const id of completed) {
        expect(await tx.getOperation(id), id).not.toBeNull();
        expect(await tx.getMeta(`m:${id}`)).toBe("1");
      }
      for (const id of failed) {
        expect(await tx.getOperation(id)).toBeNull();
        expect(await tx.getProjection(`p:${id}`)).toBeNull();
      }
      expect(await tx.listOperationsByState("local")).toHaveLength(completed.size);
    });
  });
});

describe("ترقيم الفواتير (§٨.٢)", () => {
  it("INV-<فرع>-<جهاز>-<سنة>-<تسلسل> متزايد ولا يُعاد تعيينه بتغيّر السنة", async () => {
    const storage = new MemoryStorage();
    const a = await storage.transaction((tx) =>
      nextInvoiceNumber(tx, { branchCode: "KRT", devicePrefix: "A2", yearTwoDigits: "26" }),
    );
    const b = await storage.transaction((tx) =>
      nextInvoiceNumber(tx, { branchCode: "KRT", devicePrefix: "A2", yearTwoDigits: "26" }),
    );
    const c = await storage.transaction((tx) =>
      nextInvoiceNumber(tx, { branchCode: "KRT", devicePrefix: "A2", yearTwoDigits: "25" }),
    );
    expect([a, b, c]).toEqual([
      "INV-KRT-A2-26-000001",
      "INV-KRT-A2-26-000002",
      "INV-KRT-A2-25-000003",
    ]);
    await expect(
      storage.transaction((tx) =>
        nextInvoiceNumber(tx, { branchCode: "krt", devicePrefix: "A2", yearTwoDigits: "26" }),
      ),
    ).rejects.toThrow();
  });
});

describe("التراجع الأُسّي (§٨.٣)", () => {
  it("يتضاعف ويُسقَّف ويحمل jitter بين النصف والكامل", () => {
    const zero = () => 0;
    const one = () => 1; // الحدّ الأعلى للاختبار الحتمي
    expect(retryDelayMs(1, undefined, zero)).toBe(500);
    expect(retryDelayMs(1, undefined, one)).toBe(1000);
    expect(retryDelayMs(3, undefined, zero)).toBe(2000);
    expect(retryDelayMs(30, undefined, one)).toBe(300_000);
  });
});

describe("طابور الرفع وACK (§٨.٣)", () => {
  it("دفعة تُقبل → synced بأرقام الأعضاء، وعدّاد المحاولات يُصفَّر", async () => {
    const storage = new MemoryStorage();
    const server = fakeServer();
    await saveOperation(storage, draft());
    await saveOperation(storage, draft());
    const out = await pushOnce(storage, {
      transport: server.transport,
      syncEpoch: "epoch-A",
      requestId: "r1",
    });
    expect(out).toMatchObject({ kind: "applied", synced: 2 });
    const synced = await storage.read((tx) => tx.listOperationsByState("synced"));
    expect(synced.map((o) => o.members[0]!.serverSeq)).toEqual(["1", "2"]);
    expect(
      await pushOnce(storage, {
        transport: server.transport,
        syncEpoch: "epoch-A",
        requestId: "r2",
      }),
    ).toEqual({ kind: "idle" });
  });

  it("الأب غير المؤكد يُرفق في النقل نفسه ولو لم يكن في الدفعة (بند ٦، ACC-33)", async () => {
    const storage = new MemoryStorage();
    const server = fakeServer();
    const parent = draft();
    const child = draft([parent.operationId]);
    await saveOperation(storage, parent);
    // نجعل الأب pending (كأن نقلاً سابقاً حمله وانقطع) ثم نرفع الطفل وحده
    await storage.transaction(async (tx) =>
      tx.putOperation({ ...(await tx.getOperation(parent.operationId))!, state: "pending" }),
    );
    await saveOperation(storage, child);
    await pushOnce(storage, {
      transport: server.transport,
      syncEpoch: "epoch-A",
      requestId: "r1",
      maxOperations: 50,
    });
    const ids = server.envelopes[0]!.operations.map((o) => o.operation_id);
    expect(ids).toEqual([parent.operationId, child.operationId]);
  });

  it("خطأ عابر لا يغيّر الحالة ويعيد موعداً متزايداً؛ الدائم يُحجر ولا يسدّ الطابور (ACC-59)", async () => {
    const storage = new MemoryStorage();
    const bad = draft();
    const good = draft();
    await saveOperation(storage, bad);
    await saveOperation(storage, good);
    let call = 0;
    const server = fakeServer((env) => {
      call++;
      if (call <= 2) return { ok: false, kind: "transient", reason: "network" };
      return {
        ok: true,
        response: {
          protocol_version: 1,
          sync_epoch: env.sync_epoch,
          request_id: env.request_id,
          results: env.operations.map((op) =>
            op.operation_id === bad.operationId
              ? {
                  operation_id: op.operation_id,
                  status: "rejected" as const,
                  code: "validation",
                  detail: "missing fields",
                }
              : {
                  operation_id: op.operation_id,
                  status: "accepted" as const,
                  member_receipts: op.members.map((m) => ({
                    entity: m.entity,
                    id: m.id,
                    server_seq: "7",
                  })),
                },
          ),
          server_seq_high: "7",
        },
      };
    });
    const opts = {
      transport: server.transport,
      syncEpoch: "epoch-A",
      requestId: "r",
      random: () => 1,
    };
    const r1 = await pushOnce(storage, opts);
    const r2 = await pushOnce(storage, opts);
    expect(r1).toMatchObject({ kind: "retry", delayMs: 1000 });
    expect(r2).toMatchObject({ kind: "retry", delayMs: 2000 });
    expect(await storage.read((tx) => tx.listOperationsByState("local"))).toHaveLength(2);
    const r3 = await pushOnce(storage, opts);
    expect(r3).toMatchObject({ kind: "applied", synced: 1, quarantined: 1 });
    expect(await storage.read((tx) => tx.listOperationsByState("quarantined"))).toHaveLength(1);
    expect(await storage.read((tx) => tx.getMeta(`quarantine:${bad.operationId}`))).toContain(
      "validation",
    );
    expect(await storage.read((tx) => tx.getMeta("push_attempts"))).toBe("0");
  });

  it("رفض المصادقة أو الجيل يوقف الرفع بإشارة ولا يدور (§٨.٣، §٨.١٢)", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft());
    const auth = fakeServer(() => ({ ok: false, kind: "auth", status: 401 }));
    expect(
      await pushOnce(storage, { transport: auth.transport, syncEpoch: "e", requestId: "r" }),
    ).toMatchObject({ kind: "halt", failure: { kind: "auth" } });
    const epoch = fakeServer(() => ({
      ok: false,
      kind: "epoch_mismatch",
      currentEpoch: "epoch-B",
    }));
    expect(
      await pushOnce(storage, { transport: epoch.transport, syncEpoch: "epoch-A", requestId: "r" }),
    ).toMatchObject({ kind: "halt", failure: { currentEpoch: "epoch-B" } });
    expect(await storage.read((tx) => tx.listOperationsByState("local"))).toHaveLength(1);
  });

  it("duplicate يعامل كـ accepted بأرقامه؛ conflicted يحفظ الأصل؛ الحدث الواحد لا يحسب مرتين", async () => {
    const storage = new MemoryStorage();
    const a = draft();
    const b = draft();
    await saveOperation(storage, a);
    await saveOperation(storage, b);
    const counts = await applyResults(storage, [
      {
        operation_id: a.operationId,
        status: "duplicate",
        member_receipts: [{ entity: "probe.Head", id: a.members[0]!.id, server_seq: "42" }],
      },
      { operation_id: b.operationId, status: "conflicted", code: "content_mismatch" },
    ]);
    expect(counts).toEqual({ synced: 1, conflicted: 1, quarantined: 0, waiting: 0 });
    const again = await applyResults(storage, [
      {
        operation_id: a.operationId,
        status: "accepted",
        member_receipts: [{ entity: "probe.Head", id: a.members[0]!.id, server_seq: "99" }],
      },
    ]);
    expect(again.synced).toBe(0);
    const stored = await storage.read((tx) => tx.getOperation(a.operationId));
    expect(stored!.members[0]!.serverSeq).toBe("42");
    expect(
      (await storage.read((tx) => tx.getOperation(b.operationId)))!.members[0]!.payload,
    ).toEqual({ value: "1" });
  });
});

describe("تبدّل الجيل (§٨.١٢)", () => {
  it("ردّ يحمل جيلاً غير المعتمد يُهمل: لا تأكيد ولا أرقام، والعمليات تعود local", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft());
    const server = fakeServer((env) => ({
      ok: true,
      response: {
        protocol_version: 1,
        sync_epoch: "epoch-OLD",
        request_id: env.request_id,
        results: env.operations.map((op) => ({
          operation_id: op.operation_id,
          status: "accepted" as const,
          member_receipts: [],
        })),
        server_seq_high: "99",
      },
    }));
    const out = await pushOnce(storage, {
      transport: server.transport,
      syncEpoch: "epoch-NEW",
      requestId: "r",
    });
    expect(out).toMatchObject({
      kind: "halt",
      failure: { kind: "epoch_mismatch", currentEpoch: "epoch-OLD" },
    });
    expect(await storage.read((tx) => tx.listOperationsByState("synced"))).toHaveLength(0);
    expect(await storage.read((tx) => tx.listOperationsByState("local"))).toHaveLength(1);
  });
});
