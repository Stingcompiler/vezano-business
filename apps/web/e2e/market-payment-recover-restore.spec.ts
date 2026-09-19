import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.16 — ORD-13 إثبات دفع (5) + ORD-14 ردّ مفقود (4) + ORD-15 استعادة بعد فقد خادمي (4): الإيصال
 * ليس تحصيلاً (ACC-133) والمرجع مرة واحدة (ACC-15) والتوزيع صريح؛ الاستعلام لا ينشئ شيئاً وحمولة
 * مختلفة تعارض (ACC-124)؛ الاستعادة تعلن الجهل وتوقف التنفيذ والمراجعة للمالك (ACC-137).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const yesterdayAt = (h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po1",
  op_id: "op-2041",
  number: 2041,
  number_label: "PO-2041",
  kind: "order",
  kind_label: "طلب",
  status: "received",
  status_label: "استُلم",
  version: 3,
  supplier_tenant_id: "t2",
  supplier_name: "مخزن البركة — تجريبي",
  buyer_name: "بقالة النيل — تجريبي",
  currency: "SDG",
  lines: [],
  lines_count: 2,
  total_minor: "",
  delivery_to: "",
  fees_label: "",
  note: "",
  response_hours: 72,
  deadline_at: "",
  sent_at: "2026-09-10T10:00:00Z",
  updated_at: hoursAgo(2),
  responsibilities: [],
  no_reply: false,
  near_deadline: false,
  remaining_hours: 0,
  content_line: "",
  buyer_step: "",
  supplier_step: "",
  flagged: false,
  list_status_label: "استُلم",
  reconciling: false,
  restore_point: "",
  paid_minor: "0",
  ...o,
});

const PAY = (o: Record<string, unknown> = {}) => ({
  id: "pay1",
  number: 1,
  ref_label: "PAY-1",
  amount_minor: "944000",
  transfer_ref: "TRX-7781",
  transferred_on: "2026-09-18",
  allocations: [],
  evidence_name: "",
  note: "",
  status: "recorded",
  status_label: "مسجَّل — غير مطابق",
  uploaded_at: yesterdayAt(10, 12),
  matched_at: "",
  matched_by_name: "",
  decision_note: "",
  reminded_at: "",
  hours_since_upload: 26,
  stale: true,
  ...o,
});

const PAYMENTS = (o: Record<string, unknown> = {}) => ({
  order: ORDER(),
  side: "buyer",
  payments: [],
  due_minor: "944000",
  paid_minor: "0",
  open_orders: [{ id: "po2", number_label: "PO-2077", due_minor: "300000" }],
  stale_hours: 24,
  ...o,
});

const EV = (id: string, title: string, at: string, o: Record<string, unknown> = {}) => ({
  id,
  kind: "x",
  side: "buyer",
  title,
  detail: "",
  ref_label: "",
  at,
  needs_decision: true,
  decision: "",
  decision_reason: "",
  ...o,
});

const RESTORE = (o: Record<string, unknown> = {}) => ({
  order: ORDER({ reconciling: true, restore_point: "2026-09-12T09:00:00Z" }),
  side: "buyer",
  restore_point: "2026-09-12T09:00:00Z",
  reconciling: true,
  can_review: true,
  pending: [
    EV("e1", "قبول النسخة 3 من عرض السعر", "2026-09-12T17:02:00Z", {
      detail:
        "كان مسجَّلاً قبل الفقد وغير موجود في النسخة المستعادة. إعادة تطبيقه تحتاج تأكيد المورد أن الاتفاق قائم عنده أيضاً.",
    }),
    EV("e2", "استلام الشحنة الثانية جزئياً", "2026-09-12T11:05:00Z", {
      detail:
        "إدخال المخزون في دفترك المحلي باقٍ ولم يُفقد. المفقود ربطه بالطلب على الخادم. إعادة التطبيق تربطهما دون تكرار الإدخال.",
    }),
  ],
  decided: [],
  confirmed: [EV("e0", "أُرسل الطلب", "2026-09-10T13:08:00Z", { needs_decision: false })],
  blocked_transfers: [
    {
      title: "تحويل الاستلام إلى مستند مخزني",
      ref: "LINK-03",
      detail: "معلَّق حتى تحسم الأحداث، حتى لا يُنشأ مستند على أساس طلب قد يتغيّر بعد دقيقة.",
    },
  ],
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

test.describe("ORD-13", () => {
  test("ready → validation_error → partial: الرفع لا يُسدّد، المرجع مرة واحدة، والدفعة على طلبين بتوزيع صريح", async ({
    page,
  }, info) => {
    let payments: unknown[] = [];
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po1\/payments$/, (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, PAYMENTS({ payments })));
      const b = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(b);
      if (b.transfer_ref === "TRX-OLD")
        return route.fulfill(
          json(400, {
            detail: "reference_used",
            field: "transfer_ref",
            extra: { order_number_label: "PO-1990", payment: "PAY-3" },
          }),
        );
      const created = PAY({
        id: "pay9",
        number: 9,
        ref_label: "PAY-9",
        amount_minor: b.amount_minor,
        transfer_ref: b.transfer_ref,
        allocations: b.allocations,
        stale: false,
        hours_since_upload: 0,
        uploaded_at: new Date().toISOString(),
      });
      payments = [created];
      return route.fulfill(json(201, PAYMENTS({ payments, created })));
    });
    await login(page, "/market/orders/po1/payment", /\/market\/orders\/po1\/payment$/);
    await expect(page.getByText("إيصال مرفوع بحالته")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-13",
      state: "ready",
      texts: fromFrame("ORD-13", "ready", [
        "إيصال مرفوع بحالته",
        "صورة التحويل ومبلغه وتاريخه، وشارة «مسجَّل — غير مطابق» حتى يُقرّ المورد.",
        "الرفع لا يُسدّد",
        "الذمّة لا تنقص برفع إيصال (ACC-133). من يرى رصيده ناقصاً بمجرد الرفع يحسب نفسه بريئاً وهو مطالَب.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-13"]');
    await expect(root).toContainText("9,440.00");
    await page.getByLabel("مرجع التحويل").fill("TRX-OLD");
    await page.getByRole("button", { name: "ارفع الإيصال — مسجَّل لا مسدَّد" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-13",
      state: "validation_error",
      texts: fromFrame("ORD-13", "validation_error", [
        "مبلغ مخالف أو تحويل مستهلك",
        "لا استخدام مكرر",
        "مرجع التحويل يُطابَق مرة واحدة (ACC-15). والفرق عن المستحقّ يُقبل بتوزيعٍ مشروع لا بالسكوت.",
      ]),
    });
    await expect(root).toContainText("الإيصال نفسه استُخدم في طلب سابق (PO-1990 · PAY-3).");
    await page.getByLabel("مرجع التحويل").fill("TRX-7781");
    await page.getByLabel("المبلغ (بالقرش)").fill("1244000");
    await page.getByRole("button", { name: "تحويل واحد على طلبين؟ وزّعه صراحةً" }).click();
    await page.getByLabel("على هذا الطلب PO-2041").fill("944000");
    await page.getByLabel(/على PO-2077/).fill("300000");
    await expect(root).toContainText("مجموع التوزيع 12,440.00 من 12,440.00");
    await page.getByRole("button", { name: "ارفع الإيصال — مسجَّل لا مسدَّد" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-13",
      state: "partial",
      texts: fromFrame("ORD-13", "partial", [
        "دفعة على طلبين",
        "تحويلٌ واحد يغطي طلبين — والتوزيع صريح يُدخله المستخدم.",
        "لا توزيع تلقائي",
        "توزيعُ الدفعة على الأقدم افتراضاً يُنتج أعماراً وأرصدةً لم يقصدها أحد (G-15). من يدفع يقول على ماذا.",
      ]),
    });
    expect(posted[1]).toMatchObject({
      amount_minor: "1244000",
      transfer_ref: "TRX-7781",
      allocations: [
        { order_id: "po1", amount_minor: "944000" },
        { order_id: "po2", amount_minor: "300000" },
      ],
    });
    await expect(root).toContainText("PAY-9 · مسجَّل — غير مطابق");
    await expect(root).toContainText("المستحقّ الآن — من المستلَم وحده");
  });

  test("stale → success: مضت 26 ساعة بلا مطابقة — لا خفض من طرف واحد؛ ثم يطابق المورد بتاريخين", async ({
    page,
  }, info) => {
    let side = "buyer";
    let payments = [PAY()];
    await page.route(/\/api\/market\/orders\/po1\/payments$/, (route) =>
      route.fulfill(json(200, PAYMENTS({ payments, side }))),
    );
    const acts: string[] = [];
    await page.route(/\/api\/market\/orders\/po1\/payments\/pay1\/(\w+)$/, (route) => {
      const action = route.request().url().split("/").pop() ?? "";
      acts.push(action);
      if (action === "match")
        payments = [
          PAY({
            status: "matched",
            status_label: "مطابَق",
            matched_at: "2026-09-20T09:00:00Z",
            stale: false,
          }),
        ];
      if (action === "remind") payments = [PAY({ reminded_at: new Date().toISOString() })];
      return route.fulfill(
        json(
          200,
          PAYMENTS({
            payments,
            side,
            payment: payments[0],
            due_minor: action === "match" ? "0" : "944000",
            paid_minor: action === "match" ? "944000" : "0",
          }),
        ),
      );
    });
    await login(page, "/market/orders/po1/payment", /\/market\/orders\/po1\/payment$/);
    await expectFrame(page, info, {
      screenId: "ORD-13",
      state: "stale",
      texts: fromFrame("ORD-13", "stale", [
        "إثبات الدفع — الإيصال ليس تحصيلاً",
        "ACC-133: رفع صورة الحوالة لا يُسدِّد ذمة. الذمة تُخفض عند تأكيد المورد وصول المبلغ.",
        "بيانات قديمة",
        "تحويل بنكي إلى مخزن البركة — تجريبي",
        "أثر هذا الإيصال على دفترك — الآن",
        "لن نخفض ذمتك من طرف واحد لأن الرقم حينها يصبح رأيك في وضعك المالي لا حقيقته، فتجد نفسك تطلب بضاعة على رصيد لم يصل. الإيصال محفوظ ومؤرَّخ وهو دليلك عند المطالبة.",
        "تذكير المورد بالمطابقة",
        "رفع إيصال أوضح",
        "تم",
        "رفعتَ إيصال التحويل",
        "الصورة محفوظة ومؤرَّخة ومربوطة بالطلب. هذا فعلك ودليلك.",
        "بانتظار",
        "مطابقة المورد",
        "يؤكد وصول المبلغ إلى حسابه. هو وحده يراه في بنكه.",
        "لم يحدث",
        "خفض الذمة",
        "يقع عند المطابقة لا عند الرفع. حتى ذلك الحين رصيدك كما هو.",
        "ذمتك للمورد",
        "لم تتغيّر بالرفع",
        "قيمة الإيصال المرفوع",
        "مسجَّل كإثبات لا كسداد",
        "الرصيد بعد المطابقة — متوقع",
        "يُطبَّق عند تأكيد المورد لا قبله",
      ]),
    });
    const root = page.locator('[data-screen="ORD-13"]');
    await expect(root).toContainText("لم يؤكد المورد بعد، ومضت 26 ساعة.");
    await expect(root).toContainText("مرفوع أمس 10:12 · على الطلب PO-2041");
    await page.getByRole("button", { name: "تذكير المورد بالمطابقة" }).click();
    await expect.poll(() => acts).toEqual(["remind"]);
    // جهة المورد: يطابق
    side = "supplier";
    await page.getByRole("link", { name: "طلبات العملاء" }).first().click();
    await expect(page).toHaveURL(/\/market\/orders\/incoming$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/market\/orders\/po1\/payment$/);
    await expect(page.getByRole("button", { name: "طابِق — وصل المبلغ" })).toBeVisible();
    await page.getByRole("button", { name: "طابِق — وصل المبلغ" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-13",
      state: "success",
      texts: fromFrame("ORD-13", "success", [
        "طابَق المورد الدفعة",
        "الذمّة نقصت عند المطابقة، والكشف يُظهر التاريخين: تاريخ التحويل وتاريخ المطابقة.",
        "تاريخان لا واحد",
        "المهلة بينهما هي ما يُتنازع عليه عادةً. إظهارهما يُغني عن الجدال.",
      ]),
    });
    await expect(root).toContainText("التحويل 18/09 · المطابقة 20/09");
    expect(acts).toEqual(["remind", "match"]);
  });
});

test.describe("ORD-14", () => {
  const seedAttempt = (page: Page) =>
    page.addInitScript(() => {
      localStorage.setItem(
        "market.checkout.attempt.op-2041",
        JSON.stringify({
          op_id: "op-2041",
          supplier_tenant_id: "t2",
          kind: "order",
          delivery_to: "الفرع الرئيسي",
          note: "",
          lines: [{ offer_id: "o1", qty: 4, price_minor: "118000" }],
          at: new Date(new Date().setHours(13, 8, 41, 0)).toISOString(),
        }),
      );
    });

  test("server_error → success: لا نعرف إن كان وصل؛ الاستعلام بمفتاح العملية يجد الطلب — طلبٌ واحد لا اثنان", async ({
    page,
  }, info) => {
    await seedAttempt(page);
    const probes: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/probe$/, (route) => {
      probes.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(
        json(200, {
          found: true,
          order: ORDER({
            status: "sent",
            status_label: "بانتظار رد المورد",
            list_status_label: "بانتظار رد المورد",
          }),
          same_payload: true,
          diff: [],
        }),
      );
    });
    await login(
      page,
      "/market/orders/recover?op=op-2041",
      /\/market\/orders\/recover\?op=op-2041$/,
    );
    await expectFrame(page, info, {
      screenId: "ORD-14",
      state: "server_error",
      texts: fromFrame("ORD-14", "server_error", [
        "رد مفقود بعد الإرسال — استعلام لا طلب جديد",
        "ACC-124: إعادة نفس الحمولة تُعاد إلى الطلب نفسه؛ اختلاف الحمولة تعارض يوقف الإرسال.",
        "خطأ خادم",
        "لا نعرف إن كان الطلب قد وصل",
        "ما نفعله بدلاً من ذلك",
        "حالة التعارض.",
        "لو وجد الخادم طلباً بنفس مفتاح العملية لكن بحمولة مختلفة — كأن تكون كمية عُدِّلت على جهاز آخر بين المحاولتين — فلا إرسال ولا دمج. تُعرض الحمولتان جنباً إلى جنب وتختار أنت أيهما الطلب.",
        "استعلام عن حالة الإرسال",
        "عرض الطلب كمسودة",
        "استعلام بمفتاح العملية",
        "نسأل الخادم: هل وصلك طلب بهذا المفتاح؟ السؤال لا ينشئ شيئاً.",
        "آمن",
        "إعادة نفس الحمولة بنفس المفتاح",
        "إن كان قد وصل، يعيد الخادم الطلب نفسه بدل إنشاء ثانٍ. إن لم يصل، يُنشأ الآن مرة واحدة.",
        "حمولة مختلفة بنفس المفتاح",
        "يُرفض الإرسال ويُعرض الفرق. لا دمج ولا اختيار تلقائي لأحد الإصدارين.",
        "تعارض",
      ]),
    });
    const root = page.locator('[data-screen="ORD-14"]');
    await expect(root).toContainText("أُرسل الطلب 13:08 وانقطع الرد قبل أن يعود.");
    await page.getByRole("button", { name: "استعلام عن حالة الإرسال" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-14",
      state: "success",
      texts: fromFrame("ORD-14", "success", [
        "الطلب موجود ومؤكَّد",
        "طلبٌ واحد لا اثنان، وحالته الحقيقية معروضة مع وقت آخر حدث.",
        "نقول إن الأول وصل",
        "لا «أُرسل بنجاح» فحسب. المستخدم كان يخشى الازدواج، فالجواب عن خشيته لا عن الفعل.",
      ]),
    });
    await expect(root).toContainText("PO-2041 · بانتظار رد المورد");
    expect(probes[0]).toMatchObject({
      op_id: "op-2041",
      lines: [{ offer_id: "o1", qty: 4, price_minor: "118000" }],
    });
  });

  test("conflict → ready: نفس المعرّف بحمولة مختلفة — لا كتابة فوق؛ وبلا معرّف الشاشة تشرح الاستعلام", async ({
    page,
  }, info) => {
    await seedAttempt(page);
    await page.route(/\/api\/market\/orders\/probe$/, (route) =>
      route.fulfill(
        json(200, {
          found: true,
          order: ORDER(),
          same_payload: false,
          diff: [
            {
              offer_id: "o1",
              public_name: "سكر أبيض",
              server_qty: 3,
              server_price_minor: "118000",
              local_qty: 4,
              local_price_minor: "118000",
            },
          ],
        }),
      ),
    );
    await login(
      page,
      "/market/orders/recover?op=op-2041",
      /\/market\/orders\/recover\?op=op-2041$/,
    );
    await page.getByRole("button", { name: "استعلام عن حالة الإرسال" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-14",
      state: "conflict",
      texts: fromFrame("ORD-14", "conflict", [
        "نفس المعرّف بحمولة مختلفة",
        "لا كتابة فوق",
        "التعارض يُحجَز ويُعرض الفرق للمراجعة (ACC-124). الكتابة فوق نسخة الخادم تمحو ما رآه المورد.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-14"]');
    await expect(root).toContainText("الخادم يحمل الطلب PO-2041 بحمولة والجهاز يحمله بأخرى.");
    await expect(root).toContainText("3 × 1,180.00");
    await expect(root).toContainText("4 × 1,180.00");
    await page.getByRole("link", { name: "طلباتي" }).first().click();
    await expect(page).toHaveURL(/\/market\/orders$/);
    await page.goto("/market/orders/recover").catch(() => undefined);
  });

  test("ready: بلا معرّف — استعلام بنفس المعرّف ولا زرّ «أعد الإنشاء»", async ({ page }, info) => {
    await login(page, "/market/orders/recover", /\/market\/orders\/recover$/);
    await expectFrame(page, info, {
      screenId: "ORD-14",
      state: "ready",
      texts: fromFrame("ORD-14", "ready", [
        "استعلام بنفس المعرّف",
        "يُسأل الخادم عن حالة الطلب بمعرّفه المحفوظ، ويُعرض ما لديه: لم يصل، أو وصل ومؤكَّد، أو وصل ومُلغى.",
        "لا زرّ «أعد الإنشاء»",
        "الإنشاء البديل يُنتج طلبين عند المورد. المعروض «استعلم» ثم «أعد إرسال نفسه».",
      ]),
    });
  });
});

test.describe("ORD-15", () => {
  test("stale → conflict → success: نُعلن الجهل ويتوقف التنفيذ، حدثان يحتاجان قراراً واحداً واحداً، ثم أُعيد بناء الطلب", async ({
    page,
  }, info) => {
    let body = RESTORE();
    const decisions: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po1\/restore$/, (route) =>
      route.fulfill(json(200, body)),
    );
    await page.route(/\/api\/market\/orders\/po1\/restore\/events\/(e\d)$/, (route) => {
      const eid = route.request().url().split("/").pop() ?? "";
      const b = route.request().postDataJSON() as Record<string, unknown>;
      decisions.push({ eid, ...b });
      const pending = body.pending.filter((e) => e.id !== eid);
      const decidedEv = body.pending.find((e) => e.id === eid)!;
      body = RESTORE({
        pending,
        decided: [
          ...body.decided,
          { ...decidedEv, decision: b.decision, decision_reason: b.reason ?? "" },
        ],
        reconciling: pending.length > 0,
        order: ORDER({ reconciling: pending.length > 0, restore_point: "2026-09-12T09:00:00Z" }),
      });
      return route.fulfill(json(200, body));
    });
    await login(page, "/market/orders/po1/restore", /\/market\/orders\/po1\/restore$/);
    await expectFrame(page, info, {
      screenId: "ORD-15",
      state: "stale",
      texts: fromFrame("ORD-15", "stale", [
        "حالةٌ من قبل الفقد",
        "الخادم استُعيد إلى نسخة أقدم، وحالة الطلب المعروضة تسبق آخر ما جرى.",
        "نُعلن الجهل",
        "التنفيذ يتوقف",
        "لا شحن ولا استلام على هذا الطلب حتى تنتهي المصالحة (ACC-137). فعلٌ على أساسٍ مشكوك يضاعف الضرر.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-15"]');
    await expect(root).toContainText("«ما بعد 12 سبتمبر");
    await expect(root).toContainText("غير معروف — قيد المصالحة».");
    await page.getByRole("button", { name: /ابدأ المراجعة — حدثان بعد النسخة/ }).click();
    await expectFrame(page, info, {
      screenId: "ORD-15",
      state: "conflict",
      texts: fromFrame("ORD-15", "conflict", [
        "تعارض",
        "الاستعادة أعادت الطلب إلى ما قبل حدثين سُجِّلا بعد النسخة.",
        "حدثان بعد النسخة — يحتاجان قراراً واحداً واحداً",
        "إعادة تطبيقه",
        "تركه ملغى مع سبب",
        "التحويلات المتأثرة موقوفة.",
        "تحويل الاستلام إلى مستند مخزني",
        "LINK-03",
        "قبول النسخة 3 من عرض السعر",
        "كان مسجَّلاً قبل الفقد وغير موجود في النسخة المستعادة. إعادة تطبيقه تحتاج تأكيد المورد أن الاتفاق قائم عنده أيضاً.",
        "استلام الشحنة الثانية جزئياً",
        "إدخال المخزون في دفترك المحلي باقٍ ولم يُفقد. المفقود ربطه بالطلب على الخادم. إعادة التطبيق تربطهما دون تكرار الإدخال.",
      ]),
    });
    await expect(root).toContainText("استُعيد الطلب PO-2041 إلى نسخة 12 سبتمبر");
    await expect(root).toContainText(
      "معلَّق حتى تحسم الأحداث، حتى لا يُنشأ مستند على أساس طلب قد يتغيّر بعد دقيقة.",
    );
    const first = root.getByRole("listitem").filter({ hasText: "قبول النسخة 3 من عرض السعر" });
    await first.getByRole("button", { name: "إعادة تطبيقه" }).click();
    await expect(root).toContainText("أُعيد تطبيقه");
    const second = root.getByRole("listitem").filter({ hasText: "استلام الشحنة الثانية جزئياً" });
    await second.getByLabel(/سبب تركه ملغى/).fill("الإدخال المحلي باقٍ — الربط يُعاد يدوياً");
    await second.getByRole("button", { name: "تركه ملغى مع سبب" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-15",
      state: "success",
      texts: fromFrame("ORD-15", "success", [
        "أُعيد بناء الطلب",
        "من أحداث الطرفين بهوياتها الأصلية: ما اتفق عليه الدفتران أُثبت، وما لا يُسنَد إلى حدث بقي محجوزاً.",
        "لا تحويل مالي صامت",
        "الاستعادة لا تُنشئ قيداً ولا تُلغيه. كل فرق يبقى بنداً معلَناً حتى يُقرَّر (ACC-137).",
        "الأثر معروض",
        "ما أُثبت وما حُجز وما يحتاج قراراً — ثلاث قوائم لا رسالة «تمت الاستعادة».",
      ]),
    });
    await expect(root).toContainText("قبول النسخة 3 من عرض السعر — أُعيد تطبيقه");
    await expect(root).toContainText(
      "استلام الشحنة الثانية جزئياً — الإدخال المحلي باقٍ — الربط يُعاد يدوياً",
    );
    expect(decisions).toEqual([
      { eid: "e1", decision: "reapply", reason: "" },
      { eid: "e2", decision: "void", reason: "الإدخال المحلي باقٍ — الربط يُعاد يدوياً" },
    ]);
  });

  test("permission_denied: المراجعة للمالك — مشغّل الخدمة يرى ويشخّص ولا يعدّل دفاتر الأطراف", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/orders\/po1\/restore$/, (route) =>
      route.fulfill(json(200, RESTORE({ can_review: false }))),
    );
    await login(page, "/market/orders/po1/restore", /\/market\/orders\/po1\/restore$/);
    await page.getByRole("button", { name: /ابدأ المراجعة/ }).click();
    await expectFrame(page, info, {
      screenId: "ORD-15",
      state: "permission_denied",
      texts: fromFrame("ORD-15", "permission_denied", [
        "المراجعة للمالك",
        "مشغّل الخدمة يرى ويشخّص، ولا يعدّل دفاتر الأطراف ولا يُقرّ كميةً.",
        "حدٌّ ثابت",
        "إشراف المنصة لا يمسّ دفتر مستأجر (PLT-07). القرار في طلبٍ بين منشأتين لهما لا لنا.",
      ]),
    });
  });
});
