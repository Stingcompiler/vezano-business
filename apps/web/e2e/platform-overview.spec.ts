import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * PLT-00 (بأمر المالك 2026-09-21؛ 0005 §١٠٢) — النظرة العامة: عدّادات الاستحقاق والطوابير
 * والتشغيل بختم وقتها، «يحتاج انتباهاً»، وكل بطاقة تفتح شاشتها بمرشّحها. بلا إطار مرسوم → بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const tile = (
  key: string,
  label: string,
  value: number,
  note: string,
  href: string,
  tone: "ok" | "info" | "warn" | "danger",
) => ({ key, label, value, note, href, tone });

const OVERVIEW = {
  measured_at: new Date().toISOString(),
  tenants_total: 128,
  attention: 9,
  subscriptions: [
    tile("active", "نشط", 97, "اشتراك سارٍ", "/platform/tenants", "ok"),
    tile("trial", "تجريبي", 18, "30 يوماً من الإنشاء", "/platform/tenants", "info"),
    tile(
      "due14",
      "ينتهي خلال 14 يوماً",
      7,
      "يحتاج تذكيراً أو إثبات دفع",
      "/platform/tenants?filter=due14",
      "warn",
    ),
    tile(
      "late",
      "متأخرو السداد",
      4,
      "الدفتر لا يُحجب — الميزات المدفوعة تتوقف بعد المهلة",
      "/platform/tenants?filter=late",
      "warn",
    ),
    tile(
      "suspended",
      "موقوفون",
      2,
      "إيقاف من المشغّل بسبب مسجَّل",
      "/platform/tenants?filter=suspended",
      "danger",
    ),
  ],
  queues: [
    tile("proofs", "إثباتات دفع معلّقة", 3, "الاعتماد يمدّد شهراً", "/platform/proofs", "warn"),
    tile(
      "verifications",
      "طلبات تحقّق",
      1,
      "شارة هوية لا تزكية",
      "/platform/verifications",
      "warn",
    ),
    tile(
      "reports",
      "بلاغات قيد المراجعة",
      0,
      "تعليق النشر بمسار مسجَّل",
      "/platform/reports",
      "ok",
    ),
    tile("disputes", "خلافات مفتوحة", 1, "1 قرب حدّ التدخّل", "/platform/disputes", "danger"),
    tile("demo", "طلبات جولة تنتظر", 2, "1 لم يُتواصل معه بعد", "/platform/demo-requests", "warn"),
  ],
  technical: [
    tile(
      "sync_stuck",
      "مزامنة متعثّرة",
      0,
      "جهاز لم يزامن 3 أيام",
      "/platform/tenants?filter=sync_stuck",
      "ok",
    ),
    tile(
      "health",
      "مؤشرات صحة غير سليمة",
      0,
      "المزامنة والخادم — يغذّي صفحة الحالة",
      "/platform/health",
      "ok",
    ),
  ],
  rule: "أرقام من السجل لا من تخمين — كل بطاقة تفتح شاشتها. لا مبيعات ولا أسماء زبائن هنا.",
};

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) => {
    const f = new URL(route.request().url()).searchParams.get("filter") ?? "all";
    return route.fulfill(
      json(200, {
        tenants: [],
        total: 128,
        shown: 0,
        active_count: 97,
        filter: f,
        q: "",
        access_rule: "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه.",
        fetched_at: new Date().toISOString(),
      }),
    );
  });
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByLabel("2FA").fill("123456");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-00", () => {
  test("ready: العدّادات بختم وقتها و«يحتاج انتباهاً»؛ بطاقة «موقوفون» تفتح المستأجرين بمرشّحها", async ({
    page,
  }, info) => {
    await page.route("**/api/platform/overview", (route) => route.fulfill(json(200, OVERVIEW)));
    await operatorLogin(page);
    await page.getByRole("button", { name: "النظرة العامة" }).click();
    await expect(page).toHaveURL(/\/platform$/);
    await expectFrame(page, info, {
      screenId: "PLT-00",
      state: "ready",
      texts: [
        "النظرة العامة — ما ينتظر فعلاً",
        "عدّادات من السجل بختم وقتها؛ كل بطاقة تفتح شاشتها. لا مبيعات ولا أسماء زبائن هنا.",
        "128",
        "مستأجراً",
        "يحتاج انتباهاً",
        "الاستحقاق",
        "نشط",
        "تجريبي",
        "ينتهي خلال 14 يوماً",
        "متأخرو السداد",
        "موقوفون",
        "الطوابير",
        "إثباتات دفع معلّقة",
        "طلبات تحقّق",
        "بلاغات قيد المراجعة",
        "خلافات مفتوحة",
        "1 قرب حدّ التدخّل",
        "طلبات جولة تنتظر",
        "1 لم يُتواصل معه بعد",
        "التشغيل",
        "مزامنة متعثّرة",
        "مؤشرات صحة غير سليمة",
        "أرقام من السجل لا من تخمين — كل بطاقة تفتح شاشتها. لا مبيعات ولا أسماء زبائن هنا.",
      ],
    });
    const root = page.locator('[data-screen="PLT-00"]');
    await expect(root.locator(".plt-tile", { hasText: "موقوفون" })).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(
      root.locator(".plt-tile", { hasText: "موقوفون" }).locator(".plt-tile__value"),
    ).toHaveText("2");
    await expect(root).not.toContainText("المبيعات");
    await root.locator(".plt-tile", { hasText: "موقوفون" }).click();
    await expect(page).toHaveURL(/\/platform\/tenants\?filter=suspended$/);
    await expect(page.getByRole("button", { name: "موقوفون" })).toHaveClass(/pos-chip--on/);
  });

  test("permission_denied: جلسة بلا صفة مشغّل", async ({ page }, info) => {
    await page.route("**/api/platform/overview", (route) =>
      route.fulfill(json(403, { detail: "operator_required" })),
    );
    await operatorLogin(page);
    await page.getByRole("button", { name: "النظرة العامة" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-00",
      state: "permission_denied",
      texts: ["مساحة المشغّل فقط", "النظرة العامة تُقرأ بصفة مشغّل — لا دفاتر فيها ولا باب خلفي."],
    });
  });
});
