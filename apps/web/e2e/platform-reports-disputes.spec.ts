import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { goSection } from "./platform-nav";
import { fromFrame } from "./frame-provenance";

/**
 * T3.21 — PLT-07 مراجعة بلاغ وتعليق نشر واعتراض (4) + PLT-08 متابعة الخلافات (4): التعليق إجراء
 * نشر لا محاسبي (ACC-135 · ACC-139) بسبب مصنَّف يراه البائع فوراً؛ لا زرّ يعدّل دفتر بائع؛
 * الاعتراض يحسمه غيرُ من علّق. المنصة تُيسّر وتقيس ولا تُصدر حكماً مالياً (ACC-148).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const OFFER = (o: Record<string, unknown> = {}) => ({
  id: "o1",
  tenant_id: "s1",
  public_name: "سكر أبيض",
  seller_name: "مخزن يحمل اسماً مطابقاً لبائع موثَّق",
  status: "published",
  suspended: false,
  suspended_reason: "",
  suspended_by_name: "",
  appeal_status: "",
  confirmed_orders: 0,
  ...o,
});
const REPORT = (o: Record<string, unknown> = {}) => ({
  id: "r1",
  tenant_id: "t1",
  number: 2231,
  ref_label: "RP-2231",
  reason: "impersonation",
  reason_label: "انتحال اسم منشأة أو شارتها",
  target_label: "«سكر أبيض — كرتونة 12×1كغ»",
  note: "مخزن يحمل اسماً مطابقاً لبائع موثَّق",
  evidence_name: "صورة رخصة + مقارنة اسم النطاق",
  has_evidence: true,
  reporter_name: "مخزن البركة للجملة",
  created_at: hoursAgo(3),
  hours_ago: 3,
  status: "under_review",
  status_label: "قيد المراجعة",
  outcome: "",
  offer: OFFER(),
  ...o,
});
const REASONS = [
  { code: "impersonation", label: "انتحال اسم منشأة موثَّقة" },
  { code: "misleading", label: "وصف مضلّل للمنتج أو وحدته" },
  { code: "harmful", label: "محتوى غير لائق أو ضارّ" },
  { code: "prohibited", label: "عرض لسلعة ممنوعة" },
];
const APPEAL = {
  offer_id: "o1",
  tenant_id: "s1",
  public_name: "سكر أبيض",
  seller_name: "مخزن يحمل اسماً مطابقاً لبائع موثَّق",
  suspended_reason: "انتحال اسم منشأة موثَّقة — اسم مطابق لبائع موثَّق بلا صلة",
  suspended_by_name: "طيب — تشغيل",
  appeal_status: "open",
  appeal_note: "رخصتنا باسمنا منذ 2019",
  appeal_doc_name: "license.jpg",
  has_doc: true,
  appeal_opened_at: hoursAgo(1),
};

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

test.describe("PLT-07", () => {
  test("ready → permission_denied → validation_error → success: لا زرّ يعدّل دفتر بائع، ولا تعليق بلا سبب مصنَّف، ثم تعليق معلَن واعتراض يُراجَع", async ({
    page,
  }, info) => {
    let reports = [REPORT()];
    let appeals: unknown[] = [];
    let sameReviewer = 0;
    await page.route("**/api/platform/reports?status=all", (route) =>
      route.fulfill(
        json(200, {
          reports,
          open_count: reports.filter((r) => r.status === "under_review").length,
          appeals,
          reasons: REASONS,
          fetched_at: new Date().toISOString(),
        }),
      ),
    );
    await page.route("**/api/platform/reports/t1/r1/decide", (route) => {
      const b = route.request().postDataJSON() as {
        decision: string;
        reason_code: string;
        reason_text: string;
      };
      if (b.decision === "ledger")
        return route.fulfill(json(403, { detail: "operator_scope_publish_only", extra: {} }));
      if (b.decision === "suspend" && (!b.reason_code || !b.reason_text))
        return route.fulfill(json(400, { detail: "reason_required", extra: { field: "reason" } }));
      const decided = REPORT({
        status: "actioned",
        status_label: "أُجري إجراء",
        outcome: "تعليق النشر — انتحال اسم منشأة موثَّقة",
        offer: OFFER({
          suspended: true,
          suspended_reason: "انتحال اسم منشأة موثَّقة — اسم مطابق لبائع موثَّق بلا صلة",
          suspended_by_name: "طيب — تشغيل",
        }),
      });
      reports = [decided];
      appeals = [APPEAL];
      return route.fulfill(json(200, { report: decided }));
    });
    await page.route("**/api/platform/appeals/s1/o1/decide", (route) => {
      sameReviewer += 1;
      if (sameReviewer === 1)
        return route.fulfill(json(409, { detail: "same_reviewer", extra: {} }));
      appeals = [];
      return route.fulfill(json(200, { appeal: { ...APPEAL, appeal_status: "reversed" } }));
    });
    await operatorLogin(page);
    await goSection(page, "البلاغات");
    await expect(page).toHaveURL(/\/platform\/reports$/);
    await page.getByRole("button", { name: /RP-2231/ }).click();
    await expectFrame(page, info, {
      screenId: "PLT-07",
      state: "ready",
      texts: fromFrame("PLT-07", "ready", [
        "مراجعة بلاغ وتعليق نشر واعتراض — لا مساس بدفاتر الأطراف",
        "المشغّل يعلّق",
        "النشر في السوق",
        "عند بلاغ بانتحال أو ضرر. لا يعدّل مخزون بائع ولا طلباً مؤكّداً ولا دفتر أي طرف",
        "بلاغ #RP-2231 — انتحال منشأة",
        "أبلغ عنه: مخزن البركة للجملة · قبل 3 ساعات",
        "العرض المبلَّغ عنه",
        "سكر أبيض — مخزن يحمل اسماً مطابقاً لبائع موثَّق",
        "نوع البلاغ",
        "انتحال اسم منشأة موثَّقة",
        "الدليل المرفوع",
        "صورة رخصة + مقارنة اسم النطاق",
        "طلبات مؤكَّدة على هذا العرض",
        "لا يوجد — العرض جديد بلا طلبات",
        "أثر التعليق محدود بدقّة",
        "يُخفى",
        "من نتائج السوق فقط. الطلبات المؤكَّدة قبل التعليق تبقى قائمة بين طرفيها، ومخزون البائع ودفتره لا يُلمسان. التعليق إجراء نشر لا إجراء محاسبي.",
        "قرار المراجعة",
        "تعليق النشر مع سبب معلَن للبائع",
        "— لا تعليق صامت. البائع يرى نص السبب فوراً وله مسار اعتراض.",
        "تعليق العرض مع بيان السبب",
        "إغلاق البلاغ بلا إجراء",
      ]),
    });
    const root = page.locator('[data-screen="PLT-07"]');
    // لا زرّ يعدّل كميّة أو سعراً — فتح الدفتر يُرفض بنصّ صريح
    await expect(page.getByRole("button", { name: /تعديل|كميّة|سعر/ })).toHaveCount(0);
    await page.getByRole("button", { name: "دفتر البائع ومخزونه" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-07",
      state: "permission_denied",
      texts: fromFrame("PLT-07", "permission_denied", [
        "محاولة تعديل مخزون البائع",
        "لا يوجد في مساحة المشغّل زرّ يعدّل كميّة أو سعراً في دفتر بائع. المحاولة تُرفض بنصّ صريح: صلاحية المشغّل تقف عند النشر.",
      ]),
    });
    await page.getByRole("button", { name: "فهمت" }).click();
    // تعليق بلا سبب مصنَّف
    await page.getByRole("button", { name: "تعليق العرض مع بيان السبب" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-07",
      state: "validation_error",
      texts: fromFrame("PLT-07", "validation_error", [
        "تعليق بلا سبب مصنَّف",
        "محاولة تعليق نشر بلا اختيار سبب من القائمة ولا نصّ للمعلَّق عليه.",
        "السبب حقٌّ للمعلَّق عليه",
        "تعليقٌ بلا سبب لا يُعترض عليه ولا يُصحَّح. القائمة المصنَّفة تجعل الاعتراض ممكناً والمراجعة متسقة.",
        "لا مساس بالدفاتر",
        "التعليق يمنع النشر الجديد ولا يمسّ طلباً قائماً ولا دفتر طرف",
      ]),
    });
    await page.getByRole("button", { name: "انتحال اسم منشأة موثَّقة" }).click();
    await page.getByLabel("نصّ السبب — يقرأه البائع").fill("اسم مطابق لبائع موثَّق بلا صلة");
    await page.getByRole("button", { name: "تعليق العرض مع بيان السبب" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-07",
      state: "success",
      texts: fromFrame("PLT-07", "success", [
        "تعليق نشر",
        "اعتراض البائع فُتح ويُراجَع",
        "قدّم البائع مستنداً يثبت هويته. الاعتراض يذهب لمراجِع مختلف عن من علّق، وحتى حسمه يبقى القرار الأول ساري المفعول ومعلَناً — لا حسم من طرف واحد.",
      ]),
    });
    await expect(root).toContainText("عُلّق نشر العرض — البائع يرى السبب الآن وله مسار اعتراض");
    await expect(root).toContainText("التعليق سارٍ حتى الحسم");
    // من علّق لا يحسم الاعتراض
    await page.getByRole("button", { name: "إلغاء التعليق" }).click();
    await expect(root).toContainText(
      "الاعتراض يذهب لمراجِع مختلف عن من علّق — لا حسم من طرف واحد.",
    );
    await page.getByRole("button", { name: "إلغاء التعليق" }).click();
    await expect(root).not.toContainText("التعليق سارٍ حتى الحسم");
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(root).toContainText("لا بلاغات بانتظار المراجعة.");
    await expect(root).toContainText("تعليق النشر — انتحال اسم منشأة موثَّقة");
  });
});

const DISPUTE = (o: Record<string, unknown> = {}) => ({
  id: "d1",
  tenant_id: "t1",
  ref_label: "DSP-311",
  parties: "مخزن الأمل ↔ متجر البركة",
  subject: "كمية مستلمة أقل من المؤكَّد في الطلب",
  turn_label: "بانتظار رد المورد",
  remaining_hours: 20,
  overdue_hours: 0,
  days_open: 12,
  hours_to_limit: 40,
  near_limit: true,
  over_limit: false,
  referred: false,
  referred_by_name: "",
  mediator_requested: true,
  mediator_note: "",
  evidence_count: 3,
  limit_note: "قرب الحدّ — تُيسَّر القناة وتُحفظ الأدلة، دون تحريك رصيد أي طرف.",
  ...o,
});
const ROWS = [
  DISPUTE(),
  DISPUTE({
    id: "d2",
    ref_label: "DSP-318",
    parties: "شركة النيل ↔ سوبرماركت النيل",
    subject: "خلاف على موعد التسليم المتّفق",
    remaining_hours: 44,
    days_open: 4,
    hours_to_limit: 230,
    near_limit: false,
    mediator_note: "إعادة جدولة موثَّقة بين الطرفين.",
    limit_note: "ضمن الحدّ — مسار مقترَح: إعادة جدولة موثَّقة بين الطرفين.",
  }),
  DISPUTE({
    id: "d3",
    ref_label: "DSP-320",
    parties: "مستودع الشرق ↔ بقالة الصفا",
    subject: "جودة صنف — شكوى بعد الاستلام",
    turn_label: "بانتظار رد المشتري",
    remaining_hours: 60,
    days_open: 2,
    hours_to_limit: 280,
    near_limit: false,
    limit_note: "المنصة تحفظ الصور المرفوعة فقط؛ الحكم على الجودة بين الطرفين لا علينا.",
  }),
];
const PAYLOAD = (rows: unknown[], near: number) => ({
  state: rows.length === 0 ? "empty" : near > 0 ? "partial" : "ready",
  disputes: rows,
  open_count: rows.length,
  near_limit_count: near,
  avg_response_hours: 6.5,
  response_target_hours: 8,
  within_target: true,
  referred_week: 1,
  closed_30d: 9,
  intervention_days: 14,
  fetched_at: new Date().toISOString(),
});

test.describe("PLT-08", () => {
  test("loading → partial → ready: خلافان قرب الحدّ، إحالة معلَنة باسم من أحال، ومسار مقترَح بلا تحريك رصيد", async ({
    page,
  }, info) => {
    let released = false;
    let rows = [
      ROWS[0]!,
      DISPUTE({ ...ROWS[1]!, near_limit: true, limit_note: ROWS[0]!.limit_note }),
      ROWS[2]!,
    ];
    let near = 2;
    await page.route("**/api/platform/disputes", async (route) => {
      while (!released) await new Promise((r) => setTimeout(r, 50));
      return route.fulfill(json(200, PAYLOAD(rows, near)));
    });
    await page.route("**/api/platform/disputes/t1/*/*", (route) => {
      const parts = route.request().url().split("/");
      const action = parts.pop();
      const id = parts.pop();
      const b = route.request().postDataJSON() as { note?: string };
      rows = rows.map((r) => {
        const d = r;
        if (d.id !== id) return d;
        if (action === "refer")
          return DISPUTE({
            ...d,
            referred: true,
            referred_by_name: "طيب — تشغيل",
            near_limit: false,
            limit_note: "أُحيل لمسار خارجي معلَن — المنصة لا تُصدر حكماً مالياً بين طرفين.",
          });
        return DISPUTE({
          ...d,
          near_limit: false,
          mediator_note: b.note,
          limit_note: `ضمن الحدّ — مسار مقترَح: ${b.note}`,
        });
      });
      near = rows.filter((r) => r.near_limit).length;
      return route.fulfill(json(200, { dispute: rows.find((r) => r.id === id) }));
    });
    await operatorLogin(page);
    await goSection(page, "الخلافات");
    await expect(page).toHaveURL(/\/platform\/disputes$/);
    await expectFrame(page, info, {
      screenId: "PLT-08",
      state: "loading",
      texts: fromFrame("PLT-08", "loading", [
        "متابعة الخلافات — حدّ التدخّل وزمن الاستجابة، لا تسوية دفتر تلقائية",
        "الخلافات المفتوحة",
      ]),
    });
    released = true;
    await expectFrame(page, info, {
      screenId: "PLT-08",
      state: "partial",
      texts: fromFrame("PLT-08", "partial", [
        "متابعة الخلافات — حدّ التدخّل وزمن الاستجابة، لا تسوية دفتر تلقائية",
        "المنصة تُيسّر التواصل وتقيس زمن الاستجابة، ولا تُصدر حكماً مالياً بين طرفين. تسوية الذمم تبقى بينهما",
        "خلافات مفتوحة",
        "2 قرب تجاوز حدّ التدخّل",
        "متوسط زمن الاستجابة",
        "ضمن الهدف المعلَن (8h)",
        "أُحيل لمسار خارجي",
        "تجاوز حدّ التدخّل هذا الأسبوع",
        "أُغلق ودّياً",
        "خلال 30 يوماً · بلا تسوية دفتر آلية",
        "الخلافات المفتوحة",
        "مرتّبة بزمن الاستجابة المتبقّي",
        "الخلاف والطرفان",
        "الموضوع",
        "زمن الاستجابة",
        "حدّ التدخّل",
        "مخزن الأمل ↔ متجر البركة",
        "كمية مستلمة أقل من المؤكَّد في الطلب",
        "قرب الحدّ — تُيسَّر القناة وتُحفظ الأدلة، دون تحريك رصيد أي طرف.",
        "شركة النيل ↔ سوبرماركت النيل",
        "خلاف على موعد التسليم المتّفق",
        "مستودع الشرق ↔ بقالة الصفا",
        "جودة صنف — شكوى بعد الاستلام",
        "المنصة تحفظ الصور المرفوعة فقط؛ الحكم على الجودة بين الطرفين لا علينا.",
        "حدّ التدخّل ثابت في كل صف:",
        "المنصة تفتح قناة، وتحفظ الأدلة المرفوعة، وتقيس زمن الاستجابة، وتقترح مساراً. لا تُحرّك رصيداً ولا تُلزم طرفاً بمبلغ. متى تجاوز الخلاف حدّها، يُحال إلى مسار خارجي مُعلَن لا إلى قرار داخلي صامت.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-08"]');
    // لا زرّ تسوية ولا تحريك رصيد
    await expect(page.getByRole("button", { name: /تسوية|رصيد|خصم/ })).toHaveCount(0);
    // إحالة الأول (قرب الحدّ) — تُعلَن باسم من أحال
    await page.getByRole("button", { name: "إحالة لمسار خارجي معلَن" }).first().click();
    await expect(root).toContainText(
      "أُحيل لمسار خارجي معلَن — المنصة لا تُصدر حكماً مالياً بين طرفين.",
    );
    // مسار مقترَح للثاني يرفع «قرب الحدّ» → ready
    await page.getByRole("button", { name: "اقترح مساراً" }).first().click();
    await page
      .getByLabel("المسار المقترَح — يراه الطرفان")
      .fill("إعادة جدولة موثَّقة بين الطرفين.");
    await page.getByRole("button", { name: "تسجيل المسار" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-08",
      state: "ready",
      texts: fromFrame("PLT-08", "ready", [
        "قيد المتابعة",
        "ضمن الحدّ — مسار مقترَح: إعادة جدولة موثَّقة بين الطرفين.",
      ]),
    });
    await expect(root).toContainText("0 قرب تجاوز حدّ التدخّل");
  });

  test("empty: لا خلافات مفتوحة — وضع صحّي لا خطأ", async ({ page }, info) => {
    await page.route("**/api/platform/disputes", (route) =>
      route.fulfill(json(200, PAYLOAD([], 0))),
    );
    await operatorLogin(page);
    await goSection(page, "الخلافات");
    await expectFrame(page, info, {
      screenId: "PLT-08",
      state: "empty",
      texts: fromFrame("PLT-08", "empty", [
        "لا خلافات مفتوحة",
        "وضع صحّي. السجل التاريخي للخلافات المُغلقة متاح للمراجعة، لكن لا صفوف نشطة الآن.",
      ]),
    });
  });
});
