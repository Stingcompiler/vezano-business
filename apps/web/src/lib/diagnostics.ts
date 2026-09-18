"use client";

/**
 * التشخيص المحلي (SYS-04/SYS-11؛ §١٣.١، §١٣.٦): مساحة الجهاز واستدامتها، سجل الأخطاء التقنية من
 * سجلّ محاولات العمليات (بلا أسماء ولا مبالغ)، فشل الطباعة، وفشل الكتابة. «الجهاز الذي امتلأ يكذب:
 * يبدو عاملاً ولا يحفظ» — لذا الحدّ الآمن يُفحص قبل الحفظ لا بعده.
 */
import type { LocalOpState, StoredOperation } from "@sting/platform";
import { storageEstimate } from "@sting/platform/dexie";
import { type AttemptEntry, readAttempts, savedAt } from "@sting/sync-core";

import { getStorage } from "@/lib/storage";
import { readHalted, readLastOk } from "@/lib/sync";

/** الحدّ الآمن (16-D11): «المتبقي أقل من 40 ميغابايت» */
export const SAFE_MIN_BYTES = 40 * 1024 * 1024;
export const PRINT_FAILURES_META = "diag.print_failures";
/** معلّق أقدم من ست ساعات = فشل استدامة لا انقطاع عابر (PLAN T1.36) */
export const PENDING_STALE_MS = 6 * 3_600_000;

const FAILURE_EVENTS: readonly AttemptEntry["event"][] = [
  "transient",
  "auth",
  "epoch_mismatch",
  "permanent",
  "rejected",
  "conflicted",
];

let writeFailures = 0;

/** يُستدعى من مسارات الحفظ عند فشل كتابة (QuotaExceeded وأشباهه) — في الذاكرة لأن التخزين نفسه معطوب. */
export const WRITE_FAIL_EVENT = "sting:write-failure";

export function recordWriteFailure(): number {
  writeFailures += 1;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WRITE_FAIL_EVENT));
  return writeFailures;
}

// واجهة اختبار (Playwright): محاكاة فشل الكتابة بلا ملء التخزين فعلاً
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __stingWriteFail?: () => void }).__stingWriteFail = () => {
    recordWriteFailure();
  };
}

export function writeFailureCount(): number {
  return writeFailures;
}

/** للاختبار: تصفير العدّاد بين السيناريوهات. */
export function resetWriteFailures(): void {
  writeFailures = 0;
}

export interface StorageSnapshot {
  readonly usage: number;
  readonly quota: number;
  readonly free: number;
  readonly persisted: boolean | null;
}

export async function storageSnapshot(): Promise<StorageSnapshot | null> {
  const e = await storageEstimate();
  if (!e) return null;
  let persisted: boolean | null = null;
  try {
    persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    persisted = null;
  }
  return { usage: e.usage, quota: e.quota, free: Math.max(0, e.quota - e.usage), persisted };
}

/** «نمنع قبل الحفظ لا بعده»: صحيح إن كانت المساحة المتبقية دون الحدّ الآمن. */
export async function storageLow(): Promise<boolean> {
  const s = await storageSnapshot();
  return s !== null && s.quota > 0 && s.free < SAFE_MIN_BYTES;
}

export interface ErrorEntry {
  readonly at: string;
  readonly event: AttemptEntry["event"];
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  /** أول 6 أحرف من معرّف العملية — كافٍ للدعم ولا يكشف شيئاً */
  readonly op: string;
  readonly kind: string;
}

const STATES: readonly LocalOpState[] = ["local", "pending", "conflict", "quarantined", "synced"];

async function allOperations(): Promise<StoredOperation[]> {
  const storage = getStorage();
  return storage.read(async (tx) => {
    const out: StoredOperation[] = [];
    for (const st of STATES) out.push(...(await tx.listOperationsByState(st)));
    return out;
  });
}

/** سجل الأخطاء التقنية في آخر `hours` ساعة — من سجلّ المحاولات؛ لا حمولات ولا أسماء. */
export async function errorLog(hours: number): Promise<ErrorEntry[]> {
  const since = Date.now() - hours * 3_600_000;
  const ops = await allOperations();
  const storage = getStorage();
  const out: ErrorEntry[] = [];
  for (const op of ops) {
    const attempts = await readAttempts(storage, op.operationId);
    for (const a of attempts) {
      if (!FAILURE_EVENTS.includes(a.event)) continue;
      if (new Date(a.at).getTime() < since) continue;
      out.push({
        at: a.at,
        event: a.event,
        status: a.status,
        code: a.code,
        op: op.operationId.replace(/-/g, "").slice(0, 6),
        kind: op.kind,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export interface UsageBreakdown {
  readonly synced: number;
  readonly pending: number;
  readonly held: number;
  readonly projections: number;
  /** وقت حفظ أقدم عملية — لمعدّل الاستهلاك اليومي */
  readonly oldestSavedAt: string | null;
  /** وقت حفظ أقدم معلّق */
  readonly oldestPendingAt: string | null;
  /** بايتات تقريبية لسجلات محاولات العمليات المؤكدة الأقدم من أسبوع — ما يُحذف بأمان */
  readonly reclaimableBytes: number;
}

export async function usageBreakdown(): Promise<UsageBreakdown> {
  const storage = getStorage();
  const ops = await allOperations();
  const projections = await storage.read(
    async (tx) => (await tx.listProjections("entity:")).length,
  );
  let oldest: string | null = null;
  let oldestPending: string | null = null;
  let reclaimable = 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const op of ops) {
    const attempts = await readAttempts(storage, op.operationId);
    const s = savedAt(attempts);
    if (s && (!oldest || s < oldest)) oldest = s;
    if (
      (op.state === "local" || op.state === "pending") &&
      s &&
      (!oldestPending || s < oldestPending)
    )
      oldestPending = s;
    if (op.state === "synced" && s && new Date(s).getTime() < weekAgo)
      reclaimable += JSON.stringify(attempts).length;
  }
  return {
    synced: ops.filter((o) => o.state === "synced").length,
    pending: ops.filter((o) => o.state === "local" || o.state === "pending").length,
    held: ops.filter((o) => o.state === "conflict" || o.state === "quarantined").length,
    projections,
    oldestSavedAt: oldest,
    oldestPendingAt: oldestPending,
    reclaimableBytes: reclaimable,
  };
}

/**
 * التنظيف الآمن: سجلات محاولات العمليات المؤكدة الأقدم من أسبوع فقط — لا يلمس معلّقاً ولا محجوزاً،
 * ولا المعاملات نفسها («المعاملات نفسها لا تُحذف لتحرير مساحة أبداً»). يعيد عدد السجلات المحذوفة.
 */
export async function safeCleanup(): Promise<number> {
  const storage = getStorage();
  const weekAgo = Date.now() - 7 * 86_400_000;
  const synced = await storage.read((tx) => tx.listOperationsByState("synced"));
  let removed = 0;
  for (const op of synced) {
    const attempts = await readAttempts(storage, op.operationId);
    const s = savedAt(attempts);
    if (!s || new Date(s).getTime() >= weekAgo) continue;
    await storage.transaction((tx) => tx.putMeta(`sync.attempts:${op.operationId}`, ""));
    removed += 1;
  }
  return removed;
}

export async function recordPrintFailure(): Promise<void> {
  const storage = getStorage();
  await storage.transaction(async (tx) => {
    const raw = await tx.getMeta(PRINT_FAILURES_META);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    list.push(new Date().toISOString());
    await tx.putMeta(PRINT_FAILURES_META, JSON.stringify(list.slice(-50)));
  });
}

export async function printFailures(): Promise<string[]> {
  const raw = await getStorage().read((tx) => tx.getMeta(PRINT_FAILURES_META));
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export interface SupportPayload {
  readonly generated_at: string;
  readonly app: { readonly version: string; readonly platform: string; readonly ua_family: string };
  readonly device: { readonly id: string; readonly prefix: string; readonly branch_code: string };
  readonly storage: {
    readonly usage_bytes: number;
    readonly quota_bytes: number;
    readonly persisted: boolean | null;
    readonly write_failures: number;
  };
  readonly sync: {
    readonly pending: number;
    readonly held: number;
    readonly halted: boolean;
    readonly last_ok: string | null;
  };
  readonly errors: readonly ErrorEntry[];
  readonly print_failures: number;
}

export const APP_VERSION = process.env["NEXT_PUBLIC_APP_VERSION"] ?? "0.0.0-dev";

function uaFamily(ua: string): string {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad/i.test(ua)) return "ios";
  if (/Mac OS/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

/** يبني التقرير كما سيُرسل حرفياً — بنية تقنية لا غير (ACC-87). */
export async function buildSupportPayload(device: {
  id: string;
  prefix: string;
  branchCode: string;
}): Promise<SupportPayload> {
  const [snap, errors, usage, prints, halted, lastOk] = await Promise.all([
    storageSnapshot(),
    errorLog(48),
    usageBreakdown(),
    printFailures(),
    readHalted(),
    readLastOk(),
  ]);
  return {
    generated_at: new Date().toISOString(),
    app: {
      version: APP_VERSION,
      platform: typeof navigator === "undefined" ? "" : navigator.platform,
      ua_family: typeof navigator === "undefined" ? "" : uaFamily(navigator.userAgent),
    },
    device: { id: device.id, prefix: device.prefix, branch_code: device.branchCode },
    storage: {
      usage_bytes: snap?.usage ?? 0,
      quota_bytes: snap?.quota ?? 0,
      persisted: snap?.persisted ?? null,
      write_failures: writeFailureCount(),
    },
    sync: { pending: usage.pending, held: usage.held, halted: Boolean(halted), last_ok: lastOk },
    errors,
    print_failures: prints.length,
  };
}
