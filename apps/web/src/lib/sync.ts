"use client";

/**
 * ناقل الرفع المشترك (§٨.٣ من جهة الجهاز): غلاف واحد عبر `/api/sync/push`، والعابر يعود بموعد
 * المحاولة التالية، والمصادقة/الجيل يوقفان الرفع. `pendingAfter` يبلّغ الخادم بالمعلّق المتبقي
 * (ACC-09 «المعلّق على الأجهزة»).
 */
import {
  HALTED_META,
  LAST_OK_META,
  MAX_AUTO_ATTEMPTS,
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

/**
 * محاولة رفع واحدة لكل ما هو معلّق محلياً؛ تعيد نتيجة `pushOnce` الأخيرة.
 * «ثلاث محاولات متباعدة ثم وقوف — والطابور محفوظ كما هو» (SYS-01): بعد `MAX_AUTO_ATTEMPTS` أعطال
 * متتالية يقف الرفع التلقائي (`sync.halted`) ولا يستأنفه إلا «محاولة رفع الآن» (`manual`).
 */
export async function pushPending(
  maxRounds = 10,
  opts: { manual?: boolean } = {},
): Promise<PushOnceOutcome> {
  const storage = getStorage();
  const epoch = (await storage.read((tx) => tx.getMeta("sync_epoch"))) ?? "";
  const halted = await storage.read((tx) => tx.getMeta(HALTED_META));
  if (halted && !opts.manual) {
    const last = await readLastPush();
    return {
      kind: "retry",
      failure: { kind: "transient", reason: "server_error", status: last?.status ?? 0 },
      delayMs: 0,
    };
  }
  const transport = createPushTransport(async (sent) => (await countPending()) - sent);
  let out: PushOnceOutcome = { kind: "idle" };
  for (let i = 0; i < maxRounds; i++) {
    out = await pushOnce(storage, { transport, syncEpoch: epoch, requestId: crypto.randomUUID() });
    if (out.kind !== "applied") break;
  }
  await storage.transaction(async (tx) => {
    if (out.kind === "retry") {
      const attempts = Number((await tx.getMeta("push_attempts")) ?? "0");
      if (attempts >= MAX_AUTO_ATTEMPTS) await tx.putMeta(HALTED_META, new Date().toISOString());
    } else if (out.kind === "applied" || out.kind === "idle") {
      await tx.putMeta(HALTED_META, "");
    }
  });
  // آخر محاولة رفع — تقرؤها POS-11 لتقول «الخادم ردّ بخطأ 500» باسمه لا «حدث خطأ»
  await storage.transaction((tx) =>
    tx.putMeta(
      LAST_PUSH_META,
      JSON.stringify({
        kind: out.kind,
        status: out.kind === "retry" ? out.failure.status : undefined,
        at: new Date().toISOString(),
      } satisfies LastPush),
    ),
  );
  return out;
}

export const LAST_PUSH_META = "sync.last_push";

export interface LastPush {
  readonly kind: PushOnceOutcome["kind"];
  readonly status?: number | undefined;
  readonly at: string;
}

export async function readLastPush(): Promise<LastPush | null> {
  const raw = await getStorage().read((tx) => tx.getMeta(LAST_PUSH_META));
  return raw ? (JSON.parse(raw) as LastPush) : null;
}

export interface ReachStatus {
  readonly server_time: string;
  readonly sync_epoch: string;
  readonly server_seq_high: string;
  readonly quarantined: number;
  readonly conflicted: number;
  readonly last_accepted_at: string | null;
}

/** فحص الوصول (SYS-01): «هناك شبكة» ≠ «نجح الوصول» — ردٌّ مصادَق من الخادم يحدّث `sync.last_ok`. */
export async function checkReach(): Promise<ReachStatus | null> {
  try {
    const { data, response } = await api().GET("/api/sync/status", {});
    const body = data as unknown as ReachStatus | undefined;
    if (!response.ok || !body) return null;
    await getStorage().transaction((tx) => tx.putMeta(LAST_OK_META, new Date().toISOString()));
    return body;
  } catch {
    return null;
  }
}

/** «طابق الآن» / «محاولة رفع الآن»: رفع يدوي يستأنف بعد الوقوف ثم فحص وصول. */
export async function reconcileNow(): Promise<{
  push: PushOnceOutcome;
  /** ما رُفع فعلاً في هذه الجولة — «رُفعت 12 عملية» لا «تمت المزامنة» */
  synced: number;
  reach: ReachStatus | null;
}> {
  const before = await countPending();
  const push = await pushPending(10, { manual: true });
  const after = await countPending();
  const reach = await checkReach();
  return { push, synced: Math.max(0, before - after), reach };
}

export async function readLastOk(): Promise<string | null> {
  return getStorage().read((tx) => tx.getMeta(LAST_OK_META));
}

export async function readHalted(): Promise<string | null> {
  const v = await getStorage().read((tx) => tx.getMeta(HALTED_META));
  return v || null;
}
