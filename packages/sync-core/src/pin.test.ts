import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import { attemptUnlock, PIN_LOCK_POLICY, readPinLock, storeVerifiers, verifyPin } from "./pin";

// مشتق بالخادم فعلاً (hashlib.pbkdf2_hmac، ملح أصفار، ١٠٠٠ دورة) — متجه عبر اللغتين
const SERVER_ENCODED =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$xLL5EYZbGlWr9962Y1Y77xBK9jK/wka5FYHqDqwRYw8=";

async function deriveLikeServer(pin: string, saltB64: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
  );
  return btoa(String.fromCharCode(...bits));
}

const device = async () => ({
  device_id: "d1",
  prefix: "A2",
  branch_name: "فرع بحري",
  pin_length: 6,
  fetched_at: "2026-09-16T08:00:00Z",
  verifiers: [
    {
      user_id: "u1",
      display_name: "سميّة عبد الله",
      role_name: "مدير فرع",
      branch_name: "فرع بحري",
      encoded: `pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$${await deriveLikeServer("123456", "AAAAAAAAAAAAAAAAAAAAAA==", 1000)}`,
      version: 1,
    },
  ],
});

describe("PIN محلي (§٩.١، 28-D21 ACC-07)", () => {
  it("يتحقق بنفس خوارزمية الخادم ويرفض الخوارزمية الغريبة", async () => {
    const d = await device();
    expect(await verifyPin("123456", d.verifiers[0]!.encoded)).toBe(true);
    expect(await verifyPin("123457", d.verifiers[0]!.encoded)).toBe(false);
    expect(await verifyPin("123456", SERVER_ENCODED.replace("pbkdf2_sha256", "md5"))).toBe(false);
    // المتجه الخادمي يمرّ في TS دون تعديل
    expect(await verifyPin("123456", SERVER_ENCODED)).toBe(true);
    expect(d.verifiers[0]!.encoded).toBe(SERVER_ENCODED);
  });

  it("خمس محاولات خاطئة تقفل 15 دقيقة محلياً؛ الصحيح يصفّر العدّاد", async () => {
    const s = new MemoryStorage();
    await storeVerifiers(s, await device());
    const t0 = new Date("2026-09-16T10:00:00Z");
    for (let i = 1; i < PIN_LOCK_POLICY.maxAttempts; i++) {
      const r = await attemptUnlock(s, "000000", () => t0);
      expect(r).toEqual({ kind: "wrong", failed: i, maxAttempts: 5 });
    }
    const locked = await attemptUnlock(s, "000000", () => t0);
    expect(locked).toEqual({ kind: "locked", until: "2026-09-16T10:15:00.000Z" });
    // حتى الصحيح يُرفض أثناء القفل
    expect((await attemptUnlock(s, "123456", () => t0)).kind).toBe("locked");
    const after = new Date("2026-09-16T10:16:00Z");
    const ok = await attemptUnlock(s, "123456", () => after);
    expect(ok.kind).toBe("unlocked");
    expect(await readPinLock(s)).toEqual({ failed: 0, lockedUntil: null });
  });

  it("من غاب عن القائمة الخادمية يُوسم مسحوباً: PIN صحيح لكن الوصول ممنوع (34-D26 permission_denied)", async () => {
    const s = new MemoryStorage();
    const d = await device();
    await storeVerifiers(s, d);
    await storeVerifiers(s, { ...d, verifiers: [] });
    const r = await attemptUnlock(s, "123456");
    expect(r.kind).toBe("revoked");
    expect((await attemptUnlock(s, "000000")).kind).toBe("wrong");
    // عودته إلى القائمة تلغي الوسم
    await storeVerifiers(s, d);
    expect((await attemptUnlock(s, "123456")).kind).toBe("unlocked");
  });

  it("بلا متحققات منزَّلة: لا فتح محلي (المستخدم الجديد لا يدخل جهازاً لم يستقبل تخويله)", async () => {
    const s = new MemoryStorage();
    expect((await attemptUnlock(s, "123456")).kind).toBe("no_verifiers");
  });
});
