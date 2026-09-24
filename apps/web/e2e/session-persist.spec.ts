import { expect, type Page, test } from "@playwright/test";

import { openDrawerIfPhone } from "./nav";

/**
 * بقاء الجلسة بعد إعادة التحميل (0005 §١٢١): السياق محلي والسرّ في Cookie `HttpOnly`؛ إعادة التحميل
 * على جهاز مُجهَّز تمرّ بالقفل ثم تُستأنف إلى الشاشة نفسها؛ بلا شبكة تعمل محلياً؛ 401 أثناء العمل
 * يُستأنف صامتاً ويُعاد الطلب. بلا إطار مرسوم → بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
// PIN 123456 (المتجه نفسه في acc-invite-lock.spec.ts)
const ENCODED =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$xLL5EYZbGlWr9962Y1Y77xBK9jK/wka5FYHqDqwRYw8=";
const row = (user_id: string, display_name: string) => ({
  user_id,
  display_name,
  role_name: "مدير فرع",
  branch_name: "فرع بحري",
  encoded: ENCODED,
  version: 1,
});

async function seedDevice(page: Page, rows: unknown[]) {
  await page.evaluate(
    async ({ rows }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        store.put({ key: "device.setup", value: "done" });
        store.put({
          key: "pin.verifiers",
          value: JSON.stringify({
            device_id: "d1",
            prefix: "DV-A19",
            branch_name: "فرع بحري",
            pin_length: 6,
            fetched_at: new Date().toISOString(),
            verifiers: rows,
          }),
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(new Error(String(tx.error)));
      });
      db.close();
    },
    { rows },
  );
}

async function typePin(page: Page, digits: string) {
  for (const d of digits)
    await page.locator(".acc-keypad").getByRole("button", { name: d, exact: true }).click();
}

/** دخول بجلسة حيّة (user u1، منشأة t1) إلى شاشة داخلية. */
async function liveSession(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/org/subscription", (route) =>
    route.fulfill(json(403, { detail: "owner_required" })),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}$`));
}

const RESUMED = {
  access: "a2",
  refresh: "r2",
  session_id: "s",
  user_id: "u1",
  tenant_id: "t1",
};

test.describe("بقاء الجلسة", () => {
  test("إعادة التحميل ← القفل ← الرمز ← استئناف إلى الشاشة نفسها", async ({ page }) => {
    let remembered = "";
    await page.route("**/api/auth/remember", (route) => {
      remembered = (route.request().postDataJSON() as { refresh: string }).refresh;
      return route.fulfill({ status: 204 });
    });
    let resumes = 0;
    await page.route("**/api/auth/resume", (route) => {
      resumes += 1;
      return route.fulfill(json(200, RESUMED));
    });
    await liveSession(page, "/org/subscription");
    await expect.poll(() => remembered).toBe("r");
    await seedDevice(page, [row("u1", "سميّة عبد الله")]);
    await page.reload();
    await expect(page).toHaveURL(/\/lock\?next=%2Forg%2Fsubscription$/);
    expect(resumes).toBe(0); // لا استئناف قبل الرمز
    await typePin(page, "123456");
    await expect(page).toHaveURL(/\/org\/subscription$/);
    expect(resumes).toBe(1);
    await expect.poll(() => remembered).toBe("r2"); // الرمز المدوَّر يُحفظ من جديد
  });

  test("بلا شبكة بعد إعادة التحميل: الرمز يفتح وضعاً محلياً لا شاشة دخول", async ({
    page,
    context,
  }) => {
    await page.route("**/api/auth/remember", (route) => route.fulfill({ status: 204 }));
    await liveSession(page, "/org/subscription");
    await seedDevice(page, [row("u1", "سميّة عبد الله")]);
    await page.goto("/lock?next=%2F");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await typePin(page, "123456");
    await expect(page).toHaveURL(/\/$/);
    await expect(page).not.toHaveURL(/\/login/);
    await context.setOffline(false);
  });

  test("401 أثناء العمل يُستأنف صامتاً ويُعاد الطلب — لا شاشة «انتهت الجلسة»", async ({ page }) => {
    await page.route("**/api/auth/remember", (route) => route.fulfill({ status: 204 }));
    await page.route("**/api/auth/resume", (route) => route.fulfill(json(200, RESUMED)));
    let calls = 0;
    const auths: string[] = [];
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.route("**/api/org/subscription", (route) => {
      calls += 1;
      auths.push(route.request().headers()["authorization"] ?? "");
      return calls === 1
        ? route.fulfill(json(401, { detail: "token_not_valid" }))
        : route.fulfill(json(403, { detail: "owner_required" }));
    });
    await page.goto("/login?next=%2Forg%2Fsubscription");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page).toHaveURL(/\/org\/subscription$/);
    // الأول بالرمز المنتهي فرُدّ 401، ثم أُعيد بالرمز المستأنَف (طلبات متزامنة سابقة قد تحمل القديم)
    await expect.poll(() => auths.includes("Bearer a2")).toBe(true);
    expect(auths[0]).toBe("Bearer a");
    await expect(page).not.toHaveURL(/session-expired/);
  });

  test("تسجيل الخروج (0005 §١٢٢): تأكيد يقول ما يبقى، ثم إلغاء الجلسة ومسح السياق — لا استئناف بعدها", async ({
    page,
  }) => {
    await page.route("**/api/auth/remember", (route) => route.fulfill({ status: 204 }));
    let loggedOut = false;
    await page.route("**/api/auth/logout", (route) => {
      loggedOut = true;
      return route.fulfill({ status: 204 });
    });
    await page.route("**/api/auth/forget", (route) => route.fulfill({ status: 204 }));
    let resumes = 0;
    await page.route("**/api/auth/resume", (route) => {
      resumes += 1;
      return route.fulfill(json(401, { detail: "not_remembered" }));
    });
    await liveSession(page, "/org/subscription");
    await openDrawerIfPhone(page);
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page.getByRole("group", { name: "تأكيد الخروج" })).toContainText(
      "كل عملك مرفوع. الجهاز يبقى مُجهَّزاً.",
    );
    await page.getByRole("button", { name: "اخرج", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(loggedOut).toBe(true);
    // السياق مُسح: إعادة التحميل لا تحاول الاستئناف ولا تذهب إلى القفل
    await page.goto("/org/subscription");
    await expect(page).not.toHaveURL(/\/lock/);
    expect(resumes).toBe(0);
  });
});
