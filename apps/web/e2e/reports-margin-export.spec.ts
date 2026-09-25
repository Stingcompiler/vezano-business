import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.9 — REP-05 الهامش ومقارنة الفروع (4) + REP-06 تصدير تقرير ومعاينته (5): `phase_locked` بنصّه
 * حتى سياسة التكلفة ولا رقم ربح قبلها؛ `empty` نمتنع عن الرقم؛ الشاشة كلها محجوبة لغير المالك؛
 * المعاينة قبل التصدير، الملف باسم مداه، حدّ 12 شهراً بالبدائل الثلاثة، وفشل التوليد يقترح البديل.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();

const margin = (o: Record<string, unknown> = {}) => ({
  state: "phase_locked",
  scope: "all",
  branch_compare: true,
  range: { key: "30d", start: "2026-08-21", end: "2026-09-19", label: "آخر 30 يوماً" },
  policy: "",
  policy_label: "",
  computed_at: today(10, 0),
  sales_by_branch: [
    { id: "b1", name: "الفرع الرئيسي", sales_minor: "1842000" },
    { id: "b2", name: "فرع بحري", sales_minor: "1196000" },
  ],
  rows: [],
  groups: [],
  missing: null,
  ...o,
});

const FIRST_PAGE =
  '<!doctype html><html lang="ar" dir="rtl"><body><main><h1>بقالة النيل — تجريبي</h1><p>تقرير المبيعات · صفحة 1 من 3</p></main></body></html>';

const preview = (o: Record<string, unknown> = {}) => ({
  report: "sales",
  label: "تقرير المبيعات",
  format: "html",
  file_name: "sales-2026-08-21_2026-09-19.html",
  monthly: false,
  expected_pages: 3,
  row_count: 92,
  first_page_html: FIRST_PAGE,
  range: { start: "2026-08-21", end: "2026-09-19", label: "آخر 30 يوماً", months: 2 },
  quota: { used: 2, limit: 30 },
  months_limit: 12,
  ...o,
});

const exported = (o: Record<string, unknown> = {}) => ({
  id: "e1",
  report: "sales",
  label: "تقرير المبيعات",
  format: "html",
  range: { start: "2026-08-21", end: "2026-09-19" },
  file_name: "sales-2026-08-21_2026-09-19.html",
  byte_size: 48_640,
  page_count: 3,
  row_count: 92,
  url: "/api/reports/exports/tok1",
  generated_at: today(10, 5),
  generated_by_name: "عثمان الطيب",
  open_count: 0,
  ...o,
});

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

test.describe("REP-05", () => {
  test("phase_locked → empty → ready: لا رقم ربح قبل السياسة، ثم نمتنع عن الرقم، ثم الهامش بالنسب", async ({
    page,
  }, info) => {
    let mode: "locked" | "empty" | "ready" = "locked";
    await page.route("**/api/reports/margin?**", (route) =>
      route.fulfill(
        json(
          200,
          mode === "locked"
            ? margin()
            : mode === "empty"
              ? margin({
                  state: "empty",
                  policy: "weighted_average",
                  policy_label: "المتوسط المرجَّح من مستندات الشراء",
                  branch_compare: false,
                  missing: {
                    uncosted_items: 63,
                    sold_items: 96,
                    top_uncosted: [
                      { item_id: "i1", name: "سكر", sales_minor: "500000" },
                      { item_id: "i2", name: "زيت", sales_minor: "300000" },
                    ],
                  },
                })
              : margin({
                  state: "ready",
                  policy: "weighted_average",
                  policy_label: "المتوسط المرجَّح من مستندات الشراء",
                  rows: [
                    {
                      id: "b1",
                      name: "الفرع الرئيسي",
                      sales_minor: "1842000",
                      cost_minor: "1243350",
                      margin_minor: "598650",
                      margin_bp: 3250,
                    },
                    {
                      id: "b2",
                      name: "فرع بحري",
                      sales_minor: "1196000",
                      cost_minor: "765440",
                      margin_minor: "430560",
                      margin_bp: 3600,
                    },
                  ],
                  groups: [
                    {
                      id: "",
                      name: "مواد غذائية",
                      sales_minor: "3038000",
                      cost_minor: "2008790",
                      margin_minor: "1029210",
                      margin_bp: 3388,
                    },
                  ],
                }),
        ),
      ),
    );
    await login(page, "/reports/margin");
    await expectFrame(page, info, {
      screenId: "REP-05",
      state: "phase_locked",
      texts: fromFrame("REP-05", "phase_locked", [
        "الهامش ومقارنة الفروع",
        "مشروط بسياسة تكلفة معتمدة",
        "مرحلة غير مفعّلة",
        "هذا التقرير مصمَّم ولا يعمل الآن",
        "ليس نقص صلاحية ولا عطلاً. حساب الهامش يحتاج قراراً لم يُتخذ بعد: كيف تُحتسب تكلفة الوحدة المباعة — بآخر سعر شراء، أم بالمتوسط المرجّح، أم بالوارد أولاً صادر أولاً. الثلاثة تعطي أرقام ربح مختلفة للبضاعة نفسها.",
        "ما سيعرضه عند التفعيل — تخطيط معتمد ببيانات معطَّلة",
        "الفرع",
        "المبيعات",
        "التكلفة",
        "الهامش",
        "الفرع الرئيسي",
        "18,420.00",
        "تحتاج سياسة",
        "فرع بحري",
        "11,960.00",
        "عمود المبيعات دقيق ومتاح الآن في",
        "تقرير المبيعات",
        ". الممتنع هو التكلفة والهامش وحدهما — ولن يظهرا برقم تقريبي.",
        "ما الذي تحتاجه سياسة التكلفة",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator("body")).toContainText(
      "مشروط بسياسة تكلفة معتمدة، ويبقى مقفلاً حتى تُعتمد.",
    );
    const root = page.locator('[data-screen="REP-05"]');
    await expect(root).not.toContainText("%");
    // سياسة معتمدة لكن الأصناف بلا تكلفة: نمتنع عن الرقم
    mode = "empty";
    await page.getByRole("button", { name: "آخر 7 أيام" }).click();
    await expectFrame(page, info, {
      screenId: "REP-05",
      state: "empty",
      texts: fromFrame("REP-05", "empty", [
        "الهامش — نمتنع عن الرقم بدل تخمينه",
        "بلا تكلفة مسجَّلة لا يوجد هامش. نعرض ما ينقص وكيف يُستكمل، ولا نضع رقماً مبنياً على سعر افتراضي.",
        "فارغ بسبب",
        "تقرير الهامش — غير متاح بعد",
        "الهامش = البيع ناقص التكلفة. تكلفة",
        "63 صنفاً من 96",
        "ما يلزم لتشغيله",
        "ابدأ بإدخال تكاليف الأصناف الأكثر مبيعاً",
        "تسجيل تكلفة الشراء للأصناف — تُلتقط تلقائياً من فواتير الموردين بعد اليوم.",
        "الباقة الحالية لا تشمل مقارنة الفروع؛ الهامش لفرع واحد متاح فور اكتمال التكاليف.",
      ]),
    });
    await expect(root).toContainText("سكر، زيت");
    // اكتملت التكاليف: الهامش بالفرع والمجموعة، بالنسب لا بالمبالغ وحدها
    mode = "ready";
    await page.getByRole("button", { name: "اليوم" }).click();
    await expectFrame(page, info, {
      screenId: "REP-05",
      state: "ready",
      texts: fromFrame("REP-05", "ready", [
        "الهامش بالفرع والمجموعة",
        "المقارنة بالنسب لا بالمبالغ وحدها — فرعٌ أصغر بهامش أعلى قد يكون الأفضل.",
        "وقت السياسة",
        "ومكتوبٌ في رأس التقرير أيّ سياسة وُلّد بها.",
      ]),
    });
    await expect(root).toContainText("التكلفة المتوسط المرجَّح من مستندات الشراء");
    await expect(root).toContainText("5,986.50 · 32.50%");
    await expect(root).toContainText("4,305.60 · 36.00%");
    await expect(root).toContainText("مواد غذائية");
  });

  test("permission_denied: الشاشة كلها محجوبة لغير المالك وتبقى في القائمة بقفل ظاهر", async ({
    page,
  }, info) => {
    await page.route("**/api/reports/margin?**", (route) =>
      route.fulfill(json(403, { detail: "permission_denied", role_name: "مدير فرع" })),
    );
    await login(page, "/reports/margin");
    await expectFrame(page, info, {
      screenId: "REP-05",
      state: "permission_denied",
      texts: fromFrame("REP-05", "permission_denied", [
        "الشاشة كلها محجوبة",
        "من يرى الهامش يرى التكلفة بالطرح، فالحجب الجزئي هنا وهمٌ لا سياسة.",
        "تبقى مرئية في القائمة",
        "بقفل ظاهر. الموظف يعرف أن ثمّة تقريراً يطلبه إن احتاجه.",
      ]),
    });
    await expect(page.locator("body")).toContainText("كما في «التكلفة والهامش»: من يرى الهامش");
    await expect(page.getByRole("link", { name: "الهامش", exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-screen="REP-05"]')).not.toContainText("18,420.00");
  });
});

test.describe("REP-06", () => {
  test("ready → loading → success: المعاينة قبل التصدير، ثم جاهز للتنزيل باسم يحمل مداه", async ({
    page,
  }, info) => {
    let released = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = () => {
        released = true;
        r();
      };
    });
    await page.route("**/api/reports/export/preview?**", (route) =>
      route.fulfill(json(200, preview())),
    );
    await page.route("**/api/reports/exports", async (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toMatchObject({ report: "sales", range: "30d" });
        if (!released) await held;
        return route.fulfill(json(201, { export: exported() }));
      }
      return route.fulfill(
        json(200, { exports: [], quota: { used: 2, limit: 30 }, months_limit: 12 }),
      );
    });
    await login(page, "/reports/export");
    await expectFrame(page, info, {
      screenId: "REP-06",
      state: "ready",
      texts: fromFrame("REP-06", "ready", [
        "تصدير تقرير ومعاينته",
        "اختر المدى والصيغة",
        "معاينةٌ للصفحة الأولى كما ستُطبع بالضبط: الترويسة والاتجاه والأرقام.",
        "المعاينة قبل التصدير",
        "لأن الخطأ يُكتشف بعد الإرسال إلى المحاسب عادةً، وحينها تكون الورقة خرجت.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="REP-06"]');
    await expect(root).toContainText(
      "sales-2026-08-21_2026-09-19.html · 3 صفحات متوقَّعة · 92 صفاً",
    );
    await expect(root).toContainText("الحصة هذا الشهر: 2 من 30");
    const frame = page.frameLocator(".rep-preview");
    await expect(frame.locator("body")).toContainText("صفحة 1 من 3");
    await page.getByRole("button", { name: "صدِّر" }).click();
    await expectFrame(page, info, {
      screenId: "REP-06",
      state: "loading",
      texts: fromFrame("REP-06", "loading", [
        "جارٍ التوليد",
        "مع عدد الصفحات المتوقَّع",
        "تقرير ثلاثة أشهر قد يبلغ أربعين صفحة.",
      ]),
    });
    await expect(root).toContainText("مع عدد الصفحات المتوقَّع: 3 صفحات");
    release();
    await expectFrame(page, info, {
      screenId: "REP-06",
      state: "success",
      texts: fromFrame("REP-06", "success", [
        "جاهز للتنزيل",
        "اسم الملف وحجمه وعدد صفحاته ومداه. والمدى في اسم الملف نفسه لا في محتواه وحده.",
        "لماذا في الاسم",
        "لأنه سيُرسل بالبريد ويُحفظ بين عشرة ملفات. ملفٌ اسمه «تقرير.pdf» ضائع بعد أسبوع.",
      ]),
    });
    await expect(root).toContainText(
      "sales-2026-08-21_2026-09-19.html · 48 KB · 3 صفحات · 2026-08-21 – 2026-09-19",
    );
    await expect(page.getByRole("link", { name: "تنزيل" })).toHaveAttribute(
      "download",
      "sales-2026-08-21_2026-09-19.html",
    );
  });

  test("validation_error: 14 شهراً وحدّ 12 — البدائل الثلاثة؛ server_error: فشل التوليد يقترح البديل", async ({
    page,
  }, info) => {
    let requested = false;
    await page.route("**/api/reports/export/preview?**", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("summary") === "monthly")
        return route.fulfill(
          json(
            200,
            preview({
              monthly: true,
              file_name: "sales-monthly-2025-08-01_2026-09-30.html",
              expected_pages: 1,
              row_count: 14,
            }),
          ),
        );
      if (
        url.searchParams.get("range") === "custom" &&
        url.searchParams.get("start") === "2025-08-01" &&
        url.searchParams.get("end") === "2026-09-30"
      )
        return route.fulfill(
          json(400, {
            detail: "range_too_wide",
            extra: {
              months: 14,
              limit: 12,
              alternatives: [
                { key: "split", first_end: "2026-07-01", rest_months: 2 },
                { key: "monthly_summary", months: 14 },
                { key: "request_wider", limit: 12 },
              ],
            },
          }),
        );
      return route.fulfill(json(200, preview()));
    });
    await page.route("**/api/reports/exports/limit-request", (route) => {
      requested = true;
      return route.fulfill(json(200, { requested_months: 14, limit: 12, status: "requested" }));
    });
    await page.route("**/api/reports/exports", (route) =>
      route.request().method() === "POST"
        ? route.fulfill(json(502, { detail: "upstream" }))
        : route.fulfill(
            json(200, { exports: [], quota: { used: 2, limit: 30 }, months_limit: 12 }),
          ),
    );
    await login(page, "/reports/export");
    const root = page.locator('[data-screen="REP-06"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: "مدى مخصَّص" }).click();
    await page.getByLabel("من تاريخ").fill("2025-08-01");
    await page.getByLabel("إلى تاريخ").fill("2026-09-30");
    await expectFrame(page, info, {
      screenId: "REP-06",
      state: "validation_error",
      texts: fromFrame("REP-06", "validation_error", [
        "التصدير متوقف",
        "قسّمه إلى ملفين",
        "الترويسة في كل ملف تقول أي مدى يغطيه ومتى حُسب.",
        "صدّر الملخص الشهري بدل التفصيل",
        "شهراً كاملة بسطر لكل شهر — مناسب للبنك والمراجع الخارجي.",
        "اطلب مدى أوسع",
        "شهراً من الباقة لا من النظام. يُرفع بطلب ويُذكر تأثيره على حجم الملف.",
      ]),
    });
    await expect(root).toContainText("النطاق المطلوب 14 شهراً وحدّ التصدير 12.");
    await expect(root).toContainText("12 شهراً ثم 2 شهراً.");
    await page.getByRole("button", { name: "اطلب مدى أوسع" }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(root).toContainText("سُجّل طلبك.");
    // الملخص الشهري يغطي المدى كله
    await page.getByRole("button", { name: "صدّر الملخص الشهري بدل التفصيل" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("sales-monthly-2025-08-01_2026-09-30.html");
    await expect(root).toContainText("ملخص شهري");
    // فشل التوليد: لا ملف ناقص يُنزَّل — البديل مدى أقصر أو CSV
    await page.getByRole("button", { name: "صدِّر" }).click();
    await expectFrame(page, info, {
      screenId: "REP-06",
      state: "server_error",
      texts: fromFrame("REP-06", "server_error", [
        "فشل التوليد",
        "التقرير كبير أو الخادم تعثّر. لا ملف ناقص يُنزَّل.",
        "البديل",
        "مدى أقصر، أو صيغة CSV أخفّ. نقترح البديل ولا نكتفي بالاعتذار.",
      ]),
    });
    await expect(page.getByRole("link", { name: "تنزيل" })).toHaveCount(0);
    await page.getByRole("button", { name: "صيغة CSV أخفّ" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "CSV", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
