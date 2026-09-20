import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.18 — PLT-01 دخول الإدارة ومساحة المشغّل (3) + PLT-02 المستأجرون (4): حساب منفصل بتحقّق
 * ثنائي دائماً؛ حساب مالك متجر لا يترقّى؛ القائمة لا تكشف دفاتر (ACC-60 · ACC-62) ولا عمود
 * للمبيعات؛ الفراغ يقول ما فُحص.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const ROW = (o: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "بقالة النيل — تجريبي",
  plan_label: "أساسي",
  plan_code: "single",
  due_line: "يُجدَّد بعد 9 أيام · حتى 30/09",
  expires_at: "2026-09-30T00:00:00Z",
  days_left: 9,
  devices: 3,
  last_sync_at: minutesAgo(4),
  sync_stuck: false,
  technical: "كل الأجهزة متزامنة",
  status: "active",
  status_label: "نشط",
  support_access: "لا وصول فعّال",
  actions: "مراجعة استحقاق · إعلان صيانة · لا قراءة دفاتر",
  ...o,
});

const ROWS = [
  ROW(),
  ROW({
    id: "t2",
    name: "مخزن البركة — تجريبي",
    plan_label: "سوق + أدوات مورد",
    due_line: "يُجدَّد بعد 22 يوماً · حتى 12/10",
    days_left: 22,
    last_sync_at: minutesAgo(11),
    actions: "مراجعة طلب تحقق PLT-06 · تعليق نشر بمسار PLT-07",
    support_access: "مصرَّح 48 ساعة · تذكرة SUP-771",
  }),
  ROW({
    id: "t3",
    name: "متجر الأمان — تجريبي",
    due_line: "انتهى 09/09 · متأخر 10 يوماً",
    days_left: -10,
    status: "expired",
    status_label: "منتهي الاشتراك",
    last_sync_at: minutesAgo(180),
    actions: "مراجعة دفع PLT-03 · لا حجب بيانات ولا حذف",
    technical: "إيصال دفع بانتظار المراجعة",
  }),
  ROW({
    id: "t4",
    name: "مخبز الصباح — تجريبي",
    plan_label: "أساسي · فرع واحد",
    due_line: "يُجدَّد بعد 12 يوماً · حتى 02/10",
    days_left: 12,
    status: "sync_late",
    status_label: "مزامنة متأخرة",
    last_sync_at: minutesAgo(19 * 60),
    sync_stuck: true,
    technical: "جهاز لم يزامن 3 أيام",
    actions: "فتح تذكرة تشخيص · القراءة تحتاج تذكرة من المالك",
  }),
];

const LIST = (rows: unknown[], o: Record<string, unknown> = {}) => ({
  tenants: rows,
  total: 128,
  shown: rows.length,
  active_count: 312,
  filter: "all",
  q: "",
  access_rule:
    "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه، ونطاقاً زمنياً، وسبباً مكتوباً، وتظهر في سجل تدقيقه هو — لا في سجلنا فقط. ما تراه في هذا الجدول حقول تشغيل وفوترة، وليس مبيعات ولا عملاء ولا أسعاراً.",
  fetched_at: new Date().toISOString(),
  ...o,
});

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) => {
    const b = route.request().postDataJSON() as { email: string; password: string; otp?: string };
    if (b.email === "owner@shop.example")
      return route.fulfill(json(403, { detail: "tenant_account" }));
    if (!b.otp) return route.fulfill(json(400, { detail: "otp_required" }));
    return route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "طيب — تشغيل" }),
    );
  });
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.tayeb@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByLabel("2FA").fill("123456");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-01", () => {
  test("ready → validation_error → permission_denied: تحقّق ثنائي مطلوب، وحساب مالك متجر لا يترقّى", async ({
    page,
  }, info) => {
    await page.route("**/api/platform/login", (route) => {
      const b = route.request().postDataJSON() as { email: string; otp?: string };
      if (b.email === "owner@shop.example")
        return route.fulfill(json(403, { detail: "tenant_account" }));
      if (!b.otp) return route.fulfill(json(400, { detail: "otp_required" }));
      return route.fulfill(
        json(200, { access: "op", refresh: "r", session_id: "s", display_name: "طيب — تشغيل" }),
      );
    });
    await page.goto("/platform/login");
    await expectFrame(page, info, {
      screenId: "PLT-01",
      state: "ready",
      texts: fromFrame("PLT-01", "ready", [
        "دخول الإدارة ومساحة المشغّل — حساب منفصل لا دور مزدوج",
        "من يشغّل الخدمة يدخل بحساب مشغّل مستقل. حساب مالك متجر لا يترقّى إلى مساحة المشغّل مهما كانت صلاحياته داخل متجره.",
        "فصل حسابات",
        "وحدة تشغيل Sting — دخول المشغّل",
        "بريد المشغّل",
        "كلمة المرور",
        "2FA",
        "دخول المشغّل يشترط تحقّقاً ثنائياً دائماً — لا استثناء «أجهزة موثوقة». كل جلسة مقيّدة بمدّة وتُسجَّل.",
        "دخول مساحة المشغّل",
      ]),
    });
    await page.getByLabel("بريد المشغّل").fill("ops.tayeb@sting.internal");
    await page.getByLabel("كلمة المرور").fill("very-secret-ops");
    await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-01",
      state: "validation_error",
      texts: fromFrame("PLT-01", "validation_error", [
        "تحقّق ثنائي مطلوب لم يُدخل",
        "البريد والمرور صحيحان لكن الرمز الثنائي ناقص. لا ندخل بنصف تحقّق ولا نعرض «تخطّي مؤقت». الرسالة تقول ما ينقص بالضبط دون تلميح إن كان الحساب موجوداً أصلاً.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-01"]');
    await expect(root).not.toContainText("تخطّي مؤقت»)");
    await page.getByLabel("بريد المشغّل").fill("owner@shop.example");
    await page.getByLabel("2FA").fill("123456");
    await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-01",
      state: "permission_denied",
      texts: fromFrame("PLT-01", "permission_denied", [
        "حساب مالك متجر حاول الدخول هنا",
        "هذه المساحة ليست امتداداً لصلاحياتك في متجرك.",
        "بيانات دخولك صحيحة كمالك متجر، لكن مساحة المشغّل حساب من نوع آخر تماماً. لا نمنحها لك ولا نُنشئها تلقائياً؛ من يحتاج وصول تشغيل يطلبه عبر مسار داخلي مدقَّق. أُعيد توجيهك إلى مساحة متجرك.",
      ]),
    });
    await page.getByRole("button", { name: "مساحة متجرك" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("PLT-02", () => {
  test("loading → ready → empty: القائمة بلا عمود مبيعات، الفلاتر، والفراغ يقول ما فُحص", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/platform\/tenants(\?.*)?$/, async (route) => {
      if (!released) await held;
      const url = new URL(route.request().url());
      const f = url.searchParams.get("filter") ?? "all";
      if (f === "late") return route.fulfill(json(200, LIST([], { filter: "late", total: 312 })));
      return route.fulfill(json(200, LIST(ROWS)));
    });
    await operatorLogin(page);
    await expectFrame(page, info, {
      screenId: "PLT-02",
      state: "loading",
      texts: fromFrame("PLT-02", "loading", [
        "جلب المستأجرين",
        "مع العدد الإجمالي وحالة الاستحقاق — سبب فتح الشاشة.",
      ]),
    });
    released = true;
    release();
    await expect(page.getByText("المستأجرون — 128")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "PLT-02",
      state: "ready",
      texts: fromFrame("PLT-02", "ready", [
        "المستأجرون — وصول دعم مقيد ومدقَّق",
        "ACC-62 وACC-60: مشغّل الخدمة يرى الاستحقاق والحالة التشغيلية، ولا يرى دفتر مستأجر بلا مسار مخوَّل.",
        "ADMIN",
        "إدارة Sting — مشغّل الخدمة",
        "إطار منفصل عن تطبيق المتاجر · كل فتح سجل يُدقَّق",
        "ابحث باسم المنشأة أو معرِّف المستأجر",
        "كل الاستحقاقات",
        "المستأجر",
        "آخر مزامنة",
        "الحالة",
        "ما يمكنك فعله",
        "حد الوصول",
        "لا زر «دخول كالمالك».",
        "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه، ونطاقاً زمنياً، وسبباً مكتوباً، وتظهر في سجل تدقيقه هو — لا في سجلنا فقط. ما تراه في هذا الجدول حقول تشغيل وفوترة، وليس مبيعات ولا عملاء ولا أسعاراً.",
        "بقالة النيل — تجريبي",
        "قبل 4 دقائق",
        "مراجعة استحقاق · إعلان صيانة · لا قراءة دفاتر",
        "نشط",
        "مخزن البركة — تجريبي",
        "سوق + أدوات مورد",
        "قبل 11 دقيقة",
        "مراجعة طلب تحقق PLT-06 · تعليق نشر بمسار PLT-07",
        "متجر الأمان — تجريبي",
        "قبل 3 ساعات",
        "مراجعة دفع PLT-03 · لا حجب بيانات ولا حذف",
        "منتهي الاشتراك",
        "مخبز الصباح — تجريبي",
        "أساسي · فرع واحد",
        "قبل 19 ساعة — تحت المتابعة",
        "فتح تذكرة تشخيص · القراءة تحتاج تذكرة من المالك",
        "مزامنة متأخرة",
        "لا عمود للمبيعات في هذه الشاشة ولن يوجد.",
        "وصول الدعم",
        "مصرَّح 48 ساعة · تذكرة SUP-771",
        "لا وصول فعّال",
      ]),
    });
    const root = page.locator('[data-screen="PLT-02"]');
    await expect(root).toContainText("المستأجرون — 128 متجراً");
    await expect(root).not.toContainText("المبيعات:");
    await expect(root).not.toContainText('دخول كالمالك"');
    await page.getByRole("button", { name: "متأخرو السداد" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-02",
      state: "empty",
      texts: fromFrame("PLT-02", "empty", [
        "لا مستأجرين مطابقين",
        "مرشّحٌ لا يطابق (مثلاً: متأخرو السداد وقد سدّد الجميع).",
        "نقول ما فُحص",
      ]),
    });
    await expect(root).toContainText("«لا متأخرين — 312 مستأجراً نشطاً»");
  });

  test("permission_denied: جلسة بلا صفة مشغّل — لا دفاتر ولا باب خلفي", async ({ page }, info) => {
    await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) =>
      route.fulfill(json(403, { detail: "operator_required" })),
    );
    await operatorLogin(page);
    await expectFrame(page, info, {
      screenId: "PLT-02",
      state: "permission_denied",
      texts: fromFrame("PLT-02", "permission_denied", [
        "المشغّل لا يرى دفاتر التجّار",
        "يرى الاستحقاق والباقة وتاريخ الدفع، ولا يرى مبيعات المستأجر ولا عملاءه ولا أصنافه.",
        "الحدّ الصريح",
        "حالة التشغيل والفوترة مرئية، ودفتر الأعمال لا. هذا حدٌّ تعاقدي يُرسم في الواجهة لا سياسةً مكتوبة.",
        "حتى للدعم",
        "موظف الدعم يرى تشخيصاً بلا بيانات (SYS-11) — ولا باباً خلفياً إلى الدفاتر.",
      ]),
    });
  });
});
