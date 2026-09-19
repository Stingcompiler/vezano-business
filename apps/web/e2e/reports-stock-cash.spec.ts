import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.8 — REP-03 تقرير المخزون والحركات (5) + REP-04 تقرير الصندوق والورديات (5): كل كمية لها
 * مستند والسالب بلونه ومعه مستنده؛ `pending_sync` يشمل حركات هذا الجهاز موسومة؛ `empty` يقول
 * السبب؛ الورديات المغلقة وحدها، و`conflict` = وردية بعدّين تُستثنى من المجموع ويُقال ذلك.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const todayIso = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const UNIT_KG = { code: "kg", name: "كغ", decimal_places: 0 as const };
const stockRow = (o: Record<string, unknown>) => ({
  item_id: "i1",
  name: "سكر — كيس 50",
  unit: { code: "bag", name: "كيس", decimal_places: 0 },
  opening_milli: "120000",
  in_milli: "40000",
  out_milli: "12000",
  closing_milli: "148000",
  moved_in_range: 13,
  tag: "ok",
  doc: "استلام بضاعة GRN-311",
  explain: "",
  last_movement_at: today(9, 12),
  ...o,
});

const stock = (o: Record<string, unknown> = {}) => ({
  scope: "all",
  branch: { id: "b2", name: "فرع بحري" },
  range: { key: "30d", start: "2026-09-01", end: todayIso, label: "آخر 30 يوماً" },
  rows: [
    stockRow({}),
    stockRow({
      item_id: "i2",
      name: "زيت قلي 5 لتر",
      unit: { code: "carton", name: "كرتون", decimal_places: 0 },
      opening_milli: "4000",
      in_milli: "0",
      out_milli: "10000",
      closing_milli: "-6000",
      moved_in_range: 6,
      tag: "negative",
      doc: "بيع نقطة بيع INV-BHR-A2-26-000187",
      explain: "لا يوجد إدخال شراء مقابل",
      last_movement_at: today(10, 40),
    }),
    stockRow({
      item_id: "i3",
      name: "معلبات فول",
      unit: UNIT_KG,
      opening_milli: "3000",
      in_milli: "0",
      out_milli: "3000",
      closing_milli: "0",
      moved_in_range: 2,
      tag: "empty",
      doc: "بيع نقطة بيع INV-BHR-A2-26-000190",
      last_movement_at: new Date(Date.now() - 86_400_000).toISOString(),
    }),
  ],
  moved_rows: 3,
  negatives: 1,
  completeness: {
    devices_total: 3,
    devices_synced: 3,
    pending_ops: 0,
    not_synced: [],
    complete: true,
  },
  branches: [
    { id: "b1", name: "الفرع الرئيسي" },
    { id: "b2", name: "فرع بحري" },
  ],
  computed_at: today(11, 5),
  last_movement_date: todayIso,
  ...o,
});

const shiftRow = (o: Record<string, unknown>) => ({
  id: "s1",
  branch_name: "الفرع الرئيسي",
  device_name: "تابلت الكاشير",
  user_name: "أحمد ياسين",
  opened_at: today(8, 0),
  closed_at: today(20, 42),
  count_status: "counted",
  expected_cash_at_close_minor: "243000",
  counted_cash_minor: "238500",
  counted_by_name: "أحمد ياسين",
  witness_name: "سميّة عبد الله",
  variance_minor: "-4500",
  reviewed: false,
  reviewed_by_name: "",
  conflict: null,
  ...o,
});

const cash = (o: Record<string, unknown> = {}) => ({
  scope: "all",
  branch_name: "",
  can_all_branches: true,
  range: { key: "7d", start: "2026-09-13", end: todayIso, label: "آخر 7 أيام" },
  rows: [
    shiftRow({}),
    shiftRow({
      id: "s2",
      user_name: "خالد إبراهيم",
      expected_cash_at_close_minor: "50000",
      counted_cash_minor: "50000",
      counted_by_name: "خالد إبراهيم",
      witness_name: "",
      variance_minor: "0",
      closed_at: today(14, 10),
    }),
  ],
  totals: {
    shifts: 2,
    counted: 2,
    not_counted: 0,
    variance_minor: "-4500",
    over_minor: "0",
    short_minor: "-4500",
    unreviewed_variances: 1,
    excluded_conflicts: 0,
  },
  open_shifts: [],
  completeness: {
    devices_total: 2,
    devices_synced: 2,
    pending_ops: 0,
    not_synced: [],
    complete: true,
  },
  branches: [
    { id: "b1", name: "الفرع الرئيسي" },
    { id: "b2", name: "فرع بحري" },
  ],
  computed_at: today(21, 0),
  last_closed_date: todayIso,
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

function gate() {
  let released = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = () => {
      released = true;
      r();
    };
  });
  return { held, release: () => release(), isReleased: () => released };
}

test.describe("REP-03", () => {
  test("loading → ready → pending_sync → empty: السالب بلونه ومستنده، حركات الجهاز موسومة، والفراغ يقول سببه", async ({
    page,
  }, info) => {
    const g = gate();
    await page.route("**/api/reports/stock?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("range") === "yesterday")
        return route.fulfill(
          json(
            200,
            stock({
              range: { key: "yesterday", start: "2026-09-18", end: "2026-09-18", label: "أمس" },
              rows: stock().rows.map((r) => ({
                ...r,
                moved_in_range: 0,
                in_milli: "0",
                out_milli: "0",
              })),
              moved_rows: 0,
              last_movement_date: "2026-09-16",
            }),
          ),
        );
      if (url.searchParams.get("branch_id") === "b1")
        return route.fulfill(
          json(
            200,
            stock({
              branch: { id: "b1", name: "الفرع الرئيسي" },
              completeness: {
                devices_total: 3,
                devices_synced: 2,
                pending_ops: 6,
                not_synced: [
                  {
                    device_name: "هاتف المخزن",
                    branch_name: "الفرع الرئيسي",
                    last_seen_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
                    pending: 6,
                  },
                ],
                complete: false,
              },
            }),
          ),
        );
      if (!g.isReleased()) await g.held;
      return route.fulfill(json(200, stock()));
    });
    await login(page, "/reports/stock");
    await expectFrame(page, info, {
      screenId: "REP-03",
      state: "loading",
      texts: fromFrame("REP-03", "loading", [
        "تقرير المخزون والحركات",
        "جارٍ الجمع",
        "الأرصدة من مواقع متعددة. نعرض المواقع وهي تَرِد واحداً واحداً لا شريطاً مبهماً",
      ]),
    });
    g.release();
    await expectFrame(page, info, {
      screenId: "REP-03",
      state: "ready",
      texts: fromFrame("REP-03", "ready", [
        "حركة المخزن والتصدير — كل كمية لها مستند",
        "السالب لا يُخفى ولا يُصفَّر. يظهر بلونه ومعه المستند الذي أنشأه.",
        "صنف برصيد سالب",
        "الصنف والوحدة",
        "أول المدة",
        "وارد",
        "صادر",
        "الرصيد",
        "المستند المفسِّر",
        "رصيد سالب",
        "«زيت قلي",
        ": بِيع أكثر مما دخل مسجَّلاً. السبب غالباً إدخال شراء لم يُسجَّل بعد. لا نصفّره ولا نمنع البيع بأثر رجعي — نعرضه حتى يُصحَّح بمستند.",
        "سكر — كيس 50",
        "كيس",
        "زيت قلي 5 لتر",
        "كرتون",
        "لا يوجد إدخال شراء مقابل — راجع",
        "معلبات فول",
        "نفد — آخر صرف",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="REP-03"]');
    await expect(root).toContainText("حركة الأصناف — آخر 30 يوماً · فرع بحري");
    await expect(root).toContainText("−6");
    await expect(root.locator(".inv-qty--neg").first()).toBeVisible();
    await expect(root).toContainText(
      "لا يوجد إدخال شراء مقابل — راجع بيع نقطة بيع INV-BHR-A2-26-000187",
    );
    await expect(root).toContainText("3 أجهزة من 3 زامنت · حُسب في 11:05");
    // فرع بجهاز لم يُزامن: حركات لم تُرفع — نشملها ونسمها
    await page.getByRole("button", { name: "الفرع الرئيسي" }).click();
    await expectFrame(page, info, {
      screenId: "REP-03",
      state: "pending_sync",
      texts: fromFrame("REP-03", "pending_sync", [
        "حركات لم تُرفع",
        "نشملها ونسمها",
        "إخفاؤها يجعل الرقم مخالفاً لما على الرفّ. وعرضها بلا وسم يجعله يبدو مؤكَّداً. الحلّ الثالث: تُعرض بوسم.",
      ]),
    });
    await expect(root).toContainText("هذا التقرير لا يشمل 6 عمليات معلّقة من هاتف المخزن");
    await expect(page.getByRole("button", { name: "مزامنة ثم إعادة الحساب" })).toBeVisible();
    // مدى بلا حركة: السبب المرشّح، وآخر حركة، وزرّ يوسّع المدى
    await page.getByRole("button", { name: "فرع بحري" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: "أمس", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "REP-03",
      state: "empty",
      texts: fromFrame("REP-03", "empty", [
        "لا حركة في المدى",
        "المدى المختار (أمس) بلا حركة. الفراغ سببه المرشّح لا المخزون.",
        "نقول السبب",
      ]),
    });
    await expect(root).toContainText("لا حركة في أمس — آخر حركة 16 سبتمبر.");
    await page.getByRole("button", { name: "وسّع المدى" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
  });

  test("stale: بلا اتصال — الأرصدة من آخر مطابقة والوقت مع كل رصيد", async ({
    page,
    context,
  }, info) => {
    await page.route("**/api/reports/stock?**", (route) => route.fulfill(json(200, stock())));
    await login(page, "/reports/stock");
    const root = page.locator('[data-screen="REP-03"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "REP-03",
      state: "stale",
      texts: fromFrame("REP-03", "stale", [
        "أرصدة من آخر مطابقة",
        "الوقت مع كل رصيد",
        "لا في رأس الصفحة وحده. من يطبع صفحةً واحدة من التقرير يأخذ معه الطابع الزمني.",
      ]),
    });
    await expect(root).toContainText("حُسبت في 11:05");
    await expect(root).toContainText("09:12");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  });
});

test.describe("REP-04", () => {
  test("loading → ready → conflict: الفوارق في الأعلى، ووردية بعدّين خارج المجموع ويُقال ذلك", async ({
    page,
  }, info) => {
    const g = gate();
    await page.route("**/api/reports/cash?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("range") === "30d")
        return route.fulfill(
          json(
            200,
            cash({
              range: { key: "30d", start: "2026-08-21", end: todayIso, label: "آخر 30 يوماً" },
              rows: [
                ...cash().rows,
                shiftRow({
                  id: "s3",
                  user_name: "فاطمة حسن",
                  branch_name: "فرع بحري",
                  device_name: "هاتف المالك",
                  closed_at: today(13, 5),
                  expected_cash_at_close_minor: "120000",
                  counted_cash_minor: "120000",
                  counted_by_name: "فاطمة حسن",
                  witness_name: "",
                  variance_minor: "0",
                  conflict: {
                    quarantine_id: "q1",
                    device_name: "تابلت الكاشير",
                    counted_by_name: "عثمان الطيب",
                    counted_cash_minor: "118000",
                    expected_cash_at_close_minor: "120000",
                    occurred_at: today(13, 9),
                    received_at: today(13, 20),
                  },
                }),
              ],
              totals: { ...cash().totals, shifts: 3, excluded_conflicts: 1 },
            }),
          ),
        );
      if (!g.isReleased()) await g.held;
      return route.fulfill(json(200, cash()));
    });
    await login(page, "/reports/cash");
    await expectFrame(page, info, {
      screenId: "REP-04",
      state: "loading",
      texts: fromFrame("REP-04", "loading", [
        "تقرير الصندوق والورديات",
        "جارٍ التجميع",
        "يُجمع من ورديات مغلقة وحدها. المفتوحة لا تدخل — وردية بلا عدّ ليس لها فارق.",
      ]),
    });
    g.release();
    await expectFrame(page, info, {
      screenId: "REP-04",
      state: "ready",
      texts: fromFrame("REP-04", "ready", [
        "تقرير الصندوق والورديات",
        "النقد المتوقَّع مقابل المعدود عبر الورديات. حالته الفريدة: تعارضٌ في تقرير.",
        "ورديات الأسبوع",
        "لكل وردية: المتوقَّع والمعدود والفارق ومن عدّ. والفوارق مجموعةٌ في الأعلى لأنها سبب فتح التقرير.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="REP-04"]');
    await expect(root).toContainText("−45.00");
    await expect(root).toContainText("من 2 وردية معدودة");
    await expect(root).toContainText("1 فرق لم يُراجَع");
    await expect(root).toContainText("أحمد ياسين — الفرع الرئيسي");
    await expect(root).toContainText("شاهد: سميّة عبد الله");
    await expect(root).toContainText("2,430.00");
    await expect(root).toContainText("2,385.00");
    await page.getByRole("button", { name: "آخر 30 يوماً" }).click();
    await expectFrame(page, info, {
      screenId: "REP-04",
      state: "conflict",
      texts: fromFrame("REP-04", "conflict", [
        "وردية بعدّين مختلفين",
        "وردية أُقفلت على جهازين بمبلغين مختلفين — عُدّت مرتين والنسختان في الدفتر.",
        "لا نجمع ولا نرجّح",
        "لا نأخذ المتوسط ولا الأحدث. تُعرض النسختان باسم من عدّ ووقته، وتُحال إلى SYS-03.",
        "الصفّ يُستثنى من المجموع",
        "«وردية واحدة خارج المجموع — بانتظار الحسم»",
      ]),
    });
    await expect(root).toContainText(
      "النسخة الأولى 1,200.00 عدّها فاطمة حسن على هاتف المالك في 13:05",
    );
    await expect(root).toContainText(
      "النسخة الثانية 1,180.00 عدّها عثمان الطيب على تابلت الكاشير في 13:09",
    );
    await expect(root).toContainText("خارج المجموع — بانتظار الحسم");
    await expect(root).toContainText("1 خارج المجموع");
    await expect(page.getByRole("button", { name: "الحسم في SYS-03" })).toBeVisible();
  });

  test("empty: لا ورديات مغلقة والمخرج يشير إلى المفتوحة المهجورة؛ stale: ناقص معلوم", async ({
    page,
  }, info) => {
    let pending = false;
    await page.route("**/api/reports/cash?**", (route) =>
      route.fulfill(
        json(
          200,
          pending
            ? cash({
                completeness: {
                  devices_total: 2,
                  devices_synced: 1,
                  pending_ops: 9,
                  not_synced: [
                    {
                      device_name: "هاتف المخزن",
                      branch_name: "فرع بحري",
                      last_seen_at: today(9, 0),
                      pending: 9,
                    },
                  ],
                  complete: false,
                },
              })
            : cash({
                rows: [],
                totals: {
                  ...cash().totals,
                  shifts: 0,
                  counted: 0,
                  variance_minor: "0",
                  short_minor: "0",
                  unreviewed_variances: 0,
                },
                open_shifts: [
                  {
                    id: "o1",
                    branch_name: "فرع بحري",
                    user_name: "خالد إبراهيم",
                    opened_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
                    open_hours: 48,
                    abandoned: true,
                  },
                ],
              }),
        ),
      ),
    );
    await login(page, "/reports/cash");
    await expectFrame(page, info, {
      screenId: "REP-04",
      state: "empty",
      texts: fromFrame("REP-04", "empty", [
        "لا ورديات مغلقة",
        "الورديات مفتوحة أو لم تبدأ بعد.",
        "المخرج",
      ]),
    });
    const root = page.locator('[data-screen="REP-04"]');
    await expect(root).toContainText(
      "وردية خالد إبراهيم — فرع بحري مفتوحة منذ قبل يومين — إقفال مهجور.",
    );
    pending = true;
    await page.getByRole("button", { name: "أمس", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "REP-04",
      state: "stale",
      texts: fromFrame("REP-04", "stale", [
        "ناقص معلوم",
        "هذا التقرير لا يشمل 9 عمليات معلّقة",
        ". طبعه الآن يعني طبع رقم ناقص تعرف مقداره.",
        "تصدير مع ختم الاكتمال",
        "الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من الشاشة.",
      ]),
    });
    await expect(root).toContainText("من هاتف المخزن. حُسب في 21:00");
  });
});
