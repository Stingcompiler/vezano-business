import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.15 — ORD-11 طلب مرتجع تجاري (4) + ORD-12 خلاف وأدلته (5): المرتجع ثلاث خطوات ولا خصم قبل
 * التنفيذ ولا تجاوز للمستلَم غير المُعاد (ACC-141)؛ الخلاف دفتران مستقلان ورقم المورد كما هو،
 * الدليل لا تسوية، القبول بحدّ ORG-02، والإغلاق لا يحرّك دفتراً (ACC-148).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po7",
  op_id: "op",
  number: 7741,
  number_label: "ORD-7741",
  kind: "order",
  kind_label: "طلب",
  status: "disputed",
  status_label: "خلاف مفتوح",
  version: 3,
  supplier_tenant_id: "t2",
  supplier_name: "مخزن البركة — تجريبي",
  buyer_name: "بقالة النيل",
  currency: "SDG",
  lines: [],
  lines_count: 3,
  total_minor: "",
  delivery_to: "",
  fees_label: "",
  note: "",
  response_hours: 72,
  deadline_at: "",
  sent_at: "2026-09-10T10:00:00Z",
  updated_at: "2026-09-13T10:00:00Z",
  responsibilities: [],
  no_reply: false,
  near_deadline: false,
  remaining_hours: 0,
  content_line: "",
  buyer_step: "",
  supplier_step: "",
  flagged: true,
  list_status_label: "خلاف مفتوح",
  ...o,
});

const STEPS = [
  {
    title: "طلب مرتجع — مستند طلب",
    detail: "كميات وأسباب وصور. يُنشئ سجلاً لا حركة مخزون ولا حركة ذمّة.",
  },
  {
    title: "موافقة المورد — قرار مستقلّ",
    detail: "قد يوافق جزئياً: 12 من 12 للسكر، ويرفض الزيت. الموافقة الجزئية حالة معلَنة (partial).",
  },
  {
    title: "التنفيذ — مستند عكسي",
    detail: "هنا فقط يخرج المخزون وتتعدّل الذمّة، بمستند مرتبط بمرجع الشحنة الأصلية.",
  },
];

const RLINES = [
  {
    offer_id: "o1",
    public_name: "سكر أبيض",
    pack_label: "",
    unit_name: "كرتونة",
    received: 30,
    returned_before: 12,
    returnable: 18,
    rejected_at_receipt: 0,
  },
  {
    offer_id: "o2",
    public_name: "زيت طعام",
    pack_label: "",
    unit_name: "كرتونة",
    received: 20,
    returned_before: 0,
    returnable: 20,
    rejected_at_receipt: 0,
  },
  {
    offer_id: "o3",
    public_name: "دقيق",
    pack_label: "",
    unit_name: "كيس",
    received: 10,
    returned_before: 0,
    returnable: 10,
    rejected_at_receipt: 0,
  },
];

const RETURNS = (o: Record<string, unknown> = {}) => ({
  order: ORDER({
    status: "received",
    status_label: "استُلم",
    list_status_label: "استُلم",
    flagged: false,
  }),
  side: "buyer",
  lines: RLINES,
  returns: [],
  steps: STEPS,
  next_ref: "RT-01",
  ...o,
});

const RT = (o: Record<string, unknown> = {}) => ({
  id: "rt1",
  number: 1,
  ref_label: "RT-01",
  lines: [
    {
      offer_id: "o1",
      public_name: "سكر أبيض",
      qty: 12,
      approved_qty: null,
      reason: "عبوات مبلَّلة في شحنة SH-02 — صور مرفقة",
    },
  ],
  status: "requested",
  status_label: "بانتظار موافقة",
  decision_note: "",
  requested_at: "2026-09-19T10:00:00Z",
  decided_at: "",
  ...o,
});

const EV = (
  side: "buyer" | "supplier",
  title: string,
  at: string,
  extra: Record<string, unknown> = {},
) => ({ side, title, at, kind: "evidence", note: "", ...extra });

const DISPUTE = (o: Record<string, unknown> = {}) => ({
  id: "d1",
  number: 311,
  ref_label: "DSP-311",
  title: "فارق كرتونة واحدة",
  shipment_ref: "SH-118",
  status: "open",
  status_label: "مفتوح",
  turn: "supplier",
  turn_label: "بانتظار رد المورد",
  turn_deadline: "2026-09-22T10:00:00Z",
  days_open: 3,
  lines: [
    {
      offer_id: "o1",
      public_name: "سكر أبيض",
      unit_name: "كرتونة",
      shipped: 8,
      received: 7,
      rejected: 0,
      gap: 1,
      reason: "",
      price_minor: "118000",
      buyer_value_minor: String(7 * 118000),
      supplier_value_minor: String(8 * 118000),
      gap_value_minor: "118000",
    },
  ],
  evidence: [
    EV("buyer", "صورة الشحنة عند الاستلام — 7 كراتين", "2026-09-12T11:12:00Z"),
    EV("buyer", "توقيع أمين المخزن على الفارق", "2026-09-12T11:14:00Z"),
    EV("supplier", "بيان تحميل يذكر 8 كراتين", "2026-09-12T14:30:00Z"),
    EV("supplier", "مراجعة داخلية مع الناقل — جارية", "2026-09-13T09:05:00Z"),
  ],
  outcome: "",
  outcome_label: "",
  outcome_ref: "",
  mediator_requested_at: "",
  opened_at: "2026-09-12T11:20:00Z",
  closed_at: "",
  buyer_name: "بقالة النيل",
  supplier_name: "مخزن البركة — تجريبي",
  order_number_label: "PO-2041",
  order_id: "po7",
  ...o,
});

const DISPUTES = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  order: ORDER(),
  side: "buyer",
  disputes: rows,
  can_settle: true,
  turn_hours: 72,
  ...extra,
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

test.describe("ORD-11", () => {
  test("ready → validation_error → success → partial: القابل للإرجاع، الفحص على الخادم لا على الشاشة، ولا خصم قبل التنفيذ", async ({
    page,
  }, info) => {
    let body = RETURNS();
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po7\/returns$/, (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, body));
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      body = RETURNS({
        returns: [RT()],
        next_ref: "RT-02",
        lines: RLINES.map((l) =>
          l.offer_id === "o1" ? { ...l, returned_before: 24, returnable: 6 } : l,
        ),
      });
      return route.fulfill(json(201, { ...body, created: RT() }));
    });
    await login(page, "/market/orders/po7/return", /\/market\/orders\/po7\/return$/);
    await expect(page.getByText("الكميات القابلة للإرجاع")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-11",
      state: "ready",
      texts: fromFrame("ORD-11", "ready", [
        "طلب مرتجع تجاري — موافقة ثم تنفيذ، ومستند مستقلّ لكل خطوة",
        "المرتجع ثلاث خطوات لا خطوة: طلب، موافقة مورد، ثم تنفيذ مادّي بمستند عكسي. لا خصم من الذمّة قبل التنفيذ، ولا تجاوز للمستلَم غير المُعاد (ACC-141).",
        "مرتجع على الطلب",
        "ORD-7741",
        "— الكميات القابلة للإرجاع",
        "الصنف",
        "مستلَم",
        "أُرجع سابقاً",
        "القابل للإرجاع",
        "هذا الطلب",
        "السبب",
        "الخطوات ومستنداتها",
        "لا خصم من الذمّة قبل التنفيذ",
        "طلب مرتجع — مستند طلب",
        "كميات وأسباب وصور. يُنشئ سجلاً لا حركة مخزون ولا حركة ذمّة.",
        "موافقة المورد — قرار مستقلّ",
        "التنفيذ — مستند عكسي",
        "هنا فقط يخرج المخزون وتتعدّل الذمّة، بمستند مرتبط بمرجع الشحنة الأصلية.",
        "لاحقاً",
        "سليم — لا إرجاع",
      ]),
    });
    const root = page.locator('[data-screen="ORD-11"]');
    await page.getByLabel("هذا الطلب — سكر أبيض").fill("30");
    await page.getByLabel("السبب — سكر أبيض").fill("عبوات مبلَّلة في شحنة SH-02 — صور مرفقة");
    await page.getByRole("button", { name: "أرسل طلب المرتجع RT-01" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-11",
      state: "validation_error",
      texts: fromFrame("ORD-11", "validation_error", [
        "validation_error:",
        "يتجاوز القابل للإرجاع — الأقصى 18. الفحص على الخادم لا على الشاشة.",
      ]),
    });
    await expect(root).toContainText(
      "طُلب إرجاع 30 والقابل للإرجاع 18 — لأن 12 أُرجعت في مرتجع سابق. المجموع لا يتجاوز المستلَم بأي حال",
    );
    expect(posted).toHaveLength(0);
    await page.getByLabel("هذا الطلب — سكر أبيض").fill("12");
    await page.getByRole("button", { name: "أرسل طلب المرتجع RT-01" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-11",
      state: "success",
      texts: fromFrame("ORD-11", "success", ["بانتظار موافقة", "لا خصم من الذمّة قبل التنفيذ"]),
    });
    await expect(root).toContainText("مرتجع قيد الموافقة — لم يُخصم بعد");
    expect(posted[0]).toEqual({
      lines: [{ offer_id: "o1", qty: 12, reason: "عبوات مبلَّلة في شحنة SH-02 — صور مرفقة" }],
    });
    // الموافقة الجزئية حالة معلَنة
    body = RETURNS({
      returns: [
        RT({
          status: "partial",
          status_label: "موافقة جزئية",
          lines: [
            {
              offer_id: "o1",
              public_name: "سكر أبيض",
              qty: 12,
              approved_qty: 10,
              reason: "عبوات مبلَّلة",
            },
          ],
          decision_note: "كرتونتان سليمتان",
        }),
      ],
      next_ref: "RT-02",
    });
    await page.getByRole("button", { name: "تفاصيل الطلب" }).click();
    await expect(page).toHaveURL(/\/market\/orders\/po7$/);
    await page.goBack();
    await expectFrame(page, info, {
      screenId: "ORD-11",
      state: "partial",
      texts: fromFrame("ORD-11", "partial", [
        "قد يوافق جزئياً: 12 من 12 للسكر، ويرفض الزيت. الموافقة الجزئية حالة معلَنة (partial).",
        "الآن",
        "تم",
      ]),
    });
    await expect(root).toContainText("موافقة جزئية — RT-01");
    await expect(root).toContainText("سكر أبيض: 10 من 12 — كرتونتان سليمتان");
  });
});

test.describe("ORD-12", () => {
  test("partial → success: الخلاف بدفترين ورقم المورد كما هو، الدليل يقلب الدور، والإغلاق بمرجع لا يحرّك دفتراً", async ({
    page,
  }, info) => {
    let rows: unknown[] = [DISPUTE()];
    const acts: string[] = [];
    await page.route(/\/api\/market\/orders\/po7\/disputes$/, (route) =>
      route.fulfill(json(200, DISPUTES(rows))),
    );
    await page.route(/\/api\/market\/orders\/po7\/disputes\/d1\/(\w[\w-]*)$/, (route) => {
      const action = route.request().url().split("/").pop() ?? "";
      acts.push(action);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (action === "evidence") {
        rows = [
          DISPUTE({
            turn: "supplier",
            turn_label: "بانتظار رد المورد",
            evidence: [
              ...DISPUTE().evidence,
              EV("buyer", String(body.title), new Date().toISOString()),
            ],
          }),
        ];
      } else if (action === "close") {
        rows = [
          DISPUTE({
            status: "closed",
            status_label: "مُغلق",
            outcome: "credit",
            outcome_label: "خصم/إشعار دائن",
            outcome_ref: String(body.ref),
            turn_label: "مُغلق",
          }),
        ];
      } else if (action === "mediator") {
        rows = [DISPUTE({ mediator_requested_at: new Date().toISOString() })];
      }
      return route.fulfill(json(200, { ...DISPUTES(rows), dispute: rows[0] }));
    });
    await login(page, "/market/orders/po7/disputes", /\/market\/orders\/po7\/disputes$/);
    await expect(page.getByText("الأدلة وآخر إجراء")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-12",
      state: "partial",
      texts: fromFrame("ORD-12", "partial", [
        "الخلاف — دفتران مستقلان وموظف مسؤول",
        "ACC-148: إغلاق تذكرة الدعم لا يسوّي دفتراً. ما يُغلق هو التذكرة، وما يسوّي هو إجراء مخوَّل من الطرف نفسه.",
        "جزئي",
        "خلاف",
        "DSP-311",
        "— فارق كرتونة واحدة",
        "بانتظار رد المورد",
        "دفترك — بقالة النيل",
        "دفتر المورد — كما يعرضه هو",
        "نعرض رقمه كما هو ولا نعدّله ولا نضعه في دفترك. الاختلاف حقيقة قائمة لا خطأ يُصحّح تلقائياً.",
        "الأدلة وآخر إجراء",
        "لا تسوية تلقائية",
        "إضافة دليل أو تعليق",
        "قبول رقم المورد وتعديل دفتري",
        "طلب وسيط من فيزانو —",
        "PLT-08",
        "المستلم من الشحنة",
        "7 كراتين",
        "الذمة المسجَّلة",
        "إدخال المخزون",
        "المشحون من الشحنة",
        "8 كراتين",
        "المطالبة المسجَّلة",
        "الفارق المتنازع",
        "أنت",
        "صورة الشحنة عند الاستلام — 7 كراتين",
        "توقيع أمين المخزن على الفارق",
        "المورد",
        "بيان تحميل يذكر 8 كراتين",
        "مراجعة داخلية مع الناقل — جارية",
      ]),
    });
    const root = page.locator('[data-screen="ORD-12"]');
    await expect(root).toContainText("على الشحنة SH-118 · مفتوح 3 أيام · مسؤول من كل طرف");
    await expect(root).toContainText("12 سبتمبر");
    await expect(root).toContainText("8,260.00");
    await expect(root).toContainText("9,440.00");
    await page.getByLabel("عنوان الدليل أو التعليق").fill("صورة ثانية للصندوق الناقص");
    await page.getByRole("button", { name: "إضافة دليل أو تعليق" }).click();
    await expect(root).toContainText("صورة ثانية للصندوق الناقص");
    await page.getByRole("button", { name: "طلب وسيط من فيزانو — PLT-08" }).click();
    await expect(page.getByRole("button", { name: "طلب وسيط من فيزانو — PLT-08" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("button", { name: "خصم/إشعار دائن" }).click();
    await page.getByLabel("مرجع المستند المستقل (مرتجع/إشعار دائن/إقرار)").fill("CN-2041-1");
    await page.getByRole("button", { name: "أغلق الخلاف بمرجعه" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-12",
      state: "success",
      texts: fromFrame("ORD-12", "success", [
        "أُغلق الخلاف",
        "بالنتيجة المتفَق عليها ومرجعها: مرتجعٌ أو خصمٌ أو قبولٌ بالحالة.",
        "الإغلاق لا يُحرّك دفتراً",
        "ما يُسوّى يُسوّى بمستند مستقل يُرى في كشف الطرف (ACC-148). إغلاقُ تذكرةٍ ليس قيداً.",
      ]),
    });
    await expect(root).toContainText("DSP-311 — خصم/إشعار دائن · CN-2041-1");
    expect(acts).toEqual(["evidence", "mediator", "close"]);
  });

  test("ready → permission_denied: من عليه الدور معلَن، ومسؤول الاستلام يرفع الدليل ولا يسوّي", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po7\/disputes$/, (route) =>
      route.fulfill(
        json(
          200,
          DISPUTES(
            [
              DISPUTE({
                status: "closed",
                status_label: "مُغلق",
                outcome: "accept",
                outcome_label: "قبول بالحالة",
                turn_label: "مُغلق",
              }),
              DISPUTE({ id: "d2", number: 312, ref_label: "DSP-312", title: "فارق كرتونتين" }),
            ],
            { can_settle: false },
          ),
        ),
      ),
    );
    await page.route(/\/api\/market\/orders\/po7\/disputes\/d2\/accept-supplier$/, (route) =>
      route.fulfill(json(403, { detail: "permission_denied" })),
    );
    await login(page, "/market/orders/po7/disputes?d=d1", /\/market\/orders\/po7\/disputes\?d=d1$/);
    await expectFrame(page, info, {
      screenId: "ORD-12",
      state: "ready",
      texts: fromFrame("ORD-12", "ready", [
        "الخلاف ومن عليه الدور",
        "الخط الزمني وأدلة الطرفين وآخر إجراء ومهلة الرد — ومن عليه الدور معلَنٌ في الترويسة.",
        "الدور مسمّى",
        "خلافٌ بلا صاحب دورٍ يبقى مفتوحاً شهراً. الشاشة تقول «بانتظارك» أو «بانتظار المورد» ومتى تنتهي المهلة.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-12"]');
    await expect(root).toContainText("DSP-311 — فارق كرتونة واحدة");
    await expect(root).toContainText("مُغلق · قبول بالحالة");
    await page.getByRole("button", { name: /DSP-312/ }).click();
    await expect(page).toHaveURL(/disputes\?d=d2$/);
    await expect(root).toHaveAttribute("data-state", "partial");
    await page.getByRole("button", { name: "قبول رقم المورد وتعديل دفتري" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-12",
      state: "permission_denied",
      texts: fromFrame("ORD-12", "permission_denied", [
        "مسؤول الاستلام يرفع الدليل ولا يسوّي",
        "يصوّر التالف ويكتب الواقعة، ولا يقبل تسويةً مالية.",
        "حدّ الدور",
        "التسوية إقرارٌ مالي يخضع لحدّ ORG-02. والشهادة على ما رآه ليست تنازلاً عن مال.",
      ]),
    });
  });

  test("empty: لا خلافات — حالةٌ سويّة بل مرغوبة، ولا لوحة مؤشرات", async ({ page }, info) => {
    await page.route(/\/api\/market\/orders\/po7\/disputes$/, (route) =>
      route.fulfill(json(200, DISPUTES([]))),
    );
    await login(page, "/market/orders/po7/disputes", /\/market\/orders\/po7\/disputes$/);
    await expectFrame(page, info, {
      screenId: "ORD-12",
      state: "empty",
      texts: fromFrame("ORD-12", "empty", [
        "لا خلافات",
        "حالةٌ سويّة بل مرغوبة.",
        "لا لوحة مؤشرات",
        "عددُ خلافاتٍ تاريخي لا يفيد المشتري. الفراغ يبقى فراغاً.",
      ]),
    });
  });
});
