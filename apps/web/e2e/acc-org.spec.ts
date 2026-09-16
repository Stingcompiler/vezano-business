import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.2 — ACC-03 (6 حالات) + ACC-04 (5 حالات). الخادم يُحاكى على مستوى الشبكة؛ الهوية تصل من ACC-02
 * (تذكرة الاختيار في سياق التطبيق) فالمسار يبدأ دائماً من /login.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const M = {
  nile: {
    user_id: "u1",
    tenant_id: "t1",
    tenant_name: "بقالة النيل — تجريبي",
    role_name: "مالك",
    scope: "كل الفروع",
    status: "active",
  },
  baraka: {
    user_id: "u2",
    tenant_id: "t2",
    tenant_name: "مخزن البركة — تجريبي",
    role_name: "أمين مخزن",
    scope: "المخزن الرئيسي",
    status: "active",
  },
  khartoum: {
    user_id: "u3",
    tenant_id: "t3",
    tenant_name: "متجر الخرطوم — تجريبي",
    role_name: "مالك",
    scope: "كل الفروع",
    status: "suspended",
  },
} as const;

async function loginWithMemberships(page: Page, memberships: readonly unknown[]) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(json(200, { memberships, select_ticket: "ticket" })),
  );
  await page.goto("/login");
  await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/select-org$/);
}

async function mockMemberships(page: Page, rows: readonly unknown[]) {
  await page.route("**/api/account/memberships", (route) =>
    route.fulfill(json(200, { memberships: rows, fetched_at: new Date().toISOString() })),
  );
}

test.describe("ACC-03", () => {
  test("ready: الحالي · تبديل · موقوف — والتبديل يُفرّغ الذاكرة المحلية", async ({
    page,
  }, info) => {
    await mockMemberships(page, [M.nile, M.baraka, M.khartoum]);
    await loginWithMemberships(page, [M.nile, M.baraka]);
    await expectFrame(page, info, {
      screenId: "ACC-03",
      state: "ready",
      texts: fromFrame("ACC-03", "ready", [
        "اختر المنشأة والفرع",
        "بقالة النيل — تجريبي",
        "مالك · كل الفروع",
        "مخزن البركة — تجريبي",
        "أمين مخزن · المخزن الرئيسي فقط. لا ترى فروعاً أخرى ولا دفاتر المنشأة.",
        "تبديل",
        "متجر الخرطوم — تجريبي",
        "دخولك موقوف بقرار المالك. اتصل به لرفع الوقف — بياناتك وأثرك محفوظان.",
        "موقوف",
        "التبديل يُفرّغ الذاكرة المحلية للحساب السابق.",
        "قوائم الأسعار والسلال والكتالوج المخزَّن كلها تُمحى من الجهاز قبل تحميل الحساب الجديد — لا رقم من متجر يظهر في متجر آخر.",
      ]),
      styles: [[".acc-choice--suspended", "background-color", "color.red.50"]],
    });
    // الاختيار يُصدر جلسة وينتقل إلى الرئيسية
    await page.route("**/api/account/select", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t2", user_id: "u2" }),
      ),
    );
    await page.getByRole("button", { name: /مخزن البركة — تجريبي/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("permission_denied: العضوية الموقوفة ظاهرة بسببها ولا تُخفى", async ({ page }, info) => {
    await mockMemberships(page, [M.nile, M.khartoum]);
    await loginWithMemberships(page, [M.nile]);
    await page.getByRole("button", { name: /متجر الخرطوم — تجريبي/ }).click();
    await expectFrame(page, info, {
      screenId: "ACC-03",
      state: "permission_denied",
      texts: fromFrame("ACC-03", "permission_denied", [
        "موقوف",
        "دخولك موقوف بقرار المالك. اتصل به لرفع الوقف — بياناتك وأثرك محفوظان.",
      ]),
    });
    await page.getByRole("button", { name: "اختر المنشأة والفرع" }).click();
    await expect(page.locator('[data-screen="ACC-03"][data-state="ready"]')).toBeVisible();
  });

  test("loading: هياكل بعدد آخر قائمة معروفة", async ({ page }, info) => {
    await page.route("**/api/account/memberships", async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.fulfill(
        json(200, { memberships: [M.nile], fetched_at: new Date().toISOString() }),
      );
    });
    await loginWithMemberships(page, [M.nile, M.baraka]);
    await expectFrame(page, info, {
      screenId: "ACC-03",
      state: "loading",
      texts: fromFrame("ACC-03", "loading", ["جلب منشآتك"]),
    });
    await expect(page.locator(".acc-skeleton")).toHaveCount(1);
  });

  test("empty: مساران متساويان في البروز", async ({ page }, info) => {
    await mockMemberships(page, []);
    await loginWithMemberships(page, []);
    await expectFrame(page, info, {
      screenId: "ACC-03",
      state: "empty",
      texts: fromFrame("ACC-03", "empty", [
        "لا منشأة بعد",
        "حسابٌ أُنشئ ولم يُنشئ منشأة ولم تصله دعوة.",
        "أنشئ منشأتك",
        "عندي دعوة",
      ]),
    });
    const a = page.getByRole("link", { name: "أنشئ منشأتك" });
    const b = page.getByRole("link", { name: "عندي دعوة" });
    expect(await a.getAttribute("class")).toBe(await b.getAttribute("class"));
    await a.click();
    await expect(page).toHaveURL(/\/create-org$/);
  });

  test("offline: القائمة من الذاكرة المحلية وغير المهيّأة رمادية بسبب", async ({
    page,
    context,
  }, info) => {
    await mockMemberships(page, [M.nile, M.baraka]);
    await loginWithMemberships(page, [M.nile, M.baraka]);
    await expect(page.locator('[data-screen="ACC-03"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-03",
      state: "offline",
      texts: fromFrame("ACC-03", "offline", [
        "بلا اتصال",
        "القائمة من الذاكرة المحلية، والمنشآت التي هُيّئت على هذا الجهاز وحدها قابلة للفتح.",
        "تحتاج اتصالاً أول مرة",
      ]),
    });
    await expect(page.getByRole("button", { name: /بقالة النيل — تجريبي/ })).toBeDisabled();
    await context.setOffline(false);
  });

  test("stale: قائمة قديمة بوقتها ونفتح على المحفوظ", async ({ page }, info) => {
    await mockMemberships(page, [M.nile, M.baraka]);
    await loginWithMemberships(page, [M.nile, M.baraka]);
    await expect(page.locator('[data-screen="ACC-03"][data-state="ready"]')).toBeVisible();
    // الخادم لا يردّ في الزيارة التالية — الجلسة نفسها، تذكرة الاختيار باقية في السياق
    await page.unroute("**/api/account/memberships");
    await page.route("**/api/account/memberships", (route) => route.abort("connectionfailed"));
    await page.getByRole("link", { name: "تخطٍّ إلى المحتوى" }).focus();
    await page.evaluate(() => history.pushState({}, "", "/login"));
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-03",
      state: "stale",
      texts: fromFrame("ACC-03", "stale", ["قائمة قديمة"]),
    });
    await expect(page.locator("time.sting-mono")).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(page.getByRole("button", { name: /بقالة النيل — تجريبي/ })).toBeEnabled();
  });
});

test.describe("ACC-04", () => {
  const SECTORS = {
    sectors: [{ code: "grocery", name: "بقالة ومواد غذائية" }],
    currencies: [{ code: "SDG", name: "الجنيه السوداني (SDG)", exponent: 2 }],
  };
  const CREATED = {
    client_request_id: "x",
    tenant_id: "t9",
    tenant_name: "بقالة النيل",
    branch_id: "b9",
    user_id: "u9",
    sector: "grocery",
    created: { items: 0, groups: 0, branches: 1, units: 3, payment_methods: 2, roles: 4 },
    access: "a",
    refresh: "r",
    session_id: "s",
  };

  async function toCreate(page: Page) {
    await page.route("**/api/tenants/sectors", (route) => route.fulfill(json(200, SECTORS)));
    await mockMemberships(page, []);
    await loginWithMemberships(page, []);
    await page.getByRole("link", { name: "أنشئ منشأتك" }).click();
    await expect(page.locator('[data-screen="ACC-04"]')).toBeVisible();
  }

  test("ready: النموذج والعملة قرار نهائي", async ({ page }, info) => {
    await toCreate(page);
    await expectFrame(page, info, {
      screenId: "ACC-04",
      state: "ready",
      texts: fromFrame("ACC-04", "ready", [
        "إنشاء المنشأة",
        "وصفة القطاع تُهيّئ لك أصنافاً ووحدات شائعة — كلها قابلة للتعديل.",
        "اسم المنشأة",
        "النشاط — وصفة القطاع",
        "بقالة ومواد غذائية",
        "العملة — لا تُبدَّل بعد أول معاملة",
        "الجنيه السوداني (SDG)",
        "الفرع الأول",
        "العملة قرار نهائي",
        "بعد أول معاملة لا تُبدَّل العملة. تبديلها يعني إعادة تقييم كل مبلغ سابق برقم نختاره نحن — وذلك تحريف دفترك لا إعداد.",
      ]),
      styles: [[".acc-item--danger", "background-color", "color.red.50"]],
    });
  });

  test("validation_error: حقلان يمنعان الإنشاء", async ({ page }, info) => {
    await toCreate(page);
    await page.getByRole("button", { name: "إنشاء المنشأة" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-04",
      state: "validation_error",
      texts: fromFrame("ACC-04", "validation_error", [
        "حقلان يمنعان الإنشاء",
        "اسم المنشأة فارغ",
        "القطاع غير مختار",
      ]),
    });
  });

  test("saving: ثلاث خطوات معلنة", async ({ page }, info) => {
    await toCreate(page);
    await page.route("**/api/tenants", async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.fulfill(json(201, CREATED));
    });
    await page.getByLabel("اسم المنشأة").fill("بقالة النيل");
    await page.getByLabel("النشاط — وصفة القطاع").selectOption("grocery");
    await page.getByRole("button", { name: "إنشاء المنشأة" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-04",
      state: "saving",
      texts: fromFrame("ACC-04", "saving", [
        "جارٍ الإنشاء",
        "المنشأة",
        "وصفة القطاع",
        "الفرع الأول",
      ]),
    });
  });

  test("success: أُنشئت المنشأة ومسار واحد", async ({ page }, info) => {
    await toCreate(page);
    await page.route("**/api/tenants", (route) => route.fulfill(json(201, CREATED)));
    await page.getByLabel("اسم المنشأة").fill("بقالة النيل");
    await page.getByLabel("النشاط — وصفة القطاع").selectOption("grocery");
    await page.getByRole("button", { name: "إنشاء المنشأة" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-04",
      state: "success",
      texts: fromFrame("ACC-04", "success", [
        "أُنشئت المنشأة",
        "ومعها ما أنشأته الوصفة:",
        "جهّز هذا الجهاز",
      ]),
    });
    await expect(page.locator('[data-screen="ACC-04"]').getByRole("button")).toHaveCount(1);
  });

  test("server_error: لا إعادة عمياء — نستعلم عن الحالة ثم نُكمل", async ({ page }, info) => {
    await toCreate(page);
    const seen: string[] = [];
    await page.route("**/api/tenants", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { client_request_id: string };
      seen.push(body.client_request_id);
      return route.fulfill(json(500, { detail: "boom" }));
    });
    let statusCalls = 0;
    await page.route("**/api/tenants/creation/*", (route) => {
      statusCalls += 1;
      return route.fulfill(
        statusCalls === 1 ? json(404, { detail: "not_found" }) : json(200, CREATED),
      );
    });
    await page.getByLabel("اسم المنشأة").fill("بقالة النيل");
    await page.getByLabel("النشاط — وصفة القطاع").selectOption("grocery");
    await page.getByRole("button", { name: "إنشاء المنشأة" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-04",
      state: "server_error",
      texts: fromFrame("ACC-04", "server_error", [
        "خطأ خادم أثناء الإنشاء",
        "قد تكون المنشأة أُنشئت والوصفة لم تُطبَّق.",
        "نستعلم عن الحالة أولاً ثم نُكمل من حيث توقّف.",
      ]),
    });
    expect(statusCalls).toBe(1);
    // إعادة المحاولة بنفس هوية الطلب؛ الاستعلام يجد المنشأة فتُكمل بلا منشأة ثانية
    await page.getByRole("button", { name: "أعد المحاولة" }).click();
    await expect(page.locator('[data-screen="ACC-04"][data-state="success"]')).toBeVisible();
    expect(new Set(seen).size).toBe(1);
  });
});
