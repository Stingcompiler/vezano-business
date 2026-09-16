/**
 * PIN المحلي على الجهاز (§٩.١): التحقق بنفس خوارزمية الخادم (PBKDF2-SHA256، ملح لكل مستخدم)
 * عبر WebCrypto — لا PIN نصي ولا شبكة. مرآة `backend/core/auth/pin.py`.
 *
 * القفل بعد المحاولات الخاطئة محلي (28-D21 ACC-07): «محاولة خاطئة — N من 5. بعد الخامسة يُقفل
 * الجهاز 15 دقيقة». لا يُحذف شيء ولا تُرسل عمليات.
 */
import type { StoragePort } from "@sting/platform";

export const PIN_ALGORITHM = "pbkdf2_sha256";
export const PIN_LOCK_POLICY = { maxAttempts: 5, lockMinutes: 15 } as const;
export const PIN_STATE_KEY = "pin.lock_state";
export const PIN_VERIFIERS_KEY = "pin.verifiers";

export interface PinVerifierRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly role_name: string;
  readonly branch_name: string;
  readonly encoded: string;
  readonly version: number;
  /** غاب عن آخر قائمة خادمية: سُحب وصوله إلى هذا الجهاز — يُطبَّق عند أول اتصال (34-D26). */
  readonly revoked?: boolean | undefined;
}

export interface DeviceVerifiers {
  readonly device_id: string;
  readonly prefix: string;
  readonly branch_name: string;
  readonly pin_length: number;
  readonly verifiers: readonly PinVerifierRow[];
  readonly fetched_at: string;
}

const b64 = {
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

/** يتحقق من PIN مقابل متحقق مشفَّر `pbkdf2_sha256$iterations$salt$hash`. */
export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  const [algorithm, iterations, salt, hash] = encoded.split("$");
  if (algorithm !== PIN_ALGORITHM || !iterations || !salt || !hash) return false;
  const expected = b64.decode(hash);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64.decode(salt), iterations: Number(iterations) },
      key,
      expected.length * 8,
    ),
  );
  // مقارنة بزمن ثابت
  let diff = bits.length ^ expected.length;
  for (let i = 0; i < bits.length; i++) diff |= (bits[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

export interface PinLockState {
  readonly failed: number;
  readonly lockedUntil: string | null;
}

export async function readPinLock(storage: StoragePort): Promise<PinLockState> {
  const raw = await storage.read((tx) => tx.getMeta(PIN_STATE_KEY));
  return raw ? (JSON.parse(raw) as PinLockState) : { failed: 0, lockedUntil: null };
}

export type UnlockOutcome =
  | { readonly kind: "unlocked"; readonly user: PinVerifierRow }
  | { readonly kind: "revoked"; readonly user: PinVerifierRow }
  | { readonly kind: "wrong"; readonly failed: number; readonly maxAttempts: number }
  | { readonly kind: "locked"; readonly until: string }
  | { readonly kind: "no_verifiers" };

/**
 * محاولة فتح: يجرّب PIN على متحققات الجهاز؛ الخطأ يزيد العدّاد، والخامسة تقفل 15 دقيقة —
 * كل ذلك في التخزين المحلي بلا شبكة.
 */
export async function attemptUnlock(
  storage: StoragePort,
  pin: string,
  now: () => Date = () => new Date(),
): Promise<UnlockOutcome> {
  const [lock, rawVerifiers] = await storage.read(async (tx) => [
    await tx.getMeta(PIN_STATE_KEY),
    await tx.getMeta(PIN_VERIFIERS_KEY),
  ]);
  const state: PinLockState = lock
    ? (JSON.parse(lock) as PinLockState)
    : { failed: 0, lockedUntil: null };
  if (state.lockedUntil && new Date(state.lockedUntil).getTime() > now().getTime()) {
    return { kind: "locked", until: state.lockedUntil };
  }
  const device = rawVerifiers ? (JSON.parse(rawVerifiers) as DeviceVerifiers) : null;
  if (!device || device.verifiers.length === 0) return { kind: "no_verifiers" };
  for (const v of device.verifiers) {
    if (await verifyPin(pin, v.encoded)) {
      await storage.transaction((tx) =>
        tx.putMeta(PIN_STATE_KEY, JSON.stringify({ failed: 0, lockedUntil: null })),
      );
      // «الرمز صحيح — لكن وصولك إلى هذا الجهاز سُحب»: أمران مختلفان، لا يُعدّ خطأً
      return v.revoked ? { kind: "revoked", user: v } : { kind: "unlocked", user: v };
    }
  }
  const failed = (state.lockedUntil ? 0 : state.failed) + 1;
  const lockedUntil =
    failed >= PIN_LOCK_POLICY.maxAttempts
      ? new Date(now().getTime() + PIN_LOCK_POLICY.lockMinutes * 60_000).toISOString()
      : null;
  await storage.transaction((tx) =>
    tx.putMeta(PIN_STATE_KEY, JSON.stringify({ failed: lockedUntil ? 0 : failed, lockedUntil })),
  );
  if (lockedUntil) return { kind: "locked", until: lockedUntil };
  return { kind: "wrong", failed, maxAttempts: PIN_LOCK_POLICY.maxAttempts };
}

/**
 * يخزّن القائمة الخادمية الكاملة؛ من كان معروفاً وغاب عنها يبقى موسوماً `revoked` حتى يُعلَن له
 * السحب بدل الخلط بينه وبين PIN خاطئ.
 */
export async function storeVerifiers(storage: StoragePort, device: DeviceVerifiers): Promise<void> {
  await storage.transaction(async (tx) => {
    const raw = await tx.getMeta(PIN_VERIFIERS_KEY);
    const previous = raw ? (JSON.parse(raw) as DeviceVerifiers) : null;
    const fresh = new Set(device.verifiers.map((v) => v.user_id));
    const revoked = (previous?.verifiers ?? [])
      .filter((v) => !fresh.has(v.user_id))
      .map((v) => ({ ...v, revoked: true }));
    await tx.putMeta(
      PIN_VERIFIERS_KEY,
      JSON.stringify({ ...device, verifiers: [...device.verifiers, ...revoked] }),
    );
  });
}

export async function readVerifiers(storage: StoragePort): Promise<DeviceVerifiers | null> {
  const raw = await storage.read((tx) => tx.getMeta(PIN_VERIFIERS_KEY));
  return raw ? (JSON.parse(raw) as DeviceVerifiers) : null;
}
