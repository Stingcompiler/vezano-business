import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.10 — CAT-04 (4) + CAT-05 (6). بيانات الإطارين 05-D2 و38-D30 كما هي؛ الخادم يُحاكى على مستوى
 * الشبكة. السعر سلسلة تواريخ؛ الاستيراد دفعةٌ بهوية تمنع التكرار (ACC-86).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

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
  await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}$`));
}

const PRICE_VIEW = {
  item_id: "i1",
  name: "سكر",
  base_unit_name: "كغ",
  sale_price_minor: "10000",
  price_updated_at: "2026-08-12T09:00:00Z",
  units: [{ id: "iu1", name: "كرتونة", factor_milli: "12000", price_minor: "120000" }],
  history: [
    {
      id: "p2",
      price_minor: "10000",
      effective_from: "2026-08-12T09:00:00Z",
      effective_to: "",
      changed_by_name: "",
      batch_id: "",
      note: "",
    },
    {
      id: "p1",
      price_minor: "9200",
      effective_from: "2026-07-01T09:00:00Z",
      effective_to: "2026-08-11T09:00:00Z",
      changed_by_name: "",
      batch_id: "",
      note: "",
    },
  ],
  can_change: true,
  can_see_cost: true,
  average_cost_minor: "",
  pending_requests: [],
};

test.describe("CAT-04", () => {
  test("ready: السعر الجديد وسعر الكرتونة يتبع تلقائياً وتاريخ السعر", async ({ page }, info) => {
    await page.route("**/api/catalog/items/i1/price", (route) =>
      route.fulfill(json(200, PRICE_VIEW)),
    );
    await login(page, "/catalog/i1/price");
    await page.getByLabel("السعر الجديد").fill("110.00");
    await expectFrame(page, info, {
      screenId: "CAT-04",
      state: "ready",
      texts: fromFrame("CAT-04", "ready", [
        "سعر بيع السكر — كغ",
        "السعر الجديد",
        "سعر الكرتونة يتبع تلقائياً",
        "1,320.00",
        "تاريخ السعر",
        "100.00",
        "أغسطس — سارٍ الآن",
        "92.00",
        "يوليو —",
        "الفواتير الصادرة بالسعر القديم تبقى بسعرها. لا يُعاد تسعير أي مستند محفوظ.",
        "حفظ السعر",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const hist = page.locator(".cat-price__table");
    await expect(hist).toContainText("من 12 أغسطس — سارٍ الآن");
    await expect(hist).toContainText("01 يوليو — 11 أغسطس");
  });

  test("validation_error: سعر دون التكلفة — ننبّه ولا نمنع، تأكيد واحد", async ({ page }, info) => {
    let confirmed = false;
    await page.route("**/api/catalog/items/i1/price", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { ...PRICE_VIEW, average_cost_minor: "9000" }));
      const body = route.request().postDataJSON() as { confirm_below_cost?: boolean };
      if (!body.confirm_below_cost)
        return route.fulfill(
          json(409, {
            detail: "below_cost",
            average_cost_minor: "9000",
            price_minor: "8500",
            margin_minor: "-500",
          }),
        );
      confirmed = true;
      return route.fulfill(
        json(200, {
          ...PRICE_VIEW,
          sale_price_minor: "8500",
          changed: true,
          history: [
            {
              id: "p3",
              price_minor: "8500",
              effective_from: new Date().toISOString(),
              effective_to: "",
              changed_by_name: "المالك",
              batch_id: "",
              note: "",
            },
            ...PRICE_VIEW.history,
          ],
        }),
      );
    });
    await login(page, "/catalog/i1/price");
    await page.getByLabel("السعر الجديد").fill("85.00");
    await page.getByRole("button", { name: "حفظ السعر" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-04",
      state: "validation_error",
      texts: fromFrame("CAT-04", "validation_error", [
        "سعر دون التكلفة",
        "سعرٌ يُدخَل أقلّ من متوسط التكلفة — بيعٌ بخسارة.",
        "ننبّه ولا نمنع",
      ]),
    });
    await expect(page.locator(".c-notice")).toContainText("−5.00");
    // تأكيد واحد
    await page.locator(".c-notice").getByRole("button", { name: "حفظ السعر" }).click();
    await expect(page.locator('[data-screen="CAT-04"][data-state="success"]')).toBeVisible();
    expect(confirmed).toBe(true);
  });

  test("permission_denied: تغيير السعر للمالك — ومدير الفرع يطلب تغييراً بسعره وسببه", async ({
    page,
  }, info) => {
    const requests: unknown[] = [];
    await page.route("**/api/catalog/items/i1/price", (route) =>
      route.fulfill(
        json(200, {
          ...PRICE_VIEW,
          can_change: false,
          can_see_cost: false,
          pending_requests: requests.length
            ? [
                {
                  id: "rq1",
                  proposed_price_minor: "11000",
                  reason: "السوق المحلي أعلى",
                  requested_by_name: "مدير الفرع",
                  requested_at: new Date().toISOString(),
                },
              ]
            : [],
        }),
      ),
    );
    await page.route("**/api/catalog/items/i1/price-request", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill(
        json(201, {
          id: "rq1",
          item_id: "i1",
          proposed_price_minor: "11000",
          reason: "السوق المحلي أعلى",
          status: "pending",
          requested_at: new Date().toISOString(),
        }),
      );
    });
    await login(page, "/catalog/i1/price");
    await expectFrame(page, info, {
      screenId: "CAT-04",
      state: "permission_denied",
      texts: fromFrame("CAT-04", "permission_denied", [
        "تغيير السعر للمالك",
        "مدير الفرع يرى السعر وتاريخه ولا يغيّره. السعر قرار منشأة لا فرع.",
        "اطلب تغييراً",
        "تاريخ السعر",
        "100.00",
      ]),
    });
    await expect(page.getByRole("button", { name: "حفظ السعر" })).toHaveCount(0);
    await page.getByRole("button", { name: "اطلب تغييراً" }).click();
    await page.getByLabel("السعر المقترح").fill("110");
    await page.getByLabel("السبب").fill("السوق المحلي أعلى");
    await page.getByRole("button", { name: "اطلب تغييراً" }).click();
    await expect(page.locator(".c-notice")).toContainText(
      "السعر المقترح 110.00 · السوق المحلي أعلى",
    );
    expect(requests[0]).toEqual({ proposed_price_minor: "11000", reason: "السوق المحلي أعلى" });
  });

  test("success: سُجّل السعر الجديد — سريانه من الآن والفواتير السابقة بأسعارها", async ({
    page,
  }, info) => {
    await page.route("**/api/catalog/items/i1/price", (route) =>
      route.request().method() === "GET"
        ? route.fulfill(json(200, PRICE_VIEW))
        : route.fulfill(
            json(200, {
              ...PRICE_VIEW,
              sale_price_minor: "11000",
              changed: true,
              history: [
                {
                  id: "p3",
                  price_minor: "11000",
                  effective_from: new Date().toISOString(),
                  effective_to: "",
                  changed_by_name: "المالك",
                  batch_id: "",
                  note: "",
                },
                { ...PRICE_VIEW.history[0]!, effective_to: new Date().toISOString() },
                PRICE_VIEW.history[1]!,
              ],
            }),
          ),
    );
    await login(page, "/catalog/i1/price");
    await page.getByLabel("السعر الجديد").fill("110.00");
    await page.getByRole("button", { name: "حفظ السعر" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-04",
      state: "success",
      texts: fromFrame("CAT-04", "success", [
        "سُجّل السعر الجديد",
        "ومعه سريانه: من الآن، والفواتير السابقة بأسعارها.",
        "تاريخ السعر",
      ]),
    });
    await expect(page.locator(".cat-price__table tr").first()).toContainText("110.00");
    await expect(page.locator(".cat-price__table tr").first()).toContainText("المالك");
    await expect(page.locator(".cat-price__table tr").first()).toContainText("سارٍ الآن");
    await expect(page.locator(".cat-price__follow")).toContainText("1,320.00");
  });
});

const rows = (extra: Record<string, unknown>[] = []) => [
  {
    line: 12,
    key: "i1",
    price_text: "110.00",
    item_id: "i1",
    name: "سكر",
    old_price_minor: "10000",
    new_price_minor: "11000",
    result: "update",
    reason: "",
  },
  {
    line: 13,
    key: "6291000000338",
    price_text: "240.00",
    item_id: "i2",
    name: "شاي أسود 250غ",
    old_price_minor: "24000",
    new_price_minor: "24000",
    result: "unchanged",
    reason: "",
  },
  ...extra,
];
const REJECTED = [
  {
    line: 41,
    key: "زيت 1 لتر",
    price_text: "-780.00",
    item_id: "i3",
    name: "زيت 1 لتر",
    old_price_minor: "78000",
    new_price_minor: "",
    result: "rejected",
    reason: "negative",
  },
  {
    line: 58,
    key: "صنف غير معروف",
    price_text: "300.00",
    item_id: "",
    name: "صنف غير معروف",
    old_price_minor: "",
    new_price_minor: "",
    result: "rejected",
    reason: "item_not_found",
  },
];
const batch = (over: Record<string, unknown>) => ({
  id: "b1",
  file_name: "prices-sep.csv",
  status: "previewed",
  rows: rows(),
  ready_count: 1,
  rejected_count: 0,
  unchanged_count: 1,
  applied_count: 0,
  max_increase_pct: 10,
  created_at: new Date().toISOString(),
  applied_at: "",
  reverted_at: "",
  revert_until: "",
  applied: [],
  ...over,
});

async function uploadCsv(page: Page) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "prices-sep.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("الصنف,السعر\ni1,110.00\n", "utf-8"),
    });
}

test.describe("CAT-05", () => {
  test("loading → ready: جارٍ الفحص ثم معاينة ما سيتغيّر — الفرق لا القائمة", async ({
    page,
  }, info) => {
    await login(page, "/catalog/import");
    await page.route("**/api/catalog/prices/import/preview", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill(json(200, batch({ ready_count: 84, max_increase_pct: 12 })));
    });
    await uploadCsv(page);
    await expectFrame(page, info, {
      screenId: "CAT-05",
      state: "loading",
      texts: fromFrame("CAT-05", "loading", ["جارٍ الفحص", "قراءة كاملة ومطابقة قبل أي كتابة."]),
    });
    await expectFrame(page, info, {
      screenId: "CAT-05",
      state: "ready",
      texts: fromFrame("CAT-05", "ready", [
        "معاينة استيراد الأسعار —",
        "معاينة ما سيتغيّر",
        "الملف مقروء ولم يُكتب شيء. نعرض الفرق:",
        "سعراً سيتغيّر، أكبر ارتفاع",
        "الفرق لا القائمة",
        "السطر",
        "الصنف",
        "السعر",
        "النتيجة",
        "سكر",
        "سيُحدَّث من",
        "سطراً",
      ]),
    });
    const root = page.locator('[data-screen="CAT-05"]');
    await expect(root).toContainText("84 سعراً سيتغيّر، أكبر ارتفاع 12٪");
    // الفرق لا القائمة: «بلا تغيير» لا يُعرض في ready
    await expect(root).not.toContainText("شاي أسود 250غ");
    await expect(page.getByRole("button", { name: "اعتماد 84 سطراً" })).toBeVisible();
  });

  test("partial: جاهز/مرفوض/بلا تغيير — الاعتماد يطبّق الصالح فقط والمرفوض يُنزَّل", async ({
    page,
  }, info) => {
    await login(page, "/catalog/import");
    await page.route("**/api/catalog/prices/import/preview", (route) =>
      route.fulfill(
        json(
          200,
          batch({
            rows: rows(REJECTED),
            ready_count: 184,
            rejected_count: 12,
            unchanged_count: 31,
          }),
        ),
      ),
    );
    await uploadCsv(page);
    await expectFrame(page, info, {
      screenId: "CAT-05",
      state: "partial",
      texts: fromFrame("CAT-05", "partial", [
        "معاينة استيراد الأسعار —",
        "prices-sep.csv",
        "جاهز للاعتماد",
        "184",
        "مرفوض",
        "12",
        "بلا تغيير",
        "31",
        "السطر",
        "الصنف",
        "السعر",
        "النتيجة",
        "سكر",
        "سيُحدَّث من 100.00",
        "شاي أسود 250غ",
        "بلا تغيير — نفس السعر",
        "زيت 1 لتر",
        "مرفوض: سعر سالب",
        "صنف غير معروف",
        "مرفوض: لا صنف بهذا المعرّف",
        "سطراً صالحاً فقط ويترك المرفوض دون تغيير. إعادة رفع الملف نفسه لا تكرّر التطبيق — يُطابَق بالمعرّف لا بالترتيب.",
        "اعتماد 184 سطراً",
        "تنزيل المرفوض للتصحيح",
      ]),
      styles: [[".cat-counter--ok", "background-color", "color.green.50"]],
    });
    for (const v of ["110.00", "240.00", "-780.00", "300.00"])
      await expect(page.locator('[data-screen="CAT-05"]')).toContainText(v);
    // التنزيل يطلب المرفوض من الخادم
    const dl = page.waitForRequest("**/api/catalog/prices/import/b1/rejected.csv");
    await page.route("**/api/catalog/prices/import/b1/rejected.csv", (route) =>
      route.fulfill({ status: 200, contentType: "text/csv", body: "السطر,الصنف,السعر,السبب\n" }),
    );
    await page.getByRole("button", { name: "تنزيل المرفوض للتصحيح" }).click();
    await dl;
  });

  test("validation_error: صفوف لا تُقبل — لا صالح للاعتماد، ويُصدَّر المرفوض بسببه", async ({
    page,
  }, info) => {
    await login(page, "/catalog/import");
    await page.route("**/api/catalog/prices/import/preview", (route) =>
      route.fulfill(
        json(
          200,
          batch({ rows: REJECTED, ready_count: 0, rejected_count: 12, unchanged_count: 0 }),
        ),
      ),
    );
    await uploadCsv(page);
    await expectFrame(page, info, {
      screenId: "CAT-05",
      state: "validation_error",
      texts: fromFrame("CAT-05", "validation_error", [
        "صفوف لا تُقبل",
        "صفاً بسعر غير رقمي أو بصنف غير موجود أو بسعر سالب.",
        "يُستورد السليم",
        "ويُصدَّر المرفوض بسببه ورقم سطره ليُصحَّح ويُعاد.",
        "تنزيل المرفوض للتصحيح",
        "مرفوض: سعر سالب",
      ]),
    });
    await expect(page.getByRole("button", { name: /اعتماد/ })).toHaveCount(0);
  });

  test("success: طُبّقت الأسعار — موسومة بالدفعة، والتراجع دفعةً خلال 24 ساعة", async ({
    page,
  }, info) => {
    await login(page, "/catalog/import");
    await page.route("**/api/catalog/prices/import/preview", (route) =>
      route.fulfill(json(200, batch({ ready_count: 84 }))),
    );
    await page.route("**/api/catalog/prices/import/b1/apply", (route) =>
      route.fulfill(
        json(
          200,
          batch({
            status: "applied",
            ready_count: 84,
            applied_count: 84,
            applied_at: new Date().toISOString(),
          }),
        ),
      ),
    );
    await page.route("**/api/catalog/prices/import/b1/revert", (route) =>
      route.fulfill(json(200, batch({ status: "reverted", ready_count: 84, applied_count: 84 }))),
    );
    await uploadCsv(page);
    await page.getByRole("button", { name: "اعتماد 84 سطراً" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-05",
      state: "success",
      texts: fromFrame("CAT-05", "success", [
        "طُبّقت الأسعار",
        "سعراً سرى الآن، وكلٌّ منها سطرٌ في تاريخ صنفه موسومٌ بالدفعة.",
        "التراجع دفعةً",
        "الدفعة كيانٌ واحد يُتراجَع عنه خلال",
        "ساعة ما لم يُبع بالسعر الجديد — وبعدها يصير جزءاً من الدفتر.",
      ]),
    });
    await expect(page.locator(".c-notice")).toContainText("84 سعراً سرى الآن");
    await page.getByRole("button", { name: "التراجع دفعةً" }).click();
    await expect(page.locator(".c-notice")).toContainText("أُعيدت الأسعار السابقة");
    await expect(page.getByRole("button", { name: "التراجع دفعةً" })).toHaveCount(0);
  });

  test("server_error: انقطع أثناء التطبيق — ما اكتمل يبقى وزرّ استئناف يكمل بلا تكرار", async ({
    page,
  }, info) => {
    await login(page, "/catalog/import");
    await page.route("**/api/catalog/prices/import/preview", (route) =>
      route.fulfill(json(200, batch({ ready_count: 84 }))),
    );
    let applies = 0;
    await page.route("**/api/catalog/prices/import/b1/apply", (route) => {
      applies += 1;
      if (applies === 1) return route.abort("connectionfailed");
      return route.fulfill(
        json(200, batch({ status: "applied", ready_count: 84, applied_count: 84 })),
      );
    });
    await page.route("**/api/catalog/prices/import/b1", (route) =>
      route.fulfill(json(200, batch({ status: "applying", ready_count: 84, applied_count: 40 }))),
    );
    await uploadCsv(page);
    await page.getByRole("button", { name: "اعتماد 84 سطراً" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-05",
      state: "server_error",
      texts: fromFrame("CAT-05", "server_error", [
        "انقطع أثناء التطبيق",
        "ثم انقطع. بعض الأصناف بالسعر الجديد وبعضها بالقديم.",
        "لا نصف تسعيرة",
        "الدفعة تُطبَّق كوحدة قابلة للتراجع: ما اكتمل يبقى وما انقطع يُلغى، ونعرض أين وقفنا وزرّ استئناف.",
      ]),
    });
    await expect(page.locator(".c-notice")).toContainText("طُبّق 40 من 84 ثم انقطع");
    await page.getByRole("button", { name: "استئناف" }).click();
    await expect(page.locator('[data-screen="CAT-05"][data-state="success"]')).toBeVisible();
    expect(applies).toBe(2);
  });
});
