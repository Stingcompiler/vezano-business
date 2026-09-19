import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.12 — ORD-05 تفاصيل الطلب وسجل الإصدارات (5) + ORD-06 إعداد عرض سعر من المورد (6): سلّم
 * الكميات والذمّة من المستلم وحده (ACC-127)؛ الاتفاق هو المقبول لا الأحدث والإصداران يُعرضان معاً
 * (ACC-125)؛ منشأة ثالثة رفض عام (ACC-121)؛ الصلاحية لا تكون ماضياً والزيادة تحتاج سبباً؛ لا
 * تجديد تلقائي (ACC-144)؛ أُرسل العرض بإصدار مرقَّم.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po1",
  op_id: "op1",
  number: 4471,
  number_label: "PO-4471",
  kind: "order",
  kind_label: "طلب",
  status: "accepted",
  status_label: "مقبول",
  version: 3,
  supplier_tenant_id: "t2",
  supplier_name: "مخازن النور",
  buyer_name: "بقالة النيل — تجريبي",
  currency: "SDG",
  lines: [],
  lines_count: 3,
  total_minor: "",
  delivery_to: "الفرع الرئيسي",
  fees_label: "",
  note: "",
  response_hours: 72,
  deadline_at: "2026-09-14T10:00:00Z",
  sent_at: "2026-09-11T10:00:00Z",
  updated_at: "2026-09-14T10:00:00Z",
  responsibilities: [],
  no_reply: false,
  near_deadline: false,
  remaining_hours: 0,
  content_line: "سكر أبيض كرتونة = 12 كغ ×10 · زيت طعام 1 لتر ×12 · +1",
  buyer_step: "بانتظار التسليم",
  supplier_step: "مقبول",
  flagged: false,
  list_status_label: "مقبول",
  ...o,
});

const vline = (o: Record<string, unknown> = {}) => ({
  offer_id: "o1",
  public_name: "سكر أبيض",
  pack_label: "كرتونة = 12 كغ",
  unit_name: "كرتونة",
  qty_requested: 10,
  qty_confirmed: 8,
  price_minor: "118000",
  increase_reason: "",
  ...o,
});

const VERSIONS = [
  {
    id: "v1",
    number: 1,
    kind: "request",
    kind_label: "طلب المشتري",
    author_side: "buyer",
    lines: [
      vline({ qty_confirmed: null }),
      vline({
        offer_id: "o2",
        public_name: "زيت طعام 1 لتر",
        pack_label: "كرتونة = 12 عبوة",
        qty_requested: 12,
        qty_confirmed: null,
        price_minor: "248500",
      }),
      vline({
        offer_id: "o3",
        public_name: "أرز 1 كغ",
        pack_label: "كرتونة = 25 كغ",
        qty_requested: 5,
        qty_confirmed: null,
        price_minor: "154000",
      }),
    ],
    delivery_fee_minor: "",
    valid_until: "",
    note: "",
    summary: "ثلاثة أسطر · بلا أسعار مؤكَّدة",
    draft: false,
    sent_at: "2026-09-11T10:00:00Z",
    accepted_at: "",
    is_agreement: false,
    created_at: "2026-09-11T10:00:00Z",
  },
  {
    id: "v2",
    number: 2,
    kind: "quote",
    kind_label: "عرض المورد",
    author_side: "supplier",
    lines: [
      vline(),
      vline({
        offer_id: "o2",
        public_name: "زيت طعام 1 لتر",
        pack_label: "كرتونة = 12 عبوة",
        qty_requested: 12,
        qty_confirmed: 12,
        price_minor: "248500",
      }),
      vline({
        offer_id: "o3",
        public_name: "أرز 1 كغ",
        pack_label: "كرتونة = 25 كغ",
        qty_requested: 5,
        qty_confirmed: 0,
        price_minor: "",
      }),
    ],
    delivery_fee_minor: "6000",
    valid_until: "2026-09-15",
    note: "",
    summary: "سكر 8 لا 10 · أرز غير متوفر · رسم نقل 60",
    draft: false,
    sent_at: "2026-09-12T10:00:00Z",
    accepted_at: "",
    is_agreement: false,
    created_at: "2026-09-12T10:00:00Z",
  },
  {
    id: "v3",
    number: 3,
    kind: "quote",
    kind_label: "العرض المعدَّل — مقبول",
    author_side: "supplier",
    lines: [
      vline(),
      vline({
        offer_id: "o2",
        public_name: "زيت طعام 1 لتر",
        pack_label: "كرتونة = 12 عبوة",
        qty_requested: 12,
        qty_confirmed: 12,
        price_minor: "248500",
      }),
      vline({
        offer_id: "o3",
        public_name: "أرز 1 كغ",
        pack_label: "كرتونة = 25 كغ",
        qty_requested: 5,
        qty_confirmed: 0,
        price_minor: "",
      }),
    ],
    delivery_fee_minor: "6000",
    valid_until: "2026-09-16",
    note: "",
    summary: "صلاحية 72 ساعة · هذه نسخة الاتفاق المثبَّتة",
    draft: false,
    sent_at: "2026-09-13T10:00:00Z",
    accepted_at: "2026-09-13T12:00:00Z",
    is_agreement: true,
    created_at: "2026-09-13T10:00:00Z",
  },
];

const V4 = {
  id: "v4",
  number: 4,
  kind: "revision",
  kind_label: "تعديل لاحق من المورد — غير مقبول",
  author_side: "supplier",
  lines: [
    vline({ price_minor: "125000" }),
    vline({
      offer_id: "o2",
      public_name: "زيت طعام 1 لتر",
      pack_label: "كرتونة = 12 عبوة",
      qty_requested: 12,
      qty_confirmed: 12,
      price_minor: "248500",
    }),
    vline({
      offer_id: "o3",
      public_name: "أرز 1 كغ",
      pack_label: "كرتونة = 25 كغ",
      qty_requested: 5,
      qty_confirmed: 0,
      price_minor: "",
    }),
  ],
  delivery_fee_minor: "6000",
  valid_until: "2026-09-20",
  note: "",
  summary: "سعرٌ أعلى · لا يُلزم أحداً: الأحدث ليس الاتفاق",
  draft: false,
  sent_at: "2026-09-14T10:00:00Z",
  accepted_at: "",
  is_agreement: false,
  created_at: "2026-09-14T10:00:00Z",
};

const LADDER = [
  {
    offer_id: "o1",
    public_name: "سكر أبيض",
    pack_label: "كرتونة = 12 كغ",
    unit_name: "كرتونة",
    requested: 10,
    confirmed: 8,
    shipped: 8,
    received: 7,
    gap: 1,
    price_minor: "26000",
    status: "صندوق لم يصل — محجوز بقيمته 260.00 وبابه خلاف (ORD-12)",
  },
  {
    offer_id: "o2",
    public_name: "زيت طعام 1 لتر",
    pack_label: "كرتونة = 12 عبوة",
    unit_name: "كرتونة",
    requested: 12,
    confirmed: 12,
    shipped: 12,
    received: 12,
    gap: 0,
    price_minor: "248500",
    status: "مُغلق — استُلم كاملاً وقُيّد",
  },
  {
    offer_id: "o3",
    public_name: "أرز 1 كغ",
    pack_label: "كرتونة = 25 كغ",
    unit_name: "كرتونة",
    requested: 5,
    confirmed: 0,
    shipped: 0,
    received: 0,
    gap: 0,
    price_minor: "0",
    status: "المورد لم يؤكّده — خارج الاتفاق، ولا أثر مالي له",
  },
];

const EVENTS = [
  {
    id: "e1",
    kind: "sent",
    side: "buyer",
    title: "أُرسل الطلب",
    detail: "3 بنود · بانتظار رد المورد.",
    ref_label: "PO-4471 · النسخة 1",
    at: "2026-09-11T10:08:00Z",
  },
  {
    id: "e2",
    kind: "quoted",
    side: "supplier",
    title: "عرض سعر من المورد",
    detail: "سكر 8 لا 10 · أرز غير متوفر · رسم نقل 60",
    ref_label: "Q-4471 · النسخة 2",
    at: "2026-09-12T13:40:00Z",
  },
  {
    id: "e3",
    kind: "accepted",
    side: "buyer",
    title: "قُبل الإصدار",
    detail: "قُبلت النسخة 3 بعد عرض الفرق. هذه نسخة الاتفاق الملزمة.",
    ref_label: "Q-4471 · النسخة 3 — مقبولة",
    at: "2026-09-13T14:02:00Z",
  },
];

const DETAIL = (o: Record<string, unknown> = {}) => ({
  order: ORDER(),
  side: "buyer",
  versions: VERSIONS,
  events: EVENTS,
  agreed_version: 3,
  latest_version: 3,
  conflict: false,
  partial: false,
  ladder: LADDER,
  received_value_minor: "184000",
  gap_value_minor: "26000",
  ladder_rule:
    "الذمّة تنشأ من المستلم وحده. الطلب التزامُ شراء لا دين، والمؤكَّد وعدُ توريد، والمشحون دعوى المورد — ولا واحد منها يُقيَّد على الحساب (ACC-127). والفارق يُحجَز حتى يُغلق بتسوية أو يُلغى بقرار.",
  ...o,
});

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

test.describe("ORD-05", () => {
  test("loading → ready: سلّم الكميات، الذمّة من المستلم وحده، والنسخة المقبولة مثبَّتة", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/market\/orders\/po1$/, async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, DETAIL()));
    });
    await login(page, "/market/orders/po1", /\/market\/orders\/po1$/);
    await expectFrame(page, info, {
      screenId: "ORD-05",
      state: "loading",
      texts: fromFrame("ORD-05", "loading", [
        "بناء الخط الزمني",
        "الخط يُبنى من أحداث الطرفين مرتَّبةً، ولا تُعرض حالة الطلب قبل اكتمال السلسلة.",
        "لا حالة جزئية",
        "حالةٌ محسوبة من نصف الأحداث تُظهر «مؤكَّد» لطلبٍ شُحن. والحالة هنا تُقرأ قراراً.",
      ]),
    });
    released = true;
    release();
    await expect(page.getByRole("heading", { name: "سلّم الكميات", exact: true })).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-05",
      state: "ready",
      texts: fromFrame("ORD-05", "ready", [
        "تفاصيل الطلب وسجل الإصدارات — سلّم الكميات",
        "الشاشة التي يُفتحها الطرفان عند الخلاف. أربعة أرقام لكل سطر، كلٌّ منها يعني فعلاً مختلفاً — وخلطها يصنع ديناً لم يقع.",
        "طلب",
        "— مخازن النور",
        "الاتفاق: الإصدار",
        "الصنف والوحدة",
        "مطلوب",
        "مؤكَّد",
        "مشحون",
        "مستلم",
        "فارق",
        "وضع السطر",
        "قيمة المستلم — تُقيَّد",
        "1,840.00",
        "قيمة الفارق — محجوزة",
        "260.00",
        "سجل الإصدارات — النسخة المقبولة مثبَّتة لا مرجع متحرّك",
        "سكر أبيض",
        "كرتونة = 12 كغ",
        "صندوق لم يصل — محجوز بقيمته 260.00 وبابه خلاف (ORD-12)",
        "زيت طعام 1 لتر",
        "كرتونة = 12 عبوة",
        "مُغلق — استُلم كاملاً وقُيّد",
        "أرز 1 كغ",
        "كرتونة = 25 كغ",
        "المورد لم يؤكّده — خارج الاتفاق، ولا أثر مالي له",
        "طلب المشتري",
        "عرض المورد",
        "العرض المعدَّل — مقبول",
      ]),
    });
    const root = page.locator('[data-screen="ORD-05"]');
    await expect(root).toContainText("الاتفاق: الإصدار 3 · مقبول 13 سبتمبر");
    await expect(root).toContainText("الذمّة تنشأ من المستلم وحده");
    await expect(root).toContainText("هذه نسخة الاتفاق المثبَّتة");
    await expect(root).toContainText("أُرسل الطلب");
    await expect(root).toContainText("قُبل الإصدار");
  });

  test("conflict: إصداران متوازيان — الاتفاق هو المشار إليه في القبول لا الأحدث، والإصداران معروضان معاً", async ({
    page,
  }, info) => {
    const posted: number[] = [];
    let body = DETAIL({ versions: [...VERSIONS, V4], latest_version: 4, conflict: true });
    await page.route(/\/api\/market\/orders\/po1$/, (route) => route.fulfill(json(200, body)));
    await page.route(/\/api\/market\/orders\/po1\/accept$/, (route) => {
      const b = route.request().postDataJSON() as { version: number };
      posted.push(b.version);
      body = DETAIL({
        versions: [
          ...VERSIONS.map((v) => ({
            ...v,
            is_agreement: false,
            kind_label: v.number === 3 ? "عرض المورد" : v.kind_label,
          })),
          {
            ...V4,
            is_agreement: true,
            accepted_at: "2026-09-19T10:00:00Z",
            kind_label: "العرض المعدَّل — مقبول",
          },
        ],
        agreed_version: 4,
        latest_version: 4,
        conflict: false,
      });
      return route.fulfill(json(200, body));
    });
    await login(page, "/market/orders/po1", /\/market\/orders\/po1$/);
    await expectFrame(page, info, {
      screenId: "ORD-05",
      state: "conflict",
      texts: fromFrame("ORD-05", "conflict", [
        "إصداران متوازيان",
        "الاتفاق هو المشار إليه في القبول",
        "لا إخفاء",
        "الإصداران معروضان معاً بفرقهما. إخفاء الأحدث يجعل المورد يتصرف على أساسٍ لا يراه المشتري.",
        "الإصدار 4",
        "تعديل لاحق من المورد — غير مقبول",
      ]),
    });
    const root = page.locator('[data-screen="ORD-05"]');
    await expect(root).toContainText("المورد أرسل الإصدار 4 بينما كان المشتري يقبل الإصدار 3.");
    await expect(root).toContainText(
      "الإصدار 3 لا الأحدث (ACC-125). والإصدار 4 يُعرض اقتراحاً يحتاج قبولاً جديداً.",
    );
    await expect(root).toContainText("الإصدار 3 — الاتفاق");
    await expect(root).toContainText("الإصدار 4 — اقتراح");
    await expect(root).toContainText("الفرق 70.00");
    await expect(root).toContainText("لا يُلزم أحداً: الأحدث ليس الاتفاق");
    await page.getByRole("button", { name: "اقبل الإصدار 4" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("الاتفاق: الإصدار 4");
    expect(posted).toEqual([4]);
  });

  test("partial: خط زمني للطلب — منفَّذ جزئياً ولا محو لما حدث (ACC-145)", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po1$/, (route) =>
      route.fulfill(
        json(
          200,
          DETAIL({
            partial: true,
            order: ORDER({
              status: "delivered",
              status_label: "سُلِّم",
              list_status_label: "سُلِّم",
            }),
          }),
        ),
      ),
    );
    await login(page, "/market/orders/po1", /\/market\/orders\/po1$/);
    await expectFrame(page, info, {
      screenId: "ORD-05",
      state: "partial",
      texts: fromFrame("ORD-05", "partial", [
        "منفَّذ جزئياً",
        "ACC-145: انتهاء الكتالوج بعد قبول العرض لا يمس الاتفاق. الإلغاء يخص غير المسلَّم وحده.",
        "إلغاء المتبقي — ماذا يُلغى بالضبط",
        "أُرسل الطلب",
        "عرض سعر من المورد",
        "قُبلت النسخة 3 بعد عرض الفرق. هذه نسخة الاتفاق الملزمة.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-05"]');
    await expect(root).toContainText("مستلم جزئياً");
    await expect(root).toContainText("Q-4471 · النسخة 3 — مقبولة");
  });

  test("permission_denied: منشأة ثالثة تفتح الرابط — رفض عام بلا اسم ولا صنف ولا «هذا الطلب موجود»", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po1$/, (route) =>
      route.fulfill(json(404, { detail: "not_found" })),
    );
    await login(page, "/market/orders/po1", /\/market\/orders\/po1$/);
    await expectFrame(page, info, {
      screenId: "ORD-05",
      state: "permission_denied",
      texts: fromFrame("ORD-05", "permission_denied", [
        "رفض عام",
        "لا اسم مورد ولا صنف ولا سعر ولا حتى «هذا الطلب موجود» (ACC-60 · ACC-121). وجودُ المستند سِرٌّ أيضاً.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-05"]');
    await expect(root).not.toContainText("مخازن النور");
    await expect(root).not.toContainText("سكر");
  });
});

test.describe("ORD-06", () => {
  const QUOTE = (o: Record<string, unknown> = {}) => ({
    order: ORDER({
      status: "sent",
      status_label: "بانتظار رد المورد",
      list_status_label: "بانتظار رد المورد",
    }),
    request: VERSIONS[0],
    draft: null,
    catalog_expired: [],
    default_valid_until: "2026-12-31",
    can_quote: true,
    ...o,
  });

  test("ready → partial → validation_error → saving → success: الفرق سطراً سطراً، الزيادة بسبب، الصلاحية لا ماضياً، وإصدار مرقَّم", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po1\/quote$/, async (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, QUOTE()));
      const b = route.request().postDataJSON() as {
        send: boolean;
        valid_until: string;
        lines: { qty_confirmed: number; increase_reason: string }[];
      };
      if (!b.send) {
        await new Promise((r) => setTimeout(r, 1500));
        return route.fulfill(
          json(200, { version: { ...VERSIONS[1], draft: true, number: 2 }, order: ORDER() }),
        );
      }
      return route.fulfill(
        json(200, {
          version: { ...VERSIONS[1], number: 2, valid_until: b.valid_until },
          order: ORDER({ status: "quoted" }),
        }),
      );
    });
    await login(page, "/market/orders/po1/quote", /\/market\/orders\/po1\/quote$/);
    await expect(page.getByText("مؤكد من المورد")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-06",
      state: "ready",
      texts: fromFrame("ORD-06", "ready", [
        "إعداد عرض سعر من المورد",
        "هنا يصير الطلب اتفاقاً محتملاً.",
        "تحرير الردّ سطراً سطراً",
        "يعدّل الكميات والأسعار، ويضيف رسوم نقل، ويحدّد صلاحية العرض — والفرق عن طلب المشتري معروضٌ في عمودٍ مقابل.",
        "الفرق معروض للطرفين",
        "المورد يرى ما غيّره قبل الإرسال، والمشتري يراه بعده. تغييرٌ لا يُسمّى يُقرأ خطأً.",
        "حفظ مسودة العرض",
      ]),
    });
    const root = page.locator('[data-screen="ORD-06"]');
    await expect(root).toContainText("PO-4471 — بقالة النيل — تجريبي");
    await expect(root).toContainText("كما طُلب");
    await page.getByLabel("مؤكد — سكر أبيض").fill("8");
    await expectFrame(page, info, {
      screenId: "ORD-06",
      state: "partial",
      texts: fromFrame("ORD-06", "partial", ["رد المورد — قبول جزئي", "مطلوب", "مؤكد من المورد"]),
    });
    await expect(root).toContainText("القبول الجزئي ليس رفضاً ولا موافقة كاملة");
    await expect(root).toContainText("الكمية -2");
    await page.getByLabel("مؤكد — أرز 1 كغ").fill("6");
    await page.getByLabel("صلاحية العرض").fill("2026-01-01");
    await page.getByRole("button", { name: "أرسل العرض" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-06",
      state: "validation_error",
      texts: fromFrame("ORD-06", "validation_error", [
        "صلاحية في الماضي أو كمية تفوق المطلوب",
        "تاريخ صلاحية أمس، وسطرٌ بكمية أكبر من طلب المشتري.",
        "الزيادة تحتاج سبباً",
        "قد تكون تعبئةً بالكرتونة الكاملة — تُعلَن سبباً لا تُمرّر رقماً. والمشتري يقبل الزيادة أو يرفضها.",
        "الصلاحية لا تكون ماضياً",
        "عرضٌ منتهٍ قبل إرساله لا معنى له، ويُقرأ عند المشتري خطأً في نظامنا لا في تحرير المورد.",
      ]),
    });
    await page.getByLabel("سبب الزيادة — أرز 1 كغ").fill("تعبئة بالكرتونة الكاملة");
    await page.getByLabel("صلاحية العرض").fill("2026-12-31");
    await page.getByRole("button", { name: "حفظ مسودة العرض" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-06",
      state: "saving",
      texts: fromFrame("ORD-06", "saving", [
        "حفظ مسودة العرض",
        "يُحفظ عند المورد ولا يصل المشتري حتى يُرسل صريحاً.",
      ]),
    });
    await expect(root).toHaveAttribute("data-state", "partial");
    await expect(root).toContainText("يُحفظ عند المورد ولا يصل المشتري حتى يُرسل صريحاً.");
    await page.getByRole("button", { name: "أرسل العرض" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-06",
      state: "success",
      texts: fromFrame("ORD-06", "success", [
        "أُرسل العرض",
        "بإصدارٍ مرقَّم وصلاحية معلنة — والمشتري يقبل إصداراً بعينه لا «العرض».",
        "الترقيم ليس زينة",
        "هو ما يجعل القبول قابلاً للإثبات. بلا رقم إصدار يصير القبول دعوى (ACC-125).",
      ]),
    });
    await expect(root).toContainText("الإصدار 2 · صالح حتى 31/12");
  });

  test("expired: انتهت صلاحية سعر الكتالوج أثناء التحرير — لا تجديد تلقائي (ACC-144)", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po1\/quote$/, (route) =>
      route.fulfill(json(200, QUOTE({ catalog_expired: ["o1"] }))),
    );
    await login(page, "/market/orders/po1/quote", /\/market\/orders\/po1\/quote$/);
    await expectFrame(page, info, {
      screenId: "ORD-06",
      state: "expired",
      texts: fromFrame("ORD-06", "expired", [
        "انتهت صلاحية سعر الكتالوج أثناء التحرير",
        "العرض المنشور الذي بُني عليه الردّ انتهت صلاحيته.",
        "لا تجديد تلقائي",
        "تعديل الوصف أو التحرير لا يجدّد تأكيد السعر (ACC-144). التجديد فعلٌ مستقل في MP-13.",
      ]),
    });
    await expect(page.locator('[data-screen="ORD-06"]')).toContainText("سعر الكتالوج منتهٍ");
  });
});
