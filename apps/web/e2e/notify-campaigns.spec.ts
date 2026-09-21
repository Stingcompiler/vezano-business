import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T2.11 — NOT-03 قائمة الحملات (4) + NOT-04 إنشاء حملة واختيار الجمهور (4): الحصة والرقم الصادق؛
 * نتائج الحملة بأربع درجات؛ الجمهور من دفترك وحده يُحصى خادمياً مع كل شرط؛ رسالة بلا هوية المرسل
 * تُمنع؛ لا جمهور مطابق يُفصَّل سببه؛ جمهور مستأجر آخر يُرفض بلا تسريب (ACC-103).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const yesterday = (h: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const campaign = (o: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "خصم نهاية الأسبوع",
  message: "سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل",
  channel: "sms",
  audience_rules: { segments: ["subscribed"] },
  audience_count: 412,
  excluded_count: 31,
  parts: 2,
  cost_messages: 824,
  status: "sending",
  status_label: "جارية",
  scheduled_at: "",
  sent_at: yesterday(17),
  results: {
    sent: 459,
    accepted: 459,
    delivered: 366,
    unconfirmed: 46,
    failed: 47,
    failures: [
      {
        code: "invalid_number",
        label: "رقم غير صالح أو مغلق نهائياً",
        count: 18,
        action: "نُظهرها في الأطراف لتصحّح الأرقام — لا نحذفها نيابةً عنك.",
      },
      {
        code: "provider_temp",
        label: "رفض المزوّد مؤقتاً",
        count: 29,
        action: "قابلة لإعادة المحاولة. الإعادة تخصم من الرصيد مرة أخرى، ونقول ذلك.",
      },
      {
        code: "opted_out",
        label: "الرقم أوقف التسويق أثناء الحملة",
        count: 0,
        action: "يُحترم فوراً ولو بعد بدء الإرسال. لا يُحتسب فشلاً ولا يُعاد.",
      },
    ],
  },
  created_by_name: "عثمان الطيب",
  created_at: yesterday(10),
  ...o,
});

const list = (o: Record<string, unknown> = {}) => ({
  campaigns: [campaign()],
  quota: { used: 824, max: 1200, remaining: 376 },
  subscribers: 42,
  parties_total: 88,
  can_create: true,
  can_approve: true,
  can_see_billing: true,
  as_of: today(10, 0),
  ...o,
});

const segments = (counts: Record<string, number>, selected: string[]) => [
  {
    key: "subscribed",
    label: "زبائن محلك المشتركون",
    hint: "مشتركاً عبر رابط المحل أو QR",
    count: counts.subscribed ?? 0,
    selected: selected.includes("subscribed"),
    warning: false,
    available: true,
  },
  {
    key: "bought_90d",
    label: "زبائن اشتروا خلال 90 يوماً",
    hint: "من فواتير دفترك — بلا زبائن عابرين بلا رقم",
    count: counts.bought_90d ?? 0,
    selected: selected.includes("bought_90d"),
    warning: false,
    available: true,
  },
  {
    key: "with_debt",
    label: "عليهم ذمم مستحقة",
    hint: "رسالة تسويقية لمدين قد تُفهم مطالبةً — تحذير لا منع",
    count: counts.with_debt ?? 0,
    selected: selected.includes("with_debt"),
    warning: true,
    available: true,
  },
  {
    key: "market_followers",
    label: "متابعو صفحتك في السوق",
    hint: "تابعوك طوعاً ويملكون إلغاء المتابعة",
    count: counts.market_followers ?? 0,
    selected: selected.includes("market_followers"),
    warning: false,
    available: false,
  },
];

const preview = (message: string, selected: string[], o: Record<string, unknown> = {}) => {
  const chars = message.trim().length;
  const parts = chars === 0 ? 0 : chars <= 160 ? 1 : Math.ceil(chars / 153);
  const eligible = selected.includes("subscribed") ? 412 : selected.includes("with_debt") ? 23 : 0;
  const blockers: unknown[] = [];
  if (!chars)
    blockers.push({
      code: "no_message",
      title: "لا نص للرسالة",
      detail: "المعاينة فارغة. لا نجدول رسالة لا نعرف ماذا تقول.",
    });
  else if (!message.includes("بقالة النيل"))
    blockers.push({
      code: "sender_identity_missing",
      title: "رسالة بلا هوية المرسل",
      detail: "نصٌّ لا يذكر اسم المحل. الزبون يتلقّى رسالة من رقم لا يعرفه.",
    });
  if (parts * eligible > 600)
    blockers.push({
      code: "quota_short",
      title: "رصيد الرسائل لا يكفي",
      detail: `الحاجة ${parts * eligible} رسالة والرصيد 600. نعرض العجز بالرقم قبل الجدولة لا بعد الفشل.`,
      need: parts * eligible,
      remaining: 600,
    });
  return {
    shop_name: "بقالة النيل",
    audience: {
      segments: segments(
        { subscribed: 443, bought_90d: 12, with_debt: 23, market_followers: 0 },
        selected,
      ),
      blocked: {
        key: "other_merchants",
        label: "زبائن تجّار آخرين في السوق",
        hint: "ليسوا جمهورك. غير متاح ولن يكون.",
      },
      eligible,
      consented: selected.includes("subscribed") ? 412 : 0,
      excluded_opt_out: 31,
      excluded_no_phone: 0,
      duplicates: 0,
      with_debt_in_audience: selected.includes("with_debt") ? 23 : 0,
    },
    chars,
    parts,
    cost_messages: parts * eligible,
    quota: { used: 600, max: 1200, remaining: 600 },
    blockers,
    ...o,
  };
};

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

test.describe("NOT-03", () => {
  test("loading → ready: الحصة والرقم الصادق ونتائج الحملة بأربع درجات وأسباب الفشل", async ({
    page,
  }, info) => {
    let released = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = () => {
        released = true;
        r();
      };
    });
    await page.route("**/api/campaigns", async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, list()));
    });
    await login(page, "/notify/campaigns");
    await expectFrame(page, info, {
      screenId: "NOT-03",
      state: "loading",
      texts: fromFrame("NOT-03", "loading", [
        "قائمة الحملات",
        "جلب الحملات",
        "مع الحصة الشهرية وهي تُحسب — فهي أول ما يُنظر إليه قبل إنشاء حملة.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "NOT-03",
      state: "ready",
      texts: fromFrame("NOT-03", "ready", [
        "نتائج الحملة — «قبِله المزوّد» ليس «قرأه الزبون»",
        "حملة «خصم نهاية الأسبوع»",
        "أُرسلت أمس 17:00 · قناة رسائل نصية",
        "جارية",
        "سبب الفشل",
        "العدد",
        "ما يمكن فعله",
        "أُرسلت من عندنا",
        "غادرت النظام إلى المزوّد",
        "قبِلها المزوّد",
        "قبول لا يعني تسليماً للهاتف",
        "أكّد المزوّد تسليمها",
        "وصلت الجهاز · 46 بلا تأكيد بعد",
        "فشلت نهائياً",
        "بسبب مذكور لكل واحدة",
        "رقم غير صالح أو مغلق نهائياً",
        "نُظهرها في الأطراف لتصحّح الأرقام — لا نحذفها نيابةً عنك.",
        "رفض المزوّد مؤقتاً",
        "قابلة لإعادة المحاولة. الإعادة تخصم من الرصيد مرة أخرى، ونقول ذلك.",
        "الرقم أوقف التسويق أثناء الحملة",
        "يُحترم فوراً ولو بعد بدء الإرسال. لا يُحتسب فشلاً ولا يُعاد.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="NOT-03"]');
    await expect(root).toContainText(
      "أربع درجات لا واحدة. عرض «366 وصلت» بينما 47 فشلت يجعلك تحاسب حملة نجحت نصفها.",
    );
    await expect(root).toContainText("42");
    await expect(root).toContainText(
      "زبوناً أذنوا باستقبال رسائلك — لا 88 زبوناً في دفترك. الفرق بينهما هو الإذن.",
    );
    await expect(root).toContainText("376");
  });

  test("empty: لا حملات مع الرقم الصادق؛ permission_denied: مسؤول الحملات لا يرى الفوترة", async ({
    page,
  }, info) => {
    let mode: "empty" | "manager" | "cashier" = "empty";
    await page.route(/\/api\/notifications(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, { items: [], needs_action: 0, unread: 0, category: "", as_of: today(10, 0) }),
      ),
    );
    await page.route("**/api/campaigns", (route) =>
      route.fulfill(
        mode === "cashier"
          ? json(403, { detail: "permission_denied", role_name: "كاشير" })
          : json(
              200,
              list(
                mode === "empty"
                  ? { campaigns: [], quota: { used: 0, max: 1200, remaining: 1200 } }
                  : { can_approve: false, can_see_billing: false },
              ),
            ),
      ),
    );
    await login(page, "/notify/campaigns");
    await expectFrame(page, info, {
      screenId: "NOT-03",
      state: "empty",
      texts: fromFrame("NOT-03", "empty", [
        "لا حملات",
        "لم تُنشأ حملة بعد. نعرض الحصة المتاحة وعدد المشتركين الفعلي.",
        "الرقم الصادق",
        "زبوناً أذنوا باستقبال رسائلك» — لا «",
        "زبوناً في دفترك». الفرق بينهما هو الإذن.",
      ]),
    });
    const root = page.locator('[data-screen="NOT-03"]');
    await expect(root).toContainText("«42 زبوناً أذنوا باستقبال رسائلك» — لا «88 زبوناً في دفترك»");
    await expect(page.getByRole("button", { name: "حملة جديدة" })).toBeVisible();
    // مدير الفرع: يرى الحصة ولا يرى الفوترة (النصّ في الإطار)
    mode = "manager";
    await navTo(page, "الوارد", { exact: true });
    await expect(page).toHaveURL(/\/notify\/inbox$/);
    await navTo(page, "الحملات", { exact: true });
    await expect(page).toHaveURL(/\/notify\/campaigns$/);
    await expect(root).toContainText("مسؤول الحملات لا يرى الفوترة");
    await expect(root).toContainText(
      "يرى الحملات والحصة المتبقية، ولا يرى تكلفتها ولا فاتورة الباقة.",
    );
    await expect(root).toContainText("الحصة عددٌ يحتاجه ليخطّط، والتكلفة رقمٌ مالي للمالك.");
    // الكاشير: الشاشة محجوبة
    mode = "cashier";
    await navTo(page, "الوارد", { exact: true });
    await expect(page).toHaveURL(/\/notify\/inbox$/);
    await navTo(page, "الحملات", { exact: true });
    await expect(page).toHaveURL(/\/notify\/campaigns$/);
    await expectFrame(page, info, {
      screenId: "NOT-03",
      state: "permission_denied",
      texts: fromFrame("NOT-03", "permission_denied", ["قائمة الحملات"]),
    });
    await expect(root).toContainText("دورك: كاشير.");
  });
});

test.describe("NOT-04", () => {
  test("ready: العدد يتغير مع كل شرط، اسم المحل يُدرج، الموانع بأسبابها؛ validation_error بلا هوية المرسل؛ حفظ كمسودة", async ({
    page,
  }, info) => {
    let saved: Record<string, unknown> | null = null;
    await page.route("**/api/campaigns/preview", (route) => {
      const body = route.request().postDataJSON() as {
        message: string;
        audience: { segments: string[] };
      };
      return route.fulfill(json(200, preview(body.message, body.audience.segments)));
    });
    await page.route("**/api/campaigns", (route) => {
      if (route.request().method() === "POST") {
        saved = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill(
          json(201, {
            campaign: campaign({ id: "c9", status: "draft", status_label: "مسودة", results: {} }),
          }),
        );
      }
      return route.fulfill(json(200, list()));
    });
    await login(page, "/notify/campaigns/new");
    // المعاينة الخادمية تصل بعد الشاشة — ننتظر لوحة الجمهور قبل فحص النصوص (CI أبطأ)
    await expect(page.getByText("مشتركون مؤهلون").first()).toBeVisible();
    await expectFrame(page, info, {
      screenId: "NOT-04",
      state: "ready",
      texts: fromFrame("NOT-04", "ready", [
        "إنشاء حملة واختيار الجمهور",
        "زبائن محلك أو متابعوك في السوق — لا جمهور مستأجر آخر بأي حال. ACC-103.",
        "حملة جديدة",
        "اسم الحملة — داخلي",
        "الجمهور",
        "نص الرسالة",
        "حجم الإرسال",
        "مشتركون مؤهلون",
        "ألغوا الاشتراك — مستبعدون",
        "حصتك المتبقية هذا الشهر",
        "ما لا نعد به.",
        "قبول المزوّد للرسالة ليس تسليماً، والتسليم ليس قراءة. نتائج الحملة تعرض «مقبول من المزوّد» و«فشل» فقط، ولا نسجّل «تم الاطلاع» بلا دليل.",
        "حفظ ومعاينة قبل الاعتماد",
        "حفظ كمسودة",
        "زبائن محلك المشتركون",
        "مشتركاً عبر رابط المحل أو QR",
        "زبائن تجّار آخرين في السوق",
        "غير متاح إطلاقاً — جمهور كل منشأة معزول ولا يُشترى ولا يُستعار",
        "اختيار الجمهور",
        "العدد يتغير أمامك مع كل شرط",
        "الجمهور بعد إزالة التكرار ومن رفض التسويق",
        "زبائن اشتروا خلال 90 يوماً",
        "من فواتير دفترك — بلا زبائن عابرين بلا رقم",
        "عليهم ذمم مستحقة",
        "رسالة تسويقية لمدين قد تُفهم مطالبةً — تحذير لا منع",
        "متابعو صفحتك في السوق",
        "تابعوك طوعاً ويملكون إلغاء المتابعة",
        "ليسوا جمهورك. غير متاح ولن يكون.",
        "محجوب",
        "حدود صريحة",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="NOT-04"]');
    // اسم المحل أُدرج تلقائياً في نص الرسالة
    await expect(page.getByLabel("نص الرسالة")).toHaveValue("— بقالة النيل");
    await expect(root).toContainText("412");
    await expect(root).toContainText("31 رقماً استُبعد لأن أصحابها أوقفوا الرسائل التسويقية.");
    // رسالة 164 حرفاً = رسالتان نصيتان والتكلفة 824 لا 412؛ الرصيد 600 → لا يمكن الجدولة بعد
    const msg = "سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل "
      .repeat(3)
      .slice(0, 164);
    await page.getByLabel("نص الرسالة").fill(msg);
    await expect(root).toContainText(
      "164 حرفاً = رسالتان نصيتان، والتكلفة المعروضة 824 رسالة من رصيدك لا 412.",
    );
    await expect(root).toContainText("لا يمكن الجدولة بعد");
    await expect(root).toContainText("رصيد الرسائل لا يكفي");
    await expect(root).toContainText(
      "الحاجة 824 رسالة والرصيد 600. نعرض العجز بالرقم قبل الجدولة لا بعد الفشل.",
    );
    await expect(root).toContainText("جدولة — غير متاحة");
    await expect(page.getByRole("button", { name: "حفظ ومعاينة قبل الاعتماد" })).toBeDisabled();
    // حذف اسم المحل → رسالة بلا هوية المرسل
    await page.getByLabel("نص الرسالة").fill("خصم 10% على السكر هذا الأسبوع");
    await expectFrame(page, info, {
      screenId: "NOT-04",
      state: "validation_error",
      texts: fromFrame("NOT-04", "validation_error", [
        "رسالة بلا هوية المرسل",
        "نصٌّ لا يذكر اسم المحل. الزبون يتلقّى رسالة من رقم لا يعرفه.",
        "نُلزم بالاسم",
        "وهو يُدرج تلقائياً ويمكن تحريره لا حذفه. رسالةٌ مجهولة المصدر تُبلَّغ كإزعاج فيُحظر المحل.",
      ]),
    });
    await page.getByRole("button", { name: "أدرج اسم المحل" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(page.getByLabel("نص الرسالة")).toHaveValue(
      "خصم 10% على السكر هذا الأسبوع — بقالة النيل",
    );
    // شرط إضافي يغيّر العدد أمامك؛ ثم حفظ كمسودة — الاعتماد في NOT-05
    await page.getByRole("checkbox", { name: /عليهم ذمم مستحقة/ }).check();
    await expect(root).toContainText(
      "23 عليهم ذمم مستحقة — رسالة تسويقية لمدين قد تُفهم مطالبةً — تحذير لا منع.",
    );
    await page.getByLabel("اسم الحملة — داخلي").fill("خصم السكر");
    await page.getByRole("button", { name: "حفظ كمسودة" }).click();
    await expect
      .poll(() => saved)
      .toMatchObject({ name: "خصم السكر", audience: { segments: ["subscribed", "with_debt"] } });
    await expect(root).toContainText(
      "أنت تنشئ الحملة، والاعتماد والجدولة يحتاجان صلاحية منفصلة في",
    );
    await expect(root).toContainText(". الفصل متعمَّد.");
  });

  test("empty: لا جمهور مطابق مع تفصيل السبب؛ permission_denied: جمهور خارج منشأتك يُرفض بلا تسريب", async ({
    page,
  }, info) => {
    let foreign = false;
    await page.route("**/api/campaigns/preview", (route) => {
      if (foreign)
        return route.fulfill(
          json(400, { detail: "audience_out_of_tenant", field: "party_ids", extra: {} }),
        );
      const body = route.request().postDataJSON() as {
        message: string;
        audience: { segments: string[] };
      };
      const p = preview(body.message, body.audience.segments);
      if (
        !body.audience.segments.includes("subscribed") &&
        !body.audience.segments.includes("with_debt")
      ) {
        // اشتروا هذا الشهر 12 · 0 منهم أذن
        return route.fulfill(
          json(200, { ...p, audience: { ...p.audience, eligible: 0, consented: 0 } }),
        );
      }
      return route.fulfill(json(200, p));
    });
    await page.route("**/api/campaigns", (route) => route.fulfill(json(200, list())));
    await login(page, "/notify/campaigns/new");
    const root = page.locator('[data-screen="NOT-04"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await page.getByRole("checkbox", { name: /زبائن محلك المشتركون/ }).uncheck();
    await page.getByRole("checkbox", { name: /زبائن اشتروا خلال 90 يوماً/ }).check();
    await expectFrame(page, info, {
      screenId: "NOT-04",
      state: "empty",
      texts: fromFrame("NOT-04", "empty", [
        "لا جمهور مطابق",
        "نُفصّل السبب",
        "منهم أذن",
        "معرفة أيّ الشرطين أفرغ القائمة هي ما يُصلح الحملة.",
      ]),
    });
    await expect(root).toContainText("المرشّح (زبائن اشتروا خلال 90 يوماً) لا يطابق أحداً.");
    await expect(root).toContainText("12 زبائن اشتروا خلال 90 يوماً · 0 منهم أذن.");
    // جمهور خارج منشأتك: رفض بلا تسريب
    foreign = true;
    await page.getByRole("checkbox", { name: /زبائن محلك المشتركون/ }).check();
    await expectFrame(page, info, {
      screenId: "NOT-04",
      state: "permission_denied",
      texts: fromFrame("NOT-04", "permission_denied", [
        "جمهور خارج منشأتك",
        "محاولة اختيار شريحة تشمل زبائن منشأة أخرى على نفس الجهاز.",
        "رفض بلا تسريب",
        "لا نقول كم عددهم ولا من هم. «الجمهور محصور بزبائن منشأتك» — والعدد وحده خبر.",
      ]),
    });
    await expect(root).not.toContainText("412");
  });
});
