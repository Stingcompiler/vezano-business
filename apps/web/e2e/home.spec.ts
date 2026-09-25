import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/** T1.7 — HOME-01 (6) + HOME-02 (5) + HOME-03 (5). */
const json = (status: number, body: unknown) => ({ status, json: body });
const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const OWNER = {
  kind: "owner",
  tenant_name: "بقالة النيل",
  user: { display_name: "عبد الله م.", role_name: "مالك", branch_name: "", device_name: "" },
  period: "today",
  branch_id: "",
  branches: [
    { id: "b1", name: "الرئيسي" },
    { id: "b2", name: "بحري" },
    { id: "b3", name: "النور" },
    { id: "b4", name: "أم درمان" },
  ],
  branches_synced: true,
  coverage_at: now(),
  decisions: [
    {
      id: "d1",
      title: "وردية سالم مفتوحة منذ 19 ساعة",
      detail: "فرع النور · تُقفل بعدّ حاضر",
      action: "افتح الإقفال",
      href: "/shifts/close",
      severity: "danger",
    },
    {
      id: "d2",
      title: "مستند شراء 441 ينتظر اعتمادك",
      detail: "4,415.00 · فرقه عن الأمر 235 زيادة",
      action: "راجع واعتمد",
      href: "/purchases/441",
      severity: "warn",
    },
    {
      id: "d3",
      title: "3 أصناف نفدت",
      detail: "عسل الواحة وصنفان · مورد واحد",
      action: "أنشئ أمر شراء",
      href: "/purchases/new",
      severity: "warn",
    },
  ],
  decisions_count: 3,
  kpis: [
    {
      key: "sales",
      label: "مبيعات اليوم",
      value: { kind: "money", amount_minor: "842000", exponent: 2 },
      scope: "من 4 فروع",
      note: "",
      note_kind: "info",
      as_of: ago(2),
      href: "/reports/sales",
      includes_pending: true,
    },
    {
      key: "receivables",
      label: "الذمم",
      value: { kind: "money", amount_minor: "1418000", exponent: 2 },
      scope: "22 طرفاً · أقدمها 41 يوماً",
      note: "",
      note_kind: "info",
      as_of: ago(2),
      href: "/parties",
    },
    {
      key: "cash",
      label: "نقد الصناديق",
      value: { kind: "money", amount_minor: "524000", exponent: 2 },
      scope: "3 ورديات مفتوحة",
      note: "المتوقَّع قبل العدّ",
      note_kind: "warn",
      as_of: ago(2),
      href: "/shifts",
    },
  ],
  attention: [
    {
      id: "a1",
      title_count: 3,
      title: "عمليات معلقة منذ",
      minutes: 40,
      detail: "الكاشير 1 — لا اتصال بالخادم",
      action: "مركز المزامنة",
      href: "/sync",
    },
  ],
  tasks: [],
  quick_actions: ["sale", "payment", "return"],
  can_see_finance: true,
  margin_locked: true,
  shift: null,
};
const EMPLOYEE = {
  ...OWNER,
  kind: "employee",
  user: {
    display_name: "سميرة",
    role_name: "كاشير",
    branch_name: "الفرع الرئيسي",
    device_name: "الكاشير 1",
  },
  decisions: [],
  decisions_count: 0,
  kpis: [],
  attention: [],
  tasks: [
    { id: "t1", title: "فاتورة 1044 حُفظت ولم تُطبع", href: "/pos/1044" },
    { id: "t2", title: "إغلاق الوردية عند 21:00", href: "/shifts/close" },
  ],
  can_see_finance: false,
  shift: { open_since: new Date(new Date().setHours(8, 0, 0, 0)).toISOString() },
};

async function loginTo(page: Page, summary: unknown) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/home**", (route) => route.fulfill(json(200, summary)));
  await page.route("**/api/notices", (route) =>
    route.fulfill(json(200, { items: [], needs_action: 0 })),
  );
  await page.goto("/login");
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("HOME-01", () => {
  test("ready: يحتاج قرارك فوق الأرقام، وكل رقم بمصدره ووقته", async ({ page }, info) => {
    await loginTo(page, OWNER);
    await expectFrame(page, info, {
      screenId: "HOME-01",
      state: "ready",
      texts: fromFrame("HOME-01", "ready", [
        "— بقالة النيل",
        "فروع · كلها زامنت",
        "يحتاج قرارك —",
        "وردية سالم مفتوحة منذ",
        "فرع النور · تُقفل بعدّ حاضر",
        "افتح الإقفال",
        "مستند شراء 441 ينتظر اعتمادك",
        "4,415.00 · فرقه عن الأمر 235 زيادة",
        "راجع واعتمد",
        "أصناف نفدت",
        "عسل الواحة وصنفان · مورد واحد",
        "أنشئ أمر شراء",
        "مبيعات اليوم",
        "الذمم",
        "نقد الصناديق",
        "ورديات مفتوحة",
        "محدّث قبل",
      ]),
      styles: [[".home-decisions", "background-color", "color.amber.50"]],
    });
    // كل رقم يفتح على مصدره (R-01)
    await expect(page.locator("a.home-kpi")).toHaveCount(3);
    await expect(page.locator(".home-kpi__value").first()).toHaveText("8,420 ج.س");
    await expect(page.locator('[data-screen="HOME-01"]')).toContainText("الهامش وصافي الربح");
  });

  test("empty: يومٌ لم يبدأ — لا أصفار", async ({ page }, info) => {
    await loginTo(page, { ...OWNER, decisions: [], decisions_count: 0, kpis: [], attention: [] });
    await expectFrame(page, info, {
      screenId: "HOME-01",
      state: "empty",
      texts: fromFrame("HOME-01", "empty", ["يومٌ لم يبدأ", "لم يبدأ البيع بعد", "افتح وردية"]),
    });
    await expect(page.locator('[data-screen="HOME-01"]')).not.toContainText("0.00");
  });

  test("loading: جارٍ الجمع — البطاقات تَرِد لا دفعة واحدة", async ({ page }, info) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.route("**/api/home**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill(json(200, OWNER));
    });
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "HOME-01",
      state: "loading",
      texts: fromFrame("HOME-01", "loading", ["جارٍ الجمع"]),
    });
  });

  test("stale: الأرقام حتى تغطية الخادم بوقتها — من آخر مطابقة", async ({ page }, info) => {
    await loginTo(page, OWNER);
    await expect(page.locator('[data-screen="HOME-01"][data-state="ready"]')).toBeVisible();
    await page.unroute("**/api/home**");
    await page.route("**/api/home**", (route) => route.abort("connectionfailed"));
    // إعادة الجلب بتغيير الفترة
    await page.getByLabel("الفترة").selectOption("7d");
    await expectFrame(page, info, {
      screenId: "HOME-01",
      state: "stale",
      texts: fromFrame("HOME-01", "stale", [
        "كل الأرقام حتى تغطية الخادم",
        "أجهزة الفروع الأخرى قد تحمل عمليات لم تصل بعد.",
      ]),
    });
    await expect(page.locator(".c-frame__banner")).toContainText("أرقام قديمة");
  });

  test("offline: الأرقام من آخر مطابقة والفعل لا يتوقف", async ({ page, context }, info) => {
    await loginTo(page, OWNER);
    await expect(page.locator('[data-screen="HOME-01"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "HOME-01",
      state: "offline",
      texts: fromFrame("HOME-01", "offline", ["بلا اتصال", "يحتاج قرارك"]),
    });
    await expect(page.getByRole("link", { name: "راجع واعتمد" })).toBeVisible();
    await context.setOffline(false);
  });

  test("pending_sync: شريطٌ لا نافذة — عمليات لم تُرفع والأرقام تشملها موسومةً", async ({
    page,
  }, info) => {
    await page.goto("/dev/probe");
    await page.getByTestId("save-probe").click();
    await expect(page.getByTestId("stored")).toContainText("محفوظ");
    await loginTo(page, OWNER);
    await expectFrame(page, info, {
      screenId: "HOME-01",
      state: "pending_sync",
      texts: fromFrame("HOME-01", "pending_sync", [
        "عمليات لم تُرفع",
        "على هذا الجهاز",
        "عمليات معلّقة",
        "يشمل معلّقاً",
      ]),
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("HOME-02", () => {
  test("ready: مهام الموظف بلا تقارير ممنوعة", async ({ page }, info) => {
    await loginTo(page, EMPLOYEE);
    await expectFrame(page, info, {
      screenId: "HOME-02",
      state: "ready",
      texts: fromFrame("HOME-02", "ready", [
        "، سميرة",
        "كاشير · الفرع الرئيسي · الكاشير 1",
        "وردية مفتوحة منذ",
        "بيع جديد",
        "تسجيل سداد",
        "مرتجع",
        "مهامك اليوم",
        "فاتورة 1044 حُفظت ولم تُطبع",
        "إغلاق الوردية عند 21:00",
        "خارج صلاحيتك",
        "التقارير المالية وأرصدة كل العملاء والتكلفة والهامش لا تظهر لدور",
        "هذا ليس عطلاً — اطلب التوسيع من المالك إن احتجته.",
      ]),
      styles: [[".home-action--primary", "background-color", "brand.primary"]],
    });
    // لا بطاقة مالية للكاشير — المحجوب لا يُعرض
    await expect(page.locator(".home-kpi")).toHaveCount(0);
    await expect(page.locator('[data-screen="HOME-02"]')).toContainText("08:00");
  });

  test("empty: لا مهام اليوم — والمخرج الواحد بارز", async ({ page }, info) => {
    await loginTo(page, { ...EMPLOYEE, tasks: [] });
    await expectFrame(page, info, {
      screenId: "HOME-02",
      state: "empty",
      texts: fromFrame("HOME-02", "empty", [
        "لا مهام اليوم",
        "الوردية مفتوحة ولا شيء ينتظره.",
        "افتح نقطة البيع",
      ]),
    });
  });

  test("permission_denied: لا بطاقة رمادية — الأفعال المحجوبة لا تُعرض", async ({ page }, info) => {
    await loginTo(page, {
      ...EMPLOYEE,
      quick_actions: [],
      user: { ...EMPLOYEE.user, role_name: "أمين مخزن" },
    });
    await expectFrame(page, info, {
      screenId: "HOME-02",
      state: "permission_denied",
      texts: fromFrame("HOME-02", "permission_denied", [
        "خارج صلاحيتك",
        "اطلب التوسيع من المالك إن احتجته.",
      ]),
    });
    await expect(page.getByRole("link", { name: "بيع جديد" })).toHaveCount(0);
  });

  test("offline: يعمل بلا اتصال — شريط واحد لا شاشة حجب", async ({ page, context }, info) => {
    await loginTo(page, EMPLOYEE);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "HOME-02",
      state: "offline",
      texts: fromFrame("HOME-02", "offline", ["بلا اتصال", "بيع جديد"]),
    });
    await expect(page.getByRole("link", { name: "بيع جديد" })).toBeVisible();
    await context.setOffline(false);
  });

  test("stale: أرقام قديمة — الوقت مع الرقم", async ({ page }, info) => {
    await loginTo(page, EMPLOYEE);
    await expect(page.locator('[data-screen="HOME-02"][data-state="ready"]')).toBeVisible();
    await page.unroute("**/api/home**");
    await page.route("**/api/home**", (route) => route.abort("connectionfailed"));
    // عودة الشبكة تعيد الجلب — والمطابقة متعثّرة
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expectFrame(page, info, {
      screenId: "HOME-02",
      state: "stale",
      texts: fromFrame("HOME-02", "stale", ["أرقام قديمة", "الأرقام من آخر مطابقة"]),
    });
  });
});

const SEARCH = {
  query: "الواحة",
  groups: [
    {
      kind: "parties",
      label: "أطراف",
      results: [
        {
          id: "p1",
          title: "مطعم الواحة",
          meta: "زبون آجل · رصيد 1,240",
          tag: "مستحق بعد 4 أيام",
          tag_kind: "warn",
          href: "/parties/p1",
        },
        {
          id: "p2",
          title: "مطعم الواحه",
          meta: "زبون آجل · رصيد 0",
          tag: "تكرار محتمل",
          tag_kind: "info",
          href: "/parties/p2",
        },
        {
          id: "p3",
          title: "واحة التمور — مورد",
          meta: "مورد · آخر توريد 12 يوماً",
          tag: "نشط",
          tag_kind: "ok",
          href: "/parties/p3",
        },
      ],
    },
    {
      kind: "documents",
      label: "مستندات",
      results: [
        {
          id: "d1",
          title: "فاتورة 9912 — مطعم الواحة",
          meta: "1,240.00 · قبل 4 أيام",
          tag: "غير مسدّدة",
          tag_kind: "warn",
          href: "/documents/9912",
        },
        {
          id: "d2",
          title: "سند قبض 331 — مطعم الواحة",
          meta: "500.00 · قبل 9 أيام",
          tag: "مرحَّل",
          tag_kind: "ok",
          href: "/documents/331",
        },
        {
          id: "d3",
          title: "أمر تحويل 77 — من مخزن الواحة",
          meta: "18 صنفاً · أمس",
          tag: "قيد النقل",
          tag_kind: "info",
          href: "/documents/77",
        },
      ],
    },
    {
      kind: "items",
      label: "أصناف",
      results: [
        {
          id: "i1",
          title: "تمر واحة — علبة 500 جم",
          meta: "رصيد 42 علبة · 18.00",
          tag: "متوفر",
          tag_kind: "ok",
          href: "/catalog/i1",
        },
        {
          id: "i2",
          title: "عسل الواحة — 1 كجم",
          meta: "رصيد 0 · 95.00",
          tag: "نفد",
          tag_kind: "warn",
          href: "/catalog/i2",
        },
        {
          id: "i3",
          title: "عسل الواحة — 500 جم",
          meta: "رصيد 3 · 50.00",
          tag: "متوفر",
          tag_kind: "ok",
          href: "/catalog/i3",
        },
      ],
    },
  ],
  restricted: [],
  suggestions: { nearest: [], other_branches: true, create: true },
  total: 9,
  kinds_with_results: 3,
  elapsed_ms: 200,
};
const NOTICES = {
  needs_action: 2,
  items: [
    {
      id: "n1",
      title: "وردية سالم مفتوحة منذ 4 ساعات",
      detail: "تُقفل بشهادة عدّ حاضرة — لا نُقفلها تلقائياً",
      when: "",
      needs_action: true,
      href: "/shifts",
    },
    {
      id: "n2",
      title: "فاتورة 9912 تستحق بعد 4 أيام",
      detail: "مطعم الواحة · 1,240.00",
      when: "09:00",
      needs_action: true,
      href: "/documents/9912",
    },
    {
      id: "n3",
      title: "3 أصناف نفدت من مخزن الرئيسي",
      detail: "عسل الواحة وصنفان",
      when: "",
      needs_action: false,
      href: "/inventory",
    },
  ],
};

async function toSearch(page: Page, search: unknown, q = "الواحة") {
  await loginTo(page, EMPLOYEE);
  await page.unroute("**/api/notices");
  await page.route("**/api/notices", (route) => route.fulfill(json(200, NOTICES)));
  await page.route("**/api/search**", (route) => route.fulfill(json(200, search)));
  await navTo(page, "بحث");
  await page.getByLabel("بحث", { exact: true }).fill(q);
}

test.describe("HOME-03", () => {
  test("ready: الأنواع بعناوين وترتيب ثابت، والإشعارات بجانبها", async ({ page }, info) => {
    await toSearch(page, SEARCH);
    await expectFrame(page, info, {
      screenId: "HOME-03",
      state: "ready",
      texts: fromFrame("HOME-03", "ready", [
        "نتائج «الواحة»",
        "نتائج في",
        "أطراف",
        "مطعم الواحة",
        "زبون آجل · رصيد 1,240",
        "مستحق بعد 4 أيام",
        "تكرار محتمل",
        "واحة التمور — مورد",
        "مستندات",
        "فاتورة 9912 — مطعم الواحة",
        "غير مسدّدة",
        "أصناف",
        "عسل الواحة — 1 كجم",
        "نفد",
      ]),
    });
    const heads = await page.locator(".search-group__head span:first-child").allInnerTexts();
    expect(heads).toEqual(["أطراف", "مستندات", "أصناف"]);
    // في 390 الإشعارات تبويب ثانٍ لا عمود جانبي؛ في 834+ عمود بجانب النتائج
    if ((page.viewportSize()?.width ?? 0) < 834) {
      await page.getByRole("button", { name: "إشعارات سريعة" }).click();
    }
    for (const text of fromFrame("HOME-03", "ready", [
      "إشعارات سريعة",
      "تحتاج فعلاً",
      "وردية سالم مفتوحة منذ 4 ساعات",
      "تُقفل بشهادة عدّ حاضرة — لا نُقفلها تلقائياً",
    ])) {
      await expect(page.locator('[data-screen="HOME-03"]')).toContainText(text);
    }
  });

  test("loading: نبحث في 3 أنواع — بلا «0 نتيجة» أثناء البحث", async ({ page }, info) => {
    await loginTo(page, EMPLOYEE);
    await page.route("**/api/search**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill(json(200, SEARCH));
    });
    await navTo(page, "بحث");
    await page.getByLabel("بحث", { exact: true }).fill("الواحة");
    await expectFrame(page, info, {
      screenId: "HOME-03",
      state: "loading",
      texts: fromFrame("HOME-03", "loading", ["نبحث في", "أنواع"]),
    });
    await expect(page.locator('[data-screen="HOME-03"]')).not.toContainText("0 نتيجة");
  });

  test("empty: لا نتائج — سؤال لا خبر، ويبقى ما كُتب", async ({ page }, info) => {
    await toSearch(
      page,
      {
        ...SEARCH,
        query: "فاتورة 9923",
        groups: SEARCH.groups.map((g) => ({ ...g, results: [] })),
        total: 0,
        kinds_with_results: 0,
        suggestions: { nearest: ["9912", "9932"], other_branches: true, create: true },
      },
      "فاتورة 9923",
    );
    await expectFrame(page, info, {
      screenId: "HOME-03",
      state: "empty",
      texts: fromFrame("HOME-03", "empty", [
        "لا نتائج",
        "بلا تطابق",
        "البحث في الفروع الأخرى",
        "إنشاء مستند بهذا الرقم",
      ]),
    });
    await expect(page.getByLabel("بحث", { exact: true })).toHaveValue("فاتورة 9923");
    await expect(page.locator('[data-screen="HOME-03"]')).not.toContainText("تحقّق من الإملاء");
  });

  test("permission_denied: العدد ونوعه بلا محتوى — ومدخل الطلب", async ({ page }, info) => {
    await toSearch(page, { ...SEARCH, restricted: [{ kind_label: "التقارير", count: 2 }] });
    await expectFrame(page, info, {
      screenId: "HOME-03",
      state: "permission_denied",
      texts: fromFrame("HOME-03", "permission_denied", [
        "نتائج خارج صلاحيتك",
        "في التقارير خارج صلاحيتك",
        "اطلب الإذن من المالك",
      ]),
    });
  });

  test("offline: بحث محلي بشارة «محلي» والإشعارات متوقفة لا فارغة", async ({
    page,
    context,
  }, info) => {
    await toSearch(page, SEARCH);
    await expect(page.locator('[data-screen="HOME-03"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "HOME-03",
      state: "offline",
      texts: fromFrame("HOME-03", "offline", ["محلي", "آخر مزامنة", "لم يُزامَن من جهازك"]),
    });
    if ((page.viewportSize()?.width ?? 0) < 834) {
      await page.getByRole("button", { name: "إشعارات سريعة" }).click();
    }
    await expect(page.locator('[data-screen="HOME-03"]')).toContainText("متوقفة بلا اتصال");
    await context.setOffline(false);
  });
});
