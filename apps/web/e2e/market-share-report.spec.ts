import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.9 — MP-07 مشاركة رابط ودعوة منشأة (4) + MP-14 عرض منتهٍ أو منشأة معلَّقة (3) + MP-15 بلاغ عن
 * عرض أو انتحال (4): المعاينة عامة دوماً بلا سعر خاص (ACC-150)؛ الرابط بعمر ولا يُحيا (ACC-06)؛
 * طلب التخويل يصل المورد بمن أنت ورفضه بلا سبب (ACC-121)؛ المعلَّقة تمنع الجديد وتُبقي السابق
 * (ACC-135)؛ البلاغ سبب ودليل ورقم لصاحبه ولا يُعلِّق شيئاً بنفسه (ACC-139).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const PREVIEW = {
  kind: "offer",
  title: "سكر أبيض — كرتونة 12×1كغ",
  subtitle: "مخزن البركة — تجريبي",
  price_minor: "",
  price_line: "السعر للمشترين المخوَّلين · اطلب تأكيد سعر",
  path: "/market/offers/public/o1",
};

const INVITE = (o: Record<string, unknown> = {}) => ({
  id: "i1",
  kind: "share",
  kind_label: "مشاركة رابط",
  target_name: "سكر أبيض — كرتونة 12×1كغ",
  message: "",
  status: "sent",
  status_label: "مرسَل",
  expires_at: "2026-09-26T10:00:00Z",
  created_at: "2026-09-19T10:00:00Z",
  counts: { visits: 3, signups: 1, publishes: 0, first_orders: 0 },
  ...o,
});

const INVITES = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  invites: rows,
  can_invite: true,
  share_days: 7,
  reaches: ["اسم منشأتك ومنطقتها وأنها متحققة الهوية.", "رسالتك القصيرة إن كتبتها — اختيارية."],
  not_reaches: ["حجم مبيعاتك ولا مورّدوك الآخرون ولا أسعارك.", "أنك طلبت تخويلاً من منافسه أيضاً."],
  ...extra,
});

const REASONS = [
  {
    code: "impersonation",
    label: "انتحال اسم منشأة أو شارتها",
    hint: "يحتاج دليلاً — مقارنة اسم أو مستند",
    needs_evidence: true,
  },
  {
    code: "misleading",
    label: "وصف مضلّل للمنتج أو وحدته",
    hint: "مثال: «كرتونة 12» والمحتوى 10",
    needs_evidence: false,
  },
  {
    code: "harmful",
    label: "محتوى غير لائق أو ضارّ",
    hint: "يُراجَع بأولوية",
    needs_evidence: false,
  },
  {
    code: "prohibited",
    label: "عرض لسلعة ممنوعة",
    hint: "يُحال فوراً لمشرف السوق",
    needs_evidence: false,
  },
];

const REPORT = (o: Record<string, unknown> = {}) => ({
  id: "r1",
  number: 2231,
  number_label: "RP-2231",
  target_label: "«سكر أبيض — كرتونة 12×1كغ»",
  reason: "impersonation",
  reason_label: "انتحال اسم منشأة أو شارتها",
  note: "",
  evidence_name: "مقارنة.png",
  status: "under_review",
  status_label: "قيد المراجعة",
  outcome: "",
  created_at: "2026-09-19T10:00:00Z",
  decided_at: "",
  may_happen: ["تعليق نشر الملف المنتحل، ومطالبته بدليل ملكية الاسم."],
  wont_happen: ["لا مساس بدفاتر تلك المنشأة ولا بطلباتها القائمة مع غيرك — ACC-139."],
  not_given: ["لا بيانات عن صاحب الملف ولا مراسلاته. تصل إليك النتيجة لا الملف."],
  ...o,
});

const SUPPLIER_STATUS = (suspended: boolean) => ({
  tenant_id: "t2",
  public_name: "مخزن الشرق — تجريبي",
  suspended,
  suspended_line: suspended
    ? "التعليق إجراء نشر بعد بلاغ قيد المراجعة (PLT-07)، وللبائع مسار اعتراض مفتوح. لا حكم نهائي في هذه الحالة."
    : "",
  badge: suspended ? "suspended" : "verified",
  badge_label: suspended ? "نشر معلَّق" : "موثَّقة المستندات",
  blocked: [
    {
      title: "طلب جديد من هذه المنشأة",
      detail: "زرّ الطلب موقوف بنصّ يشرح السبب، لا زرّ رمادي صامت.",
    },
  ],
  kept: [
    {
      title: "الطلبات المؤكَّدة قبل التعليق",
      detail: "اتفاق قائم بين طرفين — لا تفسخه المنصة. التسليم والاستلام والمرتجع تمضي.",
    },
    {
      title: "تصدير مستنداتك وسجلّك",
      detail: "حتى لو طال التعليق. حجب التصدير يحتجز بيانات ليست ملكنا.",
    },
    {
      title: "دفتر البائع ومخزونه كما هو",
      detail: "التعليق إجراء نشر لا إجراء محاسبي — لا كمية ولا مبلغ يتغيّر.",
    },
  ],
});

const OFFER = (o: Record<string, unknown> = {}) => ({
  id: "o1",
  seller_tenant_id: "t2",
  seller_name: "مخزن البركة — تجريبي",
  public_name: "سكر أبيض",
  unit_name: "كرتونة",
  pack_label: "كرتونة 12×1كغ",
  price_minor: "118000",
  price_line: "",
  availability: "متوفر",
  confirmed_until: "2026-09-09",
  min_order_qty: 5,
  seller_badge: "verified",
  seller_badge_label: "موثَّقة المستندات",
  description: "",
  unit_price_minor: "9833",
  base_unit_name: "كغ",
  factor_milli: "12000",
  fees_decided: false,
  fees_label: "رسوم تُحدَّد عند الطلب",
  audience: "public",
  audience_label: "كل المشترين",
  currency: "SDG",
  buyer_currency: "SDG",
  currency_mismatch: false,
  confirmed_at: "2026-09-01T10:00:00Z",
  days_since_confirmed: 18,
  valid_until: "2026-09-09",
  expired: true,
  withdrawn: false,
  tiers: [],
  others: [],
  updated_at: "2026-09-01T10:00:00Z",
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

test.describe("MP-07", () => {
  test("ready → success: المعاينة عامة بلا سعر خاص، رابط بعمر، ثم طلب تخويل يصل المورد بمن أنت فقط", async ({
    page,
  }, info) => {
    let rows: unknown[] = [];
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/share\/preview(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          preview: {
            ...PREVIEW,
            kind: "supplier",
            title: "مخزن البركة — تجريبي",
            subtitle: "جملة · بحري",
            price_line: "",
            path: "/market/suppliers/t2",
          },
        }),
      ),
    );
    await page.route(/\/api\/market\/invites$/, (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        posted.push(body);
        if (body.kind === "authorization") {
          const inv = INVITE({
            id: "i3",
            kind: "authorization",
            kind_label: "طلب تخويل",
            target_name: "مخزن البركة — تجريبي",
            expires_at: "",
          });
          rows = [inv, ...rows];
          return route.fulfill(json(201, { invite: inv }));
        }
        const inv = INVITE({
          target_name: "مخزن البركة — تجريبي",
          counts: { visits: 0, signups: 0, publishes: 0, first_orders: 0 },
        });
        rows = [inv, ...rows];
        return route.fulfill(
          json(201, { invite: inv, token: "tok123", path: "/market/i/tok123", preview: PREVIEW }),
        );
      }
      return route.fulfill(json(200, INVITES(rows)));
    });
    await login(page, "/market/share?supplier=t2", /\/market\/share\?supplier=t2$/);
    await expect(page.getByText("معاينة ما سيراه المستلم")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "MP-07",
      state: "ready",
      texts: fromFrame("MP-07", "ready", [
        "مشاركة رابط ودعوة منشأة",
        "الرابط يخرج عن سيطرتك لحظة إرساله.",
        "معاينة ما سيراه المستلم",
        "المعاينة عامة دوماً",
        "الدعوة باسم المنشأة",
        "دعوة منشأة أخرى إلى علاقة تجارية فعلٌ باسم منشأتك.",
        "لا نشر تلقائياً",
      ]),
    });
    const root = page.locator('[data-screen="MP-07"]');
    await expect(root).toContainText("مخزن البركة — تجريبي");
    await expect(root).toContainText("لا روابط بعد.");
    await page.getByRole("button", { name: "أنشئ رابط مشاركة" }).click();
    await expect(root).toContainText("/market/i/tok123");
    await expect(root).toContainText("جديدٌ لا إحياء");
    await expect(root).toContainText("يسري حتى 26 سبتمبر");
    await expect(root).toContainText("مشاركة رابط · مخزن البركة — تجريبي");
    await page.getByRole("button", { name: "اطلب تخويلاً من هذا المورد" }).click();
    await expectFrame(page, info, {
      screenId: "MP-07",
      state: "success",
      texts: fromFrame("MP-07", "success", [
        "طلب تخويل مرسَل — بانتظار المورد",
        "قرار المورد بشري ولا مهلة نفرضها عليه. الانتظار معلن وليس دوّارة.",
        "ما يصل المورد عنك",
        "يصله",
        "اسم منشأتك ومنطقتها وأنها متحققة الهوية.",
        "رسالتك القصيرة إن كتبتها — اختيارية.",
        "لا يصله",
        "حجم مبيعاتك ولا مورّدوك الآخرون ولا أسعارك.",
        "أنك طلبت تخويلاً من منافسه أيضاً.",
      ]),
    });
    expect(posted.map((b) => b.kind)).toEqual(["share", "authorization"]);
    expect(posted[1]?.supplier_tenant_id).toBe("t2");
    await page.getByRole("button", { name: "حسناً" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("طلب تخويل · مخزن البركة — تجريبي");
  });

  test("permission_denied: المدير لا يدعو باسم المنشأة — الدعوة تفتح باباً ولا تدخل أحداً منه", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/invites$/, (route) =>
      route.fulfill(json(200, INVITES([], { can_invite: false }))),
    );
    await login(page, "/market/share", /\/market\/share$/);
    await expectFrame(page, info, {
      screenId: "MP-07",
      state: "permission_denied",
      texts: fromFrame("MP-07", "permission_denied", [
        "الدعوة باسم المنشأة",
        "دعوة منشأة أخرى إلى علاقة تجارية فعلٌ باسم منشأتك.",
        "لا نشر تلقائياً",
        "قبول المدعوّ لا ينشر ملفه ولا كتالوجه",
        "الدعوة تفتح باباً ولا تدخل أحداً منه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "أنشئ رابط دعوة" })).toHaveCount(0);
  });

  test("expired: رابط دعوة انقضى — جديدٌ لا إحياء؛ والرابط الساري يُفتح بلا حساب بمعاينة عامة", async ({
    page,
  }, info) => {
    await page.route(/\/api\/public\/market\/invite\/old$/, (route) =>
      route.fulfill(json(410, { detail: "invite_expired", kind: "invite" })),
    );
    await page.route(/\/api\/public\/market\/invite\/fresh$/, (route) =>
      route.fulfill(
        json(200, {
          invite: {
            id: "i9",
            kind: "share",
            message: "",
            expires_at: "2026-09-26T10:00:00Z",
            preview: PREVIEW,
          },
        }),
      ),
    );
    await page.goto("/market/i/old");
    await expectFrame(page, info, {
      screenId: "MP-07",
      state: "expired",
      texts: fromFrame("MP-07", "expired", [
        "دعوة منتهية",
        "رابط الدعوة له عمر وانقضى.",
        "جديدٌ لا إحياء",
        "يُنشأ رابط جديد بعمر جديد؛ القديم لا يُمدَّد — تمديد رابطٍ خرج يفتح باباً لا يُعرف من وراءه",
      ]),
    });
    await page.goto("/market/i/fresh");
    const root = page.locator('[data-screen="MP-07"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("سكر أبيض — كرتونة 12×1كغ");
    await expect(root).toContainText("السعر للمشترين المخوَّلين · اطلب تأكيد سعر");
    await expect(root).not.toContainText("1,180.00");
    await page.getByRole("button", { name: "افتح في السوق" }).click();
    await expect(page).toHaveURL(/\/market\/offers\/public\/o1$/);
  });
});

test.describe("MP-14", () => {
  test("permission_denied: منشأة معلَّقة — يُمنع الجديد ويبقى السابق، والزر موقوف بنصّ (ACC-135)", async ({
    page,
  }, info) => {
    await page.route(/\/api\/public\/market\/suppliers\/t2\/status$/, (route) =>
      route.fulfill(json(200, { supplier: SUPPLIER_STATUS(true) })),
    );
    await page.goto("/market/unavailable?supplier=t2");
    await expectFrame(page, info, {
      screenId: "MP-14",
      state: "permission_denied",
      texts: fromFrame("MP-14", "permission_denied", [
        "عرض منتهٍ أو منشأة معلّقة — منع الجديد دون محو السابق",
        "تعليق البائع يمنع طلباً جديداً ويُبقي الطلبات القائمة والتصدير. الرقم المنتهي يُعرض كـ«آخر سعر معروف» لا كسعر",
        "معلّق",
        "نشر هذه المنشأة معلَّق حالياً",
        "مخزن الشرق — تجريبي · التعليق إجراء نشر بعد بلاغ قيد المراجعة (PLT-07)، وللبائع مسار اعتراض مفتوح. لا حكم نهائي في هذه الحالة.",
        "يُمنع",
        "طلب جديد من هذه المنشأة",
        "زرّ الطلب موقوف بنصّ يشرح السبب، لا زرّ رمادي صامت.",
        "يبقى",
        "الطلبات المؤكَّدة قبل التعليق",
        "اتفاق قائم بين طرفين — لا تفسخه المنصة. التسليم والاستلام والمرتجع تمضي.",
        "تصدير مستنداتك وسجلّك",
        "حتى لو طال التعليق. حجب التصدير يحتجز بيانات ليست ملكنا.",
        "دفتر البائع ومخزونه كما هو",
        "التعليق إجراء نشر لا إجراء محاسبي — لا كمية ولا مبلغ يتغيّر.",
      ]),
    });
    await expect(page.getByRole("button", { name: "طلب جديد — موقوف" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("expired → ready: عرض منتهٍ في سلّة مشترٍ بآخر سعر معروف لا يُحذف ولا يُحدَّث صامتاً، ثم لا مانع", async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "market.cart",
        JSON.stringify({
          at: new Date().toISOString(),
          data: [
            {
              offer_id: "o1",
              seller_tenant_id: "t2",
              seller_name: "مخزن البركة — تجريبي",
              public_name: "سكر أبيض",
              pack_label: "كرتونة 12×1كغ",
              unit_name: "كرتونة",
              price_minor: "118000",
              currency: "SDG",
              confirmed_at: "2026-09-01T10:00:00Z",
              valid_until: "2026-09-09",
              qty: 5,
            },
          ],
        }),
      );
    });
    let expired = true;
    await page.route(/\/api\/public\/market\/suppliers\/t2\/status$/, (route) =>
      route.fulfill(json(200, { supplier: SUPPLIER_STATUS(false) })),
    );
    await page.route(/\/api\/market\/offers\/public\/o1$/, (route) =>
      route.fulfill(json(200, { offer: OFFER({ expired }) })),
    );
    await page.goto("/market/unavailable?supplier=t2&offer=o1");
    await expectFrame(page, info, {
      screenId: "MP-14",
      state: "expired",
      texts: fromFrame("MP-14", "expired", [
        "عرض منتهٍ في سلّة مشترٍ",
        "آخر سعر معروف — لا يصلح للتأكيد",
        "1,180.00",
        "SDG",
        "انتهت الصلاحية 09/09",
        "لا نحذف السطر من السلّة ولا نحدّث سعره تلقائياً. الاثنان خطأ: الحذف يُخفي ما اختاره المشتري، والتحديث الصامت يُبدّل رقماً بناء عليه قراراً.",
        "طلب تأكيد سعر جديد",
      ]),
    });
    const root = page.locator('[data-screen="MP-14"]');
    await expect(root).not.toContainText("نشر هذه المنشأة معلَّق حالياً");
    expired = false;
    await page.getByRole("button", { name: "تفاصيل العرض" }).click();
    await expect(page).toHaveURL(/\/market\/offers\/public\/o1$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/market\/unavailable/);
    await expectFrame(page, info, {
      screenId: "MP-14",
      state: "ready",
      texts: fromFrame("MP-14", "ready", [
        "المنتهي عند ناشره",
        "العرض المنتهي يبقى في قائمة البائع بوسمه وزرّ تجديده — وعند المشتري يسقط من النتائج ولا يُعرض سعراً.",
        "وجهان لحقيقة واحدة",
        "الناشر يحتاج رؤية المنتهي ليجدّده؛ والمشتري لا يحتاج سعراً ميتاً. الشاشة نفسها بجمهورين",
        "المعلَّقة أوسع",
        "تعليق المنشأة يمنع الجديد كله ويبقي السابق للاطلاع والتصدير — لا محو",
      ]),
    });
    await expect(root).toContainText("أسطر سلّتك");
    await expect(root).toContainText("النشر قائم ولا مانع من طلب جديد.");
  });
});

test.describe("MP-15", () => {
  test("ready → validation_error → success: انتحال بلا دليل لا يُرسل، ثم بلاغ برقم متابعة لا يُعلِّق شيئاً", async ({
    page,
  }, info) => {
    const reports: unknown[] = [];
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/share\/preview(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, { preview: { ...PREVIEW, subtitle: "مخزن يحمل اسماً مطابقاً لبائع موثَّق" } }),
      ),
    );
    await page.route(/\/api\/market\/reports$/, (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        posted.push(body);
        const r = REPORT();
        reports.unshift(r);
        return route.fulfill(json(201, { report: r }));
      }
      return route.fulfill(json(200, { reports, reasons: REASONS }));
    });
    await login(page, "/market/report?offer=o1", /\/market\/report\?offer=o1$/);
    await expect(page.getByText("سبب البلاغ — اختر واحداً")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "MP-15",
      state: "ready",
      texts: fromFrame("MP-15", "ready", [
        "بلاغ عن عرض أو انتحال — سبب ودليل ومسار متابعة",
        "البلاغ ليس زرّ شكوى مجهولاً: سبب من قائمة محدَّدة، ودليل مرفوع، ورقم متابعة يرى المبلِّغ حالته. ولا يُعلَّق شيء بمجرّد البلاغ.",
        "إبلاغ عن «سكر أبيض — كرتونة 12×1كغ»",
        "مخزن يحمل اسماً مطابقاً لبائع موثَّق",
        "سبب البلاغ — اختر واحداً",
        "انتحال اسم منشأة أو شارتها",
        "يحتاج دليلاً — مقارنة اسم أو مستند",
        "وصف مضلّل للمنتج أو وحدته",
        "مثال: «كرتونة 12» والمحتوى 10",
        "محتوى غير لائق أو ضارّ",
        "يُراجَع بأولوية",
        "عرض لسلعة ممنوعة",
        "يُحال فوراً لمشرف السوق",
        "البلاغ لا يُعلّق شيئاً بنفسه",
        "التعليق قرار مراجِع بشري",
        "لو كان البلاغ يُخفي عرضاً تلقائياً لصار سلاحاً بيد منافس — عشرة بلاغات كاذبة تُخرج بائعاً من السوق بلا أن يراجعها أحد.",
      ]),
    });
    await expect(page.locator('[data-screen="MP-15"]')).toContainText(
      "التعليق قرار مراجِع بشري عند مشرف السوق.",
    );
    await page.getByLabel("انتحال اسم منشأة أو شارتها").check();
    await page.getByRole("button", { name: "أرسل البلاغ" }).click();
    await expectFrame(page, info, {
      screenId: "MP-15",
      state: "validation_error",
      texts: fromFrame("MP-15", "validation_error", [
        "بلاغ «انتحال» بلا دليل مرفوع لا يُرسل. الانتحال اتهام ثقيل يُعلَّق به نشر منشأة، فنطلب ما يسنده — وسبب «سعر لا يعجبني» ليس في القائمة أصلاً.",
      ]),
    });
    expect(posted).toHaveLength(0);
    await page
      .locator('input[type="file"][aria-label="الدليل"]')
      .first()
      .setInputFiles({ name: "مقارنة.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "أرسل البلاغ" }).click();
    await expectFrame(page, info, {
      screenId: "MP-15",
      state: "success",
      texts: fromFrame("MP-15", "success", [
        "أُرسل",
        "بلاغك رقمه",
        "RP-2231",
        "تتابع حالته من حسابك: «قيد المراجعة» ثم «أُجري إجراء» أو «أُغلق بلا إجراء» مع سبب. لا نتركك في صمت، ولا نُخبرك بتفاصيل دفاتر الطرف الآخر.",
        "وصل بلاغك عن انتحال هوية",
        "ما قد يحدث",
        "تعليق نشر الملف المنتحل، ومطالبته بدليل ملكية الاسم.",
        "ما لن يحدث",
        "لا مساس بدفاتر تلك المنشأة ولا بطلباتها القائمة مع غيرك — ACC-139.",
        "ما لا نعطيك",
        "لا بيانات عن صاحب الملف ولا مراسلاته. تصل إليك النتيجة لا الملف.",
      ]),
    });
    expect(posted[0]?.reason).toBe("impersonation");
    expect(
      typeof posted[0]?.evidence_data_url === "string" &&
        posted[0].evidence_data_url.startsWith("data:image/png"),
    ).toBe(true);
    await page.getByRole("button", { name: "بلاغاتي" }).click();
    await expect(page).toHaveURL(/\/market\/reports$/);
    await expect(page.locator('[data-screen="MP-15"]')).toContainText(
      "RP-2231 · «سكر أبيض — كرتونة 12×1كغ»",
    );
  });

  test("permission_denied: رابط متابعة بلاغ فُتح من غير مقدِّمه — هوية المبلّغ محفوظة", async ({
    page,
  }, info) => {
    await page.route(/\/api\/market\/reports$/, (route) =>
      route.fulfill(json(200, { reports: [], reasons: REASONS })),
    );
    await page.route(/\/api\/market\/reports\/r9$/, (route) =>
      route.fulfill(json(404, { detail: "not_found" })),
    );
    await login(page, "/market/reports/r9", /\/market\/reports\/r9$/);
    await expectFrame(page, info, {
      screenId: "MP-15",
      state: "permission_denied",
      texts: fromFrame("MP-15", "permission_denied", [
        "متابعة البلاغ لصاحبه",
        "رابط متابعة بلاغ فُتح من غير مقدِّمه.",
        "هوية المبلّغ محفوظة",
        "المبلَّغ عنه لا يرى من بلّغ، وغير المقدِّم لا يرى البلاغ أصلاً. كشفُ المبلّغين يقتل الإبلاغ في سوقٍ صغيرة يعرف الجميع فيها الجميع",
      ]),
    });
    await expect(page.locator('[data-screen="MP-15"]')).not.toContainText("RP-");
  });
});
