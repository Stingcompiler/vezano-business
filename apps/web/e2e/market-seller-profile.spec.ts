import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.3 — MP-08 تهيئة بائع وتحقق الهوية (5) + MP-09 إدارة صفحة المنشأة (5): حساب واحد ودفتر
 * واحد ودور بائع بتحقق منفصل؛ النقص مسمّى حقلاً حقلاً؛ التفعيل لا ينشر؛ المعاينة العامة هي
 * الحقيقة؛ بلا منطقة خدمة لا نشر؛ المدير لا يحرّر هوية المنشأة.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(14, 20, 0, 0);
  return d.toISOString();
};

const item = (key: string, title: string, hint: string, done: boolean, reason = "") => ({
  key,
  title,
  hint,
  done,
  reason,
});
const CHECK = (doc: boolean, docReason = "") => [
  item("identity", "هوية مسؤول المنشأة", "نفس التحقق المستخدم للشراء — لا يُعاد", true),
  item(
    "service_area",
    "عنوان النشاط ومنطقة الخدمة",
    "الخرطوم بحري · استلام من المخزن وتوصيل داخل المنطقة",
    true,
  ),
  item(
    "terms",
    "موافقة على شروط البائع",
    "مسؤولية الوصف والسعر والتسليم على المنشأة لا على فيزانو",
    true,
  ),
  item(
    "registry_doc",
    "مستند السجل التجاري",
    "صورة واضحة · يراجعها مشرف السوق ولا تُنشر في ملفك العام",
    doc,
    docReason,
  ),
];

const account = (o: Record<string, unknown> = {}) => ({
  shop_name: "بقالة النيل — تجريبي",
  role: "buyer",
  verification: "draft",
  verification_label: "مسوّدة الطلب",
  checklist: CHECK(false),
  done: 3,
  total: 4,
  submitted_at: "",
  days_since_submitted: null,
  usual_review_days: 3,
  review_reasons: {},
  badge_limits:
    "الشارة تقول: تحققنا من وجود هذه المنشأة ومن هوية مسؤولها. لا تقول إن بضاعتها جيدة، ولا إنها ستسلّم في الموعد، ولا إننا نضمن أي طلب.",
  can_submit: true,
  registry_doc_name: "",
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("MP-08", () => {
  test("ready → validation_error → loading → success: 3 من 4، التقديم بلا المستند يسمّي النقص، ثم قيد المراجعة، ثم فُعِّل ولم يُنشر", async ({
    page,
  }, info) => {
    let acc = account();
    await page.route("**/api/market/account", (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { registry_doc?: { name: string } };
        if (body.registry_doc)
          acc = account({
            checklist: CHECK(true),
            done: 4,
            registry_doc_name: body.registry_doc.name,
          });
      }
      return route.fulfill(json(200, { account: acc }));
    });
    let submitted = 0;
    await page.route("**/api/market/account/verification/submit", (route) => {
      submitted += 1;
      if (acc.done < 4)
        return route.fulfill(
          json(400, {
            detail: "checklist_incomplete",
            field: "",
            extra: { missing: ["registry_doc"] },
          }),
        );
      acc = account({
        checklist: CHECK(true),
        done: 4,
        verification: "pending",
        verification_label: "بانتظار المراجعة",
        submitted_at: yesterday(),
        days_since_submitted: 1,
      });
      return route.fulfill(json(200, { account: acc }));
    });
    await login(page, "/market/seller");
    await expectFrame(page, info, {
      screenId: "MP-08",
      state: "ready",
      texts: fromFrame("MP-08", "ready", [
        "تفعيل دور البائع — طلب تحقق قبل أول نشر",
        "تريد النشر في السوق",
        "حسابك يبقى واحداً ودفترك واحداً. ما يُضاف هو دور بائع بعد تحقق منفصل يراجعه مشرف السوق.",
        "طلب تحقق البائع — 3 من 4 مكتملة",
        "هوية مسؤول المنشأة",
        "نفس التحقق المستخدم للشراء — لا يُعاد",
        "عنوان النشاط ومنطقة الخدمة",
        "الخرطوم بحري · استلام من المخزن وتوصيل داخل المنطقة",
        "موافقة على شروط البائع",
        "مسؤولية الوصف والسعر والتسليم على المنشأة لا على فيزانو",
        "مكتمل",
        "مطلوب",
        "مستند السجل التجاري",
        "صورة واضحة · يراجعها مشرف السوق ولا تُنشر في ملفك العام",
        "حدود الشارة",
        "الشارة تقول: تحققنا من وجود هذه المنشأة ومن هوية مسؤولها. لا تقول إن بضاعتها جيدة، ولا إنها ستسلّم في الموعد، ولا إننا نضمن أي طلب.",
        "المسار أ — مرفوض",
        "تفعيل تلقائي داخل نفس المنشأة",
        "المسار ج — مرفوض",
        "حساب سوق منفصل مرتبط بتخويل",
        "سجلّك الخاص ليس إعلاناً عن غيرك.",
      ]),
    });
    await page.getByRole("button", { name: "قدّم طلب التحقق" }).click();
    await expectFrame(page, info, {
      screenId: "MP-08",
      state: "validation_error",
      texts: fromFrame("MP-08", "validation_error", [
        "أدلة ناقصة",
        "سجل تجاري غير مقروء أو نشاط لا يطابق الفئة المطلوبة.",
        "النقص مسمّى",
        "حقلاً حقلاً مع سبب الرفض السابق إن وُجد. «طلبك مرفوض» بلا سبب يعيد نفس الملف ثانيةً.",
      ]),
    });
    expect(submitted).toBe(1);
    await page
      .locator('input[type="file"][aria-label="مستند السجل التجاري"]')
      .first()
      .setInputFiles({ name: "registry.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "قدّم طلب التحقق" }).click();
    await expectFrame(page, info, {
      screenId: "MP-08",
      state: "loading",
      texts: fromFrame("MP-08", "loading", [
        "قيد مراجعة المشرف",
        "الطلب مرفوع وأدلته عند مشرف السوق (PLT-06).",
        "الحالة لا العجلة",
        "المدة المعتادة",
        "طلبٌ بلا أفق زمني يولّد تذاكر دعم لا صبراً.",
        "بانتظار المراجعة",
        "قُدِّم أمس",
        "· متوسط المراجعة يوم عمل واحد · لا نشر قبل الاعتماد",
      ]),
    });
    await expect(page.getByText("14:20")).toBeVisible();
    // المشرف اعتمد
    acc = account({
      checklist: CHECK(true),
      done: 4,
      role: "both",
      verification: "verified",
      verification_label: "منشأة موثَّقة المستندات",
    });
    await page.getByRole("button", { name: "تحقّق من الحالة" }).click();
    await expectFrame(page, info, {
      screenId: "MP-08",
      state: "success",
      texts: fromFrame("MP-08", "success", [
        "فُعِّل دور البائع",
        "الترقية من مشترٍ إلى بائع (المسار ب — حالة داخل MP-08 كما حُسم G-06).",
        "التفعيل لا ينشر",
        "لا ملف عام ولا عرض ولا صنف يُنشر تلقائياً (ACC-118 · ACC-120). الباب فُتح والدخول قرارات لاحقة كلٌّ بشاشته.",
      ]),
    });
  });

  test("permission_denied: المدير يرى الطلب ولا يقدّمه — للمالك", async ({ page }, info) => {
    await page.route("**/api/market/account", (route) =>
      route.fulfill(json(200, { account: account({ can_submit: false }) })),
    );
    await login(page, "/market/seller");
    await expectFrame(page, info, {
      screenId: "MP-08",
      state: "permission_denied",
      texts: fromFrame("MP-08", "permission_denied", [
        "تفعيل دور البائع — طلب تحقق قبل أول نشر",
        "طلب تحقق البائع — 3 من 4 مكتملة",
        "حدود الشارة",
      ]),
    });
    await expect(page.getByRole("button", { name: "قدّم طلب التحقق" })).toHaveCount(0);
  });
});

const PROFILE = (o: Record<string, unknown> = {}) => ({
  draft: {
    public_name: "مخزن البركة للجملة — تجريبي",
    category_line: "جملة مواد غذائية",
    categories: ["سكر", "شاي", "زيوت", "دقيق"],
    service_areas: ["الخرطوم بحري", "الخرطوم"],
    fulfilment: ["توصيل بحدّ أدنى 50,000 SDG", "استلام من المخزن بموعد"],
  },
  public: {
    public_name: "مخزن البركة للجملة — تجريبي",
    category_line: "جملة مواد غذائية",
    categories: ["سكر", "شاي", "زيوت", "دقيق"],
    service_areas: ["الخرطوم بحري", "الخرطوم"],
    fulfilment: ["توصيل بحدّ أدنى 50,000 SDG", "استلام من المخزن بموعد"],
    verified: true,
    badge_label: "منشأة موثَّقة المستندات",
    badge_note: "التوثيق لا يشمل جودة السلع أو الالتزام بالتسليم.",
    published_at: yesterday(),
    is_published: true,
  },
  can_edit: true,
  role_name: "مالك",
  portal_slug: "abc12345",
  seller_verified: true,
  not_published: ["العنوان التفصيلي", "الهاتف"],
  ...o,
});

test.describe("MP-09", () => {
  test("ready → validation_error → saving → success: المعاينة العامة كما يراها أي مشترٍ، بلا منطقة لا نشر، ثم حُفظت", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/market/profile", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { service_areas: string; publish: boolean };
        if (body.publish && !body.service_areas.trim())
          return route.fulfill(
            json(400, { detail: "service_areas_required", field: "service_areas", extra: {} }),
          );
        await held;
      }
      return route.fulfill(json(200, { profile: PROFILE() }));
    });
    await login(page, "/market/profile");
    await expectFrame(page, info, {
      screenId: "MP-09",
      state: "ready",
      texts: fromFrame("MP-09", "ready", [
        "إدارة صفحة المنشأة — المعاينة العامة هي الحقيقة",
        "البائع يرى صفحته كما يراها الغريب تماماً، بما فيه حدود الشارة. ومناطق الخدمة وطرق التنفيذ تُعلَن هنا لأن المشتري يبني عليها قراره.",
        "تحرير الصفحة",
        "المعاينة العامة",
        "كما يراها أي مشترٍ",
        "مخزن البركة للجملة — تجريبي",
        "جملة مواد غذائية",
        "منشأة موثَّقة المستندات",
        "التوثيق لا يشمل جودة السلع أو الالتزام بالتسليم. هذا النص يظهر للمشتري دائماً ولا يستطيع البائع إخفاءه.",
        "اسم المنشأة العام",
        "الفئات التي تخدمها",
        "سكر · شاي · زيوت · دقيق",
        "مناطق الخدمة",
        "الخرطوم بحري · الخرطوم",
        "طرق التنفيذ",
        "توصيل بحدّ أدنى 50,000 SDG · استلام من المخزن بموعد",
        "طرق التنفيذ وشروطها",
        "ما لا يظهر هنا",
        "العنوان التفصيلي والهاتف — يُعطيهما البائع في الطلب لا في الدليل",
      ]),
    });
    await page.getByLabel("مناطق الخدمة").fill("");
    await page.getByRole("button", { name: "انشر الصفحة" }).click();
    await expectFrame(page, info, {
      screenId: "MP-09",
      state: "validation_error",
      texts: fromFrame("MP-09", "validation_error", [
        "مناطق خدمة فارغة",
        "ملفٌ بلا منطقة خدمة لا يظهر في أي دليل — والناشر يظن نفسه منشوراً.",
        "الأثر لا الحقل",
        "«بلا منطقة لن تظهر في نتائج أحد» — نسمّي العاقبة لا «حقل مطلوب». الحقل الإلزامي بلا سبب يُملأ عبثاً.",
      ]),
    });
    await page.getByLabel("مناطق الخدمة").fill("الخرطوم بحري · الخرطوم");
    await page.getByRole("button", { name: "انشر الصفحة" }).click();
    await expectFrame(page, info, {
      screenId: "MP-09",
      state: "saving",
      texts: fromFrame("MP-09", "saving", [
        "جارٍ الحفظ",
        "الحفظ للمسودة — والمنشور لا يتغيّر حتى يكتمل.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "MP-09",
      state: "success",
      texts: fromFrame("MP-09", "success", [
        "حُفظت الصفحة",
        "عاين كما يراها الزائر",
        "بلا صلاحياتك وأسعارك الخاصة.",
        "الحقول المصرّح بها فقط",
        "ما يُنشر قائمة معلنة: الهوية والمناطق وطرق التنفيذ (ACC-120). العنوان التفصيلي والأرقام الداخلية لا تُنشر ولو مُلئت.",
      ]),
    });
  });

  test("permission_denied: مدير الفرع يحرّر عروضاً ولا يحرّر هوية المنشأة العامة", async ({
    page,
  }, info) => {
    await page.route("**/api/market/profile", (route) =>
      route.fulfill(json(200, { profile: PROFILE({ can_edit: false, role_name: "مدير فرع" }) })),
    );
    await login(page, "/market/profile");
    await expectFrame(page, info, {
      screenId: "MP-09",
      state: "permission_denied",
      texts: fromFrame("MP-09", "permission_denied", [
        "مدير الفرع يحرّر عروضاً ولا يحرّر هوية المنشأة العامة. الاسم والشارة والمناطق تمثّل المنشأة كلها، فتحريرها للمالك.",
        "المعاينة العامة",
        "كما يراها أي مشترٍ",
        "مخزن البركة للجملة — تجريبي",
      ]),
    });
    await expect(page.getByRole("button", { name: "انشر الصفحة" })).toHaveCount(0);
  });
});
