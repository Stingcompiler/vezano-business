import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.9 — CAT-02 (4) + CAT-03 (3). بيانات الإطارين 31-D23 و05-D2 كما هي؛ الخادم يُحاكى على مستوى
 * الشبكة بأشكال العقد. تغيير المعامل لا يعيد تفسير الماضي (ACC-19)؛ الحدود مرفوضة بنص كامل (ACC-25).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const UNITS = {
  units: [
    { id: "u-piece", code: "piece", name: "حبة", is_base: true, decimal_places: 0 },
    { id: "u-kg", code: "kg", name: "كغ", is_base: true, decimal_places: 3 },
    { id: "u-bag", code: "bag", name: "كيس", is_base: true, decimal_places: 0 },
    { id: "u-carton", code: "carton", name: "كرتون", is_base: false, decimal_places: 0 },
  ],
};
const GROUPS = {
  group_count: 1,
  total_items: 7,
  groups: [
    { id: "g-بقالة", name: "بقالة", parent_name: "", items: 5, aliases: [], note: "" },
    { id: "", name: "بلا مجموعة", parent_name: "", items: 2, aliases: [], note: "" },
  ],
};

const card = (over: Record<string, unknown> = {}) => ({
  id: "i-new",
  name: "سكر ناعم",
  name_normalized: "سكر ناعم",
  group_id: "g-بقالة",
  group_name: "بقالة",
  base_unit_id: "u-bag",
  base_unit_code: "bag",
  base_unit_name: "كيس",
  base_unit_decimal_places: 0,
  units: [
    {
      id: "iu-1",
      unit_id: "u-carton",
      code: "carton",
      name: "كرتون",
      decimal_places: 0,
      factor_milli: "10000",
      barcode: "",
      created_at: "2025-01-10T09:00:00Z",
      prior_lines: 0,
      changes: [],
    },
  ],
  barcode: "6291041500213",
  sale_price_minor: "850",
  price_updated_at: new Date().toISOString(),
  image_present: false,
  image_updated_at: "",
  image_data_url: "",
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: new Date().toISOString(),
  movements: 0,
  base_unit_locked: false,
  ...over,
});

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/catalog/units", (route) => route.fulfill(json(200, UNITS)));
  await page.route("**/api/catalog/groups", (route) => route.fulfill(json(200, GROUPS)));
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}$`));
}

const READY_TEXTS = [
  "صنف جديد",
  "اسم الصنف",
  "كما ينطقه الكاشير",
  "الوحدة الأساسية",
  "لا تتغيّر بعد أول حركة",
  "وحدة أكبر وتحويلها",
  "اختيارية",
  "الباركود",
  "هوية لا اسم — لا يحمله صنفان",
  "شامل الضريبة",
  "صورة الصنف",
  "اختيارية. الكاشير يتعرّف بالصورة أسرع من الاسم في الزحام.",
  "بطاقة الصنف كما تُقرأ",
  "احفظ الصنف",
  "احفظ وأضف آخر",
];

async function fillSugar(page: Page) {
  await page.getByLabel("اسم الصنف").fill("سكر ناعم");
  await page.getByLabel("الوحدة الأساسية").selectOption("u-bag");
  await page.getByLabel("وحدة أكبر وتحويلها").selectOption("u-carton");
  await page.getByLabel("المعامل").fill("10");
  await page.getByLabel("الباركود").fill("6291041500213");
  await page.getByLabel("سعر بيع الكيس").fill("8.50");
}

test.describe("CAT-02", () => {
  test("ready: الوحدة قبل السعر — الحقول الخمسة والصورة والمعاينة كما تُقرأ", async ({
    page,
  }, info) => {
    await login(page, "/catalog/new");
    await fillSugar(page);
    const width = page.viewportSize()?.width ?? 0;
    if (width < 834) await page.getByRole("button", { name: "اعرض البطاقة" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-02",
      state: "ready",
      texts: fromFrame("CAT-02", "ready", [
        ...READY_TEXTS,
        "سكر ناعم",
        "سعر بيع الكيس",
        "6291041500213",
      ]),
      styles: [[".cat-preview__name", "color", "ink.strong"]],
    });
    // المعاينة تُركَّب من الحقول: الاسم — الوحدة · الكرتون = 10 أكياس · البيع بالكيس والكرتون
    const preview = page.locator(".cat-preview__card");
    await expect(preview).toContainText("سكر ناعم — كيس");
    await expect(preview).toContainText("كرتون = 10 كيس · البيع بالكيس والكرتون");
    await expect(preview.locator(".sting-mono").last()).toHaveText("6291041500213");
  });

  test("validation_error: خطآن يمنعان الحفظ — وما كتبتَه باقٍ كما هو", async ({ page }, info) => {
    await login(page, "/catalog/new");
    await page.route("**/api/catalog/barcode?**", (route) =>
      route.fulfill(
        json(200, {
          barcode: "6291041500213",
          taken: true,
          owner_item_id: "i-coarse",
          owner_item_name: "سكر خشن — كيس 1 كجم",
          owner_unit_name: "كيس",
        }),
      ),
    );
    await page.getByLabel("اسم الصنف").fill("سكر ناعم");
    await page.getByLabel("الباركود").fill("6291041500213");
    await page.getByRole("button", { name: "احفظ الصنف" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-02",
      state: "validation_error",
      texts: fromFrame("CAT-02", "validation_error", [
        "خطآن يمنعان الحفظ",
        "الوحدة الأساسية",
        "لم تُحدَّد",
        "بلا وحدة أساسية لا يعرف النظام معنى «5» في المخزون ولا في الفاتورة: خمسة أكياس أم خمسة كراتين أم خمسة كيلوات. وهي الحقل الوحيد الذي لا يُعدَّل بعد أول حركة، لأن تعديلها يعيد تفسير كل رصيد وكل فاتورة مضت.",
        "المخرج:",
        "اختر الوحدة التي يُعدّ بها الصنف في الرفّ، لا التي يُشترى بها من المورد.",
        "الباركود",
        "مستخدم في صنف آخر",
        "الرقم 6291041500213 مسجّل على «سكر خشن — كيس 1 كجم». مسحُه على الميزان سيفتح ذاك لا هذا، والفرق يظهر في الجرد بعد شهر لا في البيع الآن.",
        "افتح الصنف الآخر وتحقّق، أو اترك الباركود فارغاً — الصنف يُباع بالبحث بالاسم ريثما يُضبط.",
        "ما كتبتَه باقٍ كما هو. لا نمسح حقلاً صحيحاً لأن جاره خطأ، ولا نُرجعك إلى أعلى النموذج — التمرير يذهب إلى أول خطأ ومؤشّر الكتابة فيه.",
      ]),
      styles: [[".cat-errors__title", "color", "danger"]],
    });
    await expect(page.getByLabel("اسم الصنف")).toHaveValue("سكر ناعم");
    await expect(page.getByLabel("الباركود")).toHaveValue("6291041500213");
    await expect(page.getByLabel("الوحدة الأساسية")).toBeFocused();
    await expect(page.getByRole("link", { name: "سكر خشن — كيس 1 كجم" })).toHaveAttribute(
      "href",
      "/catalog/i-coarse",
    );
  });

  test("validation_error: حدود الطول والقيمة مرفوضة بنص كامل من الخادم (ACC-25)", async ({
    page,
  }) => {
    await login(page, "/catalog/new");
    await page.route("**/api/catalog/barcode?**", (route) =>
      route.fulfill(json(200, { barcode: "1", taken: false })),
    );
    await page.route("**/api/catalog/items", (route) =>
      route.request().method() === "POST"
        ? route.fulfill(
            json(400, {
              detail: "validation_error",
              errors: [
                { field: "name", code: "too_long", limit: 200, actual: 231 },
                {
                  field: "sale_price_minor",
                  code: "out_of_range",
                  limit: 1000000000000000,
                  actual: 9000000000000000,
                },
                { field: "units", code: "out_of_range", limit: 1000000000, actual: 5000000000 },
              ],
            }),
          )
        : route.fallback(),
    );
    await fillSugar(page);
    await page.getByRole("button", { name: "احفظ الصنف" }).click();
    await expect(
      page.locator('[data-screen="CAT-02"][data-state="validation_error"]'),
    ).toBeVisible();
    const panel = page.locator(".cat-errors");
    await expect(panel).toContainText("أخطاء تمنع الحفظ");
    await expect(panel).toContainText("الحدّ 200 حرفاً وما كتبتَه 231.");
    await expect(panel).toContainText("القيمة 9000000000000000 والحدّ 1000000000000000.");
    await expect(page.getByLabel("اسم الصنف")).toHaveValue("سكر ناعم");
  });

  test("saving: تحقّق من تفرّد الباركود ← حفظ البطاقة ← رفع الصورة — الصورة بعد الصنف لا قبله", async ({
    page,
  }, info) => {
    await login(page, "/catalog/new");
    await page.route("**/api/catalog/barcode?**", (route) =>
      route.fulfill(json(200, { barcode: "6291041500213", taken: false })),
    );
    await page.route("**/api/catalog/items", (route) =>
      route.request().method() === "POST" ? route.fulfill(json(201, card())) : route.fallback(),
    );
    await page.route("**/api/catalog/items/i-new/image", async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.fulfill(
        json(200, card({ image_present: true, image_data_url: "data:image/png;base64,x" })),
      );
    });
    await fillSugar(page);
    await page.locator('input[type="file"][aria-label="صورة الصنف"]').setInputFiles({
      name: "sugar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.locator(".c-upload__item")).toContainText("sugar.png");
    await page.getByRole("button", { name: "احفظ الصنف" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-02",
      state: "saving",
      texts: fromFrame("CAT-02", "saving", [
        "جارٍ الحفظ",
        "تحقّق من تفرّد الباركود",
        "تمّ",
        "حفظ بطاقة الصنف",
        "رفع الصورة",
        "الأزرار معطّلة والنافذة لا تُغلق.",
        "الصورة ترفع بعد الصنف لا قبله: لو انقطع الرفع بقي الصنف محفوظاً بلا صورة، ولو حفظنا الصورة أولاً لبقيت ملفاً يتيماً بلا صنف يملكه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "احفظ الصنف" })).toBeDisabled();
    // الخطوتان الأوليان تمّتا قبل الصورة
    await expect(page.locator(".cat-step--done")).toHaveCount(2);
    await expect(page.locator('[data-screen="CAT-02"][data-state="success"]')).toBeVisible({
      timeout: 20_000,
    });
  });

  test("success: حُفظ الصنف — الصنف موجود ولا رصيد له، وثلاثة أفعال تالية", async ({
    page,
  }, info) => {
    await login(page, "/catalog/new");
    await page.route("**/api/catalog/barcode?**", (route) =>
      route.fulfill(json(200, { barcode: "6291041500213", taken: false })),
    );
    await page.route("**/api/catalog/items", (route) =>
      route.request().method() === "POST" ? route.fulfill(json(201, card())) : route.fallback(),
    );
    await fillSugar(page);
    await page.getByRole("button", { name: "احفظ الصنف" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-02",
      state: "success",
      texts: fromFrame("CAT-02", "success", [
        "حُفظ الصنف",
        "سكر ناعم — كيس",
        "الباركود مرتبط · البيع بالكيس والكرتون مفعّل · الرصيد الافتتاحي صفر",
        "الصنف موجود ولا رصيد له.",
        "بيعه الآن يُخرج المخزون إلى سالب، وهذا قرار لا خطأ — فلا نمنعه ولا نخفيه.",
        "أضف رصيداً افتتاحياً لهذا الصنف",
        "أنشئ صنفاً آخر بنفس الوحدة والمجموعة",
        "افتح بطاقة الصنف",
      ]),
      styles: [[".cat-success__title", "color", "ink.strong"]],
    });
    await expect(page.getByRole("link", { name: "افتح بطاقة الصنف" })).toHaveAttribute(
      "href",
      "/catalog/i-new",
    );
    // «أنشئ صنفاً آخر بنفس الوحدة والمجموعة»: الاسم يُمسح والوحدة والمجموعة تبقيان
    await page.getByRole("button", { name: "أنشئ صنفاً آخر بنفس الوحدة والمجموعة" }).click();
    await expect(page.locator('[data-screen="CAT-02"][data-state="ready"]')).toBeVisible();
    await expect(page.getByLabel("اسم الصنف")).toHaveValue("");
    await expect(page.getByLabel("الوحدة الأساسية")).toHaveValue("u-bag");
  });

  test("بطاقة صنف قائم: النموذج معبّأ من items/{id}، والوحدة الأساسية مقفلة بعد أول حركة", async ({
    page,
  }) => {
    await page.route("**/api/catalog/items/i-new", (route) =>
      route.request().method() === "GET"
        ? route.fulfill(json(200, card({ movements: 3, base_unit_locked: true })))
        : route.fulfill(
            json(200, card({ name: "سكر ناعم فاخر", movements: 3, base_unit_locked: true })),
          ),
    );
    await login(page, "/catalog/i-new");
    await expect(page.locator('[data-screen="CAT-02"][data-state="ready"]')).toBeVisible();
    await expect(page.getByLabel("اسم الصنف")).toHaveValue("سكر ناعم");
    await expect(page.getByLabel("الوحدة الأساسية")).toBeDisabled();
    await expect(page.locator('[data-field="base_unit_id"]')).toContainText(
      "لا تتغيّر بعد أول حركة",
    );
    await expect(page.getByRole("link", { name: "الوحدات" })).toHaveAttribute(
      "href",
      "/catalog/i-new/units",
    );
    await page.route("**/api/catalog/barcode?**", (route) =>
      route.fulfill(json(200, { barcode: "6291041500213", taken: false })),
    );
    await page.getByLabel("اسم الصنف").fill("سكر ناعم فاخر");
    await page.getByRole("button", { name: "احفظ الصنف" }).click();
    await expect(page.locator('[data-screen="CAT-02"][data-state="success"]')).toBeVisible();
    await expect(page.locator(".cat-success")).toContainText("سكر ناعم فاخر — كيس");
  });
});

const SUGAR = card({
  id: "i1",
  name: "سكر",
  base_unit_id: "u-kg",
  base_unit_code: "kg",
  base_unit_name: "كغ",
  base_unit_decimal_places: 3,
  barcode: "6291000000142",
  units: [
    {
      id: "iu-carton",
      unit_id: "u-carton",
      code: "carton",
      name: "كرتونة",
      decimal_places: 0,
      factor_milli: "12000",
      barcode: "6291000000159",
      created_at: "2025-01-10T09:00:00Z",
      prior_lines: 318,
      changes: [],
    },
  ],
});

async function openUnits(page: Page, item: unknown) {
  await page.route("**/api/catalog/items/i1", (route) => route.fulfill(json(200, item)));
  await login(page, "/catalog/i1/units");
}

test.describe("CAT-03", () => {
  test("ready: الوحدات بمعاملاتها وباركود لكل وحدة، وأمثلة محسوبة من المجال", async ({
    page,
  }, info) => {
    await openUnits(page, SUGAR);
    await expectFrame(page, info, {
      screenId: "CAT-03",
      state: "ready",
      texts: fromFrame("CAT-03", "ready", [
        "سكر — الوحدات",
        "الوحدة",
        "المعامل",
        "الباركود",
        "كغ",
        "الأساس",
        "كرتونة",
        "12",
        "أمثلة محسوبة",
        "كرتونة واحدة =",
        "نصف كرتونة =",
        "0.123",
        "كغ =",
        "كرتونة — يُعرض بالوحدة الأساس",
        "إضافة وحدة",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const ex = page.locator(".cat-examples");
    await expect(ex).toContainText("كرتونة واحدة = 12 كغ");
    await expect(ex).toContainText("نصف كرتونة = 6 كغ");
    // 0.123 ÷ 12 = 0.01025 → ثلاث منازل بالنصف بعيداً عن الصفر (المجال لا الواجهة)
    await expect(ex).toContainText("0.123 كغ = 0.010 كرتونة — يُعرض بالوحدة الأساس");
    await expect(page.locator('[data-screen="CAT-03"]')).toContainText("6291000000142");
    await expect(page.locator('[data-screen="CAT-03"]')).toContainText("6291000000159");
  });

  test("validation_error: تعديل معامل له ماضٍ — 318 سطراً تبقى بمعاملها والجديد يسري من الآن", async ({
    page,
  }, info) => {
    await openUnits(page, SUGAR);
    await page.getByRole("button", { name: "تغيير معامل الكرتونة" }).click();
    await page.getByLabel("المعامل الجديد").fill("24");
    await expectFrame(page, info, {
      screenId: "CAT-03",
      state: "validation_error",
      texts: fromFrame("CAT-03", "validation_error", [
        "تغيير معامل الكرتونة",
        "المعامل الحالي",
        "المعامل الجديد",
        "سطر بيع سابق يستخدم المعامل",
        "لن تتغير. كل سطر بيع يحفظ معامله لحظة الحفظ، فتبقى فاتورة أمس «كرتونة =",
        "كغ» إلى الأبد. المعامل الجديد يسري على البيع من الآن فقط.",
        "تاريخ التغيير — يظهر في بطاقة الصنف",
        "كغ · من يناير",
        "حتى اليوم ·",
        "سطراً",
        "كغ · من اليوم —",
        "تأكيد تغيير المعامل",
      ]),
    });
    const dlg = page.getByRole("dialog");
    await expect(dlg).toContainText("318 سطر بيع سابق يستخدم المعامل 12");
    await expect(dlg).toContainText("12 كغ · من يناير 2025 حتى اليوم · 318 سطراً");
    await expect(dlg).toContainText("24 كغ · من اليوم —");
    // الحدّ مرفوض بنص كامل (ACC-25)
    await page.route("**/api/catalog/items/i1/units/iu-carton", (route) =>
      route.fulfill(
        json(400, {
          detail: "validation_error",
          errors: [
            { field: "factor_milli", code: "out_of_range", limit: 1000000000, actual: 5000000000 },
          ],
        }),
      ),
    );
    await page.getByLabel("المعامل الجديد").fill("5000000");
    await page.getByRole("button", { name: "تأكيد تغيير المعامل" }).click();
    await expect(dlg).toContainText("خارج الحدّ");
    await expect(
      page.locator('[data-screen="CAT-03"][data-state="validation_error"]'),
    ).toBeVisible();
  });

  test("success: حُفظت الوحدات — يسري من الآن والسطور السابقة تبقى بمعاملها (ACC-19)", async ({
    page,
  }, info) => {
    await openUnits(page, SUGAR);
    const after = card({
      ...SUGAR,
      units: [
        {
          ...SUGAR.units[0]!,
          factor_milli: "24000",
          changes: [
            {
              id: "c1",
              old_factor_milli: "12000",
              new_factor_milli: "24000",
              prior_lines: 318,
              changed_by_name: "سميرة ع.",
              changed_at: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    await page.route("**/api/catalog/items/i1/units/iu-carton", (route) =>
      route.fulfill(json(200, after)),
    );
    await page.getByRole("button", { name: "تغيير معامل الكرتونة" }).click();
    await page.getByLabel("المعامل الجديد").fill("24");
    await page.getByRole("button", { name: "تأكيد تغيير المعامل" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-03",
      state: "success",
      texts: fromFrame("CAT-03", "success", ["حُفظت الوحدات", "باركود لكل وحدة", "يسري من الآن ·"]),
    });
    const root = page.locator('[data-screen="CAT-03"]');
    await expect(root).toContainText("البيع بالكغ وبالكرتونة معاً");
    await expect(root).toContainText("يسري من الآن · 318 سطر بيع سابق يستخدم المعامل 12");
    await expect(root).toContainText("كرتونة واحدة = 24 كغ");
    // إضافة وحدة بباركودها
    await page.route("**/api/catalog/items/i1/units", (route) =>
      route.fulfill(
        json(201, {
          ...after,
          units: [
            ...after.units,
            {
              id: "iu-bag",
              unit_id: "u-bag",
              code: "bag",
              name: "كيس",
              decimal_places: 0,
              factor_milli: "50000",
              barcode: "6291000000166",
              created_at: new Date().toISOString(),
              prior_lines: 0,
              changes: [],
            },
          ],
        }),
      ),
    );
    await page.getByRole("button", { name: "إضافة وحدة" }).click();
    await page.getByRole("dialog").getByLabel("الوحدة").selectOption("u-bag");
    await page.getByRole("dialog").getByLabel("المعامل").fill("50");
    await page.getByRole("dialog").getByLabel("الباركود").fill("6291000000166");
    await page.getByRole("dialog").getByRole("button", { name: "إضافة وحدة" }).click();
    await expect(root).toContainText("البيع بالكغ وبالكيس معاً · باركود لكل وحدة");
    await expect(root).toContainText("6291000000166");
  });
});
