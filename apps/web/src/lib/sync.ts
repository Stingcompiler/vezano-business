"use client";

/**
 * ناقل الرفع المشترك (§٨.٣ من جهة الجهاز): غلاف واحد عبر `/api/sync/push`، والعابر يعود بموعد
 * المحاولة التالية، والمصادقة/الجيل يوقفان الرفع. `pendingAfter` يبلّغ الخادم بالمعلّق المتبقي
 * (ACC-09 «المعلّق على الأجهزة»).
 */
import {
  attemptsKey,
  adoptEpoch,
  EPOCH_CHANGE_META,
  EPOCH_RECONCILED_META,
  HALTED_META,
  LAST_OK_META,
  MAX_AUTO_ATTEMPTS,
  REVOKED_META,
  type TransportFailure,
  type PushEnvelope,
  type PushOnceOutcome,
  pushOnce,
  type PushResponse,
  type PushTransport,
} from "@sting/sync-core";

import { api, apiBaseUrl, getDeviceRefresh } from "@/lib/api";
import { getStorage, wipeLocalStorage } from "@/lib/storage";

export function createPushTransport(
  pendingAfter?: (sent: number) => Promise<number>,
): PushTransport {
  return {
    async push(envelope: PushEnvelope) {
      const left = pendingAfter ? await pendingAfter(envelope.operations.length) : undefined;
      const { data, error, response } = await api().POST("/api/sync/push", {
        body: {
          ...envelope,
          operations: envelope.operations.map((o) => ({ ...o })),
          ...(left === undefined ? {} : { pending_after: Math.max(0, left) }),
        },
      });
      const err = error as unknown as { detail?: string; sync_epoch?: string } | undefined;
      if (response.ok && data) return { ok: true, response: data as unknown as PushResponse };
      if (response.status === 401 || response.status === 403)
        return { ok: false, kind: "auth", status: response.status, detail: err?.detail ?? "" };
      if (response.status === 409)
        return { ok: false, kind: "epoch_mismatch", currentEpoch: err?.sync_epoch ?? "" };
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
  if (out.kind === "halt") await onHalt(out.failure, epoch);
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

/**
 * الوقوف بإشارة (§٨.٣/§٨.١٢/§٩.٣): تغيّر الجيل يُسجَّل للمصالحة (SYS-08) ولا يُعتمد تلقائياً؛
 * سحب الجهاز يسلّم المعلّق إلى الحجر باعتماد مقيّد (SYS-07)؛ المحو عن بُعد يُنفَّذ محلياً.
 */
async function onHalt(failure: Exclude<TransportFailure, { kind: "transient" }>, epoch: string) {
  const storage = getStorage();
  if (failure.kind === "epoch_mismatch") {
    if (!failure.currentEpoch || failure.currentEpoch === epoch) return;
    await storage.transaction((tx) =>
      tx.putMeta(
        EPOCH_CHANGE_META,
        JSON.stringify({
          previous: epoch,
          next: failure.currentEpoch,
          detectedAt: new Date().toISOString(),
        }),
      ),
    );
    return;
  }
  if (failure.kind === "auth") {
    if (failure.detail === "device_wiped") {
      // أُقرّ فقد المعلّق عند المالك — الجهاز يمسح محلّيه (SYS-07)
      await wipeLocalStorage();
      return;
    }
    if (failure.detail === "device_revoked" || failure.detail === "session_revoked") {
      await handOverToQuarantine();
    }
  }
}

export interface HandoverOutcome {
  readonly held: number;
  readonly duplicate: number;
  readonly failed: boolean;
}

/** SYS-07 (§٩.٣): الجهاز المسحوب يسلّم عمله غير المرفوع إلى الحجر برمز التجديد — لا هوية من الحمولة. */
export async function handOverToQuarantine(): Promise<HandoverOutcome> {
  const storage = getStorage();
  const refresh = getDeviceRefresh();
  const ops = await storage.read(async (tx) => [
    ...(await tx.listOperationsByState("local")),
    ...(await tx.listOperationsByState("pending")),
  ]);
  if (!refresh || ops.length === 0) return { held: 0, duplicate: 0, failed: !refresh };
  try {
    const r = await fetch(`${apiBaseUrl()}/api/sync/recovery/handover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refresh}` },
      body: JSON.stringify({
        operations: ops.map((op) => ({
          operation_id: op.operationId,
          kind: op.kind,
          op_version: op.opVersion,
          dependencies: op.dependencies,
          members: op.members.map((m) => ({
            entity: m.entity,
            id: m.id,
            schema_version: m.schemaVersion,
            payload: m.payload,
          })),
        })),
      }),
    });
    if (!r.ok) return { held: 0, duplicate: 0, failed: true };
    const body = (await r.json()) as {
      device_status: string;
      results: { operation_id: string; status: string }[];
    };
    let held = 0;
    let duplicate = 0;
    await storage.transaction(async (tx) => {
      for (const res of body.results) {
        if (res.status !== "held" && res.status !== "duplicate") continue;
        const op = await tx.getOperation(res.operation_id);
        if (!op) continue;
        await tx.putOperation({ ...op, state: "quarantined" });
        await tx.putMeta(
          `quarantine:${op.operationId}`,
          JSON.stringify({ code: "recovered", detail: body.device_status }),
        );
        const raw = await tx.getMeta(attemptsKey(op.operationId));
        const list = raw ? (JSON.parse(raw) as unknown[]) : [];
        list.push({ at: new Date().toISOString(), event: "handed_over", code: body.device_status });
        await tx.putMeta(attemptsKey(op.operationId), JSON.stringify(list.slice(-30)));
        if (res.status === "held") held += 1;
        else duplicate += 1;
      }
      await tx.putMeta(
        REVOKED_META,
        JSON.stringify({ status: body.device_status, at: new Date().toISOString(), held }),
      );
    });
    return { held, duplicate, failed: false };
  } catch {
    return { held: 0, duplicate: 0, failed: true };
  }
}

export interface EpochChange {
  readonly previous: string;
  readonly next: string;
  readonly detectedAt: string;
}

export async function readEpochChange(): Promise<EpochChange | null> {
  const raw = await getStorage().read((tx) => tx.getMeta(EPOCH_CHANGE_META));
  return raw ? (JSON.parse(raw) as EpochChange) : null;
}

export interface ReconcileOutcome {
  readonly present: number;
  readonly toUpload: number;
  readonly held: number;
  readonly synced: number;
}

/**
 * SYS-08 (§٨.١٢): اعتماد الجيل الجديد (عزل الأرقام القديمة، المؤكد يعود local بهويته)، ثم مقارنة
 * الهويات بما عند الخادم — ما نجا يُترك مؤكداً، وما فُقد يُرفع من جديد، وما اختلف يُحجز.
 */
export async function reconcileEpoch(change: EpochChange): Promise<ReconcileOutcome> {
  const storage = getStorage();
  await adoptEpoch(storage, change.next);
  const local = await storage.read((tx) => tx.listOperationsByState("local"));
  const { data, response } = await api().POST("/api/sync/reconcile", {
    body: { operation_ids: local.map((o) => o.operationId) },
  });
  const body = data as unknown as { present: string[]; missing: string[] } | undefined;
  if (!response.ok || !body) throw new Error("reconcile_failed");
  const present = new Set(body.present);
  await storage.transaction(async (tx) => {
    for (const op of local) {
      if (!present.has(op.operationId)) continue;
      // نجت عند الخادم بهويتها — تُترك مؤكدة (الأرقام تعود مع PULL؛ لا تُرفع من جديد)
      await tx.putOperation({ ...op, state: "synced" });
    }
  });
  const push = await pushPending(10, { manual: true });
  const after = await storage.read(async (tx) => ({
    conflict: (await tx.listOperationsByState("conflict")).length,
    quarantined: (await tx.listOperationsByState("quarantined")).length,
  }));
  const synced = push.kind === "applied" ? push.synced : 0;
  await storage.transaction((tx) => tx.putMeta(EPOCH_CHANGE_META, ""));
  await storage.transaction((tx) =>
    tx.putMeta(
      EPOCH_RECONCILED_META,
      JSON.stringify({
        previous: change.previous,
        next: change.next,
        at: new Date().toISOString(),
        present: body.present.length,
        uploaded: body.missing.length,
        held: after.conflict + after.quarantined,
      }),
    ),
  );
  return {
    present: body.present.length,
    toUpload: body.missing.length,
    held: after.conflict + after.quarantined,
    synced,
  };
}
