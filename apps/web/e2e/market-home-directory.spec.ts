import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.6 — MP-01 رئيسية السوق (5) + MP-02 دليل المخازن والمتاجر (4): بلا حساب؛ لا تسجيل قبل
 * القيمة؛ الخاص يبقى خاصاً؛ منطقة بلا موردين فارغة صادقة؛ السوق يحتاج اتصالاً؛ الدليل بالخدمة
 * لا بالعنوان الخاص؛ المتقادم بوقته.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const SUPPLIERS = [
  {
    tenant_id: "s1",
    public_name: "مخازن النور",
    category_line: "مخزن بقالة",
    categories: ["سكر", "زيوت"],
    service_areas: ["المدينة الصناعية"],
    fulfilment: ["توصيل داخل المدينة"],
    offers_count: 14,
    badge: "verified",
    badge_label: "موثَّقة المستندات",
  },
  {
    tenant_id: "s2",
    public_name: "مخزن البركة — تجريبي",
    category_line: "بقالة",
    categories: ["سكر", "شاي"],
    service_areas: ["المدينة الصناعية"],
    fulfilment: ["استلام من المخزن"],
    offers_count: 6,
    badge: "verified",
    badge_label: "موثَّقة المستندات",
  },
  {
    tenant_id: "s3",
    public_name: "مورد الخير — تجريبي",
    category_line: "مشروبات",
    categories: ["مشروبات"],
    service_areas: ["المدينة الصناعية"],
    fulfilment: ["توصيل بأجر"],
    offers_count: 3,
    badge: "none",
    badge_label: "بلا شارة",
  },
];

const HOME = (o: Record<string, unknown> = {}) => ({
  area: "المدينة الصناعية",
  areas: [
    { name: "المدينة الصناعية", suppliers: 3 },
    { name: "الخرطوم بحري", suppliers: 9 },
    { name: "سنّار", suppliers: 0 },
  ],
  q: "",
  suppliers: SUPPLIERS,
  offers_by_unit: [
    {
      unit_name: "كرتونة",
      offers: [
        {
          id: "o1",
          seller_tenant_id: "s1",
          seller_name: "مخازن النور",
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
          id: "o2",
          seller_tenant_id: "s2",
          seller_name: "مخزن البركة — تجريبي",
          public_name: "سكر أبيض",
          unit_name: "كرتونة",
          pack_label: "كرتونة = 12 كغ",
          price_minor: "1180000",
          price_line: "",
          availability: "متوفر",
          confirmed_until: "2026-09-18",
          min_order_qty: 5,
        },
      ],
    },
    {
      unit_name: "كيس",
      offers: [
        {
          id: "o3",
          seller_tenant_id: "s1",
          seller_name: "مخازن النور",
          public_name: "دقيق 5 كغ",
          unit_name: "كيس",
          pack_label: "كيس",
          price_minor: "",
          price_line: "اطلب سعراً",
          availability: "متوفر",
          confirmed_until: "2026-09-25",
          min_order_qty: null,
        },
      ],
    },
  ],
  offers_count: 23,
  suppliers_count: 3,
  fetched_at: new Date().toISOString(),
  ...o,
});

const DIR = (o: Record<string, unknown> = {}) => ({
  area: "الخرطوم بحري",
  category: "",
  areas: [
    { name: "الخرطوم بحري", suppliers: 9 },
    { name: "أم درمان", suppliers: 2 },
  ],
  categories: [
    { name: "مواد غذائية", suppliers: 5 },
    { name: "منظّفات", suppliers: 2 },
  ],
  suppliers: [
    {
      tenant_id: "d1",
      public_name: "مخزن البركة للجملة — تجريبي",
      category_line: "جملة",
      categories: ["سكر", "شاي", "زيوت", "دقيق"],
      service_areas: ["بحري", "الخرطوم"],
      fulfilment: ["توصيل بحدّ أدنى", "استلام من المخزن"],
      offers_count: 36,
      badge: "verified",
      badge_label: "موثَّقة المستندات",
    },
    {
      tenant_id: "d2",
      public_name: "شركة النيل للتوريدات — تجريبي",
      category_line: "توريد",
      categories: ["معلّبات", "منظّفات"],
      service_areas: ["الخرطوم فقط"],
      fulfilment: ["توصيل يومين عمل"],
      offers_count: 12,
      badge: "none",
      badge_label: "بلا شارة",
    },
    {
      tenant_id: "d3",
      public_name: "مستودع الشرق — تجريبي",
      category_line: "تجارة عامة",
      categories: ["دقيق", "أرز"],
      service_areas: ["أم درمان", "بحري"],
      fulfilment: ["استلام فقط"],
      offers_count: 4,
      badge: "none",
      badge_label: "بلا شارة",
    },
    {
      tenant_id: "d4",
      public_name: "تجارة عامة — تجريبي",
      category_line: "تجزئة وجملة",
      categories: ["متنوّع"],
      service_areas: ["بحري"],
      fulfilment: ["استلام فقط"],
      offers_count: 2,
      badge: "none",
      badge_label: "بلا شارة",
    },
  ],
  total: 9,
  alternatives: { all_areas: 12, all_categories: 9, everything: 12 },
  fetched_at: new Date().toISOString(),
  ...o,
});

async function seedArea(page: Page, area: string) {
  await page.addInitScript((a) => localStorage.setItem("market.area", a), area);
}

test.describe("MP-01", () => {
  test("loading → ready → empty: بلا حساب، الموردون بشاراتهم والعروض بوحدتها، ثم منطقة بلا موردين", async ({
    page,
  }, info) => {
    await seedArea(page, "المدينة الصناعية");
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/public\/market(\?.*)?$/, async (route) => {
      if (!released) await held;
      const url = new URL(route.request().url());
      const area = url.searchParams.get("area") ?? "";
      return route.fulfill(
        json(
          200,
          area === "سنّار"
            ? HOME({
                area,
                suppliers: [],
                offers_by_unit: [],
                offers_count: 0,
                suppliers_count: 0,
                areas: [
                  { name: "المدينة الصناعية", suppliers: 3 },
                  { name: "سنّار", suppliers: 0 },
                ],
              })
            : HOME(),
        ),
      );
    });
    await page.goto("/market");
    await expectFrame(page, info, {
      screenId: "MP-01",
      state: "loading",
      texts: fromFrame("MP-01", "loading", [
        "العروض تَرِد",
        "الهيكل والفئات فوراً، والعروض المنشورة تلحق. لا يُعرض إلا المنشور المؤكَّد.",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "MP-01",
      state: "ready",
      texts: fromFrame("MP-01", "ready", [
        "السوق",
        "بدِّلها",
        "بحثٌ بالاسم أو الصنف",
        "ابحث عن صنف أو مورد",
        "مخازن النور",
        "متحقَّقة",
        "مخزن البركة — تجريبي",
        "بقالة · استلام من المخزن",
        "مورد الخير — تجريبي",
        "مشروبات · توصيل بأجر",
        "بلا شارة",
        "زيت طعام 1 لتر",
        "كرتونة = 24 عبوة",
        "مؤكَّد حتى 21 سبتمبر",
        "سكر أبيض",
        "كرتونة = 12 كغ",
        "مؤكَّد حتى 18 سبتمبر",
        "دقيق 5 كغ",
        "كيس",
        "اطلب سعراً",
        "متوفر — بسعرٍ عند الطلب",
        "الترتيب داخل كل وحدة على حدة — لا «الأرخص» عبر وحدات مختلفة.",
        "أنشئ حساب سوق مجاناً",
        "حساب السوق مجاني ولا يشترط شراء POS (§١٤.٦) — ولا يُحتسب اشتراك إدارة مدفوعاً.",
        "الخاص يبقى خاصاً",
        "لا سعر شريحة ولا قائمة خاصة في أي عرضٍ عام، ولو فُتح الرابط من هاتف مشترٍ مخوَّل (ACC-150 · ACC-121).",
      ]),
    });
    await expect(page.getByText("22,800.00")).toBeVisible();
    await page.getByRole("button", { name: "بدِّلها" }).click();
    await page.getByRole("button", { name: /^سنّار/ }).click();
    await expectFrame(page, info, {
      screenId: "MP-01",
      state: "empty",
      texts: fromFrame("MP-01", "empty", [
        "لا موردين ينشرون في سنّار بعد",
        "هذه حقيقة عن السوق لا خطأ في بحثك ولا عطل عندنا. السوق يُبنى منطقة منطقة، ومنطقتك لم يصلها مورد ناشر حتى الآن.",
        "لن نعرض لك موردي الخرطوم كأنهم خيار: التوصيل خارج منطقتهم ليس منشوراً، وعرض ما لا يُنفَّذ إهدار لوقتك.",
        "اطلب من مورد تعرفه أن ينشر",
        "رابط دعوة تُرسله بنفسك. لن ندعو أحداً باسمك ولن ننشئ له ملفاً — ACC-118.",
        "أبلغنا بالمنطقة لنعرف أين نعمل",
        "طلبك يُحتسب في تخطيط التوسّع ولا يُترجم وعداً بموعد.",
        "سجّل مورديك في دفترك المحلي",
        "PTY-02 يعمل بلا سوق: ذمم وطلبات ومستندات بينك وبينهم بلا حاجة إلى وجودهم هنا.",
      ]),
    });
  });

  test("stale → offline: عروض من آخر جلب بوقتها حين ينقطع الاتصال، ولا كاش = السوق يحتاج اتصالاً", async ({
    page,
    context,
  }, info) => {
    await seedArea(page, "المدينة الصناعية");
    await page.route(/\/api\/public\/market(\?.*)?$/, (route) => route.fulfill(json(200, HOME())));
    await page.goto("/market");
    await expect(page.locator('[data-screen="MP-01"]')).toHaveAttribute("data-state", "ready");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "MP-01",
      state: "stale",
      texts: fromFrame("MP-01", "stale", [
        "عروض من آخر جلب",
        "الاتصال متقطع والمعروض من الكاش",
        "الصلاحية مع كل عرض",
        "عرضٌ انتهت صلاحيته في الكاش يسقط من العرض ولا يُعرض بسعره القديم — التأكيد الخادمي وحده يجعل السعر حالياً (ACC-143).",
        "مخازن النور",
      ]),
    });
    await context.setOffline(false);
    // بلا كاش: صفحة جديدة بلا لقطة
    const fresh = await context.newPage();
    await fresh.addInitScript(() => localStorage.clear());
    await fresh.route(/\/api\/public\/market(\?.*)?$/, (route) =>
      route.abort("internetdisconnected"),
    );
    await fresh.goto("/market");
    await expect(fresh.locator('[data-screen="MP-01"]')).toHaveAttribute("data-state", "loading");
    await fresh.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      window.dispatchEvent(new Event("offline"));
    });
    await expectFrame(fresh, info, {
      screenId: "MP-01",
      state: "offline",
      texts: fromFrame("MP-01", "offline", [
        "السوق يحتاج اتصالاً",
        "بخلاف POS — أسعار الآخرين لا تُخزَّن صادقةً على جهازك.",
        "نقولها ونحفظ العمل",
        "«السوق يعمل بالاتصال» مع ما يبقى متاحاً: مسودات سلتك (ORD-01) وطلباتك المحفوظة. صفحةٌ بيضاء تُقرأ عطلاً في التطبيق كله.",
      ]),
    });
  });
});

test.describe("MP-02", () => {
  test("loading → ready → empty → stale: الدليل بالخدمة، لا منشآت بأزرار تحمل أثرها، والمتقادم بوقته", async ({
    page,
    context,
  }, info) => {
    await seedArea(page, "الخرطوم بحري");
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/public\/market\/directory(\?.*)?$/, async (route) => {
      if (!released) await held;
      const url = new URL(route.request().url());
      const cat = url.searchParams.get("category") ?? "";
      return route.fulfill(
        json(200, cat ? DIR({ category: cat, suppliers: [], total: 0 }) : DIR()),
      );
    });
    await page.goto("/market/directory");
    await expectFrame(page, info, {
      screenId: "MP-02",
      state: "loading",
      texts: fromFrame("MP-02", "loading", [
        "جلب الدليل",
        "بالمنطقة والفئة المختارتين، وعدّاد النتائج يظهر أولاً.",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "MP-02",
      state: "ready",
      texts: fromFrame("MP-02", "ready", [
        "دليل المخازن والمتاجر — تصفية بالخدمة لا بالعنوان الخاص",
        "المشتري يبحث بمن يخدم منطقته وفئته. لا نعرض عنوان منشأة ولا هاتفها في الدليل — ذلك بيانها هي تُفصح عنه في ملفها متى شاءت.",
        "الدليل — 9 منشآت تخدم منطقتك",
        "المنشأة",
        "الفئات",
        "مناطق الخدمة وطريقة التنفيذ",
        "عروض منشورة",
        "الحالة",
        "مخزن البركة للجملة — تجريبي",
        "جملة",
        "سكر · شاي · زيوت · دقيق",
        "بحري والخرطوم · توصيل بحدّ أدنى، أو استلام من المخزن",
        "موثَّقة المستندات",
        "شركة النيل للتوريدات — تجريبي",
        "توريد",
        "معلّبات · منظّفات",
        "الخرطوم فقط · توصيل يومين عمل",
        "مستودع الشرق — تجريبي",
        "دقيق · أرز",
        "أم درمان وبحري · استلام فقط",
        "تجارة عامة — تجريبي",
        "تجزئة وجملة",
        "متنوّع",
        "بحري · استلام فقط",
        "مواد غذائية",
      ]),
    });
    await page.getByRole("button", { name: /^منظّفات/ }).click();
    await expectFrame(page, info, {
      screenId: "MP-02",
      state: "empty",
      texts: fromFrame("MP-02", "empty", [
        "لا منشآت",
        "لا مخازن في هذه الفئة بمنطقتك",
        "المخرج المعروض",
        "وسّع المنطقة أو الفئة — بأزرار تحمل أثرها",
      ]),
    });
    await expect(page.getByRole("button", { name: /كل المناطق \(12 نتيجة\)/ })).toBeVisible();
    await page.getByRole("button", { name: /كل الفئات/ }).click();
    await expect(page.locator('[data-screen="MP-02"]')).toHaveAttribute("data-state", "ready");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "MP-02",
      state: "stale",
      texts: fromFrame("MP-02", "stale", [
        "متقادم",
        "قائمة الدليل محفوظة على جهازك من قبل",
        "نعرض الوقت ولا نُظهرها كأنها لحظية",
        "عدد العروض ليس سعراً مؤكَّداً — التأكيد في MP-05 وحده.",
        "مخزن البركة للجملة — تجريبي",
      ]),
    });
    await context.setOffline(false);
  });
});
