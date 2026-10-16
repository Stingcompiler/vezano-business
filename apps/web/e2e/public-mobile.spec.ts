import { expect, test } from "@playwright/test";

/**
 * مراجعة الهاتف للموقع العام (2026-10-16؛ 0005 §١٦٠): لا تجاوز أفقياً على 320/360/390/430،
 * تسميات حقول الجولة ظاهرة ومقروءة بـ16px، والأزرار الرئيسية ≥ 44px، والمقدمة ثلاثة أسطر أو أقل.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

// المقاسات داخل كل اختبار صريحة — يكفي مشروع واحد
test.beforeEach(({ browserName }, info) => {
  test.skip(
    browserName !== "chromium" || info.project.name !== "phone-390",
    "مقاسات الهاتف تُضبط داخل الاختبار",
  );
});

const PLANS = {
  plans: [
    {
      code: "single",
      name: "فرع واحد",
      price_minor: "4500000",
      max_branches: 1,
      max_devices: 3,
      campaign_quota: 0,
      blurb: "3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
      trial: false,
    },
    {
      code: "dual",
      name: "فرعان",
      price_minor: "8500000",
      max_branches: 2,
      max_devices: 6,
      campaign_quota: 0,
      blurb: "6 أجهزة · 5 مستخدمين · مقارنة الفروع · نشر في السوق واستقبال الطلبات",
      trial: false,
    },
    {
      code: "trial",
      name: "تجريبية",
      price_minor: "0",
      max_branches: 1,
      max_devices: 3,
      campaign_quota: 0,
      blurb: "كل ميزات باقة الفرع الواحد.",
      trial: true,
    },
  ],
  on_expiry: {
    hidden: ["السوق — التصفح والنشر", "الحملات والإرسال"],
    never_hidden: ["البيع كاملاً — نقدي وآجل ومختلط", "تصدير نسخة محلية كاملة"],
    grace_days: 14,
  },
  comparison: { limits: [], features: [], continues: [], stops: [] },
};

for (const width of [320, 360, 390, 430]) {
  test(`لا تجاوز أفقياً عند ${width}px في الرئيسية والباقات والسوق والتسجيل`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/public/plans", (route) => route.fulfill(json(200, PLANS)));
    for (const path of ["/", "/plans", "/market", "/register"]) {
      await page.goto(path);
      await expect(page.locator("main, [data-screen]").first()).toBeVisible();
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over, `${path} @${width}`).toBeLessThanOrEqual(0);
    }
  });
}

test("الرئيسية على 390: مقدمة قصيرة وأزرار ≥ 44px وتفاصيل الباقات سطراً سطراً", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/public/plans", (route) => route.fulfill(json(200, PLANS)));
  await page.goto("/");
  const h1 = page.locator(".lp__hero h1");
  await expect(h1).toHaveText("بيعك مستمر حتى بدون إنترنت");
  const lines = await h1.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  });
  expect(lines).toBeLessThanOrEqual(3);
  const fontPx = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(28);
  for (const name of ["ابدأ تجربتك المجانية", "شاهد طريقة الاستخدام"]) {
    const box = await page.locator(".lp__hero").getByRole("button", { name }).boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
  }
  // الباقات تسبق شرح المسار وتعرض حدودها بسطور منفصلة بخط ≥ 15px
  const plans = page.locator("#lp-plans");
  await expect(plans).toBeVisible();
  const order = await page.evaluate(
    () =>
      document.getElementById("lp-plans")!.getBoundingClientRect().top <
      document.getElementById("lp-flow")!.getBoundingClientRect().top,
  );
  expect(order).toBe(true);
  const items = plans.locator(".lp__plan-limits").first().locator("li");
  expect(await items.count()).toBeGreaterThanOrEqual(3);
  const size = await items.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(15);
  await expect(plans.getByRole("button", { name: "جرّبها مجاناً أولاً" }).first()).toBeVisible();
  await expect(plans).not.toContainText("ابدأ بهذه الباقة");
  await expect(plans).not.toContainText("الأكثر طلباً");
});

test("نموذج الجولة على 390: التسميات ظاهرة بعد الكتابة والحقول 16px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#lp-contact");
  const form = page.locator(".lp__contact");
  for (const label of ["اسمك", "رقم الواتساب", "بريدك"]) {
    const field = form.getByLabel(label);
    await field.fill("x");
    const lab = form.locator("label", { hasText: label }).first();
    await expect(lab).toBeVisible();
    const box = await lab.boundingBox();
    expect((box?.width ?? 0) > 8 && (box?.height ?? 0) > 8).toBe(true);
    const px = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(px).toBeGreaterThanOrEqual(16);
    const h = (await field.boundingBox())?.height ?? 0;
    expect(h).toBeGreaterThanOrEqual(48);
  }
  await expect(form.locator("label", { hasText: "اختياري" })).toBeVisible();
});
