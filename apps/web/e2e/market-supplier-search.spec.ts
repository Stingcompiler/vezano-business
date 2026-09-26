import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.7 — MP-03 ملف منشأة منشور (4) + MP-04 نتائج البحث والمقارنة (5): الشارة بحدودها المكتوبة،
 * حقائق لا نجوم، القسم الخاص لا يظهر أصلاً، الشارة تسقط ويبقى الملف؛ بوحدة واحدة أو لا مقارنة،
 * غير المحسوم خارج الترتيب، المنتهي للسياق.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const SUPPLIER = (o: Record<string, unknown> = {}) => ({
  tenant_id: "s1",
  public_name: "مخزن البركة — تجريبي",
  category_line: "مخزن بقالة",
  categories: ["سكر", "زيوت"],
  service_areas: ["الخرطوم بحري"],
  fulfilment: ["توصيل داخل المدينة"],
  offers_count: 41,
  badge: "verified",
  badge_label: "موثَّقة المستندات",
  since: "2026-08-03T10:00:00Z",
  badge_means: ["تحققنا من وجود هذه المنشأة ومن هوية مسؤولها بمستند سجل تجاري."],
  badge_not: [
    "أن بضاعته جيدة أو مطابقة للوصف — الوصف مسؤوليته لا مسؤوليتنا.",
    "أنه سيسلّم في الموعد. مهلة التسليم بند في اتفاقكما لا ضمان منا.",
    "أن فيزانو بلص طرف في الدفع أو ضامن لأي طلب بينكما.",
  ],
  verified_until: "2027-08-03",
  suspended_at: "",
  facts: { confirmed_orders: 12, fulfilled: 9, partial: 2, open_disputes: 1 },
  offers: [
    {
      id: "o1",
      seller_tenant_id: "s1",
      seller_name: "مخزن البركة — تجريبي",
      public_name: "زيت طعام 1 لتر",
      unit_name: "كرتونة",
      pack_label: "كرتونة = 24 عبوة",
      price_minor: "2280000",
      price_line: "",
      availability: "متوفر",
      confirmed_until: "2026-09-21",
      min_order_qty: 2,
    },
    {
      id: "o3",
      seller_tenant_id: "s1",
      seller_name: "مخزن البركة — تجريبي",
      public_name: "دقيق 5 كغ",
      unit_name: "كيس",
      pack_label: "كيس",
      price_minor: "",
      price_line: "اطلب سعراً",
      availability: "متوفر",
      confirmed_until: "",
      min_order_qty: null,
    },
  ],
  ...o,
});

const row = (o: Record<string, unknown>) => ({
  id: "r1",
  seller_tenant_id: "s1",
  seller_name: "مخزن البركة — تجريبي",
  public_name: "سكر أبيض",
  unit_name: "كرتونة",
  pack_label: "كرتونة 12×1كغ",
  price_minor: "1180000",
  price_line: "",
  availability: "متوفر",
  confirmed_until: "2026-09-18",
  min_order_qty: 5,
  unit_price_minor: "9833",
  base_unit_name: "كغ",
  fees_decided: true,
  fees_label: "توصيل داخل المنطقة مشمول",
  min_order_label: "حد أدنى 5 كراتين",
  expired: false,
  expired_yesterday: false,
  ranked: true,
  ...o,
});

const READY = {
  q: "سكر",
  area: "الخرطوم بحري",
  groups: [
    {
      label: "كرتونة",
      count: 3,
      rankable: 2,
      offers: [
        row({
          id: "a",
          seller_name: "متجر الأمان — تجريبي",
          price_minor: "4200",
          unit_price_minor: "350",
          base_unit_name: "كغ",
          fees_decided: false,
          fees_label: "رسوم النقل تُحدَّد عند الطلب — غير محسومة",
          min_order_label: "حد أدنى 5 كراتين",
          ranked: false,
          pack_label: "كرتونة",
        }),
        row({
          id: "b",
          price_minor: "8000",
          unit_price_minor: "667",
          fees_label: "توصيل مجاني فوق 500",
          min_order_label: "حد أدنى كرتونتان",
          pack_label: "كرتونة",
        }),
        row({
          id: "c",
          seller_name: "مورد الخير — تجريبي",
          public_name: "عبوة مفردة",
          price_minor: "360",
          unit_name: "عبوة",
          pack_label: "عبوة مفردة",
          unit_price_minor: "360",
          base_unit_name: "عبوة",
          fees_label: "استلام من المخزن — بلا رسوم",
          min_order_label: "بلا حد أدنى",
          pickup: true,
        }),
        row({
          id: "d",
          price_minor: "7900",
          unit_price_minor: "658",
          expired: true,
          expired_yesterday: true,
          ranked: false,
          confirmed_until: "2026-09-18",
        }),
      ],
    },
  ],
  offers_count: 3,
  suppliers_count: 3,
  multi_unit: false,
  all_areas_count: 7,
  fetched_at: new Date().toISOString(),
};

const PARTIAL = {
  ...READY,
  groups: [
    {
      label: "كرتونة 12×1كغ",
      count: 14,
      rankable: 13,
      offers: [
        row({}),
        row({
          id: "p2",
          seller_name: "متجر الأمان — تجريبي",
          unit_price_minor: "",
          fees_decided: false,
          fees_label: "التوصيل غير محسوم — يُحدَّد عند التأكيد",
          min_order_label: "حد أدنى 10",
          ranked: false,
        }),
      ],
    },
    {
      label: "كرتونة 24×500غ",
      count: 9,
      rankable: 9,
      offers: [
        row({
          id: "p3",
          pack_label: "كرتونة 24×500غ",
          unit_price_minor: "10042",
          fees_label: "توصيل 60.00 للطلب",
          min_order_label: "حد أدنى 4",
          price_minor: "1205000",
        }),
      ],
    },
    {
      label: "كيس 50كغ",
      count: 13,
      rankable: 13,
      offers: [
        row({
          id: "p4",
          seller_name: "موردون بالجملة — تجريبي",
          pack_label: "كيس 50كغ",
          unit_name: "كيس",
          unit_price_minor: "9240",
          fees_label: "الاستلام من المخزن فقط",
          min_order_label: "حد أدنى 2 أكياس",
          price_minor: "4620000",
          confirmed_until: "2026-09-09",
        }),
      ],
    },
  ],
  offers_count: 36,
  suppliers_count: 9,
  multi_unit: true,
};

async function seedArea(page: Page, area: string) {
  await page.addInitScript((a) => localStorage.setItem("market.area", a), area);
}

test.describe("MP-03", () => {
  test("loading → ready → permission_denied: الشارة بحدودها والحقائق والعروض؛ رابط قائمة خاصة لا يُظهر قسماً ولا تلميحاً", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route("**/api/public/market/suppliers/s1", async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, { supplier: SUPPLIER() }));
    });
    await page.route("**/api/market/lists/l9", (route) =>
      route.fulfill(json(404, { detail: "not_found" })),
    );
    await page.goto("/market/suppliers/s1");
    await expectFrame(page, info, {
      screenId: "MP-03",
      state: "loading",
      texts: fromFrame("MP-03", "loading", ["جلب الملف", "الهوية والشارة أولاً ثم العروض."]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "MP-03",
      state: "ready",
      texts: fromFrame("MP-03", "ready", [
        "مخزن البركة — تجريبي",
        "هوية متحققة",
        "ينشر منذ أغسطس",
        "تابع هذا المورد",
        "المتابعة اشتراك B2B باسم منشأتك — تحتاج حساباً وصلاحية",
        "والعروض أعلاه تُرى بلا حساب.",
        "ماذا تعني «هوية متحققة» وماذا لا تعني",
        "نص الحدود ليس تنويهاً صغيراً: هو أهم سطر في الصفحة، فمن يقرأه يبني عليه قراراً مالياً.",
        "تعني",
        "تحققنا من وجود هذه المنشأة ومن هوية مسؤولها بمستند سجل تجاري.",
        "لا تعني",
        "أن بضاعته جيدة أو مطابقة للوصف — الوصف مسؤوليته لا مسؤوليتنا.",
        "أنه سيسلّم في الموعد. مهلة التسليم بند في اتفاقكما لا ضمان منا.",
        "أن فيزانو",
        "طرف في الدفع أو ضامن لأي طلب بينكما.",
        "حقائق قابلة للتحقق — لا تقييم نجوم",
        "لا تقييم بالنجوم في الإصدار الأول: رقم واحد من مراجعات قليلة يُفسد سمعة مورد أو يزيّنها بلا أساس. الحقائق أعلاه تُحتسب من طلبات فعلية مؤكدة من طرفين.",
        "طلبات مؤكدة من طرفين",
        "نُفِّذت كاملة",
        "نُفِّذت جزئياً",
        "خلافات مفتوحة الآن",
        "زيت طعام 1 لتر",
        "كرتونة = 24 عبوة",
        "مؤكَّد حتى 21 سبتمبر",
        "دقيق 5 كغ",
        "اطلب سعراً",
        "متوفر — بسعرٍ عند الطلب",
      ]),
    });
    await page.goto("/market/suppliers/s1?list=l9");
    await expectFrame(page, info, {
      screenId: "MP-03",
      state: "permission_denied",
      texts: fromFrame("MP-03", "permission_denied", ["مخزن البركة — تجريبي", "هوية متحققة"]),
    });
    await expect(page.getByText("محتوى خاص")).toHaveCount(0);
    await expect(page.getByText("محجوب")).toHaveCount(0);
  });

  test("expired: تسقط الشارة ويبقى الملف — «التحقق منتهٍ منذ …»", async ({ page }, info) => {
    await page.route("**/api/public/market/suppliers/s1", (route) =>
      route.fulfill(
        json(200, {
          supplier: SUPPLIER({
            badge: "expired",
            badge_label: "التحقق منتهٍ",
            verified_until: "2026-09-01",
          }),
        }),
      ),
    );
    await page.goto("/market/suppliers/s1");
    await expectFrame(page, info, {
      screenId: "MP-03",
      state: "expired",
      texts: fromFrame("MP-03", "expired", [
        "تحقق منتهٍ أو منشأة معلَّقة",
        "الشارة سقطت أو النشر عُلِّق.",
        "الشارة بحدودها",
        "تسقط الشارة ويبقى الملف:",
        "التحقق منتهٍ منذ",
        "لا محو ولا إخفاء صامت. والمعلَّقة يُمنع جديدها ويبقى سابقها للاطلاع",
        "مخزن البركة — تجريبي",
        "زيت طعام 1 لتر",
      ]),
    });
  });
});

test.describe("MP-04", () => {
  test("loading → ready → empty → stale: الترتيب بسعر العبوة، غير المحسوم مسمّى، المنتهي للسياق، والتوسيع بعدده", async ({
    page,
    context,
  }, info) => {
    await seedArea(page, "الخرطوم بحري");
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/public\/market\/search(\?.*)?$/, async (route) => {
      if (!released) await held;
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      return route.fulfill(
        json(
          200,
          q === "زعفران"
            ? { ...READY, q, groups: [], offers_count: 0, suppliers_count: 0, all_areas_count: 7 }
            : READY,
        ),
      );
    });
    await page.goto("/market/search?q=سكر");
    await expectFrame(page, info, {
      screenId: "MP-04",
      state: "loading",
      texts: fromFrame("MP-04", "loading", [
        "النتائج تُجمع",
        "العدّ والمرشّحات أولاً، والعروض تلحق — ولا يُعرض ترتيبٌ قبل اكتمال ما سيُرتَّب.",
        "لا ترتيب جزئي",
        "«الأوفر» من نصف النتائج ادعاءٌ يتغيّر بعد ثانية. الترتيب يُعلن مكتملاً أو لا يُعلن.",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "MP-04",
      state: "ready",
      texts: fromFrame("MP-04", "ready", [
        "الترتيب: سعر العبوة الواحدة",
        "المورد والعرض",
        "الرسوم والتوصيل",
        "42.00",
        "رسوم النقل تُحدَّد عند الطلب — غير محسومة · حد أدنى 5 كراتين",
        "80.00",
        "توصيل مجاني فوق 500 · حد أدنى كرتونتان",
        "عبوة مفردة",
        "3.60",
        "استلام من المخزن — بلا رسوم · بلا حد أدنى",
        "انتهى أمس — خارج الترتيب، معروض للسياق",
        "والسعر المعروض من آخر تأكيد خادمي — والمنتهي لا يدخل الترتيب أصلاً.",
      ]),
    });
    await page.getByLabel("ابحث عن صنف أو مورد").fill("زعفران");
    await expectFrame(page, info, {
      screenId: "MP-04",
      state: "empty",
      texts: fromFrame("MP-04", "empty", [
        "لا عروض مطابقة",
        "الصنف غير معروض في منطقتك أو الفئة أضيق من اللازم.",
        "التوسيع بعدده",
        "أزرار بأثر معدود لا نصيحة عامة.",
      ]),
    });
    await expect(page.getByRole("button", { name: "كل المناطق (7 عروض)" })).toBeVisible();
    await page.getByLabel("ابحث عن صنف أو مورد").fill("سكر");
    await expect(page.locator('[data-screen="MP-04"]')).toHaveAttribute("data-state", "ready");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "MP-04",
      state: "stale",
      texts: fromFrame("MP-04", "stale", [
        "نتائج من آخر جلب",
        "الاتصال تقطّع بعد البحث.",
        "المنتهي يسقط أولاً",
        "كل عرض تجاوزت صلاحيتُه وقتَ الكاش يُستبعد من الترتيب فوراً — نعرض أقلّ ولا نعرض ميتاً",
      ]),
    });
    await context.setOffline(false);
  });

  test("partial: ثلاث وحدات مختلفة فلا يوجد «الأرخص» — الترتيب داخل كل مجموعة، وقبل الرسوم خارج الترتيب", async ({
    page,
  }, info) => {
    await seedArea(page, "الخرطوم — بحري");
    await page.route(/\/api\/public\/market\/search(\?.*)?$/, (route) =>
      route.fulfill(json(200, PARTIAL)),
    );
    await page.goto("/market/search?q=سكر");
    await expectFrame(page, info, {
      screenId: "MP-04",
      state: "partial",
      texts: fromFrame("MP-04", "partial", [
        "نتائج البحث والمقارنة — لا «الأرخص» عند اختلاف الوحدة",
        "الخرطوم — بحري",
        "36 عرضاً منشوراً من 9 موردين",
        "ترتيب موقوف",
        "نتائجك بثلاث وحدات مختلفة، فلا يوجد «الأرخص».",
        "كرتونة 12×1كغ وكرتونة 24×500غ وكيس 50كغ لا تُقارن برقم واحد، والرسوم غير محسومة في بعض العروض. الترتيب بسعر الوحدة متاح داخل كل مجموعة وحدة على حدة.",
        "سعر الوحدة",
        "سعر العبوة",
        "الرسوم والتوصيل",
        "تأكيد السعر",
        "كرتونة 12×1كغ",
        "14 عرضاً · قابلة للترتيب",
        "98.33",
        "توصيل داخل المنطقة مشمول",
        "متجر الأمان — تجريبي",
        "حد أدنى 10",
        "قبل الرسوم",
        "التوصيل غير محسوم — يُحدَّد عند التأكيد",
        "خارج الترتيب",
        "كرتونة 24×500غ",
        "100.42",
        "توصيل 60.00 للطلب",
        "كيس 50كغ",
        "موردون بالجملة — تجريبي",
        "حد أدنى 2 أكياس",
        "92.40",
        "الاستلام من المخزن فقط",
        "مؤكد خادمياً حتى 09 سبتمبر",
        "سعر الوحدة للعروض ذات الرسوم غير المحسومة يظهر بعلامة «قبل الرسوم» ولا يدخل الترتيب. تحويل 500غ إلى كغ حساب صريح نعرضه؛ تحويل «كرتونة» إلى «كيس» ليس تحويلاً بل تخمين تغليف ولن نفعله.",
      ]),
    });
  });
});
