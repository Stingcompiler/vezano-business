import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.26 — LINK-03 تحويل استلام إلى مستند (5) + LINK-04 روابط المستندات وتسوية الفرق (5) + LINK-05
 * تحويل المرتجع لمستند عكسي (5): معاينة الأثر ومصدر واحد لا تكرار (ACC-130)، استلام يدوي مطابق
 * يوقف التحويل، الفرق يُعرض بلا «رقم صحيح» والتسوية لمن له حدّ مالي، والعكسي بالمقبول وحده (ACC-132).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

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

const SHIP = (o: Record<string, unknown> = {}) => ({
  shipment_id: "s3",
  ref_label: "SH-03",
  order_id: "o1",
  order_label: "ORD-7741",
  supplier_name: "مخزن البركة للجملة — تجريبي",
  received_at: hoursAgo(5),
  received_by_name: "أحمد",
  converted: false,
  local_number: "",
  mode: "",
  ...o,
});
const LINES = [
  {
    offer_id: "a",
    offer_name: "سكر أبيض معبّأ",
    supplier_unit: "كرتونة",
    received: 7,
    shipped: 8,
    price_minor: 118000,
    item_name: "سكر أبيض",
    unit_name: "كيس 1كغ",
    factor_milli: 12000,
    my_qty_milli: 84000,
    value_minor: 826000,
  },
  {
    offer_id: "b",
    offer_name: "شاي سيلاني",
    supplier_unit: "كرتونة",
    received: 2,
    shipped: 2,
    price_minor: 90000,
    item_name: "شاي أسود",
    unit_name: "علبة 250غ",
    factor_milli: 24000,
    my_qty_milli: 48000,
    value_minor: 180000,
  },
  {
    offer_id: "c",
    offer_name: "زيت نباتي",
    supplier_unit: "كرتونة",
    received: 3,
    shipped: 3,
    price_minor: 60000,
    item_name: "زيت طعام",
    unit_name: "عبوة 5ل",
    factor_milli: 4000,
    my_qty_milli: 12000,
    value_minor: 180000,
  },
];
const DUP = {
  receipt_id: "rc1",
  receipt_number: "RC-0771",
  occurred_at: hoursAgo(4),
  user_name: "المالك",
  lines: [{ item_name: "سكر أبيض", qty_milli: "84000", unit_code: "kg1" }],
};
const PREVIEW = (
  state: "ready" | "unmapped" | "duplicate" | "converted",
  o: Record<string, unknown> = {},
) => ({
  shipment: SHIP(
    state === "converted" ? { converted: true, local_number: "PD-12", mode: "created" } : {},
  ),
  party_linked: true,
  party_name: "مخزن البركة",
  branch_id: "b2",
  branch_name: "فرع بحري",
  lines: state === "unmapped" ? LINES.slice(0, 2) : LINES,
  unmapped:
    state === "unmapped" ? [{ offer_id: "c", name: "زيت نباتي", unit_name: "كرتونة", qty: 3 }] : [],
  payable_minor: "1186000",
  state,
  duplicates: state === "duplicate" ? [DUP] : [],
  link: state === "converted" ? { local_number: "PD-12", mode: "created" } : null,
  ...o,
});

test.describe("LINK-03", () => {
  test("ready → conflict → success: المعاينة عقدٌ لا يحدث قبله شيء، والاستلام اليدوي المطابق يوقف، ثم مستند واحد", async ({
    page,
  }, info) => {
    let pvState: "ready" | "duplicate" | "converted" = "duplicate";
    let converted = false;
    await page.route("**/api/market/link/receipts", (route) =>
      route.fulfill(
        json(200, {
          state: "ready",
          can_convert: true,
          shipments: [
            SHIP({
              converted,
              local_number: converted ? "PD-12" : "",
              mode: converted ? "created" : "",
            }),
          ],
          pending_count: converted ? 0 : 1,
        }),
      ),
    );
    await page.route("**/api/market/link/receipts/s3/preview", (route) =>
      route.fulfill(json(200, PREVIEW(pvState))),
    );
    await page.route("**/api/market/link/receipts/s3/convert", (route) => {
      const b = route.request().postDataJSON() as {
        distinct_receipt_ids?: string[];
        attach_receipt_id?: string;
      };
      if (!b.distinct_receipt_ids && !b.attach_receipt_id && pvState === "duplicate")
        return route.fulfill(
          json(409, {
            detail: "duplicate_receipt",
            field: "shipment_id",
            extra: { receipts: [{ receipt_id: "rc1", receipt_number: "RC-0771" }] },
          }),
        );
      converted = true;
      pvState = "converted";
      return route.fulfill(
        json(201, {
          link: {
            id: "l1",
            local_number: "PD-12",
            mode: b.attach_receipt_id ? "attached" : "created",
          },
        }),
      );
    });
    await login(page, "/market/link/receipts", /\/market\/link\/receipts$/);
    await page.getByRole("button", { name: /SH-03 من ORD-7741/ }).click();
    await expectFrame(page, info, {
      screenId: "LINK-03",
      state: "conflict",
      texts: fromFrame("LINK-03", "conflict", [
        "تحويل استلام إلى مستند — معاينة الأثر ومصدر واحد لا تكرار",
        "شحنة وصلت عبر طلب سوق تصبح مستند استلام في دفترك. الخطر: أن تُسجّلها يدوياً أيضاً فيصير المخزون ضعف الحقيقة. لذلك المصدر واحد ومعلَن.",
        "هذه الشحنة سُجِّلت يدوياً بالفعل",
        "وجدنا مستند استلام",
        "RC-0771",
        "بنفس الكميات وتاريخ قريب. نوقف التحويل ونعرض المستندين جنباً إلى جنب: إمّا تربط هذا بذاك فيبقى مستند واحد، أو تؤكّد أنهما شحنتان مختلفتان. لا نُضيف ولا نحذف تلقائياً — الرقم المزدوج في المخزون لا يظهر إلا في الجرد بعد شهر.",
        "معاينة الأثر قبل التحويل",
        "SH-03",
        "من الطلب",
        "ORD-7741",
        "مستند استلام جديد في دفترك",
        "يشير إلى شحنة السوق SH-03 كمصدر — مصدر واحد معلَن",
        "المخزون — فرع بحري",
        "ثلاثة أصناف بوحداتك بعد التحويل المؤكَّد",
        "ذمّة المورد",
        "تُسجَّل كما في الطلب المؤكَّد، لا كما في أي سعر حالي",
        "ما لا يحدث",
        "لا سداد",
        "التحويل يسجّل الالتزام ولا يدفع شيئاً",
        "لا شيء من هذا يحدث قبل ضغطك. المعاينة هي العقد: تقرأ الأثر كاملاً ثم تُقرّه.",
      ]),
    });
    const root = page.locator('[data-screen="LINK-03"]');
    await expect(root).toContainText("سكر أبيض · 84 كيس 1كغ (7 كرتونة × 12)");
    await expect(page.getByRole("button", { name: "أقرّ الأثر وحوّل إلى مستند" })).toHaveCount(0);
    await page.getByRole("button", { name: "شحنتان مختلفتان — حوّل مستنداً جديداً" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-03",
      state: "success",
      texts: fromFrame("LINK-03", "success", [
        "أُنشئ المستند",
        "مستند شراء في دفترك مرتبطٌ بطلب السوق. الأثر مُعلن: المخزون والذمّة والتكلفة.",
        "لا أثر مزدوج",
        "المستند يُنشأ مرة واحدة ولو أُعيد التحويل (ACC-130) — والرابط بينهما هو الحارس.",
      ]),
    });
    await expect(root).toContainText("PD-12");
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(root).toContainText("حُوِّلت — PD-12");
    await expect(root).toContainText("بانتظار التحويل — 0");
  });

  test("ready → validation_error: صنف بلا مطابقة يوقف التحويل ولا نُنشئ تلقائياً", async ({
    page,
  }, info) => {
    await page.route("**/api/market/link/receipts", (route) =>
      route.fulfill(
        json(200, { state: "ready", can_convert: true, shipments: [SHIP()], pending_count: 1 }),
      ),
    );
    let first = true;
    await page.route("**/api/market/link/receipts/s3/preview", (route) => {
      const s = first ? "ready" : "unmapped";
      first = false;
      return route.fulfill(json(200, PREVIEW(s)));
    });
    await page.route("**/api/market/link/receipts/s3/convert", (route) =>
      route.fulfill(
        json(400, {
          detail: "unmapped_items",
          field: "lines",
          extra: { unmapped: [{ offer_id: "c", name: "زيت نباتي", unit_name: "كرتونة", qty: 3 }] },
        }),
      ),
    );
    await login(page, "/market/link/receipts", /\/market\/link\/receipts$/);
    await page.getByRole("button", { name: /SH-03 من ORD-7741/ }).click();
    await expectFrame(page, info, {
      screenId: "LINK-03",
      state: "ready",
      texts: fromFrame("LINK-03", "ready", [
        "معاينة الأثر قبل التحويل",
        "لا سداد",
        "التحويل يسجّل الالتزام ولا يدفع شيئاً",
      ]),
    });
    await page.getByRole("button", { name: "أقرّ الأثر وحوّل إلى مستند" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-03",
      state: "validation_error",
      texts: fromFrame("LINK-03", "validation_error", [
        "صنف بلا مطابقة",
        "الاستلام فيه صنف لم يُطابَق بعد، فلا يُعرف أيّ مخزون يدخل.",
        "لا نُنشئ تلقائياً",
        "إنشاء صنف من اسم المورد يملأ كتالوجك بأسماء غيرك. نطلب المطابقة أو الإنشاء الصريح.",
      ]),
    });
    await expect(page.locator('[data-screen="LINK-03"]')).toContainText("زيت نباتي");
    await expect(page.getByRole("button", { name: "طابق الأصناف (LINK-02)" })).toBeVisible();
  });
});

const LINK = (o: Record<string, unknown> = {}) => ({
  id: "l1",
  kind: "receipt",
  kind_label: "استلام مقابل شحنة",
  mode: "created",
  order_label: "ORD-7741",
  shipment_label: "SH-03",
  local_number: "PD-12",
  my_value_minor: "826000",
  their_value_minor: "944000",
  diff_minor: "118000",
  path: "فرق كمية. نعرض الرقمين ولا نرجّح أحدهما: قد يكون نقصاً في الشحنة أو خطأ عدّ عندك. المسار: فتح خلاف موثَّق (ORD-12) أو اتفاق مكتوب.",
  settled: false,
  settled_by_name: "",
  settlement_path: "",
  settlement_note: "",
  ...o,
});
const DOCS = (links: unknown[], payments: unknown[], can_settle = true) => ({
  state: "ready",
  can_settle,
  links,
  payments,
  linked_count: links.length,
  diff_count:
    (links as { diff_minor: string; settled: boolean }[]).filter(
      (l) => l.diff_minor !== "0" && !l.settled,
    ).length + payments.length,
});

test.describe("LINK-04", () => {
  test("conflict → ready: فرق كرتونة بلا ترجيح وإثبات دفع بلا مقابل، والتسوية تُسجَّل مساراً في دفترك وحده", async ({
    page,
  }, info) => {
    let links = [
      LINK(),
      LINK({
        id: "l2",
        shipment_label: "SH-02",
        local_number: "PD-11",
        my_value_minor: "360000",
        their_value_minor: "360000",
        diff_minor: "0",
        path: "متطابق — لا إجراء.",
      }),
    ];
    const payments = [
      {
        id: "p1",
        ref_label: "PAY-3",
        order_label: "ORD-7741",
        amount_minor: "400000",
        path: "أثبتت دفعاً لم يسجّله المورد بعد. الإيصال لا يعني تحصيلاً (ORD-13) — يبقى معلّقاً للمطابقة بلا خصم من ذمّتك.",
      },
    ];
    await page.route("**/api/market/link/documents", (route) =>
      route.fulfill(json(200, DOCS(links, payments))),
    );
    await page.route("**/api/market/link/documents/l1/settle", (route) => {
      const b = route.request().postDataJSON() as { path: string; note: string };
      if (b.path === "agreement" && !b.note)
        return route.fulfill(json(400, { detail: "note_required", field: "note", extra: {} }));
      links = links.map((l) =>
        l.id === "l1"
          ? {
              ...l,
              settled: true,
              settled_by_name: "المالك",
              settlement_path: b.path,
              settlement_note: b.note,
            }
          : l,
      );
      return route.fulfill(json(200, { link: links[0] }));
    });
    await login(page, "/market/link/documents", /\/market\/link\/documents$/);
    await expectFrame(page, info, {
      screenId: "LINK-04",
      state: "conflict",
      texts: fromFrame("LINK-04", "conflict", [
        "روابط المستندات وتسوية الفرق — دفتران مستقلّان لا دفتر مشترك",
        "نعرض رقمك ورقمه والفرق بينهما. لا نُصدر «الرقم الصحيح» — التسوية إجراء مخوَّل يكتبه أحد الطرفين في دفتره وحده.",
        "المستند المرتبط",
        "في دفترك",
        "في دفتر المورد",
        "الفرق",
        "المسار",
        "استلام مقابل شحنة",
        "متطابق — لا إجراء.",
        "فرق كمية. نعرض الرقمين ولا نرجّح أحدهما: قد يكون نقصاً في الشحنة أو خطأ عدّ عندك. المسار: فتح خلاف موثَّق (ORD-12) أو اتفاق مكتوب.",
        "إثبات دفع بلا مقابل",
        "أثبتت دفعاً لم يسجّله المورد بعد. الإيصال لا يعني تحصيلاً (ORD-13) — يبقى معلّقاً للمطابقة بلا خصم من ذمّتك.",
      ]),
    });
    const root = page.locator('[data-screen="LINK-04"]');
    await expect(root).not.toContainText("الرقم الصحيح:");
    await page.getByRole("button", { name: "سجّل مسار التسوية" }).click();
    await page.getByRole("button", { name: "اتفاق مكتوب" }).click();
    await page.getByRole("button", { name: "سجّل — في دفترك وحده" }).click();
    await expect(root).toContainText("الاتفاق المكتوب يحتاج نصّه.");
    await page.getByLabel("نصّ الاتفاق أو مرجع الخلاف").fill("خصم كرتونة في الفاتورة القادمة");
    await page.getByRole("button", { name: "سجّل — في دفترك وحده" }).click();
    await expect(root).toContainText("سُوّي · اتفاق مكتوب · المالك");
    await expect(page.locator('[data-screen="LINK-04"][data-state="conflict"]')).toBeVisible(); // إثبات الدفع ما زال معلّقاً
  });

  test("empty + permission_denied: «12 مستنداً مرتبطاً · لا فروق»؛ والكاشير يرى أن الفرق أُرسل للمالك", async ({
    page,
  }, info) => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      LINK({
        id: `l${i}`,
        local_number: `PD-${i + 1}`,
        diff_minor: "0",
        their_value_minor: "826000",
        path: "متطابق — لا إجراء.",
      }),
    );
    await page.route("**/api/market/link/documents", (route) =>
      route.fulfill(json(200, DOCS(twelve, []))),
    );
    await login(page, "/market/link/documents", /\/market\/link\/documents$/);
    await expectFrame(page, info, {
      screenId: "LINK-04",
      state: "empty",
      texts: fromFrame("LINK-04", "empty", [
        "لا فروق",
        "كل مستندات السوق طابقت نظائرها المحلية. حالةٌ صحّية.",
        "نقول العدد",
        "«12 مستنداً مرتبطاً · لا فروق». الفراغ الذي يذكر ما فُحص يُطمئن، والفارغ الصامت يُقلق.",
      ]),
    });
  });
});

test("LINK-04 permission_denied: الكاشير يسجّل الفرق ويُحال للمالك", async ({ page }, info) => {
  await page.route("**/api/market/link/documents", (route) =>
    route.fulfill(json(200, DOCS([LINK()], [], false))),
  );
  await page.route("**/api/market/link/documents/l1/settle", (route) =>
    route.fulfill(json(403, { detail: "permission_denied", field: "", extra: { referred: true } })),
  );
  await login(page, "/market/link/documents", /\/market\/link\/documents$/);
  await page.getByRole("button", { name: "سجّل مسار التسوية" }).click();
  await expectFrame(page, info, {
    screenId: "LINK-04",
    state: "permission_denied",
    texts: fromFrame("LINK-04", "permission_denied", [
      "التسوية تكتب رقماً في دفترك المالي، فهي صلاحية من له حدّ مالي. لمن دونه: «الفرق مسجَّل — أُرسل للمالك للمراجعة» ومعه نسخة من المستندين.",
    ]),
  });
  await expect(page.getByRole("button", { name: "سجّل — في دفترك وحده" })).toHaveCount(0);
});

const RET = (o: Record<string, unknown> = {}) => ({
  return_id: "r1",
  ref_label: "RT-01",
  order_label: "ORD-7741",
  supplier_name: "مخزن البركة للجملة — تجريبي",
  status: "partial",
  status_label: "موافقة جزئية",
  decision_note: "الزيت وصل سليماً",
  lines: [
    {
      offer_id: "a",
      name: "سكر أبيض",
      unit_name: "كيس",
      requested: 12,
      approved: 12,
      pending: 0,
      reason: "مبلَّلة",
      price_minor: 9833,
    },
    {
      offer_id: "c",
      name: "زيت طعام",
      unit_name: "عبوة",
      requested: 18,
      approved: 10,
      pending: 8,
      reason: "تالفة",
      price_minor: 15000,
    },
  ],
  converted: false,
  local_number: "",
  reverse_partial: false,
  ...o,
});
const REJECTED = RET({
  return_id: "r2",
  ref_label: "RT-02",
  status: "rejected",
  status_label: "مرفوض",
  lines: [
    {
      offer_id: "d",
      name: "دقيق",
      unit_name: "كيس",
      requested: 5,
      approved: 0,
      pending: 5,
      reason: "x",
      price_minor: 30000,
    },
  ],
});

test.describe("LINK-05", () => {
  test("ready → validation_error → success → partial: العكسي بالمقبول وحده، والحدّ من دفترك، والباقي بند معلّق", async ({
    page,
  }, info) => {
    let rets = [RET(), REJECTED];
    let calls = 0;
    await page.route("**/api/market/link/returns", (route) =>
      route.fulfill(
        json(200, {
          state: "ready",
          can_convert: true,
          returns: rets,
          pending_count: rets.filter((r) => !r.converted && r.status !== "rejected").length,
        }),
      ),
    );
    await page.route("**/api/market/link/returns/r1/convert", (route) => {
      calls += 1;
      if (calls === 1)
        return route.fulfill(
          json(400, {
            detail: "exceeds_received",
            field: "lines",
            extra: {
              errors: [
                {
                  offer_id: "a",
                  code: "exceeds_received",
                  name: "سكر أبيض",
                  max_qty_milli: "10000",
                },
              ],
            },
          }),
        );
      rets = [RET({ converted: true, local_number: "RV-0221", reverse_partial: true }), REJECTED];
      return route.fulfill(
        json(201, { link: { id: "lr", local_number: "RV-0221", mode: "created" } }),
      );
    });
    await login(page, "/market/link/returns", /\/market\/link\/returns$/);
    await expectFrame(page, info, {
      screenId: "LINK-05",
      state: "ready",
      texts: fromFrame("LINK-05", "ready", [
        "تحويل المرتجع لمستند عكسي",
        "الصنف",
        "طُلب إرجاعه",
        "وافق المورد",
        "المستند العكسي",
        "سكر أبيض — كيس",
        "زيت طعام — عبوة",
        "دقيق — كيس",
        "رُفض الإرجاع بسبب مكتوب. لا مستند عكسي، والبند مفتوح لخلاف إن أردت.",
        "الأثر السابق محفوظ",
        "مستند الاستلام الأصلي لا يُعدَّل ولا يُحذف. المرتجع مستند مستقلّ يشير إليه. من يعود بعد سنة يرى ما استُلم فعلاً وما أُرجع فعلاً وتاريخ كلٍّ — لا رقماً صافياً بلا قصة.",
      ]),
    });
    await page.getByRole("button", { name: "اكتب المستند العكسي بالمقبول (12)" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-05",
      state: "validation_error",
      texts: fromFrame("LINK-05", "validation_error", [
        "مرتجع يتجاوز ما استُلم",
        "مرتجع السوق أكبر مما دخل دفترك من مستند الاستلام.",
        "الحدّ من دفترك",
        "لا من دفتر الطرف الآخر. دفتراهما مستقلان (ACC-132)، وما نعكسه هو ما دخل عندنا.",
      ]),
    });
    await expect(page.locator('[data-screen="LINK-05"]')).toContainText("الحدّ من دفترك: 10");
    await page.getByRole("button", { name: "اكتب المستند العكسي بالمقبول (12)" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-05",
      state: "success",
      texts: fromFrame("LINK-05", "success", [
        "مستند عكسي RV-0221 — كامل",
        "عكسي بـ10 فقط. الثمانية الباقية بند معلّق بسبب المورد المكتوب — لا تُلغى ولا تُكتب.",
        "الجزء المتبقّي يبقى مطلباً مفتوحاً.",
      ]),
    });
    await page.getByRole("button", { name: "التالي" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-05",
      state: "partial",
      texts: fromFrame("LINK-05", "partial", [
        "الجزء المتبقّي يبقى مطلباً مفتوحاً.",
        "المستند العكسي يُكتب بالكمية المتفَق عليها فقط. ما لم يوافق عليه المورد لا يُكتب ولا يُلغى — يظل بنداً معلّقاً بسببه، لأن طيّه صامتاً يعني تنازلاً لم تقرّه.",
      ]),
    });
    await expect(page.getByRole("button", { name: /اكتب المستند العكسي/ })).toHaveCount(0);
  });
});
