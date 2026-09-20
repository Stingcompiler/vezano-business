import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.23 — PLT-11 لوحة الاكتساب M0 (4) + PLT-12 إدارة الاستحقاقات وإعدادات التشغيل (4): كل رقم
 * بمقامه ولا قمع واحد؛ قيمة التجارة مرة لا مرتين (ACC-142)؛ غير حاسم يُقال كذلك (ACC-146)؛
 * التجميع يُقرأ بختمه الزمني. الاستحقاق على مستوى الباقة — لا تجاوز عام يكسر عزل المستأجرين.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const month = new Date().toISOString().slice(0, 7);
const todayAt = (h: number, daysAgo = 0) => {
  const x = new Date();
  x.setDate(x.getDate() - daysAgo);
  x.setHours(h, 0, 0, 0);
  return x.toISOString();
};

const STAGES = [
  {
    key: "visit",
    label: "زيارة السوق",
    value: 8120,
    note: "جلسة مجهولة · لا مقام سابق",
    ratio: "",
  },
  {
    key: "register",
    label: "تسجيل حساب",
    value: 414,
    note: "حساب واحد لكل منشأة",
    ratio: "5.1% من الزيارات",
  },
  {
    key: "active",
    label: "منشأة نشطة",
    value: 187,
    note: "نشاط = بيع أو نشر خلال 14 يوماً",
    ratio: "45.3% من المسجَّلين",
  },
  {
    key: "executed",
    label: "طلب سوق منفَّذ",
    value: 61,
    note: "يُحتسب مرة واحدة للطلب",
    ratio: "32.3% من النشطة",
  },
  {
    key: "paid",
    label: "اشتراك مدفوع",
    value: 35,
    note: "لا يُقسم على الزيارات",
    ratio: "18.8% من النشطة",
  },
];
const SNAP = (opps: number, executed = 61) => ({
  month,
  computed_at: todayAt(6),
  stages: STAGES,
  trade: {
    executed_value_minor: "184200000",
    executed_count: executed,
    partial_count: 7,
    partial_value_minor: "12400000",
    disputed_count: 3,
  },
  targets: {
    opportunities: opps,
    opportunities_min: 15,
    conclusive: opps >= 15,
    mediation: 4,
    avg_accept_minutes: 310,
    accept_target_minutes: 1440,
    campaign_messages: 2130,
  },
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
  await page.getByLabel("2FA").fill("123456");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-11", () => {
  test("loading → stale → ready: التجميع بختمه الزمني، ثم إعادة التجميع تعرض كل رقم بمقامه وقيمة التجارة مرة واحدة", async ({
    page,
  }, info) => {
    let phase: "none" | "stale" | "ready" = "none";
    await page.route(`**/api/platform/m0?month=${month}`, (route) => {
      if (phase === "none")
        return route.fulfill(json(200, { state: "loading", month, snapshot: null }));
      const snap = SNAP(88);
      if (phase === "stale") snap.computed_at = todayAt(6, 1);
      return route.fulfill(
        json(200, {
          state: phase,
          month,
          computed_at: snap.computed_at,
          computed_by_name: "طيب — تشغيل",
          snapshot: snap,
        }),
      );
    });
    await page.route("**/api/platform/m0", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await new Promise((r) => setTimeout(r, 400));
      phase = phase === "none" ? "stale" : "ready";
      const snap = SNAP(88);
      if (phase === "stale") snap.computed_at = todayAt(6, 1);
      return route.fulfill(
        json(200, {
          state: phase,
          month,
          computed_at: snap.computed_at,
          computed_by_name: "طيب — تشغيل",
          snapshot: snap,
        }),
      );
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "M0" }).click();
    await expect(page).toHaveURL(/\/platform\/m0$/);
    await expectFrame(page, info, {
      screenId: "PLT-11",
      state: "loading",
      texts: fromFrame("PLT-11", "loading", [
        "جارٍ الحساب",
        "تجميعٌ عبر كل المستأجرين، ويستغرق. نعرض المدى والعدد أثناءه.",
      ]),
    });
    await page.getByRole("button", { name: "احسب الآن" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-11",
      state: "stale",
      texts: fromFrame("PLT-11", "stale", [
        "لوحة الاكتساب M0 — كل رقم بمقامه",
        "ACC-142: قيمة التجارة لا تُضاعف بين المشتري والبائع. ACC-149: نطاق الإصدار الأول لا يُقرأ كنتيجة.",
        "بيانات قديمة",
        "محسوب 06:00 · التجميع اليومي لم يكتمل بعد",
        "لا نسبة واحدة",
        "الخمسة أرقام مراحل منفصلة لا قمعاً واحداً.",
        "الزيارة مجهولة، والتسجيل بحساب، والنشاط بمنشأة، والطلب بطرفين، والدفع باشتراك. قسمة «دفع ÷ زيارة» تجمع مقامات مختلفة وتنتج نسبة لا تصف شيئاً. تحويل كل مرحلة إلى التي تليها معروض داخل بطاقتها، وهو الرقم الوحيد الذي له معنى.",
        "زيارة السوق",
        "جلسة مجهولة · لا مقام سابق",
        "تسجيل حساب",
        "5.1% من الزيارات · حساب واحد لكل منشأة",
        "منشأة نشطة",
        "45.3% من المسجَّلين · نشاط = بيع أو نشر خلال 14 يوماً",
        "طلب سوق منفَّذ",
        "32.3% من النشطة · يُحتسب مرة واحدة للطلب",
        "اشتراك مدفوع",
        "18.8% من النشطة · لا يُقسم على الزيارات",
        "قيمة التجارة — مرة واحدة لا مرتين",
        "قيمة الطلبات المنفَّذة",
        "المستلم والمؤكد من الطرفين · مرة واحدة لكل طلب",
        "طلبات جزئية — المستلم وحده",
        "المشحون غير المستلم غير محتسب",
        "محل خلاف — غير محتسب",
        "3 طلبات في ORD-12 · لا تُضاف ولا تُخصم حتى الحسم",
        "ما لا نجمعه",
        "قيمة الطلب من دفتر المشتري + قيمته من دفتر البائع = ضعف مخترع",
        "ممتنع",
      ]),
    });
    const root = page.locator('[data-screen="PLT-11"]');
    await expect(root).toContainText(
      "التجميع اليومي يقف عند 06:00 ولم يُحدَّث بعد. لن نعرضها كأنها حتى اللحظة، ولن نخفيها — تُقرأ بختمها الزمني.",
    );
    // لا قمع واحد: لا نسبة «دفع ÷ زيارة»
    await expect(root).not.toContainText(/0\.4% من الزيارات/);
    await page.getByRole("button", { name: "أعِد التجميع" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-11",
      state: "ready",
      texts: fromFrame("PLT-11", "ready", [
        "مؤشرات M0",
        "الفرص والوساطة والدقائق والكلفة مقابل الأهداف المعلنة. وقيمة التجارة تُحسب مرة لا مرتين للطرفين (ACC-142).",
        "لا مضاعفة",
        "صفقةٌ بين مشترٍ وبائع قيمةٌ واحدة. عدّها عند الطرفين يُضاعف الرقم ويُفسد القرار المبنيّ عليه.",
      ]),
    });
    await expect(root).toContainText("88 / 15");
    await expect(root).not.toContainText("بيانات قديمة");
  });

  test("empty: ثلاث فرص لا تكفي للحكم — نقولها كذلك ولا نعرض نسبة، ولا توقف البناء", async ({
    page,
  }, info) => {
    const snap = SNAP(3, 2);
    await page.route(`**/api/platform/m0?month=${month}`, (route) =>
      route.fulfill(
        json(200, {
          state: "empty",
          month,
          computed_at: snap.computed_at,
          computed_by_name: "طيب — تشغيل",
          snapshot: snap,
        }),
      ),
    );
    await operatorLogin(page);
    await page.getByRole("button", { name: "M0" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-11",
      state: "empty",
      texts: fromFrame("PLT-11", "empty", [
        "فرص غير كافية للحكم",
        "فرص، والحكم على M0 يحتاج عدداً أكبر.",
        "نتيجة غير حاسمة",
        "نقولها كذلك ولا نعرض نسبةً من ثلاث فرص.",
        "لا توقف البناء",
        "النتيجة غير الحاسمة معلومة لا حكم. الشاشة لا تقترح قراراً — تعرض ما يكفي وما لا يكفي.",
      ]),
    });
    const root = page.locator('[data-screen="PLT-11"]');
    await expect(root).toContainText("المدى فيه 3 فرص");
    await expect(root).toContainText("«غير حاسم — يحتاج 15 فرصة» أصدق من «67% نجاح» (ACC-146).");
    await expect(root).toContainText("غير حاسم");
    await expect(page.getByRole("button", { name: /قرار|أوقف|اعتمد/ })).toHaveCount(0);
  });
});

const ROWS = [
  {
    feature: "multi_branch",
    label: "عدد الفروع",
    note: "باقة فرع واحد / فرعين / متعدّد — حدّ صلب لكل باقة",
    kind: "limit",
    kind_label: "حسب الباقة",
  },
  {
    feature: "market_private_prices",
    label: "قوائم أسعار خاصة للسوق",
    note: "",
    kind: "toggle",
    kind_label: "مفعّلة",
  },
  {
    feature: "market_publish",
    label: "أدوات البائع في السوق",
    note: "تتطلّب تحقّق دور بائع منفصلاً (PLT-06)",
    kind: "conditional",
    kind_label: "مشروطة",
  },
  {
    feature: "campaigns",
    label: "حملات التسويق الجماهيرية",
    note: "محدودة بحصّة شهرية معلَنة لكل باقة",
    kind: "quota",
    kind_label: "بحصّة",
  },
];
const cell = (feature: string, enabled: boolean, o: Record<string, unknown> = {}) => ({
  feature,
  enabled,
  overridden: false,
  changed_by_name: "",
  changed_at: "",
  limit: feature === "multi_branch" ? 1 : null,
  quota: feature === "campaigns" ? 0 : null,
  ...o,
});
const PLANS = (dualPrivate: boolean, overridden = false) => [
  {
    code: "single",
    name: "فرع واحد",
    cells: [
      cell("multi_branch", true),
      cell("market_private_prices", false),
      cell("market_publish", false),
      cell("campaigns", false),
    ],
  },
  {
    code: "dual",
    name: "فرعان",
    cells: [
      cell("multi_branch", true, { limit: 2 }),
      cell("market_private_prices", dualPrivate, {
        overridden,
        changed_by_name: overridden ? "طيب — تشغيل" : "",
        changed_at: overridden ? new Date().toISOString() : "",
      }),
      cell("market_publish", true),
      cell("campaigns", true, { quota: 1200 }),
    ],
  },
];
const PAYLOAD = (dualPrivate: boolean, overridden = false, flags: unknown[] = []) => ({
  rows: ROWS,
  plans: PLANS(dualPrivate, overridden),
  flags,
});

test.describe("PLT-12", () => {
  test("ready → permission_denied → validation_error → success: لا تجاوز عام، وعلم بلا نطاق يُمنع، والتغيير على مستوى الباقة يُسجَّل", async ({
    page,
  }, info) => {
    let dualPrivate = true;
    let overridden = true;
    let flags: unknown[] = [];
    await page.route("**/api/platform/entitlements", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, PAYLOAD(dualPrivate, overridden, flags)));
      const b = route.request().postDataJSON() as {
        plan_code: string;
        feature: string;
        enabled: boolean;
        apply_all?: boolean;
        tenant_id?: string;
      };
      if (b.apply_all || b.tenant_id)
        return route.fulfill(json(403, { detail: "no_global_override", extra: {} }));
      dualPrivate = b.enabled;
      overridden = true;
      return route.fulfill(
        json(200, {
          saved: {
            plan_code: b.plan_code,
            plan_name: b.plan_code === "dual" ? "فرعان" : "فرع واحد",
            feature: b.feature,
            feature_label: "قوائم أسعار خاصة للسوق",
            enabled: b.enabled,
            changed_by_name: "طيب — تشغيل",
            changed_at: new Date().toISOString(),
          },
          ...PAYLOAD(dualPrivate, overridden, flags),
        }),
      );
    });
    await page.route("**/api/platform/flags", (route) => {
      const b = route.request().postDataJSON() as {
        key: string;
        scope_kind: string;
        scope: string;
      };
      if (!b.scope_kind || !b.scope)
        return route.fulfill(json(400, { detail: "scope_required", extra: { field: "scope" } }));
      flags = [
        {
          key: b.key,
          scope_kind: b.scope_kind,
          scope: b.scope,
          enabled: true,
          note: "",
          changed_by_name: "طيب — تشغيل",
          changed_at: new Date().toISOString(),
        },
      ];
      return route.fulfill(json(200, PAYLOAD(dualPrivate, overridden, flags)));
    });
    await operatorLogin(page);
    await page.locator(".plt-nav").getByRole("button", { name: "الاستحقاقات" }).click();
    await expect(page).toHaveURL(/\/platform\/entitlements$/);
    await expectFrame(page, info, {
      screenId: "PLT-12",
      state: "ready",
      texts: fromFrame("PLT-12", "ready", [
        "إدارة الاستحقاقات وإعدادات التشغيل — لا تجاوز عام يكسر عزل المستأجرين",
        "يُدير المشغّل استحقاقات الباقات وأعلام التشغيل، لكن لا يوجد مفتاح «طبّق على الجميع» يخترق حدود مستأجر واحد أو يفتح بيانات عبرهم.",
        "عزل المستأجرين",
        "استحقاقات الباقات",
        "ما تفتحه كل باقة — يُطبَّق على مستوى الباقة لا فوق مستأجر بعينه",
        "عدد الفروع",
        "باقة فرع واحد / فرعين / متعدّد — حدّ صلب لكل باقة",
        "حسب الباقة",
        "قوائم أسعار خاصة للسوق",
        "فُعّلت لباقة الفرعين للتوّ",
        "مفعّلة",
        "أدوات البائع في السوق",
        "تتطلّب تحقّق دور بائع منفصلاً (PLT-06)",
        "مشروطة",
        "حملات التسويق الجماهيرية",
        "محدودة بحصّة شهرية معلَنة لكل باقة",
        "بحصّة",
      ]),
    });
    const root = page.locator('[data-screen="PLT-12"]');
    // لا مفتاح «طبّق على الجميع» يمرّ — الخادم يرفضه بنيوياً
    await page.getByRole("button", { name: "طبّق على كل المستأجرين" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-12",
      state: "permission_denied",
      texts: fromFrame("PLT-12", "permission_denied", [
        "لا «تجاوز عام» على المستأجرين",
        "أي إجراء يطال أكثر من مستأجر واحد بضغطة — تفعيل ميزة للجميع، أو قراءة عبر الدفاتر — محجوب بنيوياً. التغيير يُطبَّق على تعريف الباقة، ثم يرثه كل مستأجر ضمن حدوده. لا باب خلفي يفتح مستأجراً من داخل آخر.",
      ]),
    });
    await page.getByRole("button", { name: "فهمت" }).click();
    // علم بلا نطاق
    await page.getByLabel("مفتاح العلم").fill("market_beta");
    await page.getByRole("button", { name: "حفظ العلم" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-12",
      state: "validation_error",
      texts: fromFrame("PLT-12", "validation_error", [
        "علم تشغيل بلا نطاق واضح",
        "حاول المشغّل حفظ علم تشغيل دون تحديد نطاقه (باقة؟ بيئة؟). نمنع الحفظ ونطالب بالنطاق صراحةً، لأن علماً بلا نطاق قد يتسرّب إلى الجميع.",
      ]),
    });
    await page.getByRole("button", { name: "باقة", exact: true }).click();
    await page.getByLabel("النطاق (رمز الباقة أو اسم البيئة)").fill("dual");
    await page.getByRole("button", { name: "حفظ العلم" }).click();
    await expect(root).toContainText("market_beta");
    await expect(page.locator('[data-screen="PLT-12"][data-state="ready"]')).toBeVisible();
    // إيقاف ثم تفعيل «قوائم أسعار خاصة» لباقة الفرعين — على مستوى الباقة
    const group = page.getByRole("group", { name: "قوائم أسعار خاصة للسوق" });
    await group.getByRole("button", { name: "فرعان" }).click();
    await expect(root).toContainText("أُوقفت «قوائم أسعار خاصة» لباقة الفرعين.");
    await page.getByRole("button", { name: "التالي" }).click();
    await group.getByRole("button", { name: "فرعان" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-12",
      state: "success",
      texts: fromFrame("PLT-12", "success", [
        "حُفظ التغيير على مستوى الباقة",
        "فُعّلت «قوائم أسعار خاصة» لباقة الفرعين.",
        "الأثر يُسجَّل باسم المشغّل ووقته، والمستأجرون على الباقة يرثونها في تحديثهم القادم — كلٌّ داخل حدوده.",
      ]),
    });
    await expect(root).toContainText("طيب — تشغيل");
  });
});
