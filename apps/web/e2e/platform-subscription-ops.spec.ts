import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * PLT-13 (بأمر المالك 2026-09-21؛ 0005 §١٠٠) — إدارة اشتراك المستأجر من تفاصيله: تمديد بسبب،
 * تغيير باقة، إيقاف/استئناف، ملاحظة؛ الخط الزمني يعكس كل تصرّف بمن ومتى ولماذا؛ الرفض بنصّ.
 * النصوص من عند المنفّذ (لا إطار مرسوم) — لذلك بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const DETAIL = (o: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "بقالة النيل — تجريبي",
  plan_label: "فرع واحد",
  plan_code: "single",
  due_line: "يُجدَّد بعد 9 أيام · حتى 30/09",
  expires_at: daysAhead(9),
  days_left: 9,
  devices: 3,
  last_sync_at: minutesAgo(4),
  sync_stuck: false,
  technical: "كل الأجهزة متزامنة",
  status: "active",
  status_label: "نشط",
  support_access: "لا وصول فعّال",
  actions: "مراجعة استحقاق · إعلان صيانة · لا قراءة دفاتر",
  entitlement: {
    plan_code: "single",
    plan_label: "فرع واحد",
    state: "active",
    started_at: minutesAgo(60 * 24 * 40),
    expires_at: daysAhead(9),
    extra_features: [],
    renewal_amount_minor: "4500000",
    suspended: false,
    suspended_reason: "",
  },
  plans: [
    { code: "single", name: "فرع واحد", trial: false },
    { code: "dual", name: "فرعان", trial: false },
    { code: "trial", name: "تجريبية", trial: true },
  ],
  timeline: [
    {
      id: "e1",
      kind: "proof_approved",
      kind_label: "اعتماد إثبات",
      days: 30,
      from_plan: "",
      to_plan: "فرع واحد",
      expires_after: daysAhead(9),
      reason: "رقم العملية TRX-1001",
      by_name: "طيب — تشغيل",
      at: minutesAgo(60 * 24 * 21),
    },
    {
      id: "start",
      kind: "start",
      kind_label: "بدء التجريبية",
      days: 30,
      from_plan: "",
      to_plan: "تجريبية",
      expires_after: "",
      reason: "",
      by_name: "",
      at: minutesAgo(60 * 24 * 40),
    },
  ],
  proofs: [],
  devices_list: [],
  branches: 1,
  users: 2,
  storage: { operations: 1200 },
  support_grants: [],
  limits: ["لا زر «دخول كالمالك»."],
  ...o,
});

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, {
        tenants: [DETAIL()],
        total: 1,
        shown: 1,
        active_count: 1,
        filter: "all",
        q: "",
        access_rule: "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه.",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-13", () => {
  test("تمديد بسبب → الخط الزمني؛ رفض بلا سبب؛ إيقاف → موقوف بسببه واستئناف؛ ملاحظة", async ({
    page,
  }, info) => {
    let detail = DETAIL();
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/platform/tenants/t1", (route) =>
      route.fulfill(json(200, { tenant: detail })),
    );
    await page.route("**/api/platform/tenants/t1/subscription", (route) => {
      const b = route.request().postDataJSON() as {
        action: string;
        reason?: string;
        days?: number;
        plan_code?: string;
      };
      posted.push(b);
      const reason = b.reason ?? "";
      if (!reason.trim()) return route.fulfill(json(400, { detail: "reason_required" }));
      const at = new Date().toISOString();
      const by_name = "هدى — تشغيل";
      if (b.action === "extend") {
        detail = DETAIL({
          ...detail,
          timeline: [
            {
              id: "e-ext",
              kind: "extend",
              kind_label: "تمديد",
              days: b.days,
              from_plan: "",
              to_plan: "",
              expires_after: daysAhead(39),
              reason,
              by_name,
              at,
            },
            ...detail.timeline,
          ],
        });
      } else if (b.action === "suspend") {
        detail = DETAIL({
          ...detail,
          status: "suspended",
          status_label: "موقوف",
          due_line: `أوقفه المشغّل 21/09 · ${reason}`,
          entitlement: { ...detail.entitlement, suspended: true, suspended_reason: reason },
          timeline: [
            {
              id: "e-sus",
              kind: "suspend",
              kind_label: "إيقاف",
              days: 0,
              from_plan: "",
              to_plan: "",
              expires_after: "",
              reason,
              by_name,
              at,
            },
            ...detail.timeline,
          ],
        });
      } else if (b.action === "resume") {
        detail = DETAIL({
          ...detail,
          status: "active",
          status_label: "نشط",
          entitlement: { ...detail.entitlement, suspended: false, suspended_reason: "" },
          timeline: [
            {
              id: "e-res",
              kind: "resume",
              kind_label: "استئناف",
              days: 0,
              from_plan: "",
              to_plan: "",
              expires_after: "",
              reason,
              by_name,
              at,
            },
            ...detail.timeline,
          ],
        });
      } else if (b.action === "note") {
        detail = DETAIL({
          ...detail,
          timeline: [
            {
              id: "e-note",
              kind: "note",
              kind_label: "ملاحظة",
              days: 0,
              from_plan: "",
              to_plan: "",
              expires_after: "",
              reason,
              by_name,
              at,
            },
            ...detail.timeline,
          ],
        });
      }
      return route.fulfill(json(200, { result: {}, tenant: detail }));
    });
    await operatorLogin(page);
    // الجلسة في الذاكرة: الفتح من القائمة (نقر مزدوج) لا بتحميل الرابط
    await page.locator(".c-table__row--openable", { hasText: "بقالة النيل" }).first().dblclick();
    await expect(page).toHaveURL(/\/platform\/tenants\/t1$/);
    await expectFrame(page, info, {
      screenId: "PLT-02",
      state: "ready",
      texts: [
        "إدارة الاشتراك — كل تصرّف بسبب يراه المالك",
        "تمديد",
        "تغيير الباقة",
        "إيقاف",
        "ملاحظة",
        "أيام التمديد",
        "السبب",
        "سجل الاشتراك",
        "اعتماد إثبات",
        "رقم العملية TRX-1001",
        "بدء التجريبية",
      ],
    });
    const root = page.locator('[data-screen="PLT-02"]');
    // بلا سبب: رفض محلي بنصّ، ولا طلب للخادم
    await page.getByRole("button", { name: "مدّد" }).click();
    await expect(root).toContainText("السبب مطلوب — يُسجَّل في تدقيق المستأجر.");
    expect(posted).toHaveLength(0);
    // تمديد 15 يوماً بسبب
    await page.getByLabel("أيام التمديد").fill("15");
    await page.getByLabel("السبب").fill("دفع نقدي في المكتب");
    await page.getByRole("button", { name: "مدّد" }).click();
    await expect(root).toContainText("مُدِّد 15 يوماً");
    expect(posted[0]).toMatchObject({ action: "extend", days: 15, reason: "دفع نقدي في المكتب" });
    const timeline = root.locator(".plt-timeline");
    await expect(timeline.locator("li").first()).toContainText("تمديد");
    await expect(timeline.locator("li").first()).toContainText("دفع نقدي في المكتب");
    await expect(timeline.locator("li").first()).toContainText("بواسطة هدى — تشغيل");
    // تغيير الباقة: القائمة لا تعرض الباقة الحالية
    await page.getByRole("tab", { name: "تغيير الباقة" }).click();
    const select = page.getByLabel("الباقة الجديدة");
    await expect(select.locator("option", { hasText: "فرع واحد" })).toHaveCount(0);
    await expect(select.locator("option", { hasText: "فرعان" })).toHaveCount(1);
    // إيقاف بسبب → الحالة موقوف بالسبب، والتبويب يصير «استئناف»
    await page.getByRole("tab", { name: "إيقاف" }).click();
    await expect(root).toContainText("الإيقاف يوقف الميزات المدفوعة فقط");
    await page.getByLabel("السبب").fill("بلاغ احتيال قيد التحقق");
    await page.getByRole("button", { name: "أوقف الاشتراك" }).click();
    await expect(root).toContainText("أُوقف الاشتراك");
    await expect(root).toContainText("موقوف");
    await expect(root).toContainText("بلاغ احتيال قيد التحقق — الميزات المدفوعة متوقفة");
    await expect(page.getByRole("tab", { name: "استئناف" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "إيقاف" })).toHaveCount(0);
    // استئناف
    await page.getByRole("tab", { name: "استئناف" }).click();
    await page.getByLabel("السبب").fill("انتهى التحقق — لا مخالفة");
    await page.getByRole("button", { name: "استأنف الاشتراك" }).click();
    await expect(root).toContainText("استُؤنف الاشتراك");
    await expect(root).not.toContainText("الميزات المدفوعة متوقفة");
    // ملاحظة
    await page.getByRole("tab", { name: "ملاحظة" }).click();
    await page.getByLabel("الملاحظة").fill("اتصل المالك بخصوص فرع ثالث");
    await page.getByRole("button", { name: "سجّل الملاحظة" }).click();
    await expect(root).toContainText("سُجِّلت الملاحظة");
    await expect(timeline.locator("li").first()).toContainText("اتصل المالك بخصوص فرع ثالث");
    expect(posted.map((p) => p.action)).toEqual(["extend", "suspend", "resume", "note"]);
  });
});
