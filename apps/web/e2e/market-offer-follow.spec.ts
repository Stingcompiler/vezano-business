import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T3.8 — MP-05 تفاصيل عرض (5) + MP-06 متابعة مورد (4): السعر بشروطه كاملة وتاريخ آخر تأكيد؛
 * الإضافة إلى السلة تجلب تأكيداً خادمياً قبل التثبيت (ACC-143)؛ المنتهي وبعملة أخرى ممتنع بلا تحويل
 * ضمني (ACC-140)؛ المسحوب بلا نسخة قديمة؛ عرض شريحة لا تخصّك = غير الموجود (ACC-121)؛ المتابعة
 * قرار المالك تُلغى وحدها ولا تمسّ أحداث الطلبات (ACC-134).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const confirmedDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const OFFER = (o: Record<string, unknown> = {}) => ({
  id: "o1",
  seller_tenant_id: "t2",
  seller_name: "مخزن البركة — تجريبي",
  public_name: "سكر أبيض",
  unit_name: "كرتونة",
  pack_label: "كرتونة 12×1كغ",
  price_minor: "118000",
  price_line: "",
  availability: "متوفر",
  confirmed_until: "2026-09-18",
  min_order_qty: 5,
  seller_badge: "verified",
  seller_badge_label: "موثَّقة المستندات",
  description: "",
  unit_price_minor: "9833",
  base_unit_name: "كغ",
  factor_milli: "12000",
  fees_decided: false,
  fees_label: "رسوم تُحدَّد عند الطلب",
  audience: "public",
  audience_label: "كل المشترين",
  currency: "SDG",
  buyer_currency: "",
  currency_mismatch: false,
  confirmed_at: confirmedDaysAgo(3),
  days_since_confirmed: 3,
  valid_until: "2026-09-18",
  expired: false,
  withdrawn: false,
  tiers: [],
  others: [],
  updated_at: confirmedDaysAgo(3),
  ...o,
});

const FOLLOWS = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  follows: rows,
  active_count: rows.filter((r) => (r as { status: string }).status === "active").length,
  can_follow: true,
  what_stops: ["عروضه الجديدة وتخفيضاته ورسائله التسويقية."],
  what_stays: [
    "تأكيد طلباتك معه وإشعارات الشحنات والمرتجعات — هذه أحداث طلب مخوَّلة لا تسويق.",
    "تاريخ تعاملك ومستنداتك وذمّتك. الإلغاء لا يمسّ دفتراً.",
    "قدرتك على الشراء منه في أي وقت — المتابعة ليست شرطاً للطلب.",
  ],
  ...extra,
});

const todayAt = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const ROWS = [
  {
    id: "f1",
    supplier_tenant_id: "t2",
    supplier_name: "مخزن البركة للجملة — تجريبي",
    status: "active",
    status_label: "متابَع",
    hint: "تتلقّى جديد عروضه وتنبيهات تخفيضه",
    suspended: false,
    followed_at: todayAt(9, 0),
    cancelled_at: "",
  },
  {
    id: "f2",
    supplier_tenant_id: "t3",
    supplier_name: "شركة النيل للتوريدات — تجريبي",
    status: "cancelled",
    status_label: "أُلغيت",
    hint: "لا رسائل تسويقية بعد الآن",
    suspended: false,
    followed_at: todayAt(8, 0),
    cancelled_at: todayAt(11, 20),
  },
  {
    id: "f3",
    supplier_tenant_id: "t4",
    supplier_name: "مستودع الشرق — تجريبي",
    status: "active",
    status_label: "متابَع",
    hint: "متابَع · نشره معلَّق حالياً فلا يصلك جديد منه",
    suspended: true,
    followed_at: todayAt(7, 0),
    cancelled_at: "",
  },
];

const SUPPLIER = {
  tenant_id: "t2",
  public_name: "مخزن البركة — تجريبي",
  category_line: "مخزن بقالة",
  categories: ["سكر"],
  service_areas: ["الخرطوم بحري"],
  fulfilment: ["توصيل داخل المدينة"],
  offers_count: 1,
  badge: "verified",
  badge_label: "موثَّقة المستندات",
  since: "2026-08-03T10:00:00Z",
  badge_means: ["تحققنا من وجود هذه المنشأة ومن هوية مسؤولها بمستند سجل تجاري."],
  badge_not: ["أن بضاعته جيدة أو مطابقة للوصف — الوصف مسؤوليته لا مسؤوليتنا."],
  verified_until: "2027-08-03",
  suspended_at: "",
  facts: { confirmed_orders: 0, fulfilled: 0, partial: 0, open_disputes: 0 },
  offers: [],
};

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

test.describe("MP-05", () => {
  test("ready → stale: السعر بشروطه كاملة وتاريخ آخر تأكيد بلا حساب، والإضافة تجلب تأكيداً خادمياً، والكاش يحتاج تأكيداً", async ({
    page,
    context,
  }, info) => {
    let hits = 0;
    await page.route(/\/api\/market\/offers\/public\/o1$/, (route) => {
      hits += 1;
      return route.fulfill(json(200, { offer: OFFER() }));
    });
    await page.goto("/market/offers/public/o1");
    await expect(page.getByText("أكّده الناشر قبل 3 أيام")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "MP-05",
      state: "ready",
      texts: fromFrame("MP-05", "ready", [
        "تفاصيل عرض",
        "السعر بشروطه كاملة",
        "السعر وصلاحيته المؤكَّدة، والحد الأدنى، والوحدة بتحويلها، والجمهور، وتاريخ آخر تأكيد من الناشر.",
        "الشراء يتحقق أولاً",
      ]),
    });
    const root = page.locator('[data-screen="MP-05"]');
    await expect(root).toContainText("سكر أبيض — كرتونة 12×1كغ");
    await expect(root).toContainText("مخزن البركة — تجريبي · شارة تحقق هوية فقط، لا ضمان جودة");
    await expect(root).toContainText("أكّده الناشر قبل 3 أيام · يسري حتى 18 سبتمبر");
    await expect(root).toContainText("1,180.00");
    await expect(root).toContainText("98.33 SDG لكل كغ · قبل رسوم التوصيل");
    await expect(root).toContainText("كل المشترين");
    await expect(root).toContainText("5 كرتونة");
    await expect(root).not.toContainText("عملة حسابك");
    // الإضافة تجلب تأكيداً خادمياً قبل التثبيت (ACC-143) — لا تثبيت من الكاش
    const before = hits;
    await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
    await expect(root).toContainText("أُضيف إلى السلة بعد تأكيد خادمي");
    expect(hits).toBeGreaterThan(before);
    const cart = await page.evaluate(() => localStorage.getItem("market.cart"));
    expect(typeof cart === "string" && cart.includes('"offer_id":"o1"')).toBe(true);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "MP-05",
      state: "stale",
      texts: fromFrame("MP-05", "stale", [
        "صلاحية تحتاج تأكيداً",
        "المعروض من الكاش وصلاحيته على الحدّ.",
        "الشراء يتحقق أولاً",
        "زر الإضافة إلى السلة يجلب تأكيداً خادمياً قبل التثبيت — انتهاء عامل الجدولة عند المنصة لا يجعل المنتهي سعراً حالياً (ACC-143).",
      ]),
    });
    await context.setOffline(false);
  });

  test("expired: منتهٍ وبعملة أخرى — آخر سعر معروف لا يصلح لتأكيد، ولا تحويل ضمني، والإضافة غير متاحة (ACC-140 · ACC-143)", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/offers\/public\/o1$/, (route) =>
      route.fulfill(
        json(200, {
          offer: OFFER({
            buyer_currency: "EGP",
            currency_mismatch: true,
            valid_until: "2026-09-09",
            confirmed_until: "2026-09-09",
            expired: true,
            days_since_confirmed: 12,
          }),
        }),
      ),
    );
    await login(page, "/market/offers/public/o1", /\/market\/offers\/public\/o1$/);
    await expect(page.getByText("انتهت صلاحية السعر")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "MP-05",
      state: "expired",
      texts: fromFrame("MP-05", "expired", [
        "منتهي الصلاحية",
        "سكر أبيض — كرتونة 12×1كغ",
        "مخزن البركة — تجريبي · شارة تحقق هوية فقط، لا ضمان جودة",
        "انتهت صلاحية السعر",
        "هذا السعر لم يعد مؤكداً",
        "آخر سعر معروف",
        "ولا يصلح لتأكيد طلب.",
        "آخر سعر معروف للعبوة",
        "1,180.00",
        "SDG",
        "عملة حسابك",
        "EGP",
        "العرض بالجنيه السوداني. لا نحوّل ضمناً.",
        "ممتنع",
        "التأكيد موقوف لسببين مستقلين.",
        "السعر منتهٍ، وعملة العرض تختلف عن عملة حسابك. لن نطبّق سعر صرف من عندنا لأن أي رقم نختاره سيصبح التزاماً مالياً بينك وبين المورد لم يتفق عليه أحد. اطلب تأكيداً جديداً يشمل العملة.",
        "طلب تأكيد سعر وعملة من المورد",
        "إضافة إلى السلة — غير متاح",
      ]),
    });
    const root = page.locator('[data-screen="MP-05"]');
    await expect(root).toContainText("صلاحية العرض انتهت 09 سبتمبر");
    await expect(root).toContainText("98.33 SDG لكل كغ · قبل رسوم التوصيل");
    await expect(page.getByRole("button", { name: "إضافة إلى السلة — غير متاح" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("empty: العرض سُحب — لا نسخة قديمة، وعروض الناشر القائمة بدلها", async ({ page }, info) => {
    await page.route(/\/api\/market\/offers\/public\/o1$/, (route) =>
      route.fulfill(
        json(200, {
          offer: OFFER({
            withdrawn: true,
            others: [
              {
                id: "o9",
                seller_tenant_id: "t2",
                seller_name: "مخزن البركة — تجريبي",
                public_name: "زيت طعام",
                unit_name: "كرتونة",
                pack_label: "كرتونة 4×5ل",
                price_minor: "2450000",
                price_line: "",
                availability: "متوفر",
                confirmed_until: "2026-09-25",
                min_order_qty: 2,
              },
            ],
          }),
        }),
      ),
    );
    await page.goto("/market/offers/public/o1");
    await expectFrame(page, info, {
      screenId: "MP-05",
      state: "empty",
      texts: fromFrame("MP-05", "empty", [
        "لم يعد هذا العرض متاحاً",
        "الناشر أخفاه أو حذفه بعد أن وصل الرابط.",
        "لا نسخة قديمة",
        "عرضُ آخر نسخة محفوظة يُغري بطلبٍ على سعرٍ لم يعد قائماً.",
      ]),
    });
    const root = page.locator('[data-screen="MP-05"]');
    await expect(root).not.toContainText("1,180.00");
    await expect(root).toContainText("عروض الناشر القائمة — مخزن البركة — تجريبي");
    await expect(root).toContainText("زيت طعام");
    await expect(root).toContainText("24,500.00");
  });

  test("permission_denied: عرض شريحة لا تخصّك — رفضٌ لا يصف، الصيغة نفسها لغير الموجود (ACC-121)", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/offers\/public\/o7$/, (route) =>
      route.fulfill(json(404, { detail: "not_found" })),
    );
    await login(page, "/market/offers/public/o7", /\/market\/offers\/public\/o7$/);
    await expectFrame(page, info, {
      screenId: "MP-05",
      state: "permission_denied",
      texts: fromFrame("MP-05", "permission_denied", ["رفضٌ لا يصف"]),
    });
    const root = page.locator('[data-screen="MP-05"]');
    await expect(root).toContainText("لم يعد هذا العرض متاحاً");
    await expect(root).toContainText(
      "لا اسم ولا سعر — الصيغة نفسها لغير الموجود (ACC-60 · ACC-121).",
    );
    await expect(root).not.toContainText("سكر");
    await expect(root).not.toContainText("خاص");
  });
});

test.describe("MP-06", () => {
  test("empty → ready → success: لا متابعات، ثم متابعة من رابط الملف، ثم إلغاء يوقف التسويق ولا يمسّ أحداث الطلبات (ACC-134)", async ({
    page,
  }, info) => {
    let rows: unknown[] = [];
    const posted: string[] = [];
    await page.route(/\/api\/market\/following$/, (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { supplier_tenant_id?: string };
        posted.push(String(body.supplier_tenant_id));
        rows = ROWS;
        return route.fulfill(json(201, { follow: ROWS[0] }));
      }
      return route.fulfill(json(200, FOLLOWS(rows)));
    });
    await page.route(/\/api\/market\/following\/f1\/unfollow$/, (route) => {
      rows = [
        { ...ROWS[0], status: "cancelled", status_label: "أُلغيت", cancelled_at: todayAt(11, 20) },
        ROWS[1],
        ROWS[2],
      ];
      return route.fulfill(json(200, { follow: rows[0] }));
    });
    await login(page, "/market/following", /\/market\/following$/);
    await expectFrame(page, info, {
      screenId: "MP-06",
      state: "empty",
      texts: fromFrame("MP-06", "empty", [
        "متابعة مورد — اشتراك تسويقي مستقلّ يُلغى وحده",
        "إلغاء المتابعة يوقف رسائل المورد التسويقية ولا يمسّ أحداث طلباتك المخوَّلة: تأكيد الطلب والشحنة والمرتجع تبقى (ACC-134).",
        "لا تتابع أحداً بعد",
        "المتابعة اختيارية بالكامل — الشراء لا يشترطها، ولا نضيف موردين تلقائياً لأنك طلبت منهم مرة.",
      ]),
    });
    const root = page.locator('[data-screen="MP-06"]');
    await expect(root).not.toContainText("الموردون الذين أتابعهم");
    // رابط «تابع هذا المورد» من ملف المورد (MP-03) يصل بـ?follow= — المتابعة فعل صريح مرة واحدة ثم يُنظَّف الرابط
    await page.route(/\/api\/public\/market\/suppliers\/t2$/, (route) =>
      route.fulfill(json(200, { supplier: SUPPLIER })),
    );
    await page.route(/\/api\/public\/market\/directory(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          area: "",
          category: "",
          areas: [{ name: "الخرطوم بحري", suppliers: 1 }],
          categories: [{ name: "مواد غذائية", suppliers: 1 }],
          suppliers: [SUPPLIER],
          total: 1,
          all_areas_count: 1,
          fetched_at: new Date().toISOString(),
        }),
      ),
    );
    await navTo(page, "الدليل");
    await expect(page).toHaveURL(/\/market\/directory$/);
    await page.getByText("مخزن البركة — تجريبي").first().dblclick();
    await expect(page).toHaveURL(/\/market\/suppliers\/t2$/);
    await page.getByRole("button", { name: "تابع هذا المورد" }).click();
    await expect(page).toHaveURL(/\/market\/following$/);
    await expect(page.getByText("الموردون الذين أتابعهم —")).toBeVisible();
    expect(posted).toEqual(["t2"]);
    await expectFrame(page, info, {
      screenId: "MP-06",
      state: "ready",
      texts: fromFrame("MP-06", "ready", [
        "الموردون الذين أتابعهم —",
        "قائمة خاصة بك. لا يرى المورد قائمة من يتابعه كأسماء بل عدداً.",
        "ما يتوقّف وما يبقى بعد الإلغاء",
        "مخزن البركة للجملة — تجريبي",
        "تتلقّى جديد عروضه وتنبيهات تخفيضه",
        "متابَع",
        "شركة النيل للتوريدات — تجريبي",
        "أُلغيت المتابعة اليوم 11:20 — لا رسائل تسويقية بعد الآن",
        "أُلغيت",
        "مستودع الشرق — تجريبي",
        "متابَع · نشره معلَّق حالياً فلا يصلك جديد منه",
        "يتوقف",
        "عروضه الجديدة وتخفيضاته ورسائله التسويقية.",
        "يبقى",
        "تأكيد طلباتك معه وإشعارات الشحنات والمرتجعات — هذه أحداث طلب مخوَّلة لا تسويق.",
        "تاريخ تعاملك ومستنداتك وذمّتك. الإلغاء لا يمسّ دفتراً.",
        "قدرتك على الشراء منه في أي وقت — المتابعة ليست شرطاً للطلب.",
      ]),
    });
    await expect(root).toContainText("الموردون الذين أتابعهم — 2");
    await page.getByRole("button", { name: "إلغاء المتابعة" }).first().click();
    await expectFrame(page, info, {
      screenId: "MP-06",
      state: "success",
      texts: fromFrame("MP-06", "success", [
        "تم بنجاح",
        "توقف",
        "لم يتوقف ولن يتوقف",
        "إلغاء المتابعة قرار تسويقي. علاقتكما التجارية وسجلّها ليست إعلاناً حتى تُلغى معه.",
        "إشعارات عروضه الجديدة وتخفيضاته",
        "ظهور عروضه في قسم «متابعاتك»",
        "طلباتك السابقة معه وسجلّها كامل",
        "إشعارات الطلبات القائمة: رد، شحنة، خلاف",
        "ذمتك وذمته وكل مستند بينكما",
      ]),
    });
    await expect(root).toContainText("أُلغيت متابعة مخزن البركة للجملة — تجريبي");
    await page.getByRole("button", { name: "حسناً" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("الموردون الذين أتابعهم — 1");
    await expect(page.getByRole("button", { name: "تابع من جديد" })).toHaveCount(2);
  });

  test("permission_denied: المتابعة باسم المنشأة بصلاحية — قرار من يملك ملفها لا كل مستخدم", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/following$/, (route) =>
      route.fulfill(json(200, FOLLOWS([], { can_follow: false }))),
    );
    await login(page, "/market/following", /\/market\/following$/);
    await expectFrame(page, info, {
      screenId: "MP-06",
      state: "permission_denied",
      texts: fromFrame("MP-06", "permission_denied", [
        "المتابعة باسم المنشأة بصلاحية",
        "المتابعة اشتراك B2B يصل تسويق المورد إلى المنشأة — قرارها لمن يملك ملفها لا لكل مستخدم.",
        "الإلغاء بحدوده",
        "إلغاء المتابعة يوقف التسويق ولا يمحو أحداث الطلبات القائمة المخوَّلة (ACC-134). فعلان مختلفان لا زرّ واحد.",
      ]),
    });
    await expect(page.locator('[data-screen="MP-06"]')).not.toContainText("لا تتابع أحداً بعد");
  });
});
