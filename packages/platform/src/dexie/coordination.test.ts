import { describe, expect, it } from "vitest";

import { requestPersistentStorage, withWriterLock } from "./coordination";

describe("تنسيق الكاتب الواحد (§٨.٢)", () => {
  it("يسلسل الأعمال على نفس القفل داخل العملية", async () => {
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        withWriterLock(
          "sting-writer",
          async () => {
            order.push(n);
            await new Promise((r) => setTimeout(r, 5 * (4 - n)));
            order.push(n * 10);
          },
          undefined,
        ),
      ),
    );
    expect(order).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it("يستعمل Web Locks حين تتوفر", async () => {
    const calls: string[] = [];
    const locks = { request: <T>(name: string, cb: () => Promise<T>) => (calls.push(name), cb()) };
    await withWriterLock("w", () => Promise.resolve(1), locks);
    expect(calls).toEqual(["w"]);
  });

  it("فشل عمل واحد لا يعلّق القفل للتالي", async () => {
    await expect(
      withWriterLock("x", () => Promise.reject(new Error("boom")), undefined),
    ).rejects.toThrow("boom");
    expect(await withWriterLock("x", () => Promise.resolve("ok"), undefined)).toBe("ok");
  });
});

describe("التخزين المستديم (§١٣.١)", () => {
  it("unsupported / granted / denied", async () => {
    expect(await requestPersistentStorage(undefined)).toBe("unsupported");
    expect(await requestPersistentStorage({ persist: () => Promise.resolve(true) })).toBe(
      "granted",
    );
    expect(await requestPersistentStorage({ persist: () => Promise.resolve(false) })).toBe(
      "denied",
    );
    expect(
      await requestPersistentStorage({
        persisted: () => Promise.resolve(true),
        persist: () => Promise.resolve(false),
      }),
    ).toBe("granted");
  });
});
