/**
 * تنسيق الكاتب الواحد بين التبويبات (§٨.٢) وطلب التخزين المستديم (§١٣.١) — ويب فقط.
 *
 * - `withWriterLock`: Web Locks API حين تتوفر (قفل حقيقي عبر التبويبات، يُحرَّر تلقائياً بموت
 *   التبويب المالك فيستأنف الآخر — الحالة المطلوب اختبارها في §٨.٢)؛ وإلا قفل داخل العملية.
 *   `localStorage` ليس قفلاً ذرّياً ولا يُستعمل هنا.
 * - `requestPersistentStorage`: رفض المنح يمنع اعتماد الجهاز لوضع البيع (بوابة تجهيز لا اشتراك).
 */

export type PersistOutcome = "granted" | "denied" | "unsupported";

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

const inProcessLocks = new Map<string, Promise<unknown>>();

function inProcessLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = inProcessLocks.get(name) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  inProcessLocks.set(
    name,
    next.catch(() => undefined),
  );
  return next;
}

export function withWriterLock<T>(
  name: string,
  fn: () => Promise<T>,
  locks: LockManagerLike | undefined = globalThis.navigator?.locks,
): Promise<T> {
  if (locks) return locks.request(name, fn);
  return inProcessLock(name, fn);
}

export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<PersistOutcome> {
  if (!storage?.persist) return "unsupported";
  if (storage.persisted && (await storage.persisted())) return "granted";
  return (await storage.persist()) ? "granted" : "denied";
}

export async function storageEstimate(
  storage: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<{ usage: number; quota: number } | null> {
  if (!storage?.estimate) return null;
  const e = await storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
