import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T3.4 — MP-10 عروض البائع الداخلية (4) + MP-11 إنشاء عرض ونشره (5): أربع حالات لا حالتان؛
 * لا زرّ «نشر كل المخزون»؛ النقص مسمّى (وحدة وحدّ أدنى)؛ التحرير غير النشر؛ الصلاحية تبدأ الآن.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const offer = (o: Record<string, unknown>) => ({
  id: "o1",
  item_id: "i1",
  public_name: "سكر أبيض",
  description: "",
  unit_code: "carton",
  unit_name: "كرتونة",
  pack_label: "كرتونة 12×1كغ",
  price_minor: "1150000",
  min_order_qty: 5,
  max_order_qty: null,
  fulfilment_note: "توصيل داخل المنطقة",
  audience: "public",
  audience_label: "كل المشترين",
  valid_until: "2026-09-19",
  status: "published",
  status_label: "منشور",
  meaning: "يظهر في البحث وسعره مؤكَّد حتى 19/09.",
  missing: [],
  ...o,
});

const OFFERS = [
  offer({}),
  offer({
    id: "o2",
    public_name: "شاي أسود",
    pack_label: "كرتونة 24×250غ",
    price_minor: "",
    audience: "private",
    audience_label: "قائمة خاصة — 6 مشترين",
    status_label: "منشور — جمهور محدَّد",
    meaning: "لا يظهر في البحث العام. من ليس في القائمة لا يعرف بوجوده.",
  }),
  offer({
    id: "o3",
    public_name: "زيت طعام",
    pack_label: "كرتونة 4×5ل",
    price_minor: "980000",
    valid_until: "2026-09-09",
    status: "expired",
    status_label: "منتهٍ",
    meaning:
      "انتهت الصلاحية 09/09. لا يظهر للمشتري كسعر، ويحتاج تجديد تأكيد (MP-13) — ولا يتجدّد بتعديل الوصف.",
  }),
  offer({
    id: "o4",
    public_name: "دقيق",
    pack_label: "كيس 50كغ",
    price_minor: "",
    status: "hidden",
    status_label: "مخفي",
    meaning: "أخفيته بنفسك لنقص التوفّر. محفوظ كاملاً وتُعيد نشره بضغطة — الإخفاء ليس حذفاً.",
  }),
];

const LIST = (o: Record<string, unknown> = {}) => ({
  offers: OFFERS,
  counts: { published: 14, draft: 5, expired: 3, hidden: 2 },
  total: 24,
  expiring_this_week: 2,
  can_edit: true,
  can_publish: true,
  seller_verified: true,
  plan_allows: true,
  ...o,
});

const ITEMS = [
  {
    id: "i1",
    name: "سكر أبيض",
    base_unit_code: "kg",
    base_unit_name: "كغ",
    units: [{ code: "carton", name: "كرتونة", factor_milli: "12000" }],
  },
];

const preview = (body: Record<string, string>, canPublish = true) => {
  const missing = [];
  if (!body.unit_code)
    missing.push({
      key: "unit",
      title: "وحدة البيع والعبوة",
      hint: "مطلوب — بدونها لا تظهر البطاقة في المقارنة",
    });
  if (!body.min_order_qty)
    missing.push({
      key: "min_order",
      title: "حد أدنى للطلب",
      hint: "مطلوب — يحدد ما تستطيع تنفيذه فعلاً",
    });
  const pub = body.audience === "public" && body.price_minor;
  return {
    card: {
      title: body.pack_label ? `${body.public_name} — ${body.pack_label}` : body.public_name,
      seller_line: `مخزن البركة — تجريبي · الخرطوم بحري · ${body.fulfilment_note || "توصيل داخل المنطقة"}`,
      price_minor: pub ? body.price_minor : "",
      price_line:
        body.price_minor && !pub
          ? "السعر للمشترين المخوَّلين · اطلب تأكيد سعر"
          : body.price_minor
            ? ""
            : "اطلب تأكيد سعر",
    },
    published_fields: [
      {
        title: "الاسم والصنف والوصف المصرَّح به",
        hint: "نص منفصل عن اسمك الداخلي — تعدّله للسوق دون تغيير بطاقتك",
      },
      { title: "المنطقة وطريقة التنفيذ", hint: "توصيل داخل المنطقة أو استلام من المخزن" },
    ],
    missing,
    hidden_fields: [
      {
        title: "رصيد المخزون الفعلي",
        hint: "لا يُنشر أبداً. تعرض «متوفر» أو «حد أقصى للطلب» وليس الكمية",
      },
      { title: "تكلفة الشراء وهامشك", hint: "لا يُنشر أبداً ولا يدخل أي حساب معروض للمشتري" },
    ],
    can_publish: canPublish,
    seller_verified: true,
    plan_allows: true,
  };
};

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

test.describe("MP-10", () => {
  test("loading → ready → expired → empty: أربع حالات بمعناها للمشتري، والمنتهي وحده، ولا عروض", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    let empty = false;
    await page.route(/\/api\/market\/offers$/, async (route) => {
      if (!released) await held;
      return route.fulfill(
        json(
          200,
          empty
            ? LIST({
                offers: [],
                counts: { published: 0, draft: 0, expired: 0, hidden: 0 },
                total: 0,
                expiring_this_week: 0,
              })
            : LIST(),
        ),
      );
    });
    await login(page, "/market/offers");
    await expectFrame(page, info, {
      screenId: "MP-10",
      state: "loading",
      texts: fromFrame("MP-10", "loading", [
        "جلب عروضك",
        "مع عدد ما تنتهي صلاحيته هذا الأسبوع — وهو سبب فتح الشاشة، والترتيب به لا بتاريخ النشر.",
        "الانتهاء هو العمل",
        "عرضٌ منتهٍ يختفي من نتائج المشترين بصمت. العدّاد يجعل الفقد المؤجَّل مرئياً قبل وقوعه (MP-13).",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "MP-10",
      state: "ready",
      texts: fromFrame("MP-10", "ready", [
        "عروض البائع الداخلية — أربع حالات لا حالتان",
        "منشور، مسودة، منتهٍ، مخفي. «المخفي» ليس محذوفاً و«المنتهي» ليس مخفياً — والخلط بينها يجعل البائع يظنّ عرضاً يبيع وهو لا يظهر لأحد.",
        "عروضي — 24",
        "العرض",
        "السعر والوحدة",
        "الجمهور",
        "الحالة ومعناها للمشتري",
        "لا زرّ «نشر كل المخزون».",
        "النشر اختيار صنف صنف مع جمهوره وسعره وصلاحيته (MP-11). من ينشر ٦٤٠ صنفاً بضغطة يكشف كلفته وتوفّره لمنافسيه بلا أن يقصد.",
        "منشور — 14",
        "مسودة — 5",
        "منتهٍ — 3",
        "مخفي — 2",
        "سكر أبيض",
        "كرتونة 12×1كغ",
        "كل المشترين",
        "يظهر في البحث وسعره مؤكَّد حتى 19/09.",
        "شاي أسود",
        "كرتونة 24×250غ",
        "قائمة خاصة — 6 مشترين",
        "لا يظهر في البحث العام. من ليس في القائمة لا يعرف بوجوده.",
        "منشور — جمهور محدَّد",
        "زيت طعام",
        "كرتونة 4×5ل",
        "انتهت الصلاحية 09/09. لا يظهر للمشتري كسعر، ويحتاج تجديد تأكيد (MP-13) — ولا يتجدّد بتعديل الوصف.",
        "دقيق",
        "كيس 50كغ",
        "أخفيته بنفسك لنقص التوفّر. محفوظ كاملاً وتُعيد نشره بضغطة — الإخفاء ليس حذفاً.",
      ]),
    });
    await page.getByRole("button", { name: /^منتهٍ/ }).click();
    await expectFrame(page, info, {
      screenId: "MP-10",
      state: "expired",
      texts: fromFrame("MP-10", "expired", [
        "زيت طعام",
        "انتهت الصلاحية 09/09. لا يظهر للمشتري كسعر، ويحتاج تجديد تأكيد (MP-13) — ولا يتجدّد بتعديل الوصف.",
        "منتهٍ",
      ]),
    });
    await expect(page.getByText("سكر أبيض")).toHaveCount(0);
    empty = true;
    await page.route("**/api/market/profile", (route) =>
      route.fulfill(json(200, { profile: null })),
    );
    await navTo(page, "صفحة المنشأة");
    await expect(page).toHaveURL(/\/market\/profile$/);
    await navTo(page, "عروضي");
    await expect(page).toHaveURL(/\/market\/offers$/);
    await expectFrame(page, info, {
      screenId: "MP-10",
      state: "empty",
      texts: fromFrame("MP-10", "empty", [
        "النشر اختيار صنف صنف مع جمهوره وسعره وصلاحيته (MP-11).",
      ]),
    });
    await expect(page.getByText("لا عروض بعد")).toBeVisible();
    await expect(page.getByText("عروضي — 0")).toBeVisible();
  });
});

test.describe("MP-11", () => {
  test("ready → validation_error → saving → success: صنف يُختار، حقلان ناقصان يمنعان النشر، ثم نُشر بصلاحية تبدأ الآن", async ({
    page,
  }, info) => {
    await page.route("**/api/catalog/items", (route) => route.fulfill(json(200, { items: ITEMS })));
    await page.route("**/api/catalog/items?**", (route) =>
      route.fulfill(json(200, { items: ITEMS })),
    );
    await page.route("**/api/market/offers/preview", (route) =>
      route.fulfill(json(200, preview(route.request().postDataJSON() as Record<string, string>))),
    );
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\/api\/market\/offers$/, async (route) => {
      if (route.request().method() !== "POST") return route.fulfill(json(200, LIST()));
      await held;
      const b = route.request().postDataJSON() as Record<string, string>;
      return route.fulfill(
        json(201, { offer: offer({ public_name: b.public_name, status: "published" }) }),
      );
    });
    await login(page, "/market/offers/new");
    await expectFrame(page, info, {
      screenId: "MP-11",
      state: "ready",
      texts: fromFrame("MP-11", "ready", [
        "صنف يُختار لا مخزون يُنشر",
        "العرض يبدأ باختيار صنفٍ من كتالوجك، وتُعرض قائمة الحقول التي ستُنشر منه حرفياً.",
        "لا نشر كل المخزون",
        "زرّ «انشر الكتالوج كله» غير موجود عمداً — النشر قرارٌ صنفاً صنفاً بسعرٍ مقصود (ACC-120). والرصيد الداخلي لا يُنشر أبداً.",
      ]),
    });
    await page.getByLabel("الصنف من كتالوجك").selectOption("i1");
    await page.getByLabel("السعر للوحدة").fill("11500");
    await page.getByLabel("المنطقة وطريقة التنفيذ").fill("توصيل داخل المنطقة");
    await page.getByLabel("قائمة خاصة — مشترون مخوَّلون").check();
    await expect(page.getByRole("heading", { name: "عرض جديد — سكر أبيض" })).toBeVisible();
    await page.getByRole("button", { name: /^نشر — حقلان ناقصان/ }).click();
    await expectFrame(page, info, {
      screenId: "MP-11",
      state: "validation_error",
      texts: fromFrame("MP-11", "validation_error", [
        "إنشاء عرض — النشر اختيار حقول لا تصدير مخزون",
        "عرض جديد — سكر أبيض",
        "ما يُنشر من بطاقة الصنف الداخلية",
        "حقلان ناقصان يمنعان النشر",
        "بدونهما يصل المشتري إلى سلة لا يعرف فيها ما يشتري، ويصل إليك طلب لا تستطيع تنفيذه.",
        "الجمهور",
        "معاينة عامة.",
        "ما يراه غير المدعوّ: الصنف والوحدة والمنطقة وشروط الخدمة. لا يرى سعرك الخاص ولا اسم المشتري المخوَّل ولا رصيد مخزونك.",
        "معاينة البطاقة العامة",
        "مخزن البركة — تجريبي · الخرطوم بحري · توصيل داخل المنطقة",
        "السعر للمشترين المخوَّلين · اطلب تأكيد سعر",
        "نشر — حقلان ناقصان",
        "حفظ كمسودة",
        "يُنشر",
        "الاسم والصنف والوصف المصرَّح به",
        "نص منفصل عن اسمك الداخلي — تعدّله للسوق دون تغيير بطاقتك",
        "المنطقة وطريقة التنفيذ",
        "توصيل داخل المنطقة أو استلام من المخزن",
        "ناقص",
        "وحدة البيع والعبوة",
        "مطلوب — بدونها لا تظهر البطاقة في المقارنة",
        "حد أدنى للطلب",
        "مطلوب — يحدد ما تستطيع تنفيذه فعلاً",
        "محجوب",
        "رصيد المخزون الفعلي",
        "لا يُنشر أبداً. تعرض «متوفر» أو «حد أقصى للطلب» وليس الكمية",
        "تكلفة الشراء وهامشك",
        "لا يُنشر أبداً ولا يدخل أي حساب معروض للمشتري",
        "عام — كل من يبحث في السوق",
        "السعر يظهر فقط إن اخترت سعراً عاماً. غير ذلك يظهر «اطلب تأكيد سعر».",
        "قائمة خاصة — مشترون مخوَّلون",
        "ACC-121: منشأة ثالثة لا ترى هذا السعر ولا تعرف بوجوده. الرفض عام بلا تسريب.",
        "متابعو منشأتك فقط",
        "المتابعة اشتراك B2B مستقل، وإلغاؤه لا يمحو أحداث الطلبات السابقة — ACC-134.",
      ]),
    });
    await page.getByLabel("وحدة البيع").selectOption("carton");
    await page.getByLabel("العبوة").fill("كرتونة 12×1كغ");
    await page.getByLabel("حد أدنى للطلب").fill("5");
    await expect(page.getByRole("button", { name: "نشر", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "نشر", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "MP-11",
      state: "saving",
      texts: fromFrame("MP-11", "saving", [
        "حفظ المسودة",
        "المسودة عندك ولا يراها السوق حتى تُنشر صريحاً.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "MP-11",
      state: "success",
      texts: fromFrame("MP-11", "success", [
        "نُشر العرض",
        "بسعرٍ وصلاحية معلنة وجمهور — ورابط «كما يراه المشتري».",
        "الصلاحية تبدأ الآن",
        "وتنتهي بتاريخها ما لم تُجدَّد صريحاً (MP-13). النشر ليس التزاماً أبدياً — وانتهاؤه ليس عطلاً.",
      ]),
    });
  });

  test("permission_denied: ناشر الكتالوج يحرّر المسودة والنشر بصلاحية أعلى", async ({
    page,
  }, info) => {
    await page.route("**/api/catalog/items", (route) => route.fulfill(json(200, { items: ITEMS })));
    await page.route("**/api/catalog/items?**", (route) =>
      route.fulfill(json(200, { items: ITEMS })),
    );
    await page.route("**/api/market/offers/preview", (route) =>
      route.fulfill(
        json(200, preview(route.request().postDataJSON() as Record<string, string>, false)),
      ),
    );
    await login(page, "/market/offers/new");
    await expectFrame(page, info, {
      screenId: "MP-11",
      state: "permission_denied",
      texts: fromFrame("MP-11", "permission_denied", [
        "التحرير غير النشر",
        "ناشر الكتالوج يحرّر المسودة، والنشر النهائي بصلاحية أعلى إن ضُبط كذلك في ORG-02.",
        "فصل مقصود",
        "سعرٌ يخرج للسوق باسم المنشأة التزامٌ تجاري — الفصل بين من يكتب ومن يعتمد قاعدةُ السجل نفسها.",
        "حفظ كمسودة",
      ]),
    });
    await expect(page.getByRole("button", { name: /^نشر/ })).toBeDisabled();
  });
});
