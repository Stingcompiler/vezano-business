import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import { saveOperation } from "./local-save";
import { pushOnce } from "./pusher";
import {
  describeOperation,
  LAST_OK_META,
  readAttempts,
  renumberSale,
  requeueOperation,
  savedAt,
} from "./sync-log";
import type { OperationDraft, PushEnvelope, PushTransport, TransportOutcome } from "./types";

let n = 0;
const uid = () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;

const sale = (id = uid()): OperationDraft => ({
  operationId: id,
  kind: "sale",
  opVersion: 1,
  dependencies: [],
  members: [
    {
      entity: "sales.Sale",
      id: uid(),
      schemaVersion: 1,
      payload: { invoice_number: "INV-KRT-A2-26-000009", total_minor: "10000" },
    },
    {
      entity: "sales.Payment",
      id: uid(),
      schemaVersion: 1,
      payload: { method: "cash", amount_minor: "4000" },
    },
    {
      entity: "sales.Payment",
      id: uid(),
      schemaVersion: 1,
      payload: { method: "credit", amount_minor: "6000" },
    },
  ],
});

function server(script: (env: PushEnvelope, call: number) => TransportOutcome | null) {
  let calls = 0;
  const transport: PushTransport = {
    push: (env) => {
      calls++;
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
            member_receipts: [],
          })),
          server_seq_high: "1",
        },
      });
    },
  };
  return transport;
}

describe("سجلّ المزامنة (SYS-01/SYS-02؛ §٨.٣)", () => {
  it("الوصف بلغة المحل: «بيع 100.00 — يزيد الذمة 60.00 ويدخل الصندوق 40.00»", async () => {
    const storage = new MemoryStorage();
    const { operation } = await saveOperation(storage, sale());
    const d = describeOperation(operation);
    expect(d.title).toBe("فاتورة — بيع مختلط");
    expect(d.number).toBe("INV-KRT-A2-26-000009");
    expect(d.effect).toBe("بيع 100.00 — يزيد الذمة 60.00 ويدخل الصندوق 40.00");
  });

  it("خطّ زمني لكل عملية: حُفظت، أُرسلت، تعذّر (بالرمز)، ثم قُبلت — ووقت آخر وصول ناجح", async () => {
    const storage = new MemoryStorage();
    const { operation } = await saveOperation(storage, sale());
    const transport = server((_env, call) =>
      call === 1 ? { ok: false, kind: "transient", reason: "server_error", status: 503 } : null,
    );
    const opts = { transport, syncEpoch: "e", requestId: "r", random: () => 1 };
    await pushOnce(storage, opts);
    expect(await storage.read((tx) => tx.getMeta(LAST_OK_META))).toBeNull();
    await pushOnce(storage, opts);
    const log = await readAttempts(storage, operation.operationId);
    expect(log.map((a) => a.event)).toEqual(["saved", "sent", "transient", "sent", "accepted"]);
    expect(log[2]).toMatchObject({ status: 503, code: "server_error" });
    expect(savedAt(log)).toBe(log[0]!.at);
    expect(await storage.read((tx) => tx.getMeta(LAST_OK_META))).not.toBeNull();
  });

  it("المرفوضة تُحجر بسببها وتعود إلى الطابور بموضعها الزمني؛ إعادة الترقيم تعطي رقماً جديداً وتعيدها", async () => {
    const storage = new MemoryStorage();
    const first = (await saveOperation(storage, sale())).operation;
    const second = (await saveOperation(storage, sale())).operation;
    const transport = server((env) => ({
      ok: true,
      response: {
        protocol_version: 1,
        sync_epoch: env.sync_epoch,
        request_id: env.request_id,
        results: env.operations.map((op) => ({
          operation_id: op.operation_id,
          status: "rejected" as const,
          code: "commit_failed",
          detail: "duplicate key value violates unique constraint sales_sale_invoice_number",
        })),
        server_seq_high: "0",
      },
    }));
    await pushOnce(storage, { transport, syncEpoch: "e", requestId: "r" });
    expect(await storage.read((tx) => tx.listOperationsByState("quarantined"))).toHaveLength(2);
    expect((await readAttempts(storage, first.operationId)).at(-1)).toMatchObject({
      event: "rejected",
      code: "commit_failed",
    });

    expect(await requeueOperation(storage, second.operationId)).toBe(true);
    const back = await storage.read((tx) => tx.getOperation(second.operationId));
    expect(back?.state).toBe("local");
    expect(back?.createdLocalSeq).toBe(second.createdLocalSeq); // لا قفز

    await storage.transaction((tx) => tx.putMeta("invoice_seq", "9"));
    const number = await renumberSale(
      storage,
      first.operationId,
      { branchCode: "KRT", devicePrefix: "A2", yearTwoDigits: "26" },
      "entity:sales.Sale:",
    );
    expect(number).toBe("INV-KRT-A2-26-000010");
    const re = await storage.read((tx) => tx.getOperation(first.operationId));
    expect(re?.state).toBe("local");
    expect(re?.members[0]?.payload["invoice_number"]).toBe("INV-KRT-A2-26-000010");
    expect((await readAttempts(storage, first.operationId)).at(-1)).toMatchObject({
      event: "renumbered",
      detail: "INV-KRT-A2-26-000010",
    });
    // المؤكدة لا تُعاد ولا تُرقَّم
    expect(await requeueOperation(storage, "missing")).toBe(false);
  });
});
