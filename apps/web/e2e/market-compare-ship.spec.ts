import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.13 — ORD-07 مقارنة العرض وقبوله أو رفضه (5) + ORD-08 تجهيز وتسليم جزئي (4): لا زرّ قبول
 * قبل عرض الفرق؛ القبول يخص النسخة المعروضة وحدها ولا يُحوَّل إلى الأحدث ضمناً (ACC-125)؛ لا
 * قبول صامت لسعر انتهت صلاحيته (ACC-143)؛ نسخة لا مرجع (ACC-145)؛ التراكم لا يتجاوز المؤكَّد
 * ولا يُقتطع الفائض صامتاً؛ كل شحنة بمرجع مستقل.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po1",
  op_id: "op1",
  number: 2041,
  number_label: "PO-2041",
  kind: "order",
  kind_label: "طلب",
  status: "quoted",
  status_label: "عرض سعر من المورد",
  version: 2,
  supplier_tenant_id: "t2",
  supplier_name: "مخزن البركة",
  buyer_name: "بقالة النيل — تجريبي",
  currency: "SDG",
  lines: [],
  lines_count: 2,
  total_minor: "",
  delivery_to: "الفرع الرئيسي",
  fees_label: "",
  note: "",
  response_hours: 72,
  deadline_at: "2026-09-22T10:00:00Z",
  sent_at: "2026-09-19T10:00:00Z",
  updated_at: "2026-09-19T12:00:00Z",
  responsibilities: [],
  no_reply: false,
  near_deadline: false,
  remaining_hours: 40,
  content_line: "",
  buyer_step: "",
  supplier_step: "",
  flagged: false,
  list_status_label: "عرض سعر من المورد",
  shipped_percent: 0,
  ...o,
});

const V = (n: number, o: Record<string, unknown> = {}) => ({
  id: `v${n}`,
  number: n,
  kind: n === 1 ? "request" : "quote",
  kind_label: n === 1 ? "طلب المشتري" : "عرض المورد",
  author_side: n === 1 ? "buyer" : "supplier",
  lines: [],
  delivery_fee_minor: "",
  delivery_days: null,
  valid_until: "2026-12-31",
  rejected_at: "",
  note: "",
  summary: "",
  draft: false,
  sent_at: new Date(Date.now() - 6 * 60_000).toISOString(),
  accepted_at: "",
  is_agreement: false,
  created_at: "2026-09-19T10:00:00Z",
  ...o,
});

const ROWS = [
  {
    offer_id: "o1",
    public_name: "سكر أبيض",
    pack_label: "كرتونة 12×1كغ",
    unit_name: "كرتونة",
    requested_qty: 6,
    requested_price_minor: "118000",
    shown_qty: 6,
    shown_price_minor: "118000",
    current_qty: 6,
    current_price_minor: "118000",
    diff_label: "بلا تغيير",
    increase_reason: "",
    version_diff_label: "بلا تغيير",
  },
  {
    offer_id: "o2",
    public_name: "زيت قلي",
    pack_label: "كرتونة 12×1لتر",
    unit_name: "كرتونة",
    requested_qty: 4,
    requested_price_minor: "248500",
    shown_qty: 4,
    shown_price_minor: "248500",
    current_qty: 4,
    current_price_minor: "256000",
    diff_label: "بلا تغيير",
    increase_reason: "",
    version_diff_label: "سعرٌ أعلى",
  },
];

const COMPARE = (o: Record<string, unknown> = {}) => ({
  order: ORDER(),
  request: V(1),
  shown: V(2, { delivery_days: 3 }),
  latest: V(2, { delivery_days: 3 }),
  rows: ROWS,
  conflict: false,
  expired: false,
  seconds_left: 9660,
  shown_total_minor: String(6 * 118000 + 4 * 248500),
  latest_total_minor: String(6 * 118000 + 4 * 248500),
  request_total_minor: String(6 * 118000 + 4 * 248500),
  accepted: null,
  ...o,
});

const CONFLICT = COMPARE({
  latest: V(3, { delivery_days: 5, delivery_fee_minor: "0" }),
  conflict: true,
  latest_total_minor: String(6 * 118000 + 4 * 256000),
  seconds_left: 9660,
});

const DETAIL_ACCEPTED = {
  order: ORDER({ status: "accepted", status_label: "مقبول", list_status_label: "مقبول" }),
  side: "buyer",
  versions: [V(1), V(2, { is_agreement: true, accepted_at: "2026-09-19T12:00:00Z" })],
  events: [],
  agreed_version: 2,
  latest_version: 2,
  conflict: false,
  partial: false,
  ladder: [],
  received_value_minor: "0",
  gap_value_minor: "0",
  ladder_rule: "",
};

const SHIP_LINES = [
  {
    offer_id: "o1",
    public_name: "سكر أبيض",
    pack_label: "كرتونة 12×1كغ",
    unit_name: "كرتونة",
    confirmed: 100,
    shipped: 50,
    remaining: 50,
  },
  {
    offer_id: "o2",
    public_name: "شاي أسود",
    pack_label: "كرتونة 24×250غ",
    unit_name: "كرتونة",
    confirmed: 40,
    shipped: 40,
    remaining: 0,
  },
  {
    offer_id: "o3",
    public_name: "زيت طعام",
    pack_label: "كرتونة 4×5ل",
    unit_name: "كرتونة",
    confirmed: 60,
    shipped: 35,
    remaining: 25,
  },
  {
    offer_id: "o4",
    public_name: "دقيق",
    pack_label: "كيس 50كغ",
    unit_name: "كيس",
    confirmed: 30,
    shipped: 20,
    remaining: 10,
  },
];

const SHIPMENTS = (o: Record<string, unknown> = {}) => ({
  order: ORDER({
    id: "po7",
    number: 7741,
    number_label: "ORD-7741",
    status: "preparing",
    status_label: "قيد التجهيز",
    list_status_label: "مشحون جزئياً — 63%",
  }),
  lines: SHIP_LINES,
  shipments: [
    {
      id: "s1",
      number: 1,
      ref_label: "SH-01",
      lines: [{ offer_id: "o1", public_name: "سكر أبيض", qty: 30 }],
      carrier_ref: "",
      eta_note: "",
      note: "",
      shipped_at: "2026-09-15T09:00:00Z",
      received_at: "2026-09-16T09:00:00Z",
    },
    {
      id: "s2",
      number: 2,
      ref_label: "SH-02",
      lines: [{ offer_id: "o1", public_name: "سكر أبيض", qty: 20 }],
      carrier_ref: "",
      eta_note: "",
      note: "",
      shipped_at: "2026-09-17T09:00:00Z",
      received_at: "",
    },
  ],
  next_ref: "SH-03",
  percent: 63,
  can_ship: true,
  side: "supplier",
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

test.describe("ORD-07", () => {
  test("ready → success: طلبك · عرض المورد · الفرق، ثم قُبل العرض نسخةً لا مرجعاً", async ({
    page,
  }, info) => {
    const posted: number[] = [];
    await page.route(/\/api\/market\/orders\/po1\/compare(\?.*)?$/, (route) =>
      route.fulfill(json(200, COMPARE())),
    );
    await page.route(/\/api\/market\/orders\/po1\/accept$/, (route) => {
      posted.push((route.request().postDataJSON() as { version: number }).version);
      return route.fulfill(json(200, DETAIL_ACCEPTED));
    });
    await login(page, "/market/orders/po1/compare", /\/market\/orders\/po1\/compare$/);
    await expect(page.getByText("طلبك · عرض المورد · الفرق")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-07",
      state: "ready",
      texts: fromFrame("ORD-07", "ready", [
        "طلبك · عرض المورد · الفرق",
        "ثلاثة أعمدة بالوحدة الأساسية، والفرق مسمّى: سعرٌ أعلى، كميةٌ أقل، رسمٌ مضاف، مدةٌ أطول.",
        "لا زرّ قبول قبل عرض الفرق",
        "القبول بضغطةٍ من قائمة يُنتج اتفاقاً لم يُقرأ. الشاشة تُجبر على المقابلة.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-07"]');
    await expect(root).toContainText("Q-2041 — مخزن البركة");
    await expect(root).toContainText("بلا تغيير");
    await expect(root).toContainText(/صلاحية النسخة 2 تنتهي بعد 02:4\d:\d\d/);
    await page.getByRole("button", { name: "قبول النسخة 2 كما هي" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-07",
      state: "success",
      texts: fromFrame("ORD-07", "success", [
        "قُبل العرض",
        "الإصدار المقبول يُثبَّت نسخةً من الاتفاق: كمياته وأسعاره ورسومه ومدته كما كانت لحظة القبول.",
        "نسخة لا مرجع",
        "انتهاء الكتالوج بعد القبول لا يمسّ الاتفاق (ACC-145). مرجعٌ متحرّك يعني عقداً يتغيّر بلا توقيع.",
      ]),
    });
    expect(posted).toEqual([2]);
  });

  test("conflict: فتحتَ النسخة 2 والمورد أصدر النسخة 3 — فرق النسختين، وقبول النسخة 2 مغلق", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po1\/compare(\?.*)?$/, (route) =>
      route.fulfill(json(200, CONFLICT)),
    );
    await login(
      page,
      "/market/orders/po1/compare?version=2",
      /\/market\/orders\/po1\/compare\?version=2$/,
    );
    await expectFrame(page, info, {
      screenId: "ORD-07",
      state: "conflict",
      texts: fromFrame("ORD-07", "conflict", [
        "قبول عرض سعر — لا موافقة على نسخة قديمة",
        "فرق النسخة معروض سطراً بسطر، والقبول يخص النسخة المعروضة وحدها.",
        "تعارض",
        "عرض سعر",
        "Q-2041",
        "— مخزن البركة",
        "نسخة أحدث متاحة",
        "لم نقبل نيابة عنك ولم نستبدل الشاشة من تحتك.",
        "البند",
        "النسخة 2 — التي فتحتها",
        "النسخة 3 — الحالية",
        "الفرق",
        "صلاحية النسخة 3 تنتهي بعد",
        "قبول النسخة 3 كما هي",
        "رفض وطلب تعديل",
        "قبول النسخة 2 — مغلق",
        "سكر أبيض — كرتونة 12×1كغ",
        "بلا تغيير",
        "زيت قلي — كرتونة 12×1لتر",
        "+75.00 للكرتونة · +300.00 للبند",
        "رسوم التوصيل",
        "مشمول",
        "بند جديد لم يكن في النسخة 2",
        "مهلة التسليم",
        "3 أيام",
        "5 أيام",
        "+يومان",
        "الإجمالي",
      ]),
    });
    const root = page.locator('[data-screen="ORD-07"]');
    await expect(root).toContainText("فتحتَ النسخة 2 · المورد أصدر النسخة 3 قبل 6 دقائق");
    await expect(root).toContainText(
      "القبول ينشئ اتفاقاً على النسخة 3 بعد قراءتك للفرق؛ النسخة 2 لم تعد قابلة للقبول.",
    );
    await expect(page.getByRole("button", { name: "قبول النسخة 2 — مغلق" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(root).toContainText("+300.00");
  });

  test("validation_error → expired: قبول إصدار ليس الأحدث يُرفض صراحةً، ثم صلاحية انتهت — اطلب تأكيداً جديداً", async ({
    page,
  }, info) => {
    let body = COMPARE();
    await page.route(/\/api\/market\/orders\/po1\/compare(\?.*)?$/, (route) =>
      route.fulfill(json(200, body)),
    );
    await page.route(/\/api\/market\/orders\/po1\/accept$/, (route) => {
      body = COMPARE({
        shown: V(2, { valid_until: "2026-09-01" }),
        latest: V(2, { valid_until: "2026-09-01" }),
        expired: true,
        seconds_left: 0,
      });
      return route.fulfill(
        json(400, { detail: "version_superseded", field: "version", extra: { latest: 3 } }),
      );
    });
    const requoted: string[] = [];
    await page.route(/\/api\/market\/orders\/po1\/requote$/, (route) => {
      requoted.push("x");
      return route.fulfill(json(200, DETAIL_ACCEPTED));
    });
    await login(page, "/market/orders/po1/compare", /\/market\/orders\/po1\/compare$/);
    await page.getByRole("button", { name: "قبول النسخة 2 كما هي" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-07",
      state: "validation_error",
      texts: fromFrame("ORD-07", "validation_error", [
        "قبول إصدار ليس الأحدث",
        "رفض صريح",
        "لا نُحوّل القبول إلى الأحدث ضمناً (ACC-125). نعرض الإصدار الجديد وفرقه ونطلب قبولاً جديداً.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-07"]');
    await expect(root).toContainText("الرابط المفتوح للإصدار 2 والمورد أرسل الإصدار 3.");
    await page.getByRole("button", { name: "اعرض الإصدار الجديد وفرقه" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-07",
      state: "expired",
      texts: fromFrame("ORD-07", "expired", [
        "انتهت صلاحية العرض أثناء المراجعة",
        "لا قبول صامت",
        "التأكيد الخادمي يمنع اعتباره سعراً حالياً (ACC-143). المعروض: «اطلب تأكيداً جديداً» لا «تابع».",
      ]),
    });
    await expect(page.getByRole("button", { name: "قبول — مغلق" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("button", { name: "اطلب تأكيداً جديداً" }).click();
    await expect(root).toContainText("طُلب تأكيد جديد");
    expect(requoted).toHaveLength(1);
  });
});

test.describe("ORD-08", () => {
  test("partial → validation_error → success: الشحنة الثالثة، الصف الثالث يتجاوز المؤكَّد فيُوقف الحفظ، ثم شُحنت SH-03", async ({
    page,
  }, info) => {
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po7\/shipments$/, (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, SHIPMENTS()));
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(
        json(
          201,
          SHIPMENTS({
            percent: 78,
            shipped: "SH-03",
            next_ref: "SH-04",
            shipments: [
              ...SHIPMENTS().shipments,
              {
                id: "s3",
                number: 3,
                ref_label: "SH-03",
                lines: [],
                carrier_ref: "",
                eta_note: "",
                note: "",
                shipped_at: new Date().toISOString(),
                received_at: "",
              },
            ],
          }),
        ),
      );
    });
    await login(page, "/market/orders/po7/ship", /\/market\/orders\/po7\/ship$/);
    await expect(page.getByText("تجهيز شحنة —")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-08",
      state: "partial",
      texts: fromFrame("ORD-08", "partial", [
        "تجهيز وتسليم جزئي — التراكم لا يتجاوز المؤكَّد أبداً",
        "شحنة بعد شحنة على الطلب نفسه. الحدّ الصلب: مجموع المشحون ≤ المؤكَّد لكل صنف، وكل شحنة لها مرجع مستقل يُطابق عند الاستلام.",
        "جزئي",
        "تجهيز شحنة —",
        "ORD-7741",
        "المشتري: بقالة النيل — تجريبي · الشحنة الثالثة على هذا الطلب",
        "مرجع الشحنة SH-03",
        "الصنف والوحدة",
        "مؤكَّد",
        "شُحن سابقاً",
        "هذه الشحنة",
        "المتبقّي",
        "الحدّ",
        "مرجع الشحنة — لماذا مستقلّ",
        "كل شحنة تحمل مرجعاً خاصاً",
        "SH-01/02/03",
        "سكر أبيض",
        "كرتونة 12×1كغ",
        "الحدّ الأقصى لهذه الشحنة 50 — ضمن الحدّ.",
        "شاي أسود",
        "كرتونة 24×250غ",
        "اكتمل الصنف. الحقل مغلق لا معطَّل بلا تفسير.",
        "زيت طعام",
        "كرتونة 4×5ل",
        "دقيق",
        "كيس 50كغ",
      ]),
    });
    const root = page.locator('[data-screen="ORD-08"]');
    await page.getByLabel("هذه الشحنة — زيت طعام").fill("40");
    await page.getByLabel("هذه الشحنة — دقيق").fill("10");
    await expect(root).toContainText("يُكمل الصنف بهذه الشحنة.");
    await page.getByRole("button", { name: "احفظ الشحنة SH-03" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-08",
      state: "validation_error",
      texts: fromFrame("ORD-08", "validation_error", [
        "أُدخل 40 كرتونة والمتبقّي 25 فقط. لا نقبل الشحنة ولا نقتطع الفائض صامتين — نوقف الحفظ ونعرض الرقم الأقصى المسموح. لو أراد المورد شحن أكثر فذلك",
        "تعديل على الطلب",
        "يحتاج موافقة المشتري، لا شحنة زائدة.",
        "يتجاوز المؤكَّد بـ15. الأقصى المسموح 25 — الحفظ موقوف.",
      ]),
    });
    expect(posted).toHaveLength(0);
    await page.getByLabel("هذه الشحنة — زيت طعام").fill("25");
    await page.getByRole("button", { name: "احفظ الشحنة SH-03" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-08",
      state: "success",
      texts: fromFrame("ORD-08", "success", [
        "شُحنت SH-03",
        "حالة الطلب صارت «مشحون جزئياً — 78%». المتبقّي معلَن للطرفين، وللمشتري أن يلغيه (ORD-10) أو ينتظر شحنة رابعة.",
      ]),
    });
    expect(posted[0]?.lines).toEqual([
      { offer_id: "o1", qty: 0 },
      { offer_id: "o2", qty: 0 },
      { offer_id: "o3", qty: 25 },
      { offer_id: "o4", qty: 10 },
    ]);
  });

  test("ready: أول شحنة — بيان المورد كما هو، والمخزون يُكتب بعدّ المشتري في ORD-09", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po7\/shipments$/, (route) =>
      route.fulfill(
        json(
          200,
          SHIPMENTS({
            shipments: [],
            next_ref: "SH-01",
            percent: 0,
            lines: SHIP_LINES.map((l) => ({ ...l, shipped: 0, remaining: l.confirmed })),
          }),
        ),
      ),
    );
    await login(page, "/market/orders/po7/ship", /\/market\/orders\/po7\/ship$/);
    await expectFrame(page, info, {
      screenId: "ORD-08",
      state: "ready",
      texts: fromFrame("ORD-08", "ready", [
        "الشحنة — بيان المورد كما هو",
        "بيان التحميل معروض بلا تعديل. وصول الشحنة لا يكتب مخزوناً — المخزون يُكتب بعدّك في ORD-09.",
        "رقم الناقل ووقت الوصول حقول اختيارية للاستدلال لاحقاً عند الخلاف، لا شروطاً لتسجيل الاستلام.",
      ]),
    });
    await expect(page.locator('[data-screen="ORD-08"]')).toContainText(
      "الشحنة الأولى على هذا الطلب · مرجع الشحنة SH-01",
    );
  });
});
