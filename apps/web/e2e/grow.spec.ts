import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.27 — GROW-01 اقتراح إعادة التوريد (4) + GROW-02 تحليلات المورد (5) + GROW-03 طلب عرض ممول
 * ومعاينته (4): رأيٌ يُعرَض بسببه ولا شيء يُطلب حتى تختار، ثلاثة أرقام بلا درجة ولا حكم من
 * مستندين، والإعلان يُوسم إعلاناً والطلب للمالك والتسعير قرار مفتوح (G-04). M4 خلف علم `market_m4`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function login(page: Page, next: string, urlRe: RegExp) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(urlRe);
}

const ROW = (o: Record<string, unknown>) => ({
  item_id: "i",
  item_name: "صنف",
  base_unit_name: "عبوة",
  stock_milli: "3000",
  stock_label: "3 عبوات",
  days_left: 2,
  days_left_label: "يومان",
  supplier_id: "s1",
  supplier_name: "مؤسسة الرياض",
  lead_days: 3,
  supplier_line: "مؤسسة الرياض · مهلة 3 أيام",
  unit_code: "carton",
  unit_name: "كرتونة",
  factor_milli: "12000",
  suggested: 8,
  suggested_label: "8 كراتين",
  need: true,
  basis: "بيع 6 عبوات يومياً في آخر 30 يوماً · مهلة 3 أيام · أمان 5 أيام. المقترح يغطي 13 يوماً.",
  ...o,
});
const ROWS = [
  ROW({ item_id: "oil", item_name: "زيت دوّار الشمس 1.5 ل" }),
  ROW({
    item_id: "rice",
    item_name: "أرز بسمتي 5 كجم",
    stock_label: "14 كيساً",
    days_left_label: "9 أيام",
    suggested: 0,
    suggested_label: "",
    need: false,
    unit_name: "كيس",
    basis: "لا حاجة الآن. يظهر في القائمة لأنه يشارك المورد نفسه — ضمّه يوفّر شحنة مستقلة لاحقاً.",
  }),
  ROW({
    item_id: "honey",
    item_name: "عسل الواحة 1 كجم",
    supplier_id: "",
    supplier_name: "",
    supplier_line: "مورد غير محدَّد",
    stock_milli: "0",
    stock_label: "نفد",
    days_left: 0,
    days_left_label: "نفد",
    suggested: 0,
    suggested_label: "",
    need: false,
    basis: "نفد منذ 6 أيام ولا مورد مرتبط به. لا نقترح كمية لصنف لا نعرف من يورّده ولا مهلته.",
  }),
];
const REPLENISH = (o: Record<string, unknown> = {}) => ({
  state: "ready",
  computed_at: hoursAgo(3),
  can_convert: true,
  value_hidden: false,
  ask_name: "",
  role_name: "مالك",
  branch_name: "الفرع الرئيسي",
  checked_count: 214,
  rows: ROWS,
  need_count: 1,
  next_check: "غداً 6 ص",
  safety_days: 5,
  ...o,
});

test.describe("GROW-01 اقتراح إعادة التوريد", () => {
  test("ready: رأيٌ يُعرَض بسببه — لا صندوق محدَّد سلفاً؛ التحويل باختيار صريح إلى PUR-02", async ({
    page,
  }, info) => {
    const posts: unknown[] = [];
    await page.route("**/api/grow/replenish**", (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        return route.fulfill(json(201, { order: { id: "po9", number: "9", status: "open" } }));
      }
      return route.fulfill(json(200, REPLENISH()));
    });
    await login(page, "/grow/replenish", /\/grow\/replenish$/);
    await expectFrame(page, info, {
      screenId: "GROW-01",
      state: "ready",
      texts: fromFrame("GROW-01", "ready", [
        "اقتراح إعادة التوريد — رأيٌ يُعرَض بسببه",
        "النظام لا يشتري نيابةً عنك. يقترح كمية ويقول من أين جاءت: متوسط بيع، ومهلة توريد، ورصيد أمان. كل رقم في الاقتراح قابل للفتح على حسابه.",
        "لا شيء يُطلب حتى تختار",
        "الصنف",
        "الرصيد",
        "يكفي",
        "المقترح",
        "على أيّ أساس",
        "لا صندوق اختيار محدَّداً سلفاً ولا «اختر الكل» بارزاً. الاقتراح يصير أمر شراء",
        "باختيار صريح، والكميات تبقى قابلة للتعديل قبل ذلك وبعده.",
        "زيت دوّار الشمس 1.5 ل",
        "مؤسسة الرياض · مهلة 3 أيام",
        "8 كراتين",
        "بيع 6 عبوات يومياً في آخر 30 يوماً · مهلة 3 أيام · أمان 5 أيام. المقترح يغطي 13 يوماً.",
        "أرز بسمتي 5 كجم",
        "لا حاجة الآن. يظهر في القائمة لأنه يشارك المورد نفسه — ضمّه يوفّر شحنة مستقلة لاحقاً.",
        "مورد غير محدَّد",
        "نفد",
        "نفد منذ 6 أيام ولا مورد مرتبط به. لا نقترح كمية لصنف لا نعرف من يورّده ولا مهلته.",
      ]),
    });
    // لا شيء مختار سلفاً → الزر معطَّل بسببه
    const convert = page.getByRole("button", { name: "حوّل المختار إلى أمر شراء" });
    await expect(convert).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("input[type=checkbox]:checked")).toHaveCount(0);
    await page.getByLabel("الكمية بـكرتونة").fill("8");
    await expect(convert).not.toHaveAttribute("aria-disabled", "true");
    await convert.click();
    await expect(page.getByText("أُنشئ أمر الشراء 9")).toBeVisible();
    expect(posts[0]).toMatchObject({
      supplier_id: "s1",
      lines: [{ item_id: "oil", unit_code: "carton", qty_milli: "8000" }],
    });
    await expect(page.getByRole("button", { name: "افتح أمر الشراء" })).toBeVisible();
  });

  test("empty: الفراغ نتيجة حسابٍ تمّ — «فُحص 214 صنفاً · الفحص التالي غداً 6 ص»", async ({
    page,
  }, info) => {
    await page.route("**/api/grow/replenish**", (route) =>
      route.fulfill(
        json(
          200,
          REPLENISH({ state: "empty", rows: [ROWS[1]], need_count: 0, checked_count: 214 }),
        ),
      ),
    );
    await login(page, "/grow/replenish", /\/grow\/replenish$/);
    await expectFrame(page, info, {
      screenId: "GROW-01",
      state: "empty",
      texts: fromFrame("GROW-01", "empty", [
        "لا اقتراحات",
        "كل الأصناف فوق حدّ الأمان. الفراغ هنا نتيجة حسابٍ تمّ، لا غياب بيانات — والفرق يُقال.",
        "نقول",
        "«فُحص 214 صنفاً · لا شيء يحتاج توريداً اليوم · الفحص التالي غداً 6 ص».",
      ]),
    });
    await expect(page.getByRole("button", { name: "حوّل المختار إلى أمر شراء" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("permission_denied: أمين المخزن يرى ولا يحوّل — يرسل الاقتراح إلى ندى بملاحظاته", async ({
    page,
  }, info) => {
    const posts: unknown[] = [];
    await page.route("**/api/grow/replenish**", (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        return route.fulfill(
          json(200, { forwarded: { by_name: "أمين", to_name: "ندى", note: "x", lines: [] } }),
        );
      }
      return route.fulfill(
        json(
          200,
          REPLENISH({
            state: "permission_denied",
            can_convert: false,
            value_hidden: true,
            ask_name: "ندى",
            role_name: "أمين مخزن",
          }),
        ),
      );
    });
    await login(page, "/grow/replenish", /\/grow\/replenish$/);
    await expectFrame(page, info, {
      screenId: "GROW-01",
      state: "permission_denied",
      texts: fromFrame("GROW-01", "permission_denied", [
        "يُرى ولا يُحوَّل",
        "أمين المخزن يرى الاقتراح — هو أدرى بما على الرفّ — ولا يحوّله إلى أمر شراء.",
        "«أرسل الاقتراح إلى ندى» بملاحظاته على الكميات. معرفته بالرفّ أدقّ من الحساب، فلا تُهدَر.",
        "العمود المحجوب",
        "القيمة التقديرية محجوبة كما في",
        "— وللسبب نفسه.",
        "تعديلاته على الكميات تُرسل مع الاقتراح موسومةً باسمه.",
        "زيت دوّار الشمس 1.5 ل",
      ]),
    });
    await expect(page.locator('[data-screen="GROW-01"]')).toContainText(
      "القيمة التقديرية محجوبة كما في «أوامر الشراء»",
    );
    await expect(page.getByRole("button", { name: "حوّل المختار إلى أمر شراء" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.locator("body")).not.toContainText("قيمة تقديرية");
    await page.getByLabel("الكمية بـكرتونة").fill("6");
    await page.getByLabel("ملاحظاتك على الكميات").fill("الرفّ يكفي أسبوعاً");
    await page.getByRole("button", { name: "أرسل الاقتراح إلى ندى" }).click();
    await expect(page.getByText("أُرسل الاقتراح إلى ندى")).toBeVisible();
    expect(posts[0]).toMatchObject({
      action: "forward",
      note: "الرفّ يكفي أسبوعاً",
      lines: [{ item_id: "oil", qty_milli: "6000" }],
    });
  });

  test("الكاشير: لا يرى الاقتراح أصلاً (403 بلا صفوف)", async ({ page }) => {
    await page.route("**/api/grow/replenish**", (route) =>
      route.fulfill(
        json(403, { detail: "permission_denied", state: "permission_denied", role_name: "كاشير" }),
      ),
    );
    await login(page, "/grow/replenish", /\/grow\/replenish$/);
    await expect(
      page.locator('[data-screen="GROW-01"][data-state="permission_denied"]'),
    ).toBeVisible();
    await expect(page.getByText("دورك «كاشير» لا يرى المخزون ولا الاقتراح.")).toBeVisible();
    await expect(page.getByRole("button", { name: "حوّل المختار إلى أمر شراء" })).toHaveCount(0);
  });
});

const DOC = (n: string, summary: string, label: string, h: number) => ({
  document_id: n,
  number: n,
  approved_at: hoursAgo(h),
  summary,
  label,
});
const SUPPLIER = (o: Record<string, unknown> = {}) => ({
  supplier_id: "s1",
  supplier_name: "مؤسسة الرياض",
  documents: 14,
  months: 6,
  enough: true,
  on_time: 10,
  with_order: 14,
  on_time_line: "10 من 14 في موعدها · متوسط التأخير يومان",
  returns: 3,
  returns_line: "3 مرتجعات · أغلبها «تالف»",
  price_moves: 2,
  price_line: "الزيت تحرّك مرتين · البقية ثابتة",
  recent: [
    DOC("PD-441", "استُلم بعد 5 أيام · نقص كرتونين · سعر الزيت +8%", "متأخر", 30),
    DOC("PD-437", "استُلم في موعده · مطابق للأمر", "مطابق", 200),
    DOC("PD-430", "استُلم في موعده · مرتجع كرتون تالف", "مرتجع", 400),
    DOC("PD-422", "استُلم بعد يومين · مطابق", "مطابق", 600),
    DOC("PD-418", "استُلم في موعده · مطابق", "مطابق", 800),
  ],
  min_docs: 5,
  ...o,
});
const SUPPLIERS = (o: Record<string, unknown> = {}) => ({
  state: "ready",
  computed_at: hoursAgo(6),
  newer_documents: [],
  suppliers: [SUPPLIER()],
  ...o,
});

test.describe("GROW-02 تحليلات المورد", () => {
  test("ready: ثلاثة أرقام لا أكثر — لا درجة إجمالية ولا نجوم؛ آخر خمسة مستندات بوسمها", async ({
    page,
  }, info) => {
    await page.route("**/api/grow/suppliers**", (route) => route.fulfill(json(200, SUPPLIERS())));
    await login(page, "/grow/suppliers", /\/grow\/suppliers$/);
    await expectFrame(page, info, {
      screenId: "GROW-02",
      state: "ready",
      texts: fromFrame("GROW-02", "ready", [
        "تحليلات المورد — يُحاسَب على ما وعد به لا على ما نتمنّاه",
        "ثلاثة أرقام لا أكثر: التزامه بالمواعيد، ونسبة ما رُدَّ إليه، وثبات أسعاره. كلها محسوبة من مستندات حقيقية في نطاقك، وكلها تُفتح على المستندات التي بنَتها.",
        "مؤسسة الرياض — 14 مستنداً · 6 أشهر",
        "التزام بالمواعيد",
        "10 من 14 في موعدها · متوسط التأخير يومان",
        "نسبة المرتجع",
        "3 مرتجعات · أغلبها «تالف»",
        "ثبات السعر",
        "الزيت تحرّك مرتين · البقية ثابتة",
        "آخر خمسة مستندات",
        "استُلم بعد 5 أيام · نقص كرتونين · سعر الزيت +8%",
        "متأخر",
        "استُلم في موعده · مطابق للأمر",
        "مطابق",
        "استُلم في موعده · مرتجع كرتون تالف",
        "مرتجع",
        "حساب من 14 مستنداً",
        "لا درجة إجمالية ولا نجوم. الرقم الواحد الذي يلخّص مورداً يُخفي أيَّ الثلاثة ساء — والقرار يختلف: من يتأخر يُطلب منه مبكراً، ومن يُرَدّ إليه كثيراً يُراجَع صنفه، ومن يتذبذب سعره يُثبَّت بعقد.",
      ]),
    });
    await expect(page.locator("body")).not.toContainText("★");
    await expect(page.locator("body")).not.toContainText("درجة المورد");
    await expect(page.locator(".sting-mono", { hasText: "71%" })).toBeVisible();
    await expect(page.locator(".sting-mono", { hasText: "21%" })).toBeVisible();
  });

  test("loading: ثلاثة هياكل — لا قيماً وسيطة ولا صفراً مؤقتاً", async ({ page }, info) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/grow/suppliers**", async (route) => {
      await gate;
      await route.fulfill(json(200, SUPPLIERS()));
    });
    await login(page, "/grow/suppliers", /\/grow\/suppliers$/);
    await expectFrame(page, info, {
      screenId: "GROW-02",
      state: "loading",
      texts: fromFrame("GROW-02", "loading", [
        "تحليلات المورد — يُحاسَب على ما وعد به لا على ما نتمنّاه",
        "ثلاثة هياكل بمواضع الأرقام الثلاثة. لا نُظهر رقماً جزئياً يتغيّر أمام العين — القارئ يتذكّر أول رقم رآه.",
        "لا نُظهر",
        "قيماً وسيطة ولا صفراً مؤقتاً. «71%» بعد ثانيتين خيرٌ من «0%» ثم «71%».",
      ]),
    });
    await expect(page.locator(".sting-mono", { hasText: "%" })).toHaveCount(0);
    release();
    await expect(page.locator('[data-screen="GROW-02"][data-state="ready"]')).toBeVisible();
    await expect(page.locator(".sting-mono", { hasText: "71%" })).toBeVisible();
  });

  test("empty: مستندان لا يكفيان — نعرضهما كما هما وسطر «تُحسب المؤشرات بعد 5 مستندات»", async ({
    page,
  }, info) => {
    await page.route("**/api/grow/suppliers**", (route) =>
      route.fulfill(
        json(
          200,
          SUPPLIERS({
            state: "empty",
            suppliers: [
              SUPPLIER({
                supplier_name: "مورد الوادي",
                documents: 2,
                months: 1,
                enough: false,
                recent: [
                  DOC("PD-3", "استُلم في موعده · مطابق", "مطابق", 30),
                  DOC("PD-2", "استُلم بعد يومين · مطابق", "مطابق", 200),
                ],
              }),
            ],
          }),
        ),
      ),
    );
    await login(page, "/grow/suppliers", /\/grow\/suppliers$/);
    await expectFrame(page, info, {
      screenId: "GROW-02",
      state: "empty",
      texts: fromFrame("GROW-02", "empty", [
        "مستندان لا يكفيان",
        "مورد جديد بمستندين. لا نحسب نسبة التزام من مستندين ونعرضها كأنها حكم — «50%» من اثنين ليست معلومة.",
        "نعرض",
        "المستندين كما هما بتواريخهما، وسطر: «تُحسب المؤشرات بعد 5 مستندات».",
        "استُلم بعد يومين · مطابق",
      ]),
    });
    await expect(page.locator(".sting-mono", { hasText: "%" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText(
      "تُحسب المؤشرات بعد 5 مستندات — الآن مستندان.",
    );
  });

  test("stale: محسوبة قبل 6 ساعات — مستند 441 اعتُمد بعدها ولم يدخل، مع «أعِد الحساب الآن»", async ({
    page,
  }, info) => {
    let computes = 0;
    await page.route("**/api/grow/suppliers**", (route) => {
      const compute = route.request().url().includes("compute=1");
      if (compute) computes += 1;
      return route.fulfill(
        json(
          200,
          compute
            ? SUPPLIERS({ computed_at: hoursAgo(0) })
            : SUPPLIERS({ state: "stale", newer_documents: ["PD-441"] }),
        ),
      );
    });
    await login(page, "/grow/suppliers", /\/grow\/suppliers$/);
    await expectFrame(page, info, {
      screenId: "GROW-02",
      state: "stale",
      texts: fromFrame("GROW-02", "stale", [
        "محسوبة قبل 6 ساعات",
        "المؤشرات تُحسب ليلاً لا لحظياً. نُظهر وقت الحساب لأن مستند",
        "اعتُمد بعده ولم يدخل",
        "مؤسسة الرياض — 14 مستنداً · 6 أشهر",
      ]),
    });
    await page.getByRole("button", { name: "أعِد الحساب الآن" }).click();
    await expect(page.locator('[data-screen="GROW-02"][data-state="ready"]')).toBeVisible();
    expect(computes).toBe(1);
  });

  test("permission_denied: الكاشير لا يرى مستندات الشراء ولا تحليلها", async ({ page }) => {
    await page.route("**/api/grow/suppliers**", (route) =>
      route.fulfill(
        json(403, { detail: "permission_denied", state: "permission_denied", role_name: "كاشير" }),
      ),
    );
    await login(page, "/grow/suppliers", /\/grow\/suppliers$/);
    await expect(
      page.locator('[data-screen="GROW-02"][data-state="permission_denied"]'),
    ).toBeVisible();
    await expect(page.getByText("تحليلات المورد للمالك ومدير الفرع وأمين المخزن")).toBeVisible();
  });
});

const PROMOTE = (o: Record<string, unknown> = {}) => ({
  state: "ready",
  pricing_locked: true,
  pricing_lock_label: "التسعير غير معتمد — يتواصل الفريق",
  can_request: true,
  can_prepare: true,
  offers: [
    { offer_id: "a", public_name: "سكر أبيض معبّأ", pack_label: "كرتونة 12×1كغ" },
    { offer_id: "b", public_name: "شاي سيلاني", pack_label: "كرتونة 24 علبة" },
  ],
  audiences: [
    { code: "followers", label: "متابعو منشأتي" },
    { code: "area", label: "منطقة خدمة" },
    { code: "all", label: "كل المشترين" },
  ],
  requests: [],
  ...o,
});
const PREVIEW = {
  promoted: {
    public_name: "سكر أبيض معبّأ",
    pack_label: "كرتونة 12×1كغ",
    price_minor: "118000",
    tag: "عرض ممول",
  },
  neighbors: [
    { public_name: "سكر — مخزن البركة", pack_label: "كرتونة 12×1كغ", price_minor: "116000" },
    { public_name: "سكر — الوادي", pack_label: "كرتونة 12×1كغ", price_minor: "120000" },
  ],
};

test.describe("GROW-03 طلب عرض ممول ومعاينته", () => {
  test("ready: الإعلان يُوسم إعلاناً — المعاينة بجوار الأرخص لا مكانه؛ قفلا التسعير معلَنان", async ({
    page,
  }, info) => {
    const posts: unknown[] = [];
    await page.route("**/api/grow/promote**", (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        return route.fulfill(
          json(200, {
            request: {
              id: "q1",
              offer_id: "a",
              offer_name: "سكر أبيض معبّأ",
              audience: "followers",
              audience_label: "متابعو منشأتي",
              area: "",
              duration_days: 7,
              status: "pricing_pending",
              status_label: "التسعير غير معتمد — يتواصل الفريق",
              prepared_by_name: "سالم",
              requested_by_name: "سالم",
            },
          }),
        );
      }
      if (route.request().url().includes("preview=")) return route.fulfill(json(200, PREVIEW));
      return route.fulfill(json(200, PROMOTE()));
    });
    await login(page, "/grow/promote", /\/grow\/promote$/);
    await expectFrame(page, info, {
      screenId: "GROW-03",
      state: "ready",
      texts: fromFrame("GROW-03", "ready", [
        "عرض ممول",
        "الإعلان يُوسم إعلاناً",
        "وسم «عرض ممول» ظاهر في نتيجة البحث بحجم نص العنوان لا بخط صغير.",
        "الترتيب الممول لا يُخفي نتيجة أقرب أو أرخص — يظهر بجوارها لا مكانها.",
        "المعاينة تُري التاجر شكل إعلانه كما يراه المشتري قبل الدفع.",
        "تفاصيل التسعير قرار مفتوح خارج التصميم؛ الشاشة تعرض الهيكل وتترك الرقم لقرار تجاري.",
      ]),
    });
    await expect(page.locator("body")).toContainText("التسعير غير معتمد — يتواصل الفريق");
    await expect(page.locator("body")).toContainText("لا واجهة دفع");
    await page.getByRole("button", { name: "سكر أبيض معبّأ", exact: true }).click();
    await expect(page.getByText("المعاينة — كما يراه المشتري")).toBeVisible();
    await expect(page.getByText("عرض ممول", { exact: true })).toBeVisible();
    // الجيران الأرخص يظهرون بجوار الإعلان لا مكانه
    await expect(page.getByText("سكر — مخزن البركة")).toBeVisible();
    await page.getByRole("button", { name: "متابعو منشأتي" }).click();
    await page.getByLabel("المدة بالأيام").fill("7");
    await page.getByRole("button", { name: "اطلب العرض الممول" }).click();
    await expect(page.getByText("أُرسل الطلب — التسعير غير معتمد، يتواصل الفريق")).toBeVisible();
    expect(posts[0]).toMatchObject({
      offer_id: "a",
      audience: "followers",
      duration_days: 7,
      action: "request",
    });
    // لا رقم ولا واجهة دفع في الطلب
    await expect(page.locator("body")).not.toContainText("ادفع");
  });

  test("validation_error: طلب بلا جمهور أو مدة — لا افتراض «كل المشترين»", async ({
    page,
  }, info) => {
    await page.route("**/api/grow/promote**", (route) => {
      if (route.request().method() === "POST")
        return route.fulfill(
          json(400, {
            detail: "audience_or_duration_required",
            field: "audience",
            extra: { missing: ["audience", "duration_days"] },
          }),
        );
      if (route.request().url().includes("preview=")) return route.fulfill(json(200, PREVIEW));
      return route.fulfill(json(200, PROMOTE()));
    });
    await login(page, "/grow/promote", /\/grow\/promote$/);
    await page.getByRole("button", { name: "شاي سيلاني", exact: true }).click();
    // لا جمهور محدَّد سلفاً
    await expect(page.locator(".pos-chip--on")).toHaveCount(1);
    await page.getByRole("button", { name: "اطلب العرض الممول" }).click();
    await expectFrame(page, info, {
      screenId: "GROW-03",
      state: "validation_error",
      texts: fromFrame("GROW-03", "validation_error", [
        "طلب بلا جمهور أو مدة",
        "الجمهور غير محدَّد أو المدة فارغة.",
        "لا افتراض",
        "لا نفترض «كل المشترين» جمهوراً افتراضياً. الجمهور الواسع بلا اختيار صريح إنفاقٌ بلا قصد.",
      ]),
    });
  });

  test("permission_denied: الطلب للمالك — ناشر الكتالوج يُعدّ ويحفظ ويطلب من المالك إرساله", async ({
    page,
  }, info) => {
    const posts: unknown[] = [];
    await page.route("**/api/grow/promote**", (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { action: string };
        posts.push(body);
        if (body.action === "request")
          return route.fulfill(
            json(403, { detail: "permission_denied", extra: { owner_required: true } }),
          );
        return route.fulfill(
          json(200, {
            request: {
              id: "q2",
              offer_id: "b",
              offer_name: "شاي سيلاني",
              audience: "all",
              audience_label: "كل المشترين",
              area: "",
              duration_days: 3,
              status: "draft",
              status_label: "مسودّة — بانتظار المالك",
              prepared_by_name: "منى",
              requested_by_name: "",
            },
          }),
        );
      }
      if (route.request().url().includes("preview=")) return route.fulfill(json(200, PREVIEW));
      return route.fulfill(json(200, PROMOTE({ can_request: false })));
    });
    await login(page, "/grow/promote", /\/grow\/promote$/);
    await page.getByRole("button", { name: "شاي سيلاني", exact: true }).click();
    await page.getByRole("button", { name: "كل المشترين" }).click();
    await page.getByLabel("المدة بالأيام").fill("3");
    await page.getByRole("button", { name: "اطلب العرض الممول" }).click();
    await expectFrame(page, info, {
      screenId: "GROW-03",
      state: "permission_denied",
      texts: fromFrame("GROW-03", "permission_denied", [
        "الطلب للمالك",
        "ناشر الكتالوج يُعدّ العرض ولا يطلب تمويله — الطلب التزام مالي.",
        "المخرج",
        "يُعدّه ويحفظه ويطلب من المالك إرساله، فلا يُهدر عمله.",
      ]),
    });
    await page.getByRole("button", { name: "فهمت" }).click();
    await page.getByRole("button", { name: "احفظ واطلب من المالك إرساله" }).click();
    await expect(page.getByText("حُفظ الطلب — بانتظار المالك ليرسله")).toBeVisible();
    expect(posts.map((p) => (p as { action: string }).action)).toEqual(["request", "save"]);
  });

  test("phase_locked مع التسعير: قفلان لا واحد — يُقال كلاهما", async ({ page }, info) => {
    await page.route("**/api/grow/promote**", (route) =>
      route.fulfill(json(200, PROMOTE({ state: "phase_locked" }))),
    );
    await login(page, "/grow/promote", /\/grow\/promote$/);
    await expectFrame(page, info, {
      screenId: "GROW-03",
      state: "phase_locked",
      texts: fromFrame("GROW-03", "phase_locked", [
        "لم تُفتح والتسعير غير معتمد",
        "قفلان لا واحد: المرحلة لم تُفتح، والتسعير نفسه قرار مفتوح.",
        "لا واجهة دفع",
        "نقول القفلين",
      ]),
    });
  });
});
