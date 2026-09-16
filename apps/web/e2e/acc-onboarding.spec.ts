import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/** T1.6 — ACC-10 (6 حالات). */
const json = (status: number, body: unknown) => ({ status, json: body });

const base = {
  tenant_name: "بقالة النيل",
  currency_name: "الجنيه السوداني",
  branches: 1,
  dismissed: false,
  steps: {
    org: { done: true },
    items: { imported: 0, rejected: 0, sales: 0 },
    balances: { count: 0 },
    printer: { linked: false },
    logo: { present: false },
    invite: { sent: 0 },
  },
};

async function open(page: Page, status: unknown) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/tenants/onboarding", (route) =>
    route.request().method() === "GET" ? route.fulfill(json(200, status)) : route.fallback(),
  );
  await page.goto("/login");
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "معالج بدء الاستخدام" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test.describe("ACC-10", () => {
  test("partial: خطوات بحالتها والتاجر يبيع قبل إكمالها", async ({ page }, info) => {
    await open(page, {
      ...base,
      steps: { ...base.steps, items: { imported: 184, rejected: 12, sales: 0 } },
    });
    await expectFrame(page, info, {
      screenId: "ACC-10",
      state: "partial",
      texts: fromFrame("ACC-10", "partial", [
        "تجهيز بقالة النيل",
        "تستطيع البيع الآن",
        "ابدأ البيع",
        "بيانات المنشأة والعملة",
        "بقالة النيل · الجنيه السوداني · فرع واحد",
        "تعديل",
        "استيراد الأصناف — جزئي",
        "صنفاً دخلت ·",
        "سطراً مرفوضاً ينتظر التصحيح",
        "تصحيح المرفوض",
        "أرصدة العملاء الافتتاحية",
        "لم تبدأ — يمكن إضافتها عند أول بيع آجل",
        "ابدأ",
        "ربط الطابعة وتجربة إيصال",
        "لم تبدأ — البيع يعمل بلا طابعة",
        "لا تُشترط الخطوات الأربع لبدء البيع. الاستيراد نصفه منتهٍ —",
        "رُفضت، ويمكنك تصحيحها لاحقاً دون إعادة البقية.",
      ]),
      styles: [[".acc-wizard__mark--done", "background-color", "color.green.700"]],
    });
    await expect(page.locator(".acc-wizard__foot .sting-mono").first()).toHaveText("184");
    await expect(page.locator(".acc-wizard__foot .sting-mono").nth(1)).toHaveText("12");
  });

  test("empty: لا شيء يُقترح قبل أول أسبوع بيع", async ({ page }, info) => {
    await open(page, base);
    await expectFrame(page, info, {
      screenId: "ACC-10",
      state: "empty",
      texts: fromFrame("ACC-10", "empty", ["نقترح أصنافك بعد أول أسبوع بيع"]),
    });
  });

  test("ready: التقدّم يُعرض ولا يُلاحَق — بيع قائم والمعالج لم يُلمس", async ({ page }, info) => {
    await open(page, {
      ...base,
      steps: { ...base.steps, items: { imported: 0, rejected: 0, sales: 40 } },
    });
    await expectFrame(page, info, {
      screenId: "ACC-10",
      state: "ready",
      texts: fromFrame("ACC-10", "ready", ["شعار", "دعوة موظف", "ابدأ البيع"]),
    });
    await expect(page.locator(".acc-wizard__step")).toHaveCount(6);
  });

  test("validation_error: الشعار كبير — سنصغّره لك", async ({ page }, info) => {
    await open(page, base);
    // صورة 3 ميجابايت
    const buf = Buffer.alloc(3 * 1024 * 1024, 0);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: buf });
    await expectFrame(page, info, {
      screenId: "ACC-10",
      state: "validation_error",
      texts: fromFrame("ACC-10", "validation_error", [
        "الشعار كبير",
        "ميجابايت والحدّ",
        "سنصغّره لك",
      ]),
    });
  });

  test("offline: خطوتان محليتان وخطوتان تحتاج اتصالاً", async ({ page, context }, info) => {
    await open(page, base);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-10",
      state: "offline",
      texts: fromFrame("ACC-10", "offline", [
        "المعالج بلا اتصال",
        "تحتاج اتصالاً",
        "المحليّتان تعملان الآن",
      ]),
    });
    await expect(page.getByText("تحتاج اتصالاً", { exact: true })).toHaveCount(3);
    await context.setOffline(false);
  });

  test("success: اكتمل المعالج — زرّ واحد", async ({ page }, info) => {
    await open(page, base);
    await page.route("**/api/tenants/onboarding", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill(json(200, { ...base, dismissed: true }))
        : route.fallback(),
    );
    await page.getByRole("button", { name: "اكتمل المعالج" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-10",
      state: "success",
      texts: fromFrame("ACC-10", "success", [
        "اكتمل المعالج",
        "المعالج لم يعد يظهر",
        "افتح وردية وابدأ البيع",
      ]),
    });
    await expect(page.locator('[data-screen="ACC-10"]').getByRole("button")).toHaveCount(1);
  });
});
