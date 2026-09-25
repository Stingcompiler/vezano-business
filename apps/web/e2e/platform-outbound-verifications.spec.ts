import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { goSection } from "./platform-nav";
import { fromFrame } from "./frame-provenance";

/**
 * T3.20 — PLT-05 تشغيل الإرسال والإخفاقات (4) + PLT-06 طلبات تحقق منشآت السوق (5): لا مفاتيح
 * ولا أسرار مزوّدين؛ الطابور الفارغ وضع سليم لا خطأ؛ نفاد الحصة يوقف الحملات أولاً «مؤجَّلة لا
 * فاشلة»؛ تعذّر المزوّدين معاً يحتجز لا يُسقط. الشارة هوية لا تزكية (MK-4)؛ لا رفض بلا سبب محدّد.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const CHANNELS = (mode: "ready" | "partial" | "down") => [
  {
    key: "sms_primary",
    label: "الرسائل النصية — المزوّد الأساسي",
    purpose: "حصة الحملات",
    quota_line: mode === "partial" ? "5000 / 5000" : "1240 / 5000",
    used: mode === "partial" ? 5000 : 1240,
    max: 5000,
    status: mode === "down" ? "down" : mode === "partial" ? "exhausted" : "ok",
    status_label: mode === "down" ? "متعذّر" : mode === "partial" ? "حصة منتهية" : "يعمل",
    behaviour:
      mode === "partial"
        ? "نفدت حصة الحملات لليوم. رسائل التشغيل الحرجة تُحوَّل إلى الاحتياطي تلقائياً."
        : "الحصة اليومية · يُعاد ضبطها منتصف الليل",
    note: mode === "down" ? "انقطاع عند المزوّد" : "",
  },
  {
    key: "sms_fallback",
    label: "الرسائل النصية — الاحتياطي",
    purpose: mode === "ready" ? "احتياط" : "يستقبل التحويل",
    quota_line: "—",
    used: 0,
    max: 0,
    status: mode === "down" ? "down" : mode === "partial" ? "receiving" : "ready",
    status_label: mode === "down" ? "متعذّر" : mode === "partial" ? "يعمل" : "جاهز",
    behaviour:
      mode === "ready"
        ? "يُستعمل تلقائياً عند تعثّر الأساسي؛ التحويل يُسجَّل ولا يحدث صامتاً"
        : "يعمل ضمن سعته. التحويل من الأساسي يُسجَّل ولا يحدث صامتاً.",
    note: "",
  },
  {
    key: "push",
    label: "إشعارات التطبيق",
    purpose: "قناة مباشرة",
    quota_line: "—",
    used: 31,
    max: 1000,
    status: "partial",
    status_label: "جزئي",
    behaviour: "3.1% فشل: أجهزة أوقفت الإشعارات من نظامها — لا يُعدّ عطلاً في المنصة.",
    failure_pct: "3.1",
    note: "",
  },
  {
    key: "email",
    label: "البريد التشغيلي",
    purpose: "تقارير وإيصالات",
    quota_line: "—",
    used: 0,
    max: 0,
    status: "ok",
    status_label: "سليم",
    behaviour: "سليم. لا يُستعمل للتسويق الجماهيري بل للمستندات التشغيلية.",
    note: "",
  },
];
const OUTBOUND = (state: "ready" | "empty" | "partial" | "server_error") => ({
  state,
  sent_today: state === "partial" ? 5000 : 1240,
  quota: {
    used: state === "partial" ? 5000 : 1240,
    max: 5000,
    remaining: state === "partial" ? 0 : 3760,
  },
  queue: {
    queued: state === "empty" ? 0 : state === "server_error" ? 84 : 12,
    unconfirmed: 0,
    temp_failed: 0,
    held_waiting_channel: state === "server_error" ? 84 : 0,
    deferred_campaigns: state === "partial" ? 3 : 0,
    announcements_due: 0,
  },
  delivery_rate_hour: "98.4",
  delivery_hour_total: 320,
  channels: CHANNELS(state === "partial" ? "partial" : state === "server_error" ? "down" : "ready"),
  fetched_at: new Date().toISOString(),
});

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "طيب — تشغيل" }),
    ),
  );
  await page.route("**/api/platform/tenants**", (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
        filter: "all",
        q: "",
        access_rule: "",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.tayeb@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-05", () => {
  test("ready → server_error → empty: القنوات بلا أسرار، وتعذّر المزوّدين معاً يحتجز لا يُسقط، والفراغ وضع سليم", async ({
    page,
  }, info) => {
    let mode: "ready" | "empty" | "partial" | "server_error" = "ready";
    await page.route("**/api/platform/outbound", (route) =>
      route.fulfill(json(200, OUTBOUND(mode))),
    );
    await page.route("**/api/platform/outbound/channels/*", (route) => {
      const b = route.request().postDataJSON() as { state: string };
      mode = b.state === "down" ? "server_error" : "empty";
      return route.fulfill(json(200, OUTBOUND(mode)));
    });
    await operatorLogin(page);
    await goSection(page, "الإرسال");
    await expect(page).toHaveURL(/\/platform\/outbound$/);
    await expectFrame(page, info, {
      screenId: "PLT-05",
      state: "ready",
      texts: fromFrame("PLT-05", "ready", [
        "تشغيل الإرسال والإخفاقات — حصص وقنوات دون كشف أسرار المزوّدين",
        "لوحة تشغيل كاملة للإرسال: القنوات، الحصص، التحويل الاحتياطي، والطابور لكل مستأجر — بلا مفتاح أو سرّ مزوّد واحد.",
        "أُرسل اليوم",
        "تشغيل + تسويق",
        "حصة الرسائل المتبقّية",
        "في الطابور",
        "نسبة التسليم",
        "قياس آخر ساعة",
        "القنوات والمزوّدون",
        "لا مفاتيح ولا أسرار معروضة",
        "القناة / المزوّد",
        "الحصة المستهلَكة",
        "الحالة",
        "السلوك عند التعثّر",
        "الرسائل النصية — المزوّد الأساسي",
        "حصة الحملات",
        "يعمل",
        "الرسائل النصية — الاحتياطي",
        "إشعارات التطبيق",
        "قناة مباشرة",
        "3.1% فشل: أجهزة أوقفت الإشعارات من نظامها — لا يُعدّ عطلاً في المنصة.",
        "جزئي",
        "البريد التشغيلي",
        "تقارير وإيصالات",
        "سليم. لا يُستعمل للتسويق الجماهيري بل للمستندات التشغيلية.",
        "سليم",
      ]),
    });
    const root = page.locator('[data-screen="PLT-05"]');
    await expect(root).toContainText("98.4%");
    // لا سرّ ولا مفتاح في الصفحة
    await expect(root).not.toContainText(/api[_ -]?key|secret|token/i);
    await page.getByRole("button", { name: "إعلان تعذّر القناة" }).first().click();
    await expectFrame(page, info, {
      screenId: "PLT-05",
      state: "server_error",
      texts: fromFrame("PLT-05", "server_error", [
        "تعذّر الوصول إلى المزوّد الأساسي والاحتياطي معاً",
        "لا نعلن «أُرسلت» لما لم يُرسل. الرسائل تُحتجز في الطابور بحالة «بانتظار قناة» لا «فشل نهائي»، ويُعاد المحاولة تلقائياً. عدّاد الاحتجاز ظاهر، ولا يُحذف حدث صامتاً.",
      ]),
    });
    await expect(root).toContainText("محتجَز بانتظار قناة: 84");
    await expect(root).toContainText("انقطاع عند المزوّد");
    await page.getByRole("button", { name: "إعلان عودة القناة" }).first().click();
    await expectFrame(page, info, {
      screenId: "PLT-05",
      state: "empty",
      texts: fromFrame("PLT-05", "empty", [
        "لا طابور إرسال الآن",
        "كل ما أُرسل تأكّد تسليمه أو انتهى بحالة نهائية. هذا وضع سليم لا خطأ، فلا نعرض جدولاً فارغاً موحياً بعطل.",
      ]),
    });
  });

  test("partial: نفاد حصة الحملات يوقف التسويق أولاً، والتشغيل يمرّ عبر الاحتياطي، والحملات مؤجَّلة لا فاشلة", async ({
    page,
  }, info) => {
    await page.route("**/api/platform/outbound", (route) =>
      route.fulfill(json(200, OUTBOUND("partial"))),
    );
    await operatorLogin(page);
    await goSection(page, "الإرسال");
    await expectFrame(page, info, {
      screenId: "PLT-05",
      state: "partial",
      texts: fromFrame("PLT-05", "partial", [
        "جزئي",
        "نفدت حصة الرسائل النصية للحملات. أوقفنا حملات التسويق أولاً، وتبقى رسائل التشغيل الحرجة (تأكيد طلب، تنبيه دفع) تمرّ عبر المزوّد الاحتياطي. التجار أصحاب الحملات المؤجَّلة أُبلغوا أن حملتهم",
        "مؤجَّلة لا فاشلة",
        "نفدت للحملات · تشغيل عبر الاحتياطي",
        "حملات مؤجَّلة تنتظر إعادة الحصة",
        "نفدت حصة الحملات لليوم. رسائل التشغيل الحرجة تُحوَّل إلى الاحتياطي تلقائياً.",
        "حصة منتهية",
        "يستقبل التحويل",
        "يعمل ضمن سعته. التحويل من الأساسي يُسجَّل ولا يحدث صامتاً.",
        "يعمل",
      ]),
    });
    const root = page.locator('[data-screen="PLT-05"]');
    await expect(root).toContainText("3 حملات مؤجَّلة تنتظر إعادة الحصة");
    await expect(root).toContainText("5000 / 5000");
  });
});

const REQ = (o: Record<string, unknown> = {}) => ({
  tenant_id: "t1",
  name: "مخزن البركة للجملة",
  docs_line: "رخصة تجارية + بطاقة المالك + صورة المحل",
  status: "pending",
  status_label: "مكتمل المستندات",
  note: "",
  reasons: {},
  submitted_at: hoursAgo(3),
  waiting_hours: 3,
  reviewed_at: "",
  reviewer_name: "",
  has_doc: true,
  doc_name: "registry.jpg",
  checklist: [
    { key: "identity", title: "هوية المسؤول", done: true, reason: "" },
    { key: "service_area", title: "عنوان النشاط ومنطقة الخدمة", done: true, reason: "" },
    { key: "terms", title: "موافقة على شروط البائع", done: true, reason: "" },
    { key: "registry_doc", title: "مستند السجل التجاري", done: true, reason: "" },
  ],
  ...o,
});
const ROWS = [
  REQ(),
  REQ({
    tenant_id: "t2",
    name: "شركة النيل للتوريدات",
    status: "needs_more",
    status_label: "ناقص",
    note: "رخصة منتهية منذ شهرين — نطلب تجديدها ولا نرفض الطلب",
    reasons: { registry_doc: "رخصة منتهية منذ شهرين — نطلب تجديدها ولا نرفض الطلب" },
    submitted_at: hoursAgo(30),
    waiting_hours: 30,
  }),
  REQ({
    tenant_id: "t3",
    name: "مستودع الشرق",
    status: "needs_more",
    status_label: "يحتاج توضيحاً",
    note: "اسم المالك في البطاقة يخالف اسم الرخصة — يحتاج توضيحاً مكتوباً",
    reasons: { identity: "اسم المالك في البطاقة يخالف اسم الرخصة — يحتاج توضيحاً مكتوباً" },
    submitted_at: hoursAgo(50),
    waiting_hours: 50,
  }),
  REQ({
    tenant_id: "t4",
    name: "تجارة عامة — بلا مستندات",
    status: "rejected",
    status_label: "مرفوض",
    docs_line: "بلا مستندات",
    has_doc: false,
    reviewed_at: hoursAgo(1),
    reviewer_name: "طيب — تشغيل",
    waiting_hours: 0,
  }),
];
const BADGE = "منشأة موثَّقة المستندات — التوثيق لا يشمل جودة السلع أو الالتزام بالتسليم";
const LIST = (rows: unknown[], pending: number, avg = 4) => ({
  requests: rows,
  pending_count: pending,
  oldest_waiting_hours: 50,
  avg_review_hours_week: avg,
  badge_text: BADGE,
  fetched_at: new Date().toISOString(),
});

test.describe("PLT-06", () => {
  test("loading → ready → validation_error → success: الأقدم أولاً، ولا إعادة رفع بلا سبب محدّد، والتوثيق بمن قرّر ومتى", async ({
    page,
  }, info) => {
    let released = false;
    let rows = ROWS;
    let pending = 5;
    await page.route("**/api/platform/verifications", async (route) => {
      while (!released) await new Promise((r) => setTimeout(r, 50));
      return route.fulfill(json(200, LIST(rows, pending)));
    });
    await page.route("**/api/platform/verifications/t1/*", (route) => {
      const action = route.request().url().split("/").pop();
      const b = route.request().postDataJSON() as {
        decision?: string;
        reasons?: Record<string, string>;
      };
      if (action === "document")
        return route.fulfill(
          json(200, {
            doc_name: "registry.jpg",
            doc_data:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          }),
        );
      if (b.decision === "needs_more" && !b.reasons)
        return route.fulfill(
          json(400, { detail: "reasons_required", extra: { field: "reasons" } }),
        );
      const req = REQ({
        status: "verified",
        status_label: "موثَّقة",
        reviewed_at: new Date().toISOString(),
        reviewer_name: "طيب — تشغيل",
        waiting_hours: 0,
      });
      rows = [req, ...ROWS.slice(1)];
      pending = 4;
      return route.fulfill(json(200, { request: req, badge_text: BADGE }));
    });
    await operatorLogin(page);
    await goSection(page, "طلبات التحقُّق");
    await expect(page).toHaveURL(/\/platform\/verifications$/);
    await expectFrame(page, info, {
      screenId: "PLT-06",
      state: "loading",
      texts: fromFrame("PLT-06", "loading", [
        "جلب الطلبات",
        "مع أقدم طلب منتظر — فالانتظار الطويل هنا يعطّل تاجراً عن البيع.",
      ]),
    });
    released = true;
    await expectFrame(page, info, {
      screenId: "PLT-06",
      state: "ready",
      texts: fromFrame("PLT-06", "ready", [
        "طلبات التحقُّق وتشغيل الإرسال — ما تعنيه الشارة بالضبط",
        "الشارة تقول «تحقّقنا من وجود المنشأة ومن هوية مالكها». لا تقول إن بضاعته جيدة ولا إنه يوفي بوعوده.",
        "طلبات التحقُّق",
        "5 بانتظار المراجعة",
        "مخزن البركة للجملة",
        "رخصة تجارية + بطاقة المالك + صورة المحل",
        "مكتمل المستندات",
        "شركة النيل للتوريدات",
        "رخصة منتهية منذ شهرين — نطلب تجديدها ولا نرفض الطلب",
        "ناقص",
        "مستودع الشرق",
        "اسم المالك في البطاقة يخالف اسم الرخصة — يحتاج توضيحاً مكتوباً",
        "يحتاج توضيحاً",
        "تجارة عامة — بلا مستندات",
        "رُفض الطلب مع بيان السبب. الحساب يبقى عاملاً بلا شارة.",
        "مرفوض",
        "نص الشارة ثابت ومعروض للمشتري:",
        "«منشأة موثَّقة المستندات — التوثيق لا يشمل جودة السلع أو الالتزام بالتسليم». بلا هذا السطر تصبح الشارة ضماناً لم نقدّمه.",
        "تشغيل الإرسال",
        "صحة القنوات دون كشف مفاتيح أو أسرار مزوّدين",
        "عند نفاد الحصة لا نُسقط الرسائل صامتين.",
        "الحملات التسويقية تتوقف أولاً، وتبقى رسائل التشغيل الحرجة تمرّ، ويُبلَّغ التجار المتأثرون بأن حملاتهم مؤجَّلة لا فاشلة.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-06"]');
    await expect(root).toContainText("أقدم انتظار 50 ساعة");
    // المرفوض لا يُفتح للقرار
    await expect(page.getByRole("button", { name: "تجارة عامة — بلا مستندات" })).toHaveCount(0);
    await page.getByRole("button", { name: "مخزن البركة للجملة" }).click();
    await page.getByRole("button", { name: "افتح المستند — تُسجَّل المشاهدة" }).click();
    await expect(page.getByRole("img", { name: "مستند مخزن البركة للجملة" })).toBeVisible();
    // إعادة رفع بلا سبب: الخادم يرفض — «لا رفض» بل سبب محدّد
    await expect(page.getByRole("button", { name: "رفض بسبب" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("button", { name: "اطلب إعادة الرفع بسبب" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-06",
      state: "validation_error",
      texts: fromFrame("PLT-06", "validation_error", [
        "مستند غير مقروء",
        "الصورة مشوّشة أو مقطوعة الأطراف.",
        "لا رفض",
        "نطلب إعادة الرفع بسبب محدّد: «الطرف الأيسر مقطوع». الرفض يُعيد التاجر إلى أول الطابور بلا ذنب.",
      ]),
    });
    await page.getByRole("button", { name: "تُحقّق من المنشأة" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-06",
      state: "success",
      texts: fromFrame("PLT-06", "success", [
        "تُحقّق من المنشأة",
        "نقول ما صار مسموحاً: النشر والبيع في السوق، والشارة على صفحتها.",
        "الشارة تعني ما تقول",
        "تحقّقٌ من هوية المنشأة لا شهادةُ جودة ولا ضمان. وهذا مكتوب حيث تُقرأ الشارة لا هنا فقط.",
      ]),
    });
    await expect(root).toContainText("قرّر طيب — تشغيل");
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(root).toContainText("4 بانتظار المراجعة");
    await expect(root).toContainText("موثَّقة");
  });

  test("empty: كل الطلبات روجعت — متوسط المراجعة مقياس يُحاسَب عليه المشغّل لا تهنئة", async ({
    page,
  }, info) => {
    await page.route("**/api/platform/verifications", (route) =>
      route.fulfill(json(200, LIST([ROWS[3]], 0, 4))),
    );
    await operatorLogin(page);
    await goSection(page, "طلبات التحقُّق");
    await expectFrame(page, info, {
      screenId: "PLT-06",
      state: "empty",
      texts: fromFrame("PLT-06", "empty", [
        "لا طلبات",
        "كل الطلبات روجعت. نعرض متوسط زمن المراجعة كمقياس خدمة.",
        "المقياس لا التهنئة",
        "«لا طلبات · متوسط المراجعة 4 ساعات هذا الأسبوع» — رقمٌ يُحاسَب عليه المشغّل.",
      ]),
    });
    await expect(page.locator('[data-screen="PLT-06"]')).toContainText("0 بانتظار المراجعة");
  });
});
