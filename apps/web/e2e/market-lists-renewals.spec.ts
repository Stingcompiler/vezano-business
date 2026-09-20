import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T3.5 — MP-12 أسعار شرائح وقوائم خاصة (4) + MP-13 تجديد تأكيد سعر وتوفر (5): الشريحة بوحدتها
 * والمشترون بأسمائهم؛ فجوة تمنع الحفظ؛ منشأة ثالثة ترى «الرابط لم يعد صالحاً» نفسها؛ الوصف لا
 * يجدّد والتجديد فعل صريح بصلاحية من يلتزم بالسعر.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const tier = (min: number, max: number | null, price: string, unit: string) => ({
  min,
  max,
  label: max === null ? `أكثر من ${min - 1}` : `${min} – ${max} كرتونة`,
  price_minor: price,
  unit_price_minor: unit,
  base_unit_name: "كغ",
  negotiable: !price,
  pack_label: "كرتونة 12×1كغ",
});

const LIST = {
  id: "l1",
  name: "موزّعو بحري",
  offer_id: "o1",
  offer_name: "سكر أبيض",
  pack_label: "كرتونة 12×1كغ",
  unit_name: "كرتونة",
  tiers: [
    tier(5, 19, "1180000", "9833"),
    tier(20, 49, "1140000", "9500"),
    tier(60, 120, "1095000", "9125"),
    tier(121, null, "", ""),
  ],
  gaps: [],
  active_count: 4,
  members: [
    {
      id: "m1",
      buyer_name: "بقالة النيل — تجريبي",
      status: "active",
      status_label: "نشطة",
      hint: "مخوَّلة منذ 12 أغسطس · 7 طلبات",
    },
    {
      id: "m2",
      buyer_name: "متجر الأمان — تجريبي",
      status: "active",
      status_label: "نشطة",
      hint: "مخوَّلة منذ 03 سبتمبر · لا طلبات بعد",
    },
    {
      id: "m3",
      buyer_name: "مخبز الصباح — تجريبي",
      status: "suspended",
      status_label: "موقوف",
      hint: "التخويل موقوف بطلبك — لا يرى الأسعار الآن",
    },
    {
      id: "m4",
      buyer_name: "مطعم الواحة — تجريبي",
      status: "invited",
      status_label: "دعوة معلّقة",
      hint: "دعوة مرسلة ولم تُقبل · تنتهي بعد 4 أيام",
    },
  ],
};

const offer = (o: Record<string, unknown>) => ({
  id: "o1",
  number: 4102,
  item_id: "i1",
  public_name: "سكر أبيض",
  description: "",
  unit_code: "carton",
  unit_name: "كرتونة",
  pack_label: "كرتونة 12×1كغ",
  price_minor: "1180000",
  min_order_qty: 5,
  max_order_qty: null,
  fulfilment_note: "",
  audience: "public",
  audience_label: "كل المشترين",
  valid_until: "2026-09-25",
  status: "published",
  status_label: "منشور",
  meaning: "",
  missing: [],
  confirmed_at: new Date().toISOString(),
  days_left: 6,
  ...o,
});

const RULES = [
  {
    action: "تصحيح الوصف أو الصورة",
    effect: "لا يجدّد التأكيد ولا يغيّر حالة الصلاحية. العرض يبقى منتهياً كما هو.",
    verdict: "لا يجدّد",
  },
  {
    action: "تعديل منطقة الخدمة",
    effect: "لا يجدّد السعر، ويُخطر المشترين المخوَّلين بأن التوصيل تغيّر.",
    verdict: "لا يجدّد",
  },
  {
    action: "تغيير السعر أو الوحدة",
    effect: "يُلغي التأكيد القائم فوراً ويطلب تجديداً صريحاً. لا سعر جديد بتأكيد قديم.",
    verdict: "يُلغي التأكيد",
  },
  {
    action: "تغيير الحد الأدنى للطلب",
    effect: "يُلغي التأكيد لأنه يغيّر ما يستطيع المشتري طلبه بهذا السعر.",
    verdict: "يُلغي التأكيد",
  },
  {
    action: "زر «تجديد التأكيد»",
    effect: "الفعل الوحيد الذي يمنح ختماً خادمياً جديداً بمدة صلاحية معلنة.",
    verdict: "يجدّد",
  },
];

const expiredAt = () => {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
};

const RENEWALS = (o: Record<string, unknown> = {}) => ({
  offers: [
    offer({
      id: "o2",
      number: 4102,
      public_name: "زيت طعام",
      pack_label: "كرتونة 4×5ل",
      valid_until: "2026-09-09",
      status: "expired",
      status_label: "منتهٍ",
      confirmed_at: expiredAt(),
      days_left: -10,
    }),
    offer({}),
  ],
  can_renew: true,
  renew_hours: 48,
  rules: RULES,
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

test.describe("MP-12", () => {
  test("empty → ready → validation_error: لا قوائم خاصة، ثم القائمة بشرائحها وأعضائها، والفجوة تمنع الحفظ", async ({
    page,
  }, info) => {
    let listsBody: unknown = { lists: [], can_edit: true, can_manage: true };
    await page.route(/\/api\/market\/lists$/, (route) => route.fulfill(json(200, listsBody)));
    await login(page, "/market/lists");
    await expectFrame(page, info, {
      screenId: "MP-12",
      state: "empty",
      texts: fromFrame("MP-12", "empty", [
        "لا قوائم خاصة",
        "كل الأسعار عامة — حالة سويّة لأغلب الباعة.",
        "الشرائح بحدودها",
        "كل شريحة: منشآت مسمّاة بعلاقة مخوَّلة، وأسعار بوحداتها، وحدود كمية.",
        "العلاقة أولاً",
        "لا سعر خاص لمنشأة بلا علاقة قائمة (متابعة مقبولة أو تعامل سابق). السعر الخاص امتيازُ علاقة لا إعلان.",
      ]),
    });
    await page.route(/\/api\/market\/lists\/l1$/, (route) => {
      if (route.request().method() === "PUT")
        return route.fulfill(
          json(400, {
            detail: "tier_gap",
            field: "tiers",
            extra: { gaps: [{ from: 50, to: 59 }] },
          }),
        );
      return route.fulfill(json(200, { list: LIST, role: "seller" }));
    });
    listsBody = { lists: [LIST], can_edit: true, can_manage: true };
    await navTo(page, "عروضي");
    await expect(page).toHaveURL(/\/market\/offers$/);
    await navTo(page, "القوائم الخاصة");
    await expect(page).toHaveURL(/\/market\/lists$/);
    await page.getByRole("button", { name: /قائمة «موزّعو بحري»/ }).click();
    await expect(page).toHaveURL(/\/market\/lists\/l1$/);
    await expect(page.getByText("المشترون المخوَّلون — بأسمائهم لا بوصف عام")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "MP-12",
      state: "ready",
      texts: fromFrame("MP-12", "ready", [
        "قوائم الأسعار الخاصة — الشريحة بوحدتها والمشترون بأسمائهم",
        "قائمة «موزّعو بحري» — سكر أبيض",
        "4 مشترين مخوَّلين · الوحدة: كرتونة 12×1كغ",
        "الشريحة",
        "سعر العبوة",
        "سعر الوحدة",
        "التحقق",
        "5 – 19 كرتونة",
        "كرتونة 12×1كغ",
        "سليمة",
        "20 – 49 كرتونة",
        "60 – 120 كرتونة",
        "أكثر من 120",
        "بالتفاوض",
        "«بالتفاوض» مقبول ويمنع الطلب الفوري ويفتح طلب عرض سعر",
        "المشترون المخوَّلون — بأسمائهم لا بوصف عام",
        "بقالة النيل — تجريبي",
        "مخوَّلة منذ 12 أغسطس · 7 طلبات",
        "نشطة",
        "متجر الأمان — تجريبي",
        "مخوَّلة منذ 03 سبتمبر · لا طلبات بعد",
        "مخبز الصباح — تجريبي",
        "التخويل موقوف بطلبك — لا يرى الأسعار الآن",
        "موقوف",
        "مطعم الواحة — تجريبي",
        "دعوة مرسلة ولم تُقبل · تنتهي بعد 4 أيام",
        "دعوة معلّقة",
        "تسريب محجوب",
      ]),
    });
    await expect(page.getByText("98.33")).toBeVisible();
    await expect(page.getByText("95.00")).toBeVisible();
    await expect(page.getByText("91.25")).toBeVisible();
    await page.getByLabel("سعر العبوة — شريحة 1").fill("11800");
    await page.getByRole("button", { name: "احفظ القائمة" }).click();
    await expectFrame(page, info, {
      screenId: "MP-12",
      state: "validation_error",
      texts: fromFrame("MP-12", "validation_error", [
        "فجوة بين شريحتين تمنع الحفظ",
        "لا يجد سعراً، فيقع على سعر افتراضي لا أحد اتفق عليه.",
        "أغلق الفجوة أو صرّح بالسعر الساري فيها.",
        "فجوة: 50 – 59 كرتونة بلا سعر معلن",
      ]),
    });
  });

  test("permission_denied: منشأة ثالثة تفتح رابط القائمة فترى «الرابط لم يعد صالحاً» نفسها", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/lists\/l1$/, (route) =>
      route.fulfill(json(404, { detail: "not_found" })),
    );
    await login(page, "/market/lists/l1");
    await expectFrame(page, info, {
      screenId: "MP-12",
      state: "permission_denied",
      texts: fromFrame("MP-12", "permission_denied", [
        "منشأة ثالثة تطلب القائمة",
        "رابط قائمة خاصة وصل لغير أهله.",
        "رفض عام",
        "كأنها غير موجودة (ACC-121). وتبديل الحساب على نفس الجهاز لا يُظهر كاش الحساب السابق (ACC-138) — العزل بالحساب لا بالجهاز.",
      ]),
    });
    await expect(page.locator('[data-screen="MP-12"]')).toContainText("الرابط لم يعد صالحاً");
    await expect(page.getByText("موزّعو بحري")).toHaveCount(0);
  });
});

test.describe("MP-13", () => {
  test("ready → expired → saving → success: الأقرب انتهاءً أولاً، ما يجدّد وما لا يجدّده، ثم جُدِّد التأكيد", async ({
    page,
  }, info) => {
    let renewals = RENEWALS();
    await page.route("**/api/market/renewals", (route) => route.fulfill(json(200, renewals)));
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/market/offers/o2/renew", async (route) => {
      await held;
      renewals = RENEWALS({
        offers: [
          offer({}),
          offer({ id: "o2", public_name: "زيت طعام", valid_until: "2026-09-21", days_left: 2 }),
        ],
      });
      return route.fulfill(
        json(200, {
          offer: offer({ id: "o2", public_name: "زيت طعام", valid_until: "2026-09-21" }),
        }),
      );
    });
    await login(page, "/market/renewals");
    await expectFrame(page, info, {
      screenId: "MP-13",
      state: "ready",
      texts: fromFrame("MP-13", "ready", [
        "ما ينتهي وما انتهى",
        "قائمة عروضك بصلاحياتها، والأقرب انتهاءً أولاً — والتجديد فعل صريح لكل عرض: «ما زال السعر قائماً؟».",
        "الوصف لا يجدّد",
        "تعديل وصفٍ أو صورة لا يجدّد تأكيد السعر (ACC-144). التجديد إقرارٌ سعري له زرّه — وإلا صار كل تحريرٍ تمديداً خفياً.",
      ]),
    });
    await page.getByRole("button", { name: /زيت طعام/ }).click();
    await expectFrame(page, info, {
      screenId: "MP-13",
      state: "expired",
      texts: fromFrame("MP-13", "expired", [
        "تجديد التأكيد والمتابعة — فعلان لا يُنجزان تلقائياً",
        "تعديل عرض قائم — ما يجدّد التأكيد وما لا يجدّده",
        "العرض 4102 · تأكيده الخادمي انتهى 18:00",
        "لماذا لا نجدّد تلقائياً عند أي تعديل؟",
        "لأن تصحيح خطأ إملائي في الوصف سيصبح حينها إعلاناً بأن السعر ساري اليوم، والمشتري يبني عليه طلباً. التجديد فعل صريح بزر وختم وقت.",
        "تجديد تأكيد السعر والتوفر — 48 ساعة",
        "تصحيح الوصف أو الصورة",
        "لا يجدّد التأكيد ولا يغيّر حالة الصلاحية. العرض يبقى منتهياً كما هو.",
        "لا يجدّد",
        "تعديل منطقة الخدمة",
        "لا يجدّد السعر، ويُخطر المشترين المخوَّلين بأن التوصيل تغيّر.",
        "تغيير السعر أو الوحدة",
        "يُلغي التأكيد القائم فوراً ويطلب تجديداً صريحاً. لا سعر جديد بتأكيد قديم.",
        "يُلغي التأكيد",
        "تغيير الحد الأدنى للطلب",
        "يُلغي التأكيد لأنه يغيّر ما يستطيع المشتري طلبه بهذا السعر.",
        "زر «تجديد التأكيد»",
        "الفعل الوحيد الذي يمنح ختماً خادمياً جديداً بمدة صلاحية معلنة.",
        "يجدّد",
      ]),
    });
    await page.getByRole("button", { name: /تجديد تأكيد السعر والتوفر — 48 ساعة/ }).click();
    await expectFrame(page, info, {
      screenId: "MP-13",
      state: "saving",
      texts: fromFrame("MP-13", "saving", [
        "جارٍ التجديد",
        "التأكيد يُرفع للخادم — التجديد المحلي لا معنى له: صدقه في وصوله.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "MP-13",
      state: "success",
      texts: fromFrame("MP-13", "success", [
        "جُدِّد التأكيد",
        "صلاحية جديدة بتاريخها، والعرض يعود إلى نتائج البحث إن كان سقط.",
        "الماضي ثابت",
        "التجديد بسعرٍ جديد لا يمسّ طلباً قُبل على السعر القديم (ACC-145) — نسخة الاتفاق محفوظة هناك.",
      ]),
    });
  });

  test("permission_denied: محرّر الوصف لا يجدّد الأسعار", async ({ page }, info) => {
    await page.route("**/api/market/renewals", (route) =>
      route.fulfill(json(200, RENEWALS({ can_renew: false }))),
    );
    await login(page, "/market/renewals");
    await expectFrame(page, info, {
      screenId: "MP-13",
      state: "permission_denied",
      texts: fromFrame("MP-13", "permission_denied", [
        "التجديد إقرار سعري",
        "محرّر الوصف لا يجدّد الأسعار — التجديد بصلاحية من يلتزم بالسعر.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تجديد التأكيد" })).toHaveCount(0);
  });
});
