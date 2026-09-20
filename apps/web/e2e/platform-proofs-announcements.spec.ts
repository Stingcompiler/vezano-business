import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.19 — PLT-03 مراجعة دفع الاشتراك (4) + PLT-04 إعلانات المنصة وصيانة (4): المراجعة تُحجز
 * لشخص واحد 15 دقيقة ويظهر اسمه؛ رقم التحويل يُفحص قبل الاعتماد لا بعده؛ الرفض يحتاج سبباً
 * يقرأه التاجر؛ الجمهور المتأثّر يظهر قبل الجدولة، والنصّ الذي يَعِد بما ليس في الباقة لا يُرسل.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const PROOF = (o: Record<string, unknown> = {}) => ({
  id: "p1",
  tenant_id: "t1",
  tenant_name: "متجر البركة",
  plan_code: "single",
  plan_label: "أساسي",
  amount_minor: "4500000",
  due_minor: "4500000",
  shortfall_minor: "0",
  reference: "TRX-44821",
  period_label: "شهر",
  note: "",
  has_image: true,
  image_name: "receipt.jpg",
  submitted_at: minutesAgo(20),
  submitted_by_name: "مالك البركة",
  status: "pending",
  reviewed_at: "",
  reviewed_by_name: "",
  rejection_reason: "",
  claim: null,
  reference_used: null,
  ...o,
});
const CLAIM_OTHER = {
  by_name: "م. الطيب",
  mine: false,
  claimed_at: minutesAgo(4),
  expires_at: new Date(Date.now() + 11 * 60_000).toISOString(),
  minutes_ago: 4,
  handover_requested: false,
};
const CLAIM_MINE = { ...CLAIM_OTHER, by_name: "طيب — تشغيل", mine: true, minutes_ago: 0 };

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
  await page.getByLabel("2FA").fill("123456");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-03", () => {
  test("ready → conflict: إيصال مفتوح عند زميل — الاعتماد محجوز وطلب التسليم متاح", async ({
    page,
  }, info) => {
    let handover = false;
    await page.route("**/api/platform/proofs?status=pending", (route) =>
      route.fulfill(
        json(200, {
          proofs: [
            PROOF({ claim: CLAIM_OTHER }),
            PROOF({
              id: "p2",
              tenant_id: "t2",
              tenant_name: "مخبز الصباح",
              reference: "TRX-90112",
            }),
          ],
          pending_count: 2,
          claim_minutes: 15,
        }),
      ),
    );
    await page.route("**/api/platform/proofs/t1/p1/*", (route) => {
      const action = route.request().url().split("/").pop();
      if (action === "handover") handover = true;
      return route.fulfill(
        json(200, { proof: PROOF({ claim: { ...CLAIM_OTHER, handover_requested: handover } }) }),
      );
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "مراجعة الدفع" }).click();
    await expect(page).toHaveURL(/\/platform\/proofs$/);
    await expectFrame(page, info, {
      screenId: "PLT-03",
      state: "ready",
      texts: fromFrame("PLT-03", "ready", [
        "مراجعة دفع الاشتراك",
        "الإثبات ومطابقته",
        "صورة التحويل ورقمه وتاريخه، بجانب المستحقّ والباقة. والمطابقة يدوية بقرار لا آلية.",
        "لا قبول آلي",
        "مطابقة المبلغ وحدها لا تكفي — قد يكون تحويلاً لغرض آخر أو مستهلكاً سابقاً (ACC-15).",
      ]),
    });
    const root = page.locator('[data-screen="PLT-03"]');
    await expect(root).toContainText("يراجعه م. الطيب");
    await page.getByRole("button", { name: /متجر البركة/ }).click();
    await expectFrame(page, info, {
      screenId: "PLT-03",
      state: "conflict",
      texts: fromFrame("PLT-03", "conflict", [
        "مراجعة دفع اشتراك — الازدواج يُمنع قبل الاعتماد لا بعده",
        "التحويل اليدوي يصل بإيصال مصوّر. الخطر الحقيقي: اعتماد الإيصال نفسه مرتين من مراجعَين مختلفَين.",
        "تعارض",
        "إيصال بانتظار المراجعة",
        "متجر البركة · وصل قبل 20 دقيقة",
        "المبلغ في الإيصال",
        "المستحق على الباقة",
        "تاريخ التحويل",
        "رقم العملية البنكية",
        "صورة الإيصال",
        "معاينة بحجم كامل وتكبير — لا تُحمَّل إلا عند فتح المراجعة، وتُسجَّل كل مشاهدة في الأثر",
        "هذا الإيصال مراجَع الآن من زميل",
        "فتحه «م. الطيب» قبل 4 دقائق. لن نسمح باعتمادين متوازيين ينتجان شهرين مدفوعين بإيصال واحد.",
        "المراجعة تُحجز لشخص واحد مدة 15 دقيقة، ويظهر اسمه لبقية الفريق.",
        "اعتماد — محجوز لزميل",
        "طلب تسليم المراجعة",
        "الرفض يحتاج سبباً يقرأه التاجر",
        "الرفض لا يوقف الخدمة فوراً: للتاجر مهلة معلنة لتصحيح الإيصال، والتعطيل يأتي بإشعار سابق لا مفاجأة.",
        "رقم العملية البنكية يُفحص قبل الاعتماد؛ لو اعتُمد سابقاً لأي متجر نوقف الإجراء ونعرض الاعتماد الأول بتاريخه ومن نفّذه.",
        "الاعتماد يكتب مدة الاشتراك مرة واحدة. محاولة ثانية على نفس الإيصال تُرفض ولا تُمدِّد شهراً إضافياً.",
      ]),
    });
    // لا زرّ اعتماد فعّال ولا رفض حين يكون الإيصال عند زميل
    await expect(page.getByRole("button", { name: "اعتماد — محجوز لزميل" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("button", { name: "اعتماد", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "طلب تسليم المراجعة" }).click();
    await expect(page.getByRole("button", { name: "طلب تسليم المراجعة" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(handover).toBe(true);
  });

  test("validation_error → success: رقم التحويل مستخدم يوقف الاعتماد ويُظهر السابقة بلا اسم مستأجر آخر، ثم رفض بسبب", async ({
    page,
  }, info) => {
    const used = {
      approved_at: "2026-08-21T09:00:00Z",
      approved_by_name: "س. عثمان",
      same_tenant: false,
      tenant_name: "",
    };
    const p2 = PROOF({
      id: "p2",
      tenant_id: "t2",
      tenant_name: "مخبز الصباح",
      reference: "TRX-90112",
      amount_minor: "4000000",
      shortfall_minor: "500000",
      reference_used: used,
    });
    let pending = [p2];
    await page.route("**/api/platform/proofs?status=pending", (route) =>
      route.fulfill(
        json(200, { proofs: pending, pending_count: pending.length, claim_minutes: 15 }),
      ),
    );
    await page.route("**/api/platform/proofs/t2/p2/*", (route) => {
      const action = route.request().url().split("/").pop();
      const body = route.request().postDataJSON() as { reason?: string };
      if (action === "open")
        return route.fulfill(json(200, { proof: { ...p2, claim: CLAIM_MINE } }));
      if (action === "image")
        return route.fulfill(
          json(200, {
            image_name: "receipt.jpg",
            image_data:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          }),
        );
      if (action === "approve")
        return route.fulfill(json(400, { detail: "reference_used", extra: used }));
      if (action === "reject" && !body.reason)
        return route.fulfill(json(400, { detail: "reason_required" }));
      pending = [];
      return route.fulfill(
        json(200, {
          proof: {
            ...p2,
            status: "rejected",
            reviewed_by_name: "طيب — تشغيل",
            rejection_reason: body.reason,
            claim: null,
          },
        }),
      );
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "مراجعة الدفع" }).click();
    await page.getByRole("button", { name: /مخبز الصباح/ }).click();
    await expect(page.locator('[data-screen="PLT-03"][data-state="ready"]')).toBeVisible();
    // الفرق بالرقم، والمرجع المستهلك ظاهر قبل أي زرّ
    await expect(page.locator('[data-screen="PLT-03"]')).toContainText(
      "المبلغ أقل من المستحق — الفرق",
    );
    await expect(page.locator('[data-screen="PLT-03"]')).toContainText("مستأجر آخر");
    await expect(page.locator('[data-screen="PLT-03"]')).not.toContainText("س. عثمان · متجر");
    await page.getByRole("button", { name: "افتح الصورة — تُسجَّل المشاهدة" }).click();
    await expect(page.getByRole("img", { name: "إيصال TRX-90112" })).toBeVisible();
    // الاعتماد محجوب بالمرجع المستخدم — نحاكي مسار الخادم عبر زرّ مفعَّل لا يوجد؛ الزرّ معطَّل بسبب معلَن
    await expect(page.getByRole("button", { name: "اعتماد", exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("button", { name: "رفض بسبب" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // الخادم نفسه يرفض الاعتماد لو وصل (المرجع يُفحص قبل الاعتماد): نستدعي المسار كما لو ضُغط الزرّ
    await page.evaluate(async () => {
      const r = await fetch("/api/platform/proofs/t2/p2/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      (window as unknown as { __approve: number }).__approve = r.status;
    });
    expect(await page.evaluate(() => (window as unknown as { __approve: number }).__approve)).toBe(
      400,
    );
    await page.getByLabel("سبب الرفض").fill("رقم العملية مستعمل سابقاً — اعتُمد 21 أغسطس");
    await page.getByRole("button", { name: "رفض بسبب" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-03",
      state: "success",
      // إطار success هو رسم 18-D13 نفسه؛ وسم «إيصال بانتظار المراجعة» يصير «رُفض»/«اعتُمد» بعد الحسم (0005 §٨٢)
      texts: fromFrame("PLT-03", "success", [
        "مراجعة دفع اشتراك — الازدواج يُمنع قبل الاعتماد لا بعده",
        "صورة الإيصال",
        "الرفض لا يوقف الخدمة فوراً: للتاجر مهلة معلنة لتصحيح الإيصال، والتعطيل يأتي بإشعار سابق لا مفاجأة.",
        "الاعتماد يكتب مدة الاشتراك مرة واحدة. محاولة ثانية على نفس الإيصال تُرفض ولا تُمدِّد شهراً إضافياً.",
      ]),
    });
    await expect(page.locator('[data-screen="PLT-03"]')).toContainText("رُفض الإيصال بسبب");
    await expect(page.getByRole("button", { name: "رفض بسبب" })).toHaveCount(0);
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(page.locator('[data-screen="PLT-03"]')).toContainText(
      "لا إيصالات بانتظار المراجعة.",
    );
  });

  test("validation_error: اعتماد على مرجع مستخدم من الخادم يُظهر السابقة بتاريخها ومن نفّذها", async ({
    page,
  }, info) => {
    const used = {
      approved_at: "2026-08-21T09:00:00Z",
      approved_by_name: "س. عثمان",
      same_tenant: true,
      tenant_name: "متجر البركة",
    };
    const p1 = PROOF();
    await page.route("**/api/platform/proofs?status=pending", (route) =>
      route.fulfill(json(200, { proofs: [p1], pending_count: 1, claim_minutes: 15 })),
    );
    let approves = 0;
    await page.route("**/api/platform/proofs/t1/p1/*", (route) => {
      const action = route.request().url().split("/").pop();
      if (action === "open")
        return route.fulfill(json(200, { proof: { ...p1, claim: CLAIM_MINE } }));
      approves += 1;
      // المرجع استُهلك بين الفتح والاعتماد (زميل اعتمد إيصالاً آخر بنفس الرقم)
      if (approves === 1)
        return route.fulfill(json(400, { detail: "reference_used", extra: used }));
      return route.fulfill(json(409, { detail: "already_reviewed" }));
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "مراجعة الدفع" }).click();
    await page.getByRole("button", { name: /متجر البركة/ }).click();
    await page.getByRole("button", { name: "اعتماد", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "PLT-03",
      state: "validation_error",
      texts: fromFrame("PLT-03", "validation_error", [
        "رقم التحويل مستخدم",
        "نفس المرجع استُعمل لاعتماد دفعة سابقة.",
        "نُظهر السابقة",
        "بتاريخها ومستأجرها — بلا اسمه إن كان مستأجراً آخر. المراجع يحتاج أن يعرف أنها مستهلكة لا لمن.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-03"]');
    await expect(root).toContainText("21 أغسطس");
    await expect(root).toContainText("س. عثمان");
    await expect(root).toContainText("المستأجر نفسه");
    // محاولة ثانية على إيصال حُسم: الخادم يقول «مراجَع سابقاً» ولا يُمدِّد شهراً
    await page.getByRole("button", { name: "اعتماد", exact: true }).click();
    await expect(root).toContainText(
      "الاعتماد يكتب مدة الاشتراك مرة واحدة. محاولة ثانية على نفس الإيصال تُرفض ولا تُمدِّد شهراً إضافياً.",
    );
    expect(approves).toBe(2);
  });
});

const SEGMENTS = (audience: "all" | "market") => [
  {
    label: "متاجر ذات مزامنة سوق فعّالة",
    count: 47,
    note: "المتأثّرون مباشرة بنافذة الصيانة",
    included: true,
  },
  {
    label: "أجهزة تعمل الآن في هذه المتاجر",
    count: 112,
    note: "ستتلقّى الإشعار داخل التطبيق",
    included: true,
  },
  {
    label: "متاجر بلا نشاط سوق",
    count: audience === "all" ? 81 : 0,
    note: "لا نزعجها بإعلان لا يخصّها",
    included: audience === "all",
  },
  {
    label: "زبائن نهائيون",
    count: 0,
    note: "لا يُرسل لهم شيء — هذه صيانة تشغيل داخلية",
    included: false,
    fixed: true,
  },
];
const ANN = (o: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "maintenance",
  kind_label: "صيانة مجدولة",
  title: "صيانة مزامنة السوق — الجمعة 03:00–03:40",
  body: "قد يتأخّر ظهور عروض السوق وتحديث الطلبات نحو 40 دقيقة. نقاط البيع تعمل بالكامل محلياً والمزامنة تُستأنف تلقائياً بعد النافذة.",
  audience: "market",
  audience_label: "متاجر ذات مزامنة سوق فعّالة",
  starts_at: "2026-09-25T01:00:00Z",
  ends_at: "2026-09-25T01:40:00Z",
  status: "draft",
  status_label: "مسودة",
  audience_count: 0,
  created_by_name: "طيب — تشغيل",
  scheduled_at: "",
  cancelled_by_name: "",
  ...o,
});

async function mockAnnouncements(page: Page, opts: { delaySaveMs?: number } = {}) {
  let rows: unknown[] = [];
  let scheduled = false;
  await page.route("**/api/platform/announcements", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill(json(200, { announcements: rows, now: new Date().toISOString() }));
    const b = route.request().postDataJSON() as { title: string; body: string; audience: string };
    const a = ANN({ title: b.title, body: b.body, audience: b.audience });
    rows = [a];
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        void route.fulfill(json(201, { announcement: a })).then(resolve);
      }, opts.delaySaveMs ?? 0);
    });
  });
  await page.route("**/api/platform/announcements/preview", (route) => {
    const b = route.request().postDataJSON() as { audience: "all" | "market"; body: string };
    const promise = b.audience === "all" && /السوق|ميزة سوق مميّزة/.test(b.body);
    return route.fulfill(
      json(200, {
        targeted: b.audience === "all" ? 128 : 47,
        segments: SEGMENTS(b.audience),
        promise_outside_plan: promise,
        outside_count: promise ? 81 : 0,
        kind: "maintenance",
      }),
    );
  });
  await page.route("**/api/platform/announcements/a1/*", (route) => {
    const action = route.request().url().split("/").pop();
    if (action === "schedule") {
      scheduled = true;
      const a = ANN({ status: "scheduled", status_label: "مجدول", audience_count: 47 });
      rows = [a];
      return route.fulfill(json(200, { announcement: a }));
    }
    const a = ANN({ status: "cancelled", status_label: "أُلغي", cancelled_by_name: "طيب — تشغيل" });
    rows = [a];
    return route.fulfill(json(200, { announcement: a }));
  });
  return { wasScheduled: () => scheduled };
}

test.describe("PLT-04", () => {
  test("ready → success: الجمهور المتأثّر يظهر ويتحدّث قبل الجدولة، ثم جُدول لـ47 متجراً ويُلغى باسم من نفّذه", async ({
    page,
  }, info) => {
    const m = await mockAnnouncements(page);
    await operatorLogin(page);
    await page.getByRole("button", { name: "الإعلانات" }).click();
    await expect(page).toHaveURL(/\/platform\/announcements$/);
    await page.getByLabel("العنوان").fill("صيانة مزامنة السوق — الجمعة 03:00–03:40");
    await page
      .getByLabel("النص المعروض للتاجر")
      .fill(
        "قد يتأخّر ظهور عروض السوق وتحديث الطلبات نحو 40 دقيقة. نقاط البيع تعمل بالكامل محلياً والمزامنة تُستأنف تلقائياً بعد النافذة.",
      );
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "PLT-04",
      state: "ready",
      texts: fromFrame("PLT-04", "ready", [
        "إعلانات المنصة وصيانة — الجمهور المتأثّر يظهر قبل الجدولة",
        "قبل أن يُجدول أي إعلان، يرى المشغّل بالضبط من سيصله ومتى. ولا يُعلن عن ميزة مقيّدة بباقة لمن لا يملكها (G-ref ACC-104).",
        "تم الحفظ",
        "صياغة إعلان صيانة مجدولة",
        "نافذة صيانة على مزامنة السوق — لا تمسّ POS المحلي",
        "العنوان",
        "النص المعروض للتاجر",
        "نقاط البيع تعمل بالكامل محلياً",
        "والمزامنة تُستأنف تلقائياً بعد النافذة.",
        "قيد",
        "لا يمكن اختيار «ميزة سوق مميّزة» في نص موجَّه لباقة لا تشملها — الحقل يمنع الصياغة المضلِّلة عند الاختيار.",
        "الجمهور المتأثّر — قبل الجدولة",
        "متاجر ذات مزامنة سوق فعّالة",
        "المتأثّرون مباشرة بنافذة الصيانة",
        "أجهزة تعمل الآن في هذه المتاجر",
        "ستتلقّى الإشعار داخل التطبيق",
        "متاجر بلا نشاط سوق",
        "لا نزعجها بإعلان لا يخصّها",
        "0 مستهدَف",
        "زبائن نهائيون",
        "لا يُرسل لهم شيء — هذه صيانة تشغيل داخلية",
        "مستبعَد",
        "الرقم أعلاه يتحدّث حيّاً مع كل تعديل في الاستهداف. لا يُجدول الإعلان قبل أن يؤكّد المشغّل هذا العدد.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-04"]');
    await expect(page.getByRole("button", { name: "جدولة — 47 متجراً" })).toBeVisible();
    // توسيع الجمهور يحدّث العدد حيّاً
    await page.getByRole("button", { name: "كل المتاجر" }).click();
    await expect(page.getByRole("button", { name: "جدولة — 128 متجراً" })).toBeVisible();
    await expect(root).toContainText("81 مستهدَف");
    await page.getByRole("button", { name: "متاجر ذات مزامنة سوق فعّالة", exact: true }).click();
    await page.getByRole("button", { name: "جدولة — 47 متجراً" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-04",
      state: "success",
      texts: fromFrame("PLT-04", "success", [
        "جُدول الإعلان — 47 متجراً",
        "يُرسل قبل النافذة بساعة وعند بدئها وعند انتهائها. الحالة «مجدول» قابلة للإلغاء حتى دقيقة الإرسال، والإلغاء يُسجَّل باسم من نفّذه.",
      ]),
    });
    expect(m.wasScheduled()).toBe(true);
    await expect(root).toContainText("مجدول");
    await page.getByRole("button", { name: "إلغاء — يُسجَّل باسمك" }).click();
    await expect(root).toContainText("ألغاه طيب — تشغيل");
    await expect(root).toContainText("أُلغي");
  });

  test("validation_error → saving: نصّ يَعِد بميزة سوق لكل المتاجر لا يُجدول حتى يُضيَّق الجمهور، والجدولة تُسجَّل ولا تُرسل", async ({
    page,
  }, info) => {
    let released = false;
    await mockAnnouncements(page, { delaySaveMs: 0 });
    await page.route("**/api/platform/announcements", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { announcements: [], now: new Date().toISOString() }));
      while (!released) await new Promise((r) => setTimeout(r, 50));
      return route.fulfill(json(201, { announcement: ANN() }));
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "الإعلانات" }).click();
    await page.getByLabel("العنوان").fill("عروض السوق لكل التجّار");
    await page
      .getByLabel("النص المعروض للتاجر")
      .fill("جرّب ميزة سوق مميّزة: عروض السوق تظهر لكل متجر هذا الأسبوع.");
    await page.getByRole("button", { name: "كل المتاجر" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-04",
      state: "validation_error",
      texts: fromFrame("PLT-04", "validation_error", [
        "إعلانات المنصة وصيانة",
        "إعلان يَعِد بما ليس في الباقة",
        "نصٌّ يذكر ميزة غير متاحة لكل الجماهير المختارة (ACC-104).",
        "نُطابق النصّ بالجمهور",
        "ونمنع الإرسال حتى يُضيَّق الجمهور أو يُعدَّل النصّ. إعلانٌ مضلِّل من المنصّة أسوأ من إعلان تاجر.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-04"]');
    await expect(root).toContainText("81 متاجر بلا سوق في الجمهور المختار.");
    await expect(page.getByRole("button", { name: /^جدولة — / })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // تضييق الجمهور يرفع المنع
    await page.getByRole("button", { name: "متاجر ذات مزامنة سوق فعّالة", exact: true }).click();
    await expect(page.locator('[data-screen="PLT-04"][data-state="ready"]')).toBeVisible();
    await page.getByRole("button", { name: "جدولة — 47 متجراً" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-04",
      state: "saving",
      texts: fromFrame("PLT-04", "saving", [
        "جارٍ الجدولة",
        "إعلان الصيانة يُجدول قبل موعده بوقت كافٍ، والجدولة تُسجَّل ولا تُرسل.",
        "نافذة الصيانة",
        "تُعرض بتوقيت المستأجر لا بتوقيت الخادم. «٢ ص» لمن؟ السؤال يُجاب هنا لا في ذهن القارئ.",
      ]),
    });
    released = true;
    await expect(page.locator('[data-screen="PLT-04"][data-state="success"]')).toBeVisible();
  });
});
