import { expect, type Page, type Route, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.3 — ACC-05 (6 حالات). الخادم يُحاكى على مستوى الشبكة؛ الهوية تصل من ACC-02 (جلسة بعضوية واحدة).
 * IndexedDB حقيقي: الصفحات تُكتب إسقاطاتٍ وتُستأنف من النسخة نفسها.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const IMAGE = {
  image_id: "11111111-1111-7111-8111-111111111111",
  sync_epoch: "E1",
  snapshot_id: "22222222-2222-7222-8222-222222222222",
  cutoff_server_seq: "7",
  schema_version: 1,
  as_of: "2026-09-16T08:00:00Z",
  expires_at: "2026-09-17T08:00:00Z",
  page_size: 2,
  scopes: [
    { group: "catalog", total: 3, pages: 2 },
    { group: "parties", total: 1, pages: 1 },
    { group: "balances", total: 0, pages: 1 },
    { group: "settings", total: 2, pages: 1 },
  ],
  balances: [],
};
const ENT = (entity: string, id: string) => ({ entity, id, payload: { name: id } });
const PAGES: Record<string, unknown[][]> = {
  catalog: [[ENT("catalog.Item", "a"), ENT("catalog.Item", "b")], [ENT("catalog.Item", "c")]],
  parties: [[ENT("parties.Party", "p1")]],
  balances: [[]],
  settings: [[ENT("core.Unit", "u1"), ENT("core.Unit", "u2")]],
};

async function loginToSetup(page: Page) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/devices/renew", (route) =>
    route.fulfill(json(404, { detail: "device_not_found" })),
  );
  await page.route("**/api/devices/register", (route) =>
    route.fulfill(
      json(201, {
        device_id: "33333333-3333-7333-8333-333333333333",
        prefix: "A2",
        branch_id: "44444444-4444-7444-8444-444444444444",
        registration_secret: "secret",
        access: "da",
        refresh: "dr",
      }),
    ),
  );
  await page.route("**/api/bootstrap/start", (route) => route.fulfill(json(201, IMAGE)));
  await page.route("**/api/bootstrap/*/complete", (route) =>
    route.fulfill(json(200, { image_id: IMAGE.image_id, completed_at: "2026-09-16T08:05:00Z" })),
  );
  await page.goto("/login");
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  // الدخول بعضوية واحدة لا يمرّ بـ ACC-03؛ الانتقال إلى التجهيز من داخل التطبيق (الجلسة في الذاكرة)
  await page.getByRole("link", { name: "تجهيز الجهاز" }).click();
  await expect(page).toHaveURL(/\/setup-device$/);
}

function pageRoute(handler: (group: string, n: number, route: Route) => Promise<void> | void) {
  return (route: Route) => {
    const url = new URL(route.request().url());
    return handler(
      url.searchParams.get("group") ?? "",
      Number(url.searchParams.get("page")),
      route,
    );
  };
}
const servePage = (group: string, n: number, route: Route) =>
  route.fulfill(
    json(200, {
      image_id: IMAGE.image_id,
      group,
      page_no: n,
      pages: PAGES[group]?.length ?? 1,
      entities: PAGES[group]?.[n - 1] ?? [],
    }),
  );

test.describe("ACC-05", () => {
  test("loading: نطاقات مسمّاة كلٌّ بحجمه وتقدّمه", async ({ page }, info) => {
    await page.route(
      "**/api/bootstrap/*/page**",
      pageRoute(async (g, n, route) => {
        await new Promise((r) => setTimeout(r, 2500));
        await servePage(g, n, route);
      }),
    );
    await loginToSetup(page);
    await expect(page.locator(".acc-steps li")).toHaveCount(4);
    await expectFrame(page, info, {
      screenId: "ACC-05",
      state: "loading",
      texts: fromFrame("ACC-05", "loading", [
        "التنزيل جارٍ",
        "الكتالوج",
        "الأطراف",
        "الأرصدة",
        "الإعدادات",
      ]),
    });
    await expect(page.locator(".acc-steps li").first()).toContainText(/\d+ من 3/);
  });

  test("success: الجهاز جاهز بالأرقام ومساره الواحد — ولا وعد بالمزامنة الدائمة", async ({
    page,
  }, info) => {
    await page.route("**/api/bootstrap/*/page**", pageRoute(servePage));
    await loginToSetup(page);
    await expectFrame(page, info, {
      screenId: "ACC-05",
      state: "success",
      texts: fromFrame("ACC-05", "success", [
        "الجهاز جاهز",
        "صنفاً و",
        "طرفاً وفرعٌ واحد.",
        "افتح وردية وابدأ البيع",
        "يعمل بلا اتصال ويُزامن حين تعود الشبكة",
      ]),
    });
    await expect(page.locator(".c-notice .sting-mono").first()).toHaveText("3");
    await expect(page.locator(".c-notice .sting-mono").nth(1)).toHaveText("1");
    // الجهاز مهيّأ لهذه المنشأة في IndexedDB الحقيقي، والإسقاطات كُتبت
    const meta = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      const get = (store: string, key: string) =>
        new Promise<unknown>((res) => {
          const r = db.transaction(store).objectStore(store).get(key);
          r.onsuccess = () => res(r.result);
        });
      return {
        setup: await get("meta", "device.setup"),
        item: await get("projections", "entity:catalog.Item:c"),
      };
    });
    expect(meta.setup).toMatchObject({ value: "done" });
    expect(meta.item).toMatchObject({ value: { name: "c" } });
    // بعد التهيئة: الترحيب لا يُعرض لجهاز مهيّأ — ينتقل إلى قفل PIN
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/lock$/);
  });

  test("server_error → partial: ثلاث محاولات متباعدة ثم وقوف يدوي، وما نزل يبقى ويُستأنف", async ({
    page,
  }, info) => {
    let calls = 0;
    let failBalances = true;
    await page.route(
      "**/api/bootstrap/*/page**",
      pageRoute((g, n, route) => {
        calls += 1;
        if (g === "balances" && failBalances) return route.fulfill(json(500, { detail: "boom" }));
        return servePage(g, n, route);
      }),
    );
    await loginToSetup(page);
    // الكتالوج والأطراف نزلا ثم انقطعت الأرصدة → صالح للبيع لا للجرد
    await expectFrame(page, info, {
      screenId: "ACC-05",
      state: "partial",
      texts: fromFrame("ACC-05", "partial", [
        "بعض النطاقات وصلت",
        "تستطيع البيع الآن · الجرد يحتاج الأرصدة",
        "من حيث توقّف لا من الصفر.",
      ]),
    });
    const before = calls;
    expect(before).toBeGreaterThanOrEqual(4 + 4); // ٤ صفحات ناجحة (إعدادات، كتالوج×٢، أطراف) + ٤ محاولات على الأرصدة
    failBalances = false;
    await page.getByRole("button", { name: "أعد المحاولة" }).click();
    await expect(page.locator('[data-screen="ACC-05"][data-state="success"]')).toBeVisible();
    // الاستئناف لم يُعد تنزيل الكتالوج: طلب واحد للأرصدة فقط
    expect(calls - before).toBe(1);
  });

  test("server_error: خطأ قبل أي نطاق كامل — لا نمسح", async ({ page }, info) => {
    await page.route(
      "**/api/bootstrap/*/page**",
      pageRoute((_g, _n, route) => route.fulfill(json(500, {}))),
    );
    await loginToSetup(page);
    await expectFrame(page, info, {
      screenId: "ACC-05",
      state: "server_error",
      texts: fromFrame("ACC-05", "server_error", [
        "انقطع التنزيل بخطأ",
        "المُنزَّل سليم والباقي لا.",
        "ما نزل يبقى.",
      ]),
    });
  });

  test("stale: النسخة انتهت في منتصف الصفحات — نبدأ من جديد ونقول ذلك", async ({ page }, info) => {
    let expired = true;
    await page.route(
      "**/api/bootstrap/*/page**",
      pageRoute((g, n, route) =>
        g === "parties" && expired
          ? route.fulfill(json(410, { detail: "image_expired" }))
          : servePage(g, n, route),
      ),
    );
    await loginToSetup(page);
    await expectFrame(page, info, {
      screenId: "ACC-05",
      state: "stale",
      texts: fromFrame("ACC-05", "stale", [
        "تهيئة قديمة غير مكتملة",
        "ما نُزِّل قديم — نبدأ من جديد",
      ]),
    });
    expired = false;
    let starts = 0;
    await page.unroute("**/api/bootstrap/start");
    await page.route("**/api/bootstrap/start", (route) => {
      starts += 1;
      return route.fulfill(
        json(201, { ...IMAGE, image_id: "55555555-5555-7555-8555-555555555555" }),
      );
    });
    await page.getByRole("button", { name: "أعد المحاولة" }).click();
    await expect(page.locator('[data-screen="ACC-05"][data-state="success"]')).toBeVisible();
    expect(starts).toBe(1);
  });

  test("offline: التقدّم محفوظ ويُستأنف من حيث توقّف", async ({ page, context }, info) => {
    await page.route(
      "**/api/bootstrap/*/page**",
      pageRoute(async (g, n, route) => {
        if (g === "balances") await new Promise((r) => setTimeout(r, 4000));
        await servePage(g, n, route);
      }),
    );
    await loginToSetup(page);
    await expect(page.locator('[data-screen="ACC-05"][data-state="loading"]')).toBeVisible();
    await page.waitForTimeout(1500);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-05",
      state: "offline",
      texts: fromFrame("ACC-05", "offline", [
        "تجهيز الجهاز",
        "التنزيل الأول يحتاج اتصالاً. بعده يعمل الجهاز كاملاً بلا إنترنت.",
        "حساب المنشأة",
        "تم",
        "الكتالوج والوحدات",
        "الخطوط وواجهة العمل",
        "الطابعة",
        "لاحقاً",
        "انقطع الاتصال عند",
        "التقدّم محفوظ ويُستأنف من حيث توقّف — لا يبدأ من الصفر. وما نُزّل من كتالوج وخطوط يعمل الآن؛ ما ينتظر هو الباقي فقط.",
      ]),
    });
    await expect(page.locator(".c-notice .sting-mono")).toHaveText(/^\d+$/);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator('[data-screen="ACC-05"][data-state="success"]')).toBeVisible();
  });
});
