import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.14 — PUR-03 مستند الشراء واعتماده (4) + PUR-04 مرتجع المشتريات (4): الاعتماد توقيع على
 * مبلغ؛ الفروق عن الأمر تُعرض؛ بلا رقم فاتورة ولا سبب زيادة يُمنع الاعتماد ويبقى الحفظ؛ فوق الحدّ
 * يُعرض الرقمان والإحالة تُبقيه مسوّدة؛ الاعتماد يُعلن آثاره الثلاثة؛ المرتجع بسعر المستند لا
 * يتجاوز المستلَم وبسبب لكل سطر؛ ردّ المورد الجزئي يبقى مفتوحاً بالمرفوض.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const LINES = [
  {
    id: "l1",
    item_name: "سكر ناعم",
    unit_name: "كراتين",
    ordered_qty_milli: "10000",
    received_qty_milli: "8000",
    unit_price_minor: "20000",
    est_unit_price_minor: "20000",
    line_total_minor: "160000",
    excess_reason: "",
    returned_qty_milli: "0",
    diff: "qty",
  },
  {
    id: "l2",
    item_name: "زيت دوّار الشمس",
    unit_name: "الكرتون",
    ordered_qty_milli: "8000",
    received_qty_milli: "8000",
    unit_price_minor: "18000",
    est_unit_price_minor: "15000",
    line_total_minor: "144000",
    excess_reason: "",
    returned_qty_milli: "0",
    diff: "price",
  },
  {
    id: "l3",
    item_name: "أرز بسمتي",
    unit_name: "كراتين",
    ordered_qty_milli: "6000",
    received_qty_milli: "6000",
    unit_price_minor: "22916",
    est_unit_price_minor: "22916",
    line_total_minor: "137500",
    excess_reason: "",
    returned_qty_milli: "0",
    diff: "",
  },
];

const doc = (o: Record<string, unknown> = {}, approval: Record<string, unknown> = {}) => ({
  id: "d1",
  number: "441",
  order_id: "o1",
  order_number: "118",
  supplier_name: "مؤسسة الرياض",
  branch_name: "المخزن الرئيسي",
  supplier_invoice_number: "F-2291",
  status: "draft",
  status_label: "مسوّدة",
  total_minor: "441500",
  order_estimated_minor: "418000",
  diff_count: 2,
  due_days: 30,
  lines: LINES,
  approved_by_name: "",
  approved_at: "",
  referred_to_name: "ندى",
  effects: {},
  blockers: [],
  approval: {
    viewer_name: "ندى",
    limit_minor: "",
    over_limit: false,
    can_approve: true,
    ...approval,
  },
  ...o,
});

const APPROVED = doc({
  status: "approved",
  status_label: "معتمد",
  approved_by_name: "ندى",
  approved_at: new Date().toISOString(),
  effects: {
    stock: [
      { item_name: "سكر", qty_milli: "8000", unit_name: "كراتين" },
      { item_name: "أرز", qty_milli: "6000", unit_name: "كراتين" },
      { item_name: "زيت", qty_milli: "8000", unit_name: "كراتين" },
    ],
    cost: [
      { item_name: "سكر", before_minor: "20000", after_minor: "20000", unit_name: "كرتون" },
      { item_name: "الزيت", before_minor: "8875", after_minor: "9210", unit_name: "كرتون" },
    ],
    branch_name: "المخزن الرئيسي",
    payable_minor: "441500",
  },
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

test.describe("PUR-03", () => {
  test("ready → validation_error → success: الفروق مجاورة، بلا رقم فاتورة ولا سبب زيادة يُمنع الاعتماد ويبقى الحفظ، ثم اعتُمد بآثاره الثلاثة", async ({
    page,
  }, info) => {
    let current = doc({ supplier_invoice_number: "" });
    await page.route("**/api/inventory/purchasing/orders/o1/document", (route) =>
      route.fulfill(json(200, { document: current })),
    );
    await page.route("**/api/inventory/purchasing/documents/d1", async (route) => {
      const body = route.request().postDataJSON() as {
        supplier_invoice_number: string;
        lines: { id: string; received_qty_milli: string; excess_reason: string }[];
      };
      const inv = body.supplier_invoice_number;
      const l1 = body.lines.find((l) => l.id === "l1")!;
      const blockers: unknown[] = [];
      if (!inv) blockers.push({ code: "invoice_number_required", title: "رقم الفاتورة" });
      if (Number(l1.received_qty_milli) > 10000 && !l1.excess_reason)
        blockers.push({
          code: "excess_reason_required",
          title: "الزيادة",
          line_id: "l1",
          item_name: "سكر ناعم",
          received_qty_milli: l1.received_qty_milli,
          ordered_qty_milli: "10000",
        });
      current = doc({
        supplier_invoice_number: inv,
        blockers,
        lines: LINES.map((l) =>
          l.id === "l1"
            ? {
                ...l,
                received_qty_milli: l1.received_qty_milli,
                excess_reason: l1.excess_reason,
                line_total_minor: String((20000 * Number(l1.received_qty_milli)) / 1000),
              }
            : l,
        ),
      });
      return route.fulfill(json(200, { document: current }));
    });
    await page.route("**/api/inventory/purchasing/documents/d1/approve", (route) =>
      route.fulfill(json(200, { document: APPROVED })),
    );
    await login(page, "/purchasing/orders/o1/document");
    await expectFrame(page, info, {
      screenId: "PUR-03",
      state: "ready",
      texts: fromFrame("PUR-03", "ready", [
        "مستند الشراء واعتماده — الاعتماد توقيع على مبلغ",
        "هنا يتحرّك المخزون وتتحرّك الذمّة. المستند يُعرض كما سيُحفظ تماماً — بأرقامه وفروقه عن الأمر — والاعتماد فعلٌ باسمٍ ووقت لا ضغطةُ مرور.",
        "مستند شراء 441",
        "فروق عن الأمر 118",
        "الفروق تُعرض ولا تُخفى في تفصيل.",
        "الإجمالي للاعتماد",
        "4,415.00",
        "اعتمد باسم ندى",
        "سكر ناعم — 10 كراتين",
        "زيت دوّار الشمس — سعر الكرتون",
        "أرز بسمتي — كما في الأمر",
      ]),
    });
    // استلام 12 مقابل 10 بلا سبب، ورقم الفاتورة فارغ
    await page.getByLabel("الكمية المستلمة — سكر ناعم").fill("12");
    await page.getByRole("button", { name: "اعتمد باسم ندى" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-03",
      state: "validation_error",
      texts: fromFrame("PUR-03", "validation_error", [
        "مستند بلا رقم فاتورة المورد",
        "الاستلام مكتمل والاعتماد ممنوع: رقم فاتورة المورد فارغ، وصنفٌ استُلم بكمية تفوق الأمر بلا سبب مكتوب.",
        "رقم الفاتورة",
        "هو ما يُطابَق به الدفتران عند المراجعة. بدونه يصير المستند داخلياً لا يُحاجَج به المورد.",
        "الزيادة",
        "استلام 12 مقابل 10 مطلوبة يحتاج سطراً: هديّة، أم خطأ المورد، أم تعديل متّفق عليه هاتفياً.",
        "الاعتماد معطّل والحفظ كمسوّدة متاح — العمل لا يضيع لأن ورقةً ناقصة.",
      ]),
    });
    await expect(page.getByRole("button", { name: "احفظ كمسوّدة" })).toBeEnabled();
    await page.getByLabel("رقم فاتورة المورد").fill("F-2291");
    await page.getByLabel("سبب الزيادة — سكر ناعم").fill("هديّة من المورد");
    await page.getByRole("button", { name: "اعتمد باسم ندى" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-03",
      state: "success",
      texts: fromFrame("PUR-03", "success", [
        "اعتُمد المستند 441",
        "تحرّك المخزون وتحرّكت الذمّة الآن. ثلاثة آثار تُعلَن صراحةً لا تُترك ليكتشفها المستخدم.",
        "المخزون",
        "+8 كراتين سكر و+6 أرز و+8 زيت في المخزن الرئيسي.",
        "التكلفة",
        "متوسط تكلفة الزيت ارتفع من 88.75 إلى 92.10 — والهامش",
        "الذمّة",
        "على المنشأة لمؤسسة الرياض، تستحق بعد 30 يوماً.",
        "المسارات: سجّل دفعة، أنشئ مرتجعاً، اطبع المستند. الاعتماد لا يُلغى — يُعكس بمستند مضادّ.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "متوسط تكلفة الزيت ارتفع من 88.75 إلى 92.10 — والهامش تبعه في «التكلفة والهامش».",
    );
    await expect(page.getByRole("button", { name: "اعتمد باسم ندى" })).toHaveCount(0);
  });

  test("permission_denied: فوق الحدّ نُظهر الرقمين، والإحالة تُبقيه مسوّدة وما أُدخل يبقى", async ({
    page,
  }, info) => {
    let current = doc(
      { supplier_invoice_number: "" },
      { viewer_name: "خالد", limit_minor: "300000", over_limit: true, can_approve: false },
    );
    await page.route("**/api/inventory/purchasing/documents/d1", (route) => {
      const body = route.request().postDataJSON() as { supplier_invoice_number: string };
      current = { ...current, supplier_invoice_number: body.supplier_invoice_number };
      return route.fulfill(json(200, { document: current }));
    });
    await page.route("**/api/inventory/purchasing/documents/d1/refer", (route) => {
      current = { ...current, status: "referred", status_label: "محال للاعتماد" };
      return route.fulfill(json(200, { document: current }));
    });
    let served = 0;
    await page.route(/\/api\/inventory\/purchasing\/documents\/d1$/, (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      served += 1;
      return route.fulfill(json(200, { document: current, return_limits: {}, returns: [] }));
    });
    await login(page, "/purchasing/documents/d1");
    await expectFrame(page, info, {
      screenId: "PUR-03",
      state: "permission_denied",
      texts: fromFrame("PUR-03", "permission_denied", [
        "الاعتماد فوق حدّ الصلاحية",
        "نُظهر الرقمين",
        "حدّك 3,000 وهذا 4,415.",
        "الإحالة",
        "«أحِل إلى ندى» ترسل المستند كما هو، وتُبقيه مسوّدة لا معتمداً — والاعتماد يُنسب لمن وقّع.",
        "ما أدخله المحاسب من أرقام يبقى؛ الإحالة لا تعيد العمل من الصفر.",
      ]),
    });
    expect(served).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /اعتمد باسم/ })).toHaveCount(0);
    await page.getByLabel("رقم فاتورة المورد").fill("F-2291");
    await page.getByRole("button", { name: "أحِل إلى ندى" }).click();
    await expect(page.getByText("محال للاعتماد")).toBeVisible();
    await expect(page.getByLabel("رقم فاتورة المورد")).toHaveValue("F-2291");
    await expect(page.getByRole("button", { name: "أُحيل إلى ندى" })).toBeDisabled();
  });
});

const RET_LINES = [
  {
    id: "r1",
    document_line_id: "l2",
    item_name: "زيت دوّار الشمس 1.5 ل",
    unit_name: "كراتين",
    qty_milli: "8000",
    unit_price_minor: "6000",
    line_total_minor: "48000",
    reason: "عبوات مسرّبة — صُوِّرت عند الاستلام",
    accepted_qty_milli: "",
    supplier_note: "",
  },
  {
    id: "r2",
    document_line_id: "l3",
    item_name: "أرز بسمتي 5 كجم",
    unit_name: "كراتين",
    qty_milli: "6000",
    unit_price_minor: "2800",
    line_total_minor: "16800",
    reason: "خطأ في الطلب — النوع المطلوب حبّة طويلة",
    accepted_qty_milli: "",
    supplier_note: "",
  },
];

const ret = (o: Record<string, unknown> = {}) => ({
  id: "ret1",
  number: "62",
  document_id: "d1",
  document_number: "441",
  supplier_name: "مؤسسة الرياض",
  status: "recorded",
  status_label: "مسجَّل",
  total_minor: "64800",
  accepted_minor: "64800",
  rejected_minor: "0",
  supplier_note: "",
  lines: RET_LINES,
  created_by_name: "ندى",
  created_at: new Date().toISOString(),
  responded_at: "",
  ...o,
});

const RET_DOC = doc({
  status: "approved",
  status_label: "معتمد",
  approved_by_name: "ندى",
  lines: [
    { ...LINES[0]!, item_name: "سكر ناعم", unit_name: "كراتين", received_qty_milli: "10000" },
    {
      ...LINES[1]!,
      item_name: "زيت دوّار الشمس 1.5 ل",
      unit_name: "كراتين",
      unit_price_minor: "6000",
    },
    { ...LINES[2]!, item_name: "أرز بسمتي 5 كجم", unit_name: "كراتين", unit_price_minor: "2800" },
  ],
});

test.describe("PUR-04", () => {
  test("ready → validation_error → success: بسعر المستند، لا يُردّ أكثر مما استُلم وبسبب لكل سطر، ثم سُجّل المرتجع", async ({
    page,
  }, info) => {
    await page.route(/\/api\/inventory\/purchasing\/documents\/d1$/, (route) =>
      route.fulfill(
        json(200, {
          document: RET_DOC,
          return_limits: { l1: 10000, l2: 8000, l3: 6000 },
          returns: [],
        }),
      ),
    );
    await page.route("**/api/inventory/purchasing/documents/d1/return", (route) =>
      route.fulfill(json(201, { return: ret() })),
    );
    await login(page, "/purchasing/documents/d1/return");
    await expectFrame(page, info, {
      screenId: "PUR-04",
      state: "ready",
      texts: fromFrame("PUR-04", "ready", [
        "مرتجع المشتريات — يُردّ ما استُلم بالسعر الذي استُلم به",
        "المرتجع يُبنى على مستند شراء بعينه لا على الصنف مجرّداً، فيرجع بسعر تلك الفاتورة لا بسعر اليوم — وإلا صارت المرتجعات باباً لتغيير التكلفة.",
        "مرتجع على مستند 441",
        "الأسعار مثبّتة من المستند الأصلي",
        "الصنف",
        "استُلم",
        "يُردّ",
        "سعر المستند",
        "السبب",
        "السبب إلزامي لكل سطر: المرتجع بلا سبب لا يُقرأ في تحليلات المورد",
        "ولا يُحاجَج به. «تالف» و«خطأ في الطلب» و«قارب الانتهاء» ثلاثة أحكام مختلفة على المورد.",
        "قيمة المرتجع",
        "زيت دوّار الشمس 1.5 ل",
        "سكر ناعم",
        "أرز بسمتي 5 كجم",
      ]),
    });
    // 9 كراتين أرز من 6 مستلمة + زيت بكمية بلا سبب
    await page.getByLabel("يُردّ — أرز بسمتي 5 كجم").fill("9");
    await page.getByLabel("السبب — أرز بسمتي 5 كجم").fill("خطأ في الطلب");
    await page.getByLabel("يُردّ — زيت دوّار الشمس 1.5 ل").fill("8");
    await page.getByRole("button", { name: "سجّل المرتجع" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-04",
      state: "validation_error",
      texts: fromFrame("PUR-04", "validation_error", [
        "ردٌّ أكثر مما استُلم",
        "محاولة ردّ 9 كراتين أرز",
        "من 6 مستلمة، وسطرٌ بكمية ردّ بلا سبب.",
        "الكمية",
        "لا يُردّ ما لم يُستلم. الحدّ الأعلى لكل سطر هو المستلم ناقص ما رُدّ سابقاً على نفس المستند.",
        "السبب",
        "إلزامي لأنه يُقرأ في",
        "«تالف» حكمٌ على المورد، و«خطأ في الطلب» حكمٌ علينا.",
        "الحقل يُقصَر على الحدّ فور تجاوزه، ويُعرض الحدّ بجانبه — لا رسالة بعد الحفظ.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "إلزامي لأنه يُقرأ في «تحليلات المورد»: «تالف» حكمٌ على المورد",
    );
    await page.getByLabel("يُردّ — أرز بسمتي 5 كجم").fill("6");
    await page
      .getByLabel("السبب — أرز بسمتي 5 كجم")
      .fill("خطأ في الطلب — النوع المطلوب حبّة طويلة");
    await page
      .getByLabel("السبب — زيت دوّار الشمس 1.5 ل")
      .fill("عبوات مسرّبة — صُوِّرت عند الاستلام");
    await expect(page.getByText("−648.00")).toBeVisible();
    await page.getByRole("button", { name: "سجّل المرتجع" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-04",
      state: "success",
      texts: fromFrame("PUR-04", "success", [
        "سُجّل المرتجع 62",
        "لصالح المنشأة على المورد — إشعار دائن لا نقد.",
        "التكلفة",
        "لا تتأثر: الردّ بسعر المستند نفسه، فالمتوسط المرجّح يبقى كما هو. هذا سبب تثبيت السعر ابتداءً.",
        "التحليلات",
        "مع سببه مصنّفاً.",
        "المسار: خصمه من مستحقّ المورد، أو مطالبته باستبدال عينيّ.",
        "8 كراتين",
        "عبوات مسرّبة — صُوِّرت عند الاستلام",
        "6 كراتين",
        "خطأ في الطلب — النوع المطلوب حبّة طويلة",
      ]),
    });
  });

  test("partial: المورد قَبِل الزيت ورفض الأرز — المرتجع يبقى مفتوحاً والمقبول وحده يُخصم", async ({
    page,
  }, info) => {
    const partial = ret({
      status: "partial",
      status_label: "مقبول جزئياً",
      accepted_minor: "19200",
      rejected_minor: "45600",
      supplier_note: "النوع مطابق لما طُلب في الأمر",
      responded_at: new Date().toISOString(),
      lines: [
        {
          ...RET_LINES[0]!,
          item_name: "الزيت",
          qty_milli: "2000",
          unit_price_minor: "9600",
          line_total_minor: "19200",
          accepted_qty_milli: "2000",
        },
        {
          ...RET_LINES[1]!,
          item_name: "الأرز",
          qty_milli: "3000",
          unit_price_minor: "15200",
          line_total_minor: "45600",
          accepted_qty_milli: "0",
        },
      ],
    });
    let responded = false;
    await page.route("**/api/inventory/purchasing/returns/ret1", (route) => {
      if (route.request().method() === "POST") {
        responded = true;
        return route.fulfill(json(200, { return: partial }));
      }
      return route.fulfill(json(200, { return: ret({ total_minor: "64800" }) }));
    });
    await page.route(/\/api\/inventory\/purchasing\/documents\/d1$/, (route) =>
      route.fulfill(
        json(200, {
          document: RET_DOC,
          return_limits: { l1: 10000, l2: 6000, l3: 3000 },
          returns: [],
        }),
      ),
    );
    await login(page, "/purchasing/returns/ret1");
    await expect(page.locator('[data-screen="PUR-04"][data-state="ready"]')).toBeVisible();
    await page.getByLabel("قَبِل المورد من زيت دوّار الشمس 1.5 ل").fill("2");
    await page.getByLabel("قَبِل المورد من أرز بسمتي 5 كجم").fill("0");
    await page.getByLabel("ما قاله المورد").fill("النوع مطابق لما طُلب في الأمر");
    await page.getByRole("button", { name: "سجّل ردّ المورد" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-04",
      state: "partial",
      texts: fromFrame("PUR-04", "partial", [
        "رُدَّ بعض ما طُلب ردُّه",
        "«النوع مطابق لما طُلب في الأمر»",
        "لا نُغلقه",
        "المرتجع يبقى مفتوحاً بالمرفوض، ويُسجَّل ردُّ المورد نصاً كما قاله — هو الذي سيُحتجّ به لاحقاً.",
        "الأثر المالي",
        "يُخصم المقبول (",
        "192",
        "لا يُخصم ولا يعود للمخزون قبل قرارك: تحتفظ به أو تتصعّد.",
      ]),
    });
    expect(responded).toBe(true);
    await expect(page.getByRole("button", { name: "سجّل ردّ المورد" })).toHaveCount(0);
  });
});
