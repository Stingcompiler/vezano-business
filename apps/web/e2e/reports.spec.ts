import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.7 — REP-01 تقرير المبيعات (6) + REP-02 تقرير الذمم (5): الرقم ومعه وقته وسطر الاكتمال؛
 * `pending_sync` يعلن ما لم يدخل بعد؛ `empty` يقترح المدى الأقرب؛ `stale` من آخر مطابقة؛ مدير
 * الفرع لا يقارن؛ الذمم بلا أعمار (G-15) والكاشير لا يراها.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const todayIso = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const BRANCHES = [
  { id: "b1", name: "الفرع الرئيسي" },
  { id: "b2", name: "فرع السوق" },
  { id: "b3", name: "فرع الكورنيش" },
  { id: "b4", name: "فرع النور" },
];

const sales = (o: Record<string, unknown> = {}) => ({
  scope: "all",
  branch_name: "",
  can_all_branches: true,
  range: { key: "today", start: todayIso, end: todayIso, label: "اليوم" },
  method: "all",
  totals: {
    revenue_minor: "842000",
    returns_minor: "12000",
    net_minor: "830000",
    invoices: 147,
    returns_count: 4,
    cash_minor: "600000",
    credit_minor: "200000",
    bank_minor: "42000",
    average_minor: "5728",
  },
  by_branch: [
    {
      id: "b1",
      name: "الفرع الرئيسي",
      revenue_minor: "400000",
      returns_minor: "0",
      invoices: 70,
      last_sync_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      pending: 0,
      complete: true,
    },
    {
      id: "b2",
      name: "فرع السوق",
      revenue_minor: "242000",
      returns_minor: "12000",
      invoices: 40,
      last_sync_at: new Date(Date.now() - 6 * 60_000).toISOString(),
      pending: 0,
      complete: true,
    },
    {
      id: "b3",
      name: "فرع الكورنيش",
      revenue_minor: "200000",
      returns_minor: "0",
      invoices: 37,
      last_sync_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      pending: 0,
      complete: true,
    },
    {
      id: "b4",
      name: "فرع النور",
      revenue_minor: "0",
      returns_minor: "0",
      invoices: 0,
      last_sync_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      pending: 0,
      complete: true,
    },
  ],
  by_day: [
    {
      date: todayIso,
      invoices: 147,
      cash_minor: "600000",
      credit_minor: "200000",
      bank_minor: "42000",
      revenue_minor: "842000",
      returns_minor: "12000",
      net_minor: "830000",
    },
  ],
  completeness: {
    devices_total: 4,
    devices_synced: 4,
    pending_ops: 0,
    not_synced: [],
    complete: true,
  },
  branches: BRANCHES,
  computed_at: today(9, 41),
  last_sale_date: todayIso,
  cost_columns: "phase_locked",
  ...o,
});

const receivables = (o: Record<string, unknown> = {}) => ({
  side: "customers",
  scope: "all",
  rows: [
    {
      id: "p1",
      name: "أحمد الطيب — تجريبي",
      balance_minor: "250000",
      last_payment_date: "2026-09-05",
      oldest_unpaid_date: "2026-09-09",
      invoices: 3,
      source: "فواتير آجلة",
    },
    {
      id: "p2",
      name: "فاطمة حسن — تجريبي",
      balance_minor: "30000",
      last_payment_date: "",
      oldest_unpaid_date: todayIso,
      invoices: 1,
      source: "فاتورة واحدة",
    },
    {
      id: "p3",
      name: "عمر بابكر — تجريبي",
      balance_minor: "15000",
      last_payment_date: "",
      oldest_unpaid_date: "2026-08-12",
      invoices: 0,
      source: "رصيد افتتاحي — بلا فواتير",
    },
  ],
  totals: { balance_minor: "295000", parties: 3 },
  computed_at: today(8, 0),
  ageing: "disabled",
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

test.describe("REP-01", () => {
  test("loading → ready → pending_sync → empty: الرقم ومعه وقته، سطر الاكتمال، ناقص معلوم، ثم اقتراح المدى الأقرب", async ({
    page,
  }, info) => {
    let calls = 0;
    let released = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = () => {
        released = true;
        r();
      };
    });
    await page.route("**/api/reports/sales?**", async (route) => {
      calls += 1;
      const url = new URL(route.request().url());
      if (url.searchParams.get("export") === "csv") {
        return route.fulfill({
          status: 200,
          contentType: "text/csv",
          body: "# تقرير المبيعات · اليوم · ناقص 9 عمليات معلّقة\n",
        });
      }
      if (url.searchParams.get("range") === "yesterday") {
        return route.fulfill(
          json(
            200,
            sales({
              range: { key: "yesterday", start: "2026-09-18", end: "2026-09-18", label: "أمس" },
              totals: { ...sales().totals, invoices: 0, revenue_minor: "0", returns_count: 0 },
              by_day: [],
              last_sale_date: "2026-09-16",
            }),
          ),
        );
      }
      if (url.searchParams.get("method") === "credit") {
        // ناقص معلوم: 9 عمليات معلّقة من جهازين
        return route.fulfill(
          json(
            200,
            sales({
              method: "credit",
              completeness: {
                devices_total: 4,
                devices_synced: 2,
                pending_ops: 9,
                not_synced: [
                  {
                    device_name: "هاتف المخزن",
                    branch_id: "b2",
                    branch_name: "فرع بحري",
                    last_seen_at: new Date(Date.now() - 40 * 60_000).toISOString(),
                    pending: 7,
                  },
                  {
                    device_name: "جهاز الكاشير 3",
                    branch_id: "b3",
                    branch_name: "فرع أم درمان",
                    last_seen_at: new Date(Date.now() - 20 * 60_000).toISOString(),
                    pending: 2,
                  },
                ],
                complete: false,
              },
              by_branch: sales().by_branch.map((b) =>
                b.id === "b2"
                  ? { ...b, pending: 7, complete: false }
                  : b.id === "b3"
                    ? { ...b, pending: 2, complete: false }
                    : b,
              ),
            }),
          ),
        );
      }
      if (!released) await held; // الحساب جارٍ حتى نُثبت حالة loading (StrictMode يكرّر الطلب)
      return route.fulfill(json(200, sales()));
    });
    await login(page, "/reports");
    await expectFrame(page, info, {
      screenId: "REP-01",
      state: "loading",
      texts: fromFrame("REP-01", "loading", [
        "تقرير المبيعات — الرقم ومعه وقته",
        "جارٍ الحساب",
        "المرشّحات فعّالة",
        "تغييرها أثناء الحساب يعيد الطلب لا ينتظره.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "REP-01",
      state: "ready",
      texts: fromFrame("REP-01", "ready", [
        "تقرير المبيعات — الرقم ومعه وقته",
        "في نظامٍ تعمل أجهزته بلا اتصال، «مبيعات اليوم» ليست رقماً واحداً بل رقمٌ مع بيانِ ما دخل فيه وما لم يدخل بعد.",
        "اكتمال البيانات",
        "الإيراد",
        "المرتجعات",
        "آخر مزامنة",
        "عدد الفواتير",
        "الفرع الرئيسي",
        "فرع السوق",
        "فرع الكورنيش",
        "فرع النور",
        "لا عمود تكلفة ولا هامش هنا — قرار",
        "صدِّر CSV",
        "كل وسائل الدفع",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator("body")).toContainText("وتظهر في «تقرير الهامش» مقفلةً حتى تُعتمد.");
    const root = page.locator('[data-screen="REP-01"]');
    await expect(root).toContainText("4 أجهزة من 4 زامنت.");
    await expect(root).toContainText("8,420.00");
    await expect(root).toContainText("من 4 فروع زامنت");
    await expect(root).toContainText("4 مرتجعات");
    await expect(root).toContainText("متوسط 57.28");
    await expect(root).toContainText("قبل دقيقتين");
    await expect(root).toContainText("قبل 6 دقائق");
    await expect(root).toContainText("حُسب في 09:41");
    // ناقص معلوم — الجهازان اللذان لم يزامنا مذكوران في الرأس لا في حاشية
    await page.getByRole("button", { name: "آجل", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "REP-01",
      state: "pending_sync",
      texts: fromFrame("REP-01", "pending_sync", [
        "ناقص معلوم",
        "اكتمال البيانات",
        "تصدير مع ختم الاكتمال",
        "مزامنة ثم إعادة الحساب",
        "الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من الشاشة.",
        "مكتمل",
      ]),
    });
    await expect(root).toContainText(
      "هذا التقرير لا يشمل 9 عمليات معلّقة من هاتف المخزن وجهاز الكاشير 3",
    );
    await expect(root).toContainText("طبعه الآن يعني طبع رقم ناقص تعرف مقداره.");
    await expect(root).toContainText("2 أجهزة من 4 زامنت.");
    await expect(root).toContainText("ناقص 7 عمليات");
    await expect(root).toContainText("ناقص 2 عمليات");
    // المدى بلا مبيعات → اقتراح المدى الأقرب بزرّ ينتقل إليه
    await page.getByRole("button", { name: "كل وسائل الدفع" }).click();
    await page.getByRole("button", { name: "أمس", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "REP-01",
      state: "empty",
      texts: fromFrame("REP-01", "empty", [
        "لا مبيعات في المدى",
        "المدى المختار بلا فواتير. السبب المرشّح غالباً لا انعدام البيع.",
        "نقترح المدى الأقرب",
      ]),
    });
    await expect(root).toContainText("لا مبيعات في أمس — آخر بيع 16 سبتمبر.");
    const before = calls;
    await page.getByRole("button", { name: "نقترح المدى الأقرب" }).click();
    await expect.poll(() => calls).toBeGreaterThan(before);
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "2026-09-16" })).toBeVisible();
  });

  test("stale: لا اتصال — أرقام من آخر مطابقة بوقتها؛ permission_denied: مدير الفرع لا يقارن", async ({
    page,
    context,
  }, info) => {
    await page.route("**/api/reports/sales?**", (route) =>
      route.fulfill(
        json(
          200,
          sales({
            scope: "branch",
            branch_name: "فرع السوق",
            can_all_branches: false,
            branches: [],
          }),
        ),
      ),
    );
    await login(page, "/reports");
    const root = page.locator('[data-screen="REP-01"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("فرع السوق");
    await page.getByRole("button", { name: "كل الفروع" }).click();
    await expectFrame(page, info, {
      screenId: "REP-01",
      state: "permission_denied",
      texts: fromFrame("REP-01", "permission_denied", [
        "مدير الفرع يرى فرعه",
        "يرى أرقام فرعه كاملةً ولا يرى الفروع الأخرى ولا المقارنة بينها.",
        "لا نُخفي وجودها",
      ]),
    });
    await expect(root).toContainText(
      "«تُعرض أرقام فرع السوق — المقارنة بين الفروع للمالك». معرفةُ أن ثمّة أكثر ليست إفشاءً.",
    );
    await page.getByRole("button", { name: "فرع السوق" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    // انقطاع الشبكة: التقرير من آخر مطابقة بوقته ووسمه — لا نمنع القراءة
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "REP-01",
      state: "stale",
      texts: fromFrame("REP-01", "stale", [
        "أرقام من آخر مطابقة",
        "لا اتصال الآن، والتقرير من بيانات الجهاز المحلية.",
        "لا نمنع القراءة",
        "نُظهره بوقته ووسمه. منعُ تقرير لأن الشبكة ساقطة يُعطّل عملاً لأجل دقّةٍ قد لا تلزم.",
      ]),
    });
    await expect(root).toContainText("حُسب في 09:41");
    await expect(root).toContainText("8,420.00");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  });
});

test.describe("REP-02", () => {
  test("loading → ready: رصيد وآخر سداد وأقدم حركة غير مسددة، بلا أعمار؛ empty للموردين", async ({
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
    await page.route("**/api/reports/receivables?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("side") === "suppliers")
        return route.fulfill(
          json(
            200,
            receivables({
              side: "suppliers",
              rows: [],
              totals: { balance_minor: "0", parties: 0 },
            }),
          ),
        );
      if (!released) await held;
      return route.fulfill(json(200, receivables()));
    });
    await login(page, "/reports/receivables");
    await expectFrame(page, info, {
      screenId: "REP-02",
      state: "loading",
      texts: fromFrame("REP-02", "loading", [
        "جارٍ الحساب",
        "الذمم تُحسب من كل الحركات لا تُقرأ جاهزة.",
        "لا رقم جزئي",
        "لا نعرض مجموعاً يتزايد أمام العين. المجموع المالي يُقرأ مرة ويُحفظ في الذهن.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "REP-02",
      state: "ready",
      texts: fromFrame("REP-02", "ready", [
        "تقرير الذمم — بلا تقادم مخترَع",
        "آخر سداد وأقدم حركة غير مسددة، لا جدول أعمار",
        "على العملاء",
        "لنا على الموردين",
        "كل الفروع",
        "تصدير",
        "العميل",
        "الرصيد",
        "آخر سداد",
        "أقدم حركة غير مسددة",
        "المصدر",
        "غير مفعّل",
        "تقادم الديون (30/60/90) غير معروض.",
        "أحمد الطيب — تجريبي",
        "05 سبتمبر",
        "09 سبتمبر",
        "فواتير آجلة",
        "فاطمة حسن — تجريبي",
        "لا سداد بعد",
        "اليوم",
        "فاتورة واحدة",
        "عمر بابكر — تجريبي",
        "رصيد افتتاحي — بلا فواتير",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="REP-02"]');
    await expect(root).toContainText("2,500.00");
    await expect(root).toContainText("3 طرفاً · المجموع 2,950.00");
    await expect(root).toContainText("حسابه يتطلب توزيع كل دفعة على فواتير بعينها");
    await page.getByRole("button", { name: "لنا على الموردين" }).click();
    await expect(root).toHaveAttribute("data-state", "empty");
    await expect(root).toContainText("لا ذمم");
  });

  test("empty: لا ذمم — كل مبيعاتك نقدية؛ stale بلا اتصال؛ permission_denied للكاشير", async ({
    page,
    context,
  }, info) => {
    let denied = false;
    await page.route("**/api/reports/receivables?**", (route) =>
      denied
        ? route.fulfill(json(403, { detail: "permission_denied", role_name: "كاشير" }))
        : route.fulfill(
            json(200, receivables({ rows: [], totals: { balance_minor: "0", parties: 0 } })),
          ),
    );
    await login(page, "/reports/receivables");
    await expectFrame(page, info, {
      screenId: "REP-02",
      state: "empty",
      texts: fromFrame("REP-02", "empty", [
        "لا ذمم",
        "كل البيع نقدي ولا آجل. حالةٌ صحّية لمحلّ تجزئة، لا نقصَ بيانات.",
        "نقولها كذلك",
        "«لا ذمم مفتوحة — كل مبيعاتك نقدية». لا نقترح فتح البيع الآجل: قرارٌ تجاري ليس لنا.",
      ]),
    });
    const root = page.locator('[data-screen="REP-02"]');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "REP-02",
      state: "stale",
      texts: fromFrame("REP-02", "stale", [
        "الذمم من آخر مطابقة",
        "الخطر المحدد",
        "أن تطالب زبوناً سدّد. نقولها صراحةً: «قد لا تشمل سداداً وقع في فرع لم يُزامن» — لا تحذيراً عاماً.",
      ]),
    });
    await expect(root).toContainText("(08:00)");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(root).toHaveAttribute("data-state", "empty");
    // الكاشير: 403 → يرى زبائنه وقت البيع لا التقرير كاملاً
    denied = true;
    await page.getByRole("button", { name: "لنا على الموردين" }).click();
    await expectFrame(page, info, {
      screenId: "REP-02",
      state: "permission_denied",
      texts: fromFrame("REP-02", "permission_denied", [
        "الكاشير يرى زبائنه",
        "الكاشير يرى رصيد الطرف الذي يبيع له وقت البيع، ولا يرى تقرير الذمم كاملاً.",
        "لماذا",
        "التقرير الكامل صورةٌ مالية للمنشأة كلها. رؤية رصيد زبون أمامك حاجةُ عمل، ورؤية الجميع ليست كذلك.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تصدير" })).toHaveCount(0);
  });
});
