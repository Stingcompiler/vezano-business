import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * PLT-16 (بأمر المالك 2026-09-22؛ 0005 §١١٠) — الباقات والتسعير: الكتالوج بأسعار الدورات
 * وعدد المشتركين، تعديل باقة بسبب، باقة جديدة، سعر مقبل بتاريخ سريان (إشعار 30 يوماً)، وسجل
 * التغييرات. بلا إطار مرسوم → بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Plan = {
  code: string;
  name: string;
  blurb: string;
  order: number;
  is_active: boolean;
  trial: boolean;
  trial_days: number;
  max_branches: number;
  max_devices: number;
  max_users: number | null;
  campaign_quota: number;
  features: string[];
  price_monthly_minor: string;
  price_quarterly_minor: string;
  price_yearly_minor: string;
  next_price: {
    monthly_minor: string | null;
    quarterly_minor: string | null;
    yearly_minor: string | null;
    effective_at: string;
  } | null;
  subscribers: number;
  updated_at: string;
};
const plan = (o: Partial<Plan> & { code: string; name: string }): Plan => ({
  blurb: "",
  order: 0,
  is_active: true,
  trial: false,
  trial_days: 30,
  max_branches: 1,
  max_devices: 3,
  max_users: null,
  campaign_quota: 0,
  features: ["pos_core"],
  price_monthly_minor: "0",
  price_quarterly_minor: "0",
  price_yearly_minor: "0",
  next_price: null,
  subscribers: 0,
  updated_at: minutesAgo(60),
  ...o,
});
const FEATURES = [
  "pos_core",
  "multi_branch",
  "advanced_reports",
  "branch_compare",
  "market_publish",
  "market_private_prices",
  "campaigns",
  "bulk_pricing",
  "cost_margin",
  "supplier_analytics",
];
const RULE =
  "تغيير السعر الحالي يمسّ التجديدات القادمة فقط؛ الأسعار المعلنة تحتاج إشعاراً قبل 30 يوماً — لذلك السعر الجديد يُجدول بتاريخ سريان لا يُطبَّق فوراً.";

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
        filter: "all",
        q: "",
        access_rule: "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه.",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-16", () => {
  test("ready: الكتالوج؛ تعديل سعر بسبب يظهر في السجل؛ باقة جديدة؛ سعر مقبل مرفوض قبل 30 يوماً ثم يُجدول", async ({
    page,
  }, info) => {
    let plans: Plan[] = [
      plan({
        code: "single",
        name: "فرع واحد",
        order: 1,
        blurb: "3 أجهزة · مستخدمان بدور كامل",
        features: ["pos_core", "advanced_reports", "bulk_pricing"],
        price_monthly_minor: "4500000",
        subscribers: 97,
      }),
      plan({
        code: "dual",
        name: "فرعان",
        order: 2,
        max_branches: 2,
        max_devices: 6,
        campaign_quota: 1200,
        features: ["pos_core", "multi_branch", "campaigns"],
        price_monthly_minor: "8500000",
        price_yearly_minor: "85000000",
        subscribers: 31,
      }),
      plan({ code: "trial", name: "تجريبية", order: 3, trial: true, subscribers: 18 }),
    ];
    const changes: {
      id: string;
      plan_code: string;
      changes: Record<string, unknown>;
      reason: string;
      by_name: string;
      at: string;
    }[] = [];
    const payload = () => ({
      plans,
      features: FEATURES,
      cycles: [
        { cycle: "monthly", label: "شهري", days: 30 },
        { cycle: "quarterly", label: "ربعي", days: 90 },
        { cycle: "yearly", label: "سنوي", days: 365 },
      ],
      changes,
      min_price_notice_days: 30,
      rule: RULE,
    });
    await page.route("**/api/platform/plans", (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, payload()));
      const b = route.request().postDataJSON() as {
        code: string;
        name: string;
        reason?: string;
        price_monthly_minor?: number;
        max_branches?: number;
      };
      if (plans.some((p) => p.code === b.code))
        return route.fulfill(json(409, { detail: "code_exists" }));
      plans = [
        ...plans,
        plan({
          code: b.code,
          name: b.name,
          max_branches: b.max_branches ?? 1,
          price_monthly_minor: String(b.price_monthly_minor ?? 0),
        }),
      ];
      changes.unshift({
        id: `c${changes.length}`,
        plan_code: b.code,
        changes: { created: true },
        reason: b.reason ?? "",
        by_name: "هدى — تشغيل",
        at: new Date().toISOString(),
      });
      return route.fulfill(json(201, payload()));
    });
    await page.route("**/api/platform/plans/*/*", (route) => {
      const parts = route.request().url().split("/");
      const action = parts.pop() ?? "";
      const code = parts.pop() ?? "";
      const b = route.request().postDataJSON() as {
        price_monthly_minor?: number;
        max_devices?: number;
        reason?: string;
        effective_at?: string;
        monthly_minor?: number | null;
      };
      const p = plans.find((x) => x.code === code)!;
      if (action === "update") {
        const diff: Record<string, unknown> = {};
        if (b.price_monthly_minor !== undefined) {
          diff.price_monthly_minor = { from: p.price_monthly_minor, to: b.price_monthly_minor };
          p.price_monthly_minor = String(b.price_monthly_minor);
        }
        if (b.max_devices !== undefined && b.max_devices !== p.max_devices) {
          diff.max_devices = { from: p.max_devices, to: b.max_devices };
          p.max_devices = Number(b.max_devices);
        }
        if (Object.keys(diff).length === 0)
          return route.fulfill(json(400, { detail: "nothing_to_change" }));
        changes.unshift({
          id: `c${changes.length}`,
          plan_code: code,
          changes: diff,
          reason: String(b.reason ?? ""),
          by_name: "هدى — تشغيل",
          at: new Date().toISOString(),
        });
        return route.fulfill(json(200, payload()));
      }
      if (action === "price") {
        const eff = new Date(String(b.effective_at));
        if (eff.getTime() < Date.now() + 30 * 86_400_000)
          return route.fulfill(json(400, { detail: "notice_too_short" }));
        p.next_price = {
          monthly_minor: b.monthly_minor == null ? null : String(b.monthly_minor),
          quarterly_minor: null,
          yearly_minor: null,
          effective_at: eff.toISOString(),
        };
        return route.fulfill(json(200, payload()));
      }
      return route.fulfill(json(400, { detail: "unknown_action" }));
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "الباقات والتسعير" }).click();
    await expect(page).toHaveURL(/\/platform\/plans$/);
    await expectFrame(page, info, {
      screenId: "PLT-16",
      state: "ready",
      texts: [
        "الباقات والتسعير — ما تراه الصفحة العامة يُحرَّر هنا",
        "فرع واحد",
        "فرعان",
        "تجريبية",
        "معروضة",
        "شهري",
        "45,000.00",
        "85,000.00",
        "سنوي",
        "850,000.00",
        "97",
        "مشترك",
        "باقة جديدة",
        "سجل التغييرات",
        "لا تغييرات بعد — الكتالوج كما بُذر.",
        RULE,
      ],
    });
    const root = page.locator('[data-screen="PLT-16"]');
    // تعديل: السعر الشهري والأجهزة بسبب → السجل والبطاقة يتحدّثان
    const single = root.locator(".plt-plan", { hasText: "فرع واحد" });
    await single.getByRole("button", { name: "عدّل" }).click();
    await single.getByLabel("السعر الشهري").fill("50,000");
    await single.getByLabel("الأجهزة").fill("4");
    await single.getByLabel("سبب التغيير").fill("تسعير 2027");
    await single.getByRole("button", { name: "احفظ" }).click();
    await expect(root).toContainText("حُفظت «فرع واحد»");
    await expect(single).toContainText("50,000.00");
    await expect(single).toContainText("4 أجهزة");
    await expect(root.locator(".plt-timeline li").first()).toContainText("تسعير 2027");
    // سعر مقبل: تاريخ قريب مرفوض بنصّ، ثم بعيد يُجدول ويظهر «سعر مقبل»
    await single.getByRole("button", { name: "سعر مقبل بتاريخ" }).click();
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await single.getByLabel("الشهري الجديد").fill("60,000");
    await single.getByLabel("تاريخ السريان").fill(soon);
    await single.getByRole("button", { name: "جدوِل السعر" }).click();
    await expect(single).toContainText(
      "السعر الجديد يحتاج إشعاراً 30 يوماً على الأقل — اختر تاريخاً أبعد.",
    );
    await single.getByLabel("تاريخ السريان").fill(later);
    await single.getByRole("button", { name: "جدوِل السعر" }).click();
    await expect(root).toContainText("جُدول السعر الجديد بتاريخ سريانه");
    await expect(single.locator(".plt-plan__next")).toContainText("60,000.00");
    // باقة جديدة
    await page.getByRole("button", { name: "باقة جديدة" }).click();
    const form = root.locator("form.plt-plan-form").last();
    await form.getByLabel("الرمز").fill("chain");
    await form.getByLabel("الاسم").fill("سلسلة");
    await form.getByLabel("السعر الشهري").fill("150,000");
    await form.getByLabel("الفروع", { exact: true }).fill("5");
    await form.getByRole("button", { name: "أنشئ الباقة" }).click();
    await expect(root).toContainText("أُنشئت الباقة «سلسلة»");
    await expect(root.locator(".plt-plan", { hasText: "سلسلة" })).toContainText("150,000.00");
  });

  test("permission_denied: جلسة بلا صفة مشغّل", async ({ page }, info) => {
    await page.route("**/api/platform/plans", (route) =>
      route.fulfill(json(403, { detail: "operator_required" })),
    );
    await operatorLogin(page);
    await page.getByRole("button", { name: "الباقات والتسعير" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-16",
      state: "permission_denied",
      texts: ["مساحة المشغّل فقط", "الكتالوج يُحرَّر بصفة مشغّل."],
    });
  });
});
