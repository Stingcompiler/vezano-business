import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T2.4 — ORG-06 الاشتراك والباقات (4) + ORG-08 انتهاء الاشتراك (3). حدود صريحة بالأرقام؛ الميزة
 * غير المتاحة رمادية بسبب؛ المبالغ للمالك؛ الانتهاء لا يحجب الدفتر (G-08؛ ACC-80/81/82/104).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const FEATURES = [
  {
    code: "pos_core",
    label: "نقاط البيع والطباعة والجرد",
    note: "لا تتوقف في أي حال — حتى بعد انتهاء الاشتراك",
    status: "open",
  },
  {
    code: "multi_branch",
    label: "تعدّد الفروع",
    note: "فرعان في باقتك · الثالث يحتاج ترقية",
    status: "open",
  },
  {
    code: "market_private_prices",
    label: "قوائم أسعار خاصة في السوق",
    note: "فُعّلت لباقتك حديثاً",
    status: "open",
  },
  {
    code: "market_publish",
    label: "أدوات البائع ونشر العروض",
    note: "تحتاج تحقّق دور بائع منفصلاً — ليس قيد باقة بل قيد تحقّق (MP-08)",
    status: "conditional",
  },
  {
    code: "supplier_analytics",
    label: "تحليلات المورد المتقدّمة",
    note: "غير مشمولة في باقة الفرعين. نعرضها رمادية مع ما تفعله بالضبط، ولا نخفيها.",
    status: "locked",
  },
];
const CONTINUES = [
  "البيع كاملاً — نقدي وآجل ومختلط",
  "المرتجع ومعالجة فشل الحفظ",
  "الورديات والصندوق والإغلاق",
  "كشوف الحساب وتسجيل السداد",
  "تصدير نسخة محلية كاملة",
  "تصدير التقارير",
];
const STOPS = [
  "السوق — التصفح والنشر",
  "طلبات التوريد",
  "الحملات والإرسال",
  "التقارير التحليلية",
  "الاستيراد الجماعي",
];
const PLANS = [
  {
    code: "single",
    name: "فرع واحد",
    price_minor: "4500000",
    period: "month",
    trial_days: null,
    blurb: "3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
    current: false,
  },
  {
    code: "dual",
    name: "فرعان",
    price_minor: "8500000",
    period: "month",
    trial_days: null,
    blurb: "6 أجهزة · 5 مستخدمين · مقارنة الفروع · نشر في السوق واستقبال الطلبات",
    current: true,
  },
  {
    code: "trial",
    name: "تجريبية",
    price_minor: "0",
    period: "trial",
    trial_days: 30,
    blurb: "كل ميزات باقة الفرع الواحد. عند الانتهاء تبقى بياناتك وتتحوّل للقراءة والبيع النقدي.",
    current: false,
  },
];

const payload = (o: Record<string, unknown> = {}, owner = true) => ({
  plan: {
    code: "dual",
    name: "فرعان",
    trial: false,
    state: "active",
    expires_at: "2026-09-23T00:00:00Z",
    days_since_expiry: -4,
    price_minor: owner ? "8500000" : null,
    currency: "SDG",
  },
  limits: {
    branches: { used: 2, max: 2 },
    devices: { used: 4, max: 6 },
    users: { used: 7, max: null },
    campaign_quota: { used: 0, max: 1200 },
  },
  features: FEATURES,
  if_expired: { continues: CONTINUES, stops: STOPS },
  plans: PLANS,
  can_see_amounts: owner,
  can_renew: owner,
  ...o,
});

const expiry = (o: Record<string, unknown> = {}) => ({
  state: "expired",
  expired: true,
  expired_at: "2026-09-09T00:00:00Z",
  days_since_expiry: 10,
  continues: CONTINUES,
  stops: STOPS,
  can_renew: true,
  can_see_amounts: true,
  plan_name: "فرعان",
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

test.describe("ORG-06", () => {
  test("loading → ready: الاستحقاقات والحدود كأرقام والميزات بحالاتها والباقات", async ({
    page,
  }, info) => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/org/subscription", async (route) => {
      await gate;
      await route.fulfill(json(200, payload()));
    });
    await login(page, "/org/subscription");
    await expectFrame(page, info, {
      screenId: "ORG-06",
      state: "loading",
      texts: fromFrame("ORG-06", "loading", [
        "جلب الاشتراك",
        "حالة الاشتراك من الخادم دائماً. رقمٌ قديم هنا يعني قراراً مالياً على معلومة قديمة.",
        "لا كاش للاستحقاق",
        "تاريخ الاستحقاق والمبلغ يُقرآن حيّين. والشاشة تُفتح مرةً في الشهر — فثانيتان مقبولتان.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    release!();
    await expectFrame(page, info, {
      screenId: "ORG-06",
      state: "ready",
      texts: fromFrame("ORG-06", "ready", [
        "الاشتراك والباقات — ما تفتحه الباقة وما لا تفتحه، بلا إخفاء",
        "الميزة غير المتاحة تُعرض رمادية مع سبب، لا تُخفى فيظنّ التاجر أنها غير موجودة. وحدّ الأجهزة رقم صريح لا مفاجأة عند الجهاز السابع.",
        "استحقاقات",
        "باقتك الحالية — فرعان",
        "سارية",
        "حدود الباقة كأرقام",
        "عند بلوغ الحدّ لا نمنع البيع. نمنع إضافة جهاز جديد ونشرح البديل: ترقية الباقة أو سحب جهاز قديم.",
        "لو انتهى الاشتراك",
        "نقاط البيع والطباعة والجرد",
        "لا تتوقف في أي حال — حتى بعد انتهاء الاشتراك",
        "مفتوح",
        "تعدّد الفروع",
        "فرعان في باقتك · الثالث يحتاج ترقية",
        "قوائم أسعار خاصة في السوق",
        "فُعّلت لباقتك حديثاً",
        "أدوات البائع ونشر العروض",
        "تحتاج تحقّق دور بائع منفصلاً — ليس قيد باقة بل قيد تحقّق (MP-08)",
        "مشروط",
        "تحليلات المورد المتقدّمة",
        "غير مشمولة في باقة الفرعين. نعرضها رمادية مع ما تفعله بالضبط، ولا نخفيها.",
        "مغلق",
        "الفروع",
        "الأجهزة",
        "المستخدمون",
        "حصة رسائل الحملات",
        "الباقات",
        "حدود صريحة بالأرقام، لا «غير محدود» بنجمة",
        "فرع واحد",
        "3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
        "فرعان",
        "6 أجهزة · 5 مستخدمين · مقارنة الفروع · نشر في السوق واستقبال الطلبات",
        "تجريبية",
        "كل ميزات باقة الفرع الواحد. عند الانتهاء تبقى بياناتك وتتحوّل للقراءة والبيع النقدي.",
      ]),
    });
    const root = page.locator('[data-screen="ORG-06"]');
    await expect(root).toContainText("تُجدَّد في 23 سبتمبر · 85,000.00 SDG شهرياً");
    await expect(root).toContainText("7 / غير محدود");
    await expect(root).toContainText("4 / 6");
    await expect(root).toContainText("1,200 / شهر");
    await expect(root).toContainText("45,000 / شهر");
    await expect(root).toContainText("85,000 / شهر");
    await expect(root).toContainText("30 يوماً");
  });

  test("permission_denied: مدير فرع يرى الحدود والميزات دون المبالغ؛ expired: لو انتهى الاشتراك", async ({
    page,
  }, info) => {
    let mode: "manager" | "expired" = "manager";
    await page.route("**/api/org/subscription", (route) =>
      route.fulfill(
        json(
          200,
          mode === "manager"
            ? payload({}, false)
            : payload({ plan: { ...payload().plan, state: "grace", days_since_expiry: 3 } }),
        ),
      ),
    );
    await login(page, "/org/subscription");
    await expectFrame(page, info, {
      screenId: "ORG-06",
      state: "permission_denied",
      texts: fromFrame("ORG-06", "permission_denied", [
        "مدير فرع يفتح الاشتراك",
        "الاشتراك التزام مالي على المنشأة — يراه المالك ومن فوّضه صراحة. مدير الفرع يرى أثر الباقة على عمله (الحدود والميزات) دون المبالغ ولا وسيلة الدفع.",
        "حدود الباقة كأرقام",
        "تعدّد الفروع",
      ]),
    });
    const root = page.locator('[data-screen="ORG-06"]');
    await expect(root).not.toContainText("85,000");
    await expect(root).not.toContainText("SDG");
    await expect(page.getByRole("button", { name: "تجديد الاشتراك" })).toHaveCount(0);
    // منتهٍ (مهلة السماح): الشاشة تعرض القائمة بعد الانتهاء أيضاً
    mode = "expired";
    await page.route("**/api/org/users", (route) =>
      route.fulfill(
        json(200, {
          users: [],
          invitations: [],
          counts: { users: 0, open_invitations: 0 },
          invite_ttl_hours: 72,
          branches: [],
          roles: [],
          can_invite: true,
        }),
      ),
    );
    await navTo(page, "المستخدمون", { exact: true });
    await expect(page).toHaveURL(/\/org\/users$/);
    await navTo(page, "الاشتراك", { exact: true });
    await expect(page).toHaveURL(/\/org\/subscription$/);
    await expectFrame(page, info, {
      screenId: "ORG-06",
      state: "expired",
      texts: fromFrame("ORG-06", "expired", [
        "لو انتهى الاشتراك",
        "استحقاقات",
        "حدود الباقة كأرقام",
      ]),
    });
    await expect(root).toContainText("انتهى اشتراكك قبل 3 أيام");
  });
});

test.describe("ORG-08", () => {
  test("expired: القائمة الصريحة — يستمر بالكامل / محجوب حتى التجديد، والتصدير متاح دائماً", async ({
    page,
  }, info) => {
    await page.route("**/api/org/subscription/expiry", (route) =>
      route.fulfill(json(200, expiry())),
    );
    await login(page, "/org/subscription/expiry");
    await expectFrame(page, info, {
      screenId: "ORG-08",
      state: "expired",
      texts: fromFrame("ORG-08", "expired", [
        "انتهاء الاشتراك",
        "بياناتك كاملة ولم يُحجب منها شيء. البيع وإدارة الذمم والورديات تعمل كالمعتاد. ما توقّف هو السوق والحملات والتقارير التحليلية.",
        "يستمر بالكامل",
        "محجوب حتى التجديد",
        "تصدير نسخة محلية",
        "وتصدير التقارير",
        "يبقيان متاحين دائماً. لن نحتجز بياناتك مقابل التجديد، وتستطيع أخذها كاملة في أي وقت.",
        "تجديد الاشتراك",
        "تصدير نسخة كاملة",
        ...CONTINUES,
        ...STOPS,
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator('[data-screen="ORG-08"]')).toContainText(
      "انتهى اشتراكك في 09 سبتمبر",
    );
    await expect(page.getByRole("button", { name: "تصدير نسخة كاملة" })).toBeEnabled();
  });

  test("ready: ما يستمر وما يتوقف قبل الانتهاء؛ permission_denied: التجديد للمالك", async ({
    page,
  }, info) => {
    let who: "owner" | "employee" = "owner";
    await page.route("**/api/org/subscription/expiry", (route) =>
      route.fulfill(
        json(
          200,
          who === "owner"
            ? expiry({ state: "active", expired: false, days_since_expiry: -20 })
            : expiry({ can_renew: false, can_see_amounts: false }),
        ),
      ),
    );
    await login(page, "/org/subscription/expiry");
    await expectFrame(page, info, {
      screenId: "ORG-08",
      state: "ready",
      texts: fromFrame("ORG-08", "ready", [
        "انتهاء الاشتراك",
        "حالتان ناقصتان، وتحكمهما قائمة",
        "ما يستمر وما يتوقف",
        "قائمتان صريحتان لا عبارة عامة: البيع والذمم والورديات والتصدير تستمر؛ السوق والتقارير الخادمية والحملات تتوقف.",
        "لماذا صريحتان",
        "«الأعمال الأساسية مستمرة» جملةٌ يفسّرها كلٌّ بهواه. القائمة تُنهي الجدل قبل وقوعه",
        "لا حجب للبيانات",
        "انتهاء الاشتراك لا يحجب دفترك عنك. التصدير يبقى عاملاً — بياناتك بياناتك.",
      ]),
    });
    who = "employee";
    await page.getByRole("button", { name: "الاشتراك والباقات" }).click();
    await page.route("**/api/org/subscription", (route) =>
      route.fulfill(json(200, payload({}, false))),
    );
    await expect(page).toHaveURL(/\/org\/subscription$/);
    await page.getByRole("button", { name: "ما يحدث عند الانتهاء" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-08",
      state: "permission_denied",
      texts: fromFrame("ORG-08", "permission_denied", [
        "التجديد للمالك",
        "الموظف يرى أن الاشتراك انتهى وأثر ذلك على عمله، ولا يرى الفواتير ولا يجدّد.",
        "ما يراه",
        "ما توقّف من وظائفه هو، لا حالة الحساب المالية. «تقرير المبيعات موقوف — الاشتراك منتهٍ» يكفيه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تجديد الاشتراك" })).toHaveCount(0);
  });
});

/** 0005 §١١٢ — ترقية/تخفيض من المستأجر: عرض قبل التنفيذ، الترقية تقود إلى ORG-07 بوضع الفرق، التخفيض يُجدول ويُلغى. */
test.describe("ORG-06 · تغيير الباقة", () => {
  test("تخفيض ممنوع بالحدود → مسموح ويُجدول → يُلغى؛ ترقية تعرض الفرق وتقود إلى إثبات الفرق", async ({
    page,
  }) => {
    // الحالية «فرع واحد»؛ الأخرى «فرعان» (ترقية) و«تجريبية»
    const plans = PLANS.map((p) => ({ ...p, current: p.code === "single" }));
    let body: Record<string, unknown> = payload({
      plan: { ...payload().plan, code: "single", name: "فرع واحد", price_minor: "4500000" },
      plans,
      next_plan_code: "",
      next_plan_name: "",
    });
    let blocked = true;
    await page.route("**/api/org/subscription", (route) => route.fulfill(json(200, body)));
    await page.route(/\/api\/org\/subscription\/change(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET") {
        const code = url.searchParams.get("plan_code");
        const upgrade = code === "dual";
        return route.fulfill(
          json(200, {
            quote: {
              from: { code: "single", name: "فرع واحد", price_minor: "4500000" },
              to: upgrade
                ? { code: "dual", name: "فرعان", price_minor: "8500000" }
                : { code: "single", name: "فرع واحد", price_minor: "4500000" },
              kind: upgrade ? "upgrade" : "downgrade",
              remaining_days: 15,
              expires_at: "2026-10-07T00:00:00Z",
              amount_minor: upgrade ? "2000000" : "0",
              currency: "SDG",
              effective: upgrade ? "immediately_after_approval" : "at_renewal",
              blocked_reasons: !upgrade && blocked ? ["الفروع النشطة 2 تتجاوز حدّ الباقة 1"] : [],
              pending_downgrade: "",
              note: upgrade
                ? "الترقية تسري فور اعتماد إثبات فرق السعر على الأيام المتبقية — تاريخ الانتهاء لا يتغيّر."
                : "التخفيض يسري عند التجديد القادم؛ لا يُردّ مال عن المدة المدفوعة.",
            },
          }),
        );
      }
      const b = route.request().postDataJSON() as { plan_code?: string; cancel?: boolean };
      if (b.cancel) {
        body = { ...body, next_plan_code: "", next_plan_name: "" };
        return route.fulfill(json(200, { quote: null, ...body }));
      }
      if (blocked) return route.fulfill(json(409, { detail: "limits_exceeded" }));
      body = { ...body, next_plan_code: "single", next_plan_name: "فرع واحد" };
      return route.fulfill(json(200, { quote: {}, ...body }));
    });
    // نحتاج باقة أصغر للتخفيض: نجعل الحالية «فرعان» في هذا السيناريو الفرعي
    body = payload({ next_plan_code: "", next_plan_name: "" });
    await login(page, "/org/subscription");
    const root = page.locator('[data-screen="ORG-06"]');
    const singleRow = root.locator("li.org-effects__row", { hasText: "فرع واحد" }).first();
    await singleRow.getByRole("button", { name: "تخفيض" }).click();
    await expect(root).toContainText("الفروع النشطة 2 تتجاوز حدّ الباقة 1");
    await expect(root.getByRole("button", { name: "جدوِل التخفيض" })).toHaveCount(0);
    await page.getByRole("button", { name: "إلغاء" }).click();
    blocked = false;
    await singleRow.getByRole("button", { name: "تخفيض" }).click();
    await page.getByRole("button", { name: "جدوِل التخفيض" }).click();
    await expect(root).toContainText("تخفيض مجدول إلى «فرع واحد» عند التجديد");
    await page.getByRole("button", { name: "ألغِ التخفيض" }).click();
    await expect(root).not.toContainText("تخفيض مجدول");
    // ترقية: الحالية «فرع واحد» → «فرعان» بفرق
    body = payload({
      plan: { ...payload().plan, code: "single", name: "فرع واحد", price_minor: "4500000" },
      plans,
      next_plan_code: "",
      next_plan_name: "",
    });
    await page.goto("/login?next=%2Forg%2Fsubscription");
    await login(page, "/org/subscription");
    await root.getByRole("button", { name: "ترقية", exact: true }).click();
    await expect(root).toContainText("ترقية إلى «فرعان»");
    await expect(root).toContainText("الفرق على 15 يوماً متبقية: 20,000 SDG");
    await page.route("**/api/org/subscription/proofs", (route) =>
      route.fulfill(
        json(200, {
          due: {
            plan_code: "single",
            plan_name: "فرع واحد",
            amount_minor: "4500000",
            currency: "SDG",
            period_label: "أكتوبر",
            review_sla: "يوم عمل واحد",
            cycles: [],
          },
          proofs: [],
          can_submit: true,
          review_sla: "يوم عمل واحد",
        }),
      ),
    );
    await page.getByRole("button", { name: "ادفع الفرق وارفع الإثبات" }).click();
    await expect(page).toHaveURL(/\/org\/subscription\/renew\?upgrade=dual$/);
    const renew = page.locator('[data-screen="ORG-07"]');
    await expect(renew).toContainText("ترقية إلى «فرعان» — فرق السعر");
    await expect(renew).toContainText("20,000.00 SDG");
    await expect(renew).toContainText("الفترة: فرق ترقية");
  });

  test("الإضافات (0005 §١١٦): جهاز إضافي بعرض مقسَّط → إثبات «إضافة»، وإزالة ممنوعة بالاستعمال", async ({
    page,
  }) => {
    const addons = (qty: number) => [
      {
        kind: "devices",
        label: "جهاز",
        unit_monthly_minor: "1000000",
        offered: true,
        qty,
        monthly_minor: String(1000000 * qty),
      },
      {
        kind: "users",
        label: "مستخدم",
        unit_monthly_minor: "500000",
        offered: true,
        qty: 0,
        monthly_minor: "0",
      },
      {
        kind: "branches",
        label: "فرع",
        unit_monthly_minor: "0",
        offered: false,
        qty: 0,
        monthly_minor: "0",
      },
    ];
    const base = payload();
    const body: Record<string, unknown> = {
      ...base,
      limits: { ...base.limits, devices: { used: 6, max: 7, extra: 0, addon: 1 } },
      addons: addons(1),
      can_buy_addons: true,
    };
    let quoted = "";
    await page.route("**/api/org/subscription", (route) => route.fulfill(json(200, body)));
    await page.route(/\/api\/org\/subscription\/addon(\?.*)?$/, (route) => {
      if (route.request().method() === "GET") {
        const url = new URL(route.request().url());
        quoted = `${url.searchParams.get("kind")}:${url.searchParams.get("qty")}`;
        return route.fulfill(
          json(200, {
            quote: {
              kind: "devices",
              label: "جهاز",
              qty: Number(url.searchParams.get("qty")),
              plan_code: "dual",
              plan_name: "فرعان",
              unit_monthly_minor: "1000000",
              remaining_days: 15,
              expires_at: "2026-10-07T00:00:00Z",
              amount_minor: String(500000 * Number(url.searchParams.get("qty"))),
              renewal_monthly_minor: String(1000000 * Number(url.searchParams.get("qty"))),
              currency: "SDG",
              note: "تسري الإضافة فور اعتماد الإثبات حتى نهاية الفترة الحالية، ثم تُجدَّد مع الباقة بسعرها الشهري ما لم تُخفَّض.",
            },
          }),
        );
      }
      return route.fulfill(json(409, { detail: "limits_exceeded" }));
    });
    await login(page, "/org/subscription");
    const root = page.locator('[data-screen="ORG-06"]');
    await expect(root).toContainText("(منها 1 مدفوعة)");
    const box = root.getByTestId("org-addons");
    await expect(box.locator('[data-addon="branches"]')).toHaveCount(0);
    const dev = box.locator('[data-addon="devices"]');
    await expect(dev).toContainText("10,000 / شهر للوحدة · لديك 1");
    // الإزالة ممنوعة: 6 أجهزة نشطة على حدّ 7 → 6 لا يزال يسع؟ الخادم يقرّر — هنا يرفض
    await dev.getByRole("button", { name: "أزل واحدة" }).click();
    await expect(root).toContainText("الاستعمال الحالي يحتاج هذه الإضافة");
    await dev.getByRole("button", { name: "زد كمية جهاز" }).click();
    await dev.getByRole("button", { name: "أضف" }).click();
    expect(quoted).toBe("devices:2");
    await expect(root).toContainText("إضافة 2 جهاز");
    await expect(root).toContainText(
      "الآن عن 15 يوماً متبقية: 10,000 SDG · ثم 20,000 / شهر مع التجديد",
    );
    let posted: Record<string, unknown> = {};
    await page.route("**/api/org/subscription/proofs", (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill(json(400, { detail: "x" }));
      }
      return route.fulfill(
        json(200, {
          due: {
            plan_code: "dual",
            plan_name: "فرعان",
            amount_minor: "9500000",
            currency: "SDG",
            period_label: "أكتوبر",
            review_sla: "يوم عمل واحد",
            addons_amount_minor: "1000000",
            addons: addons(1),
            cycles: [],
          },
          proofs: [],
          can_submit: true,
          review_sla: "يوم عمل واحد",
        }),
      );
    });
    await page.getByRole("button", { name: "ادفع وارفع الإثبات" }).click();
    await expect(page).toHaveURL(/\/org\/subscription\/renew\?addon=devices&qty=2$/);
    const renew = page.locator('[data-screen="ORG-07"]');
    await expect(renew).toContainText("إضافة 2 جهاز");
    await expect(renew).toContainText("10,000.00 SDG");
    await expect(renew).toContainText("الفترة: إضافة");
    await expect(renew.getByTestId("renew-addons")).toHaveCount(0);
    await renew.getByLabel("رقم العملية").fill("TRX-AD9");
    await page.getByRole("button", { name: "إرسال الإثبات" }).click();
    await expect.poll(() => posted.kind).toBe("addon");
    expect(posted.addon_kind).toBe("devices");
    expect(posted.addon_qty).toBe(2);
    // التجديد العادي يعرض الإضافات المشمولة
    await login(page, "/org/subscription/renew");
    await expect(page.getByTestId("renew-addons")).toContainText("يشمل الإضافات: 1 جهاز");
  });
});
