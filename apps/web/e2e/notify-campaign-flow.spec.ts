import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.12 — NOT-05 معاينة واعتماد وجدولة (5) + NOT-06 نتائج حملة وإلغاؤها (5): الرقم الحاسم قبل
 * الاعتماد؛ إعادة التحقق قبل كل محاولة (ACC-109)؛ الجدولة تُسجَّل ولا تُرسل؛ مضى وقت الإرسال يُسأل؛
 * مقبول ≠ مقروء (ACC-111)؛ المزوّد الصامت يُقال كما هو؛ الإلغاء يُفصّل ما أُرسل ولا يُستردّ.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const yesterday = (h: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};
const dateInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const campaign = (o: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "عرض السكر — سبتمبر",
  message: "سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل",
  audience_count: 42,
  excluded_count: 3,
  parts: 1,
  cost_messages: 42,
  status: "draft",
  status_label: "مسودة",
  scheduled_at: "",
  sent_at: "",
  results: {},
  overdue: false,
  can_approve: true,
  can_cancel: true,
  approved_by_name: "",
  approved_at: "",
  cancelled_at: "",
  shop_name: "بقالة النيل",
  quota: { used: 0, max: 200, remaining: 200 },
  ...o,
});

const verify = (c: ReturnType<typeof campaign>, blockers: unknown[] = []) => ({
  audience: { eligible: 42, excluded_opt_out: 3 },
  parts: 1,
  cost_messages: 42,
  quota: { used: 0, max: 200, remaining: 200 },
  blockers,
  campaign: c,
});

const results = (o: Record<string, unknown> = {}) => ({
  sent: 312,
  accepted: 312,
  delivered: 280,
  unconfirmed: 9,
  awaiting: 0,
  failed: 23,
  failed_permanent: 14,
  failed_temporary: 9,
  opted_out: 0,
  queued: 0,
  cancelled: 0,
  failures: [
    {
      code: "invalid_number",
      label: "رقم غير صالح أو مغلق نهائياً",
      count: 14,
      action: "نُظهرها في الأطراف لتصحّح الأرقام — لا نحذفها نيابةً عنك.",
      retryable: false,
    },
    {
      code: "provider_temp",
      label: "رفض المزوّد مؤقتاً",
      count: 9,
      action: "قابلة لإعادة المحاولة. الإعادة تخصم من الرصيد مرة أخرى، ونقول ذلك.",
      retryable: true,
    },
    {
      code: "opted_out",
      label: "الرقم أوقف التسويق أثناء الحملة",
      count: 0,
      action: "يُحترم فوراً ولو بعد بدء الإرسال. لا يُحتسب فشلاً ولا يُعاد.",
      retryable: false,
    },
  ],
  provider_silent: false,
  read: null,
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

test.describe("NOT-05", () => {
  test("ready → validation_error → saving → success: الرقم الحاسم، إعادة التحقق تمنع، ثم مجدولة لا أُرسلت والإلغاء ظاهر", async ({
    page,
  }, info) => {
    let current = campaign();
    let released = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = () => {
        released = true;
        r();
      };
    });
    let approves = 0;
    await page.route("**/api/campaigns/c1", (route) =>
      route.fulfill(json(200, { campaign: current })),
    );
    await page.route("**/api/campaigns/c1/verify", (route) => {
      const body = route.request().postDataJSON() as {
        scheduled_at: string;
        night_confirmed: boolean;
      };
      const night =
        body.scheduled_at && new Date(body.scheduled_at).getHours() >= 22 && !body.night_confirmed;
      return route.fulfill(
        json(
          200,
          verify(
            current,
            night
              ? [
                  {
                    code: "night_send",
                    title: "وقت الإرسال 23:00",
                    detail:
                      "ليس خطأً لكنه يوقظ زبائنك. نطلب تأكيداً صريحاً لأي إرسال بين 22:00 و07:00.",
                    confirmable: true,
                  },
                ]
              : [],
          ),
        ),
      );
    });
    await page.route("**/api/campaigns/c1/approve", async (route) => {
      approves += 1;
      const body = route.request().postDataJSON() as {
        scheduled_at?: string;
        night_confirmed?: boolean;
        send_now?: boolean;
      };
      if (approves === 1) {
        // إعادة التحقق قبل كل محاولة: رصيد اليوم لا يكفي
        return route.fulfill(
          json(400, {
            detail: "blocked",
            extra: {
              blockers: [
                {
                  code: "quota_short",
                  title: "رصيد الرسائل لا يكفي",
                  detail: "الحاجة 42 رسالة والرصيد 30. نعرض العجز بالرقم قبل الجدولة لا بعد الفشل.",
                  need: 42,
                  remaining: 30,
                },
              ],
              cost_messages: 42,
              quota: { used: 170, max: 200, remaining: 30 },
            },
          }),
        );
      }
      if (!released) await held;
      current = campaign({
        status: "scheduled",
        status_label: "مجدولة",
        scheduled_at: body.scheduled_at,
        approved_by_name: "عثمان الطيب",
        approved_at: today(10, 0),
        quota: { used: 42, max: 200, remaining: 158 },
      });
      return route.fulfill(json(200, { campaign: current }));
    });
    await page.route("**/api/campaigns/c1/cancel", (route) => {
      current = campaign({
        status: "cancelled",
        status_label: "أُلغيت",
        cancelled_at: today(10, 5),
        results: { sent: 0, cancelled: 42, refunded_messages: 42 },
      });
      return route.fulfill(json(200, { campaign: current }));
    });
    await login(page, "/notify/campaigns/c1/approve");
    await expectFrame(page, info, {
      screenId: "NOT-05",
      state: "ready",
      texts: fromFrame("NOT-05", "ready", [
        "معاينة واعتماد وجدولة",
        "آخر باب قبل الإرسال.",
        "كما ستصل الزبون",
        "معاينةٌ بشكل الرسالة على هاتفه، ومعها العدد والوقت والحصة بعد الإرسال.",
        "الرقم الحاسم",
        "زبوناً · تبقى",
        "من حصتك». الاعتماد على معرفة الأثر لا على الثقة بالنظام.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="NOT-05"]');
    await expect(root).toContainText("«ستصل 42 زبوناً · تبقى 158 من حصتك»");
    await expect(root).toContainText("سكر أبيض كرتونة 12 كغ");
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    await page.getByLabel("تاريخ الإرسال").fill(dateInput(tmr));
    await page.getByRole("button", { name: "اعتمد وجدول" }).click();
    await expectFrame(page, info, {
      screenId: "NOT-05",
      state: "validation_error",
      texts: fromFrame("NOT-05", "validation_error", [
        "لا يمكن الجدولة بعد",
        "كلٌّ منها مذكور بسببه وبما يلزم لحلّه.",
        "رصيد الرسائل لا يكفي",
        "جدولة — غير متاحة",
      ]),
    });
    await expect(root).toContainText(
      "الحاجة 42 رسالة والرصيد 30. نعرض العجز بالرقم قبل الجدولة لا بعد الفشل.",
    );
    // المحاولة الثانية تمرّ: جارٍ الجدولة ثم مجدولة (لا أُرسلت) والإلغاء ظاهر هنا
    await page.getByRole("button", { name: "اعتمد وجدول" }).click();
    await expectFrame(page, info, {
      screenId: "NOT-05",
      state: "saving",
      texts: fromFrame("NOT-05", "saving", [
        "جارٍ الجدولة",
        "الجدولة تُسجَّل ولا تُرسل. الفرق مكتوب: «مجدولة ٨ ص غداً» لا «أُرسلت».",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "NOT-05",
      state: "success",
      texts: fromFrame("NOT-05", "success", [
        "اعتُمدت",
        "نقول ما صار: مجدولة",
        "، وأين تُتابَع نتائجها (NOT-06).",
        "الإلغاء متاح",
        "حتى لحظة الإرسال، وزرّه ظاهر هنا لا مخبوء في القائمة.",
      ]),
    });
    await expect(root).toContainText("مجدولة 08:00 غداً · اعتمدها عثمان الطيب في 10:00");
    await expect(page.getByRole("button", { name: "إلغاء الحملة" }).first()).toBeVisible();
  });

  test("expired: مضى وقت الإرسال — لا إرسال متأخر تلقائياً؛ «أرسل الآن» يرسل", async ({
    page,
  }, info) => {
    let current = campaign({
      status: "scheduled",
      status_label: "مجدولة",
      scheduled_at: yesterday(8),
      overdue: true,
      approved_by_name: "عثمان الطيب",
      approved_at: yesterday(7),
    });
    await page.route("**/api/campaigns/c1", (route) =>
      route.fulfill(json(200, { campaign: current })),
    );
    await page.route("**/api/campaigns/c1/verify", (route) =>
      route.fulfill(json(200, verify(current))),
    );
    await page.route("**/api/campaigns/c1/approve", (route) => {
      const body = route.request().postDataJSON() as { send_now?: boolean };
      expect(body.send_now).toBe(true);
      current = campaign({
        status: "done",
        status_label: "اكتملت",
        scheduled_at: today(9, 0),
        sent_at: today(9, 0),
        overdue: false,
        results: results({
          failed: 0,
          failed_permanent: 0,
          failed_temporary: 0,
          unconfirmed: 0,
          sent: 42,
          accepted: 42,
          delivered: 42,
        }),
      });
      return route.fulfill(json(200, { campaign: current }));
    });
    await login(page, "/notify/campaigns/c1/approve");
    await expectFrame(page, info, {
      screenId: "NOT-05",
      state: "expired",
      texts: fromFrame("NOT-05", "expired", [
        "مضى وقت الإرسال",
        "لا إرسال متأخر تلقائياً",
        "عرضُ «خصم اليوم» يصل بعد يومين إزعاجٌ لا تسويق. نسأل: أرسل الآن أم أعد الجدولة أم ألغِ.",
      ]),
    });
    const root = page.locator('[data-screen="NOT-05"]');
    await expect(root).toContainText("حملة مجدولة لأمس 08:00 والنظام كان متوقفاً.");
    await page.getByRole("button", { name: "أرسل الآن", exact: true }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect(root).toContainText("نقول ما صار: أُرسلت");
  });
});

test.describe("NOT-06", () => {
  test("empty → partial → ready: لا نتائج بعد ≠ لم تصل لأحد؛ الدرجات الأربع بلا قراءة؛ إعادة محاولة العابرة", async ({
    page,
  }, info) => {
    let mode: "empty" | "partial" | "ready" = "empty";
    await page.route("**/api/campaigns/c1", (route) =>
      route.fulfill(
        json(200, {
          campaign: campaign(
            mode === "empty"
              ? {
                  status: "sending",
                  status_label: "جارية",
                  sent_at: new Date(Date.now() - 4 * 60_000).toISOString(),
                  audience_count: 312,
                  results: results({
                    sent: 0,
                    accepted: 0,
                    delivered: 0,
                    unconfirmed: 0,
                    awaiting: 312,
                    failed: 0,
                    failed_permanent: 0,
                    failed_temporary: 0,
                    failures: [],
                  }),
                }
              : mode === "partial"
                ? {
                    status: "done",
                    status_label: "اكتملت",
                    sent_at: yesterday(18),
                    audience_count: 312,
                    results: results(),
                  }
                : {
                    status: "done",
                    status_label: "اكتملت",
                    sent_at: yesterday(18),
                    audience_count: 312,
                    results: results({
                      failed: 14,
                      failed_temporary: 0,
                      unconfirmed: 0,
                      delivered: 298,
                      failures: results().failures.map((f) =>
                        f.code === "provider_temp" ? { ...f, count: 0 } : f,
                      ),
                    }),
                  },
          ),
        }),
      ),
    );
    await page.route("**/api/campaigns", (route) =>
      route.fulfill(
        json(200, {
          campaigns: [
            campaign({
              status: "done",
              status_label: "اكتملت",
              sent_at: yesterday(18),
              results: results(),
            }),
          ],
          quota: { used: 312, max: 1200, remaining: 888 },
          subscribers: 312,
          parties_total: 400,
          can_create: true,
          can_approve: true,
          can_see_billing: true,
          as_of: today(10, 0),
        }),
      ),
    );
    await page.route("**/api/campaigns/c1/retry", (route) => {
      mode = "ready";
      return route.fulfill(
        json(200, {
          campaign: campaign({
            status: "done",
            status_label: "اكتملت",
            sent_at: yesterday(18),
            audience_count: 312,
            results: results({ failed: 14, failed_temporary: 0, unconfirmed: 0, delivered: 298 }),
          }),
        }),
      );
    });
    await login(page, "/notify/campaigns/c1");
    await expectFrame(page, info, {
      screenId: "NOT-06",
      state: "empty",
      texts: fromFrame("NOT-06", "empty", [
        "نتائج حملة وإلغاؤها",
        "ما وصل فعلاً. القاعدة: لا ندّعي علماً بما لا يُخبرنا به المزوّد.",
        "لا نتائج بعد",
        "نفرّق",
        "«لم تصل نتائج بعد» لا «لم تصل لأحد». الأولى انتظار والثانية فشل.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="NOT-06"]');
    await expect(root).toContainText("أُرسلت قبل 4 دقائق ولم يردّ المزوّد بشيء.");
    // اكتملت جزئياً — الإخفاقات والعابرة غير المحسومة (نعود إلى الحملة من القائمة)
    mode = "partial";
    await page.getByRole("link", { name: "الحملات", exact: true }).first().click();
    await expect(page).toHaveURL(/\/notify\/campaigns$/);
    await page.getByRole("row", { name: /عرض السكر — سبتمبر/ }).dblclick();
    await expect(page).toHaveURL(/\/notify\/campaigns\/c1$/);
    await expectFrame(page, info, {
      screenId: "NOT-06",
      state: "partial",
      texts: fromFrame("NOT-06", "partial", [
        "عرض السكر — سبتمبر",
        "أُرسلت أمس 18:00 · 312 مستلماً",
        "اكتملت جزئياً",
        "غير معروف",
        "القراءة غير مقيسة ولن تُعرض.",
        "المزوّد يخبرنا أنه قبِل الرسالة، وأحياناً أنه سلّمها. لا يخبرنا أن أحداً قرأها. عرض «معدل القراءة» هنا سيكون رقماً مخترعاً تبني عليه قراراً تسويقياً خاطئاً.",
        "الإخفاقات — 23 رسالة",
        "رقم غير صالح",
        "دائم — لا يُعاد الإرسال تلقائياً",
        "عابر — إعادة المحاولة متاحة بصلاحية",
        "العابرة لم تُحسم نتيجتها لدى المزوّد — تُعرض «غير مؤكدة» ولا تُحتسب نجاحاً ولا فشلاً نهائياً.",
        "أُرسلت للمزوّد",
        "كل الجمهور المؤهل",
        "قبِلها المزوّد",
        "قبول ليس تسليماً",
        "فشلت",
        "14 دائم · 9 عابر",
        "غير محسومة",
        "انقطع عامل الجدولة",
        "الإيقاف لا يسترد ما أُرسل ولا يعيد رصيده. نقول ذلك قبل التأكيد لا بعده.",
      ]),
    });
    await expect(root).not.toContainText("معدل القراءة:");
    await page.getByRole("button", { name: "إعادة محاولة الـ18 العابرة" }).click();
    await expectFrame(page, info, {
      screenId: "NOT-06",
      state: "ready",
      texts: fromFrame("NOT-06", "ready", [
        "لا قراءة مفترضة",
        "تسجيل القراءة افتراضاً يجعل التاجر يظنّ حملته ناجحة. الصمت أصدق من رقم مخترع.",
      ]),
    });
    await expect(root).toContainText("298");
  });

  test("server_error: المزوّد لا يردّ — نقولها كما هي ولا نُعيد الإرسال؛ success: أُلغيت الحملة بتفصيل ما أُرسل", async ({
    page,
  }, info) => {
    let current = campaign({
      status: "sending",
      status_label: "جارية",
      sent_at: today(9, 0),
      audience_count: 42,
      results: results({
        sent: 42,
        accepted: 0,
        delivered: 0,
        unconfirmed: 0,
        awaiting: 42,
        failed: 0,
        failed_permanent: 0,
        failed_temporary: 0,
        failures: [],
        provider_silent: true,
      }),
    });
    await page.route("**/api/campaigns/c1", (route) =>
      route.fulfill(json(200, { campaign: current })),
    );
    await page.route("**/api/campaigns/c1/cancel", (route) => {
      current = campaign({
        status: "cancelled",
        status_label: "أُلغيت",
        sent_at: today(9, 0),
        cancelled_at: today(9, 20),
        results: results({
          sent: 12,
          accepted: 0,
          delivered: 0,
          unconfirmed: 0,
          awaiting: 12,
          failed: 0,
          failed_permanent: 0,
          failed_temporary: 0,
          failures: [],
          cancelled: 30,
          refunded_messages: 30,
        }),
      });
      return route.fulfill(json(200, { campaign: current }));
    });
    await login(page, "/notify/campaigns/c1");
    await expectFrame(page, info, {
      screenId: "NOT-06",
      state: "server_error",
      texts: fromFrame("NOT-06", "server_error", [
        "المزوّد لا يردّ",
        "الحملة أُرسلت وحالة التسليم مجهولة. أسوأ من الفشل لأنه غموض.",
        "نقولها كما هي",
        "حالة التسليم غير معروفة — المزوّد لا يستجيب». ولا نُعيد الإرسال: قد تصل مرتين.",
      ]),
    });
    const root = page.locator('[data-screen="NOT-06"]');
    await expect(root).toContainText("«أُرسلت 42 · حالة التسليم غير معروفة — المزوّد لا يستجيب»");
    await expect(page.getByRole("button", { name: /إعادة محاولة/ })).toHaveCount(0);
    // الإلغاء بعد بدء الإرسال: يُقال قبل التأكيد، ثم نُفصّل
    await page.getByRole("button", { name: "إيقاف ما تبقّى" }).click();
    await expect(root).toContainText(
      "الإيقاف لا يسترد ما أُرسل ولا يعيد رصيده. نقول ذلك قبل التأكيد لا بعده.",
    );
    await page.getByRole("button", { name: "أكّد الإيقاف" }).click();
    await expectFrame(page, info, {
      screenId: "NOT-06",
      state: "success",
      texts: fromFrame("NOT-06", "success", [
        "أُلغيت الحملة",
        "ما أُرسل لا يُستردّ",
        "أُرسلت ولا تُستردّ ·",
        "أُلغيت». الإلغاء الجزئي حقيقة تُقال.",
      ]),
    });
    await expect(root).toContainText("«12 أُرسلت ولا تُستردّ · 30 أُلغيت»");
  });
});
