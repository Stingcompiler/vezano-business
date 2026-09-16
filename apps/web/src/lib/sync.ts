"use client";

/**
 * ناقل الرفع المشترك (§٨.٣ من جهة الجهاز): غلاف واحد عبر `/api/sync/push`، والعابر يعود بموعد
 * المحاولة التالية، والمصادقة/الجيل يوقفان الرفع. `pendingAfter` يبلّغ الخادم بالمعلّق المتبقي
 * (ACC-09 «المعلّق على الأجهزة»).
 */
import {
  type PushEnvelope,
  type PushOnceOutcome,
  pushOnce,
  type PushResponse,
  type PushTransport,
} from "@sting/sync-core";

import { api } from "@/lib/api";
import { getStorage } from "@/lib/storage";

export function createPushTransport(
  pendingAfter?: (sent: number) => Promise<number>,
): PushTransport {
  return {
    async push(envelope: PushEnvelope) {
      const left = pendingAfter ? await pendingAfter(envelope.operations.length) : undefined;
      const { data, response } = await api().POST("/api/sync/push", {
        body: {
          ...envelope,
          operations: envelope.operations.map((o) => ({ ...o })),
          ...(left === undefined ? {} : { pending_after: Math.max(0, left) }),
        },
      });
      if (response.ok && data) return { ok: true, response: data as unknown as PushResponse };
      if (response.status === 401 || response.status === 403)
        return { ok: false, kind: "auth", status: response.status };
      if (response.status === 409) return { ok: false, kind: "epoch_mismatch", currentEpoch: "" };
      return { ok: false, kind: "transient", reason: "server_error", status: response.status };
    },
  };
}

export async function countPending(): Promise<number> {
  return getStorage().read(
    async (tx) =>
      (await tx.listOperationsByState("local")).length +
      (await tx.listOperationsByState("pending")).length,
  );
}

/** محاولة رفع واحدة لكل ما هو معلّق محلياً؛ تعيد نتيجة `pushOnce` الأخيرة. */
export async function pushPending(maxRounds = 10): Promise<PushOnceOutcome> {
  const storage = getStorage();
  const epoch = (await storage.read((tx) => tx.getMeta("sync_epoch"))) ?? "";
  const transport = createPushTransport(async (sent) => (await countPending()) - sent);
  let out: PushOnceOutcome = { kind: "idle" };
  for (let i = 0; i < maxRounds; i++) {
    out = await pushOnce(storage, { transport, syncEpoch: epoch, requestId: crypto.randomUUID() });
    if (out.kind !== "applied") break;
  }
  return out;
}
