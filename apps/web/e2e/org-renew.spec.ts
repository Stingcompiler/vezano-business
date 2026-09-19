import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.5 — ORG-07 إثبات تحويل الاشتراك ومراجعته (5): الرفع لا يُفعِّل — «معلّق» معلَنة؛ رقم العملية
 * إلزامي؛ فشل الرفع لا يُضيّع الصورة (مسار بديل نصّي)؛ الاعتماد يمدّد شهراً مرة واحدة (§١٦.٢).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const DUE = {
  plan_code: "dual",
  plan_name: "فرعان",
  amount_minor: "8500000",
  currency: "SDG",
  period_label: "أكتوبر",
  review_sla: "يوم عمل واحد",
};
const proof = (o: Record<string, unknown> = {}) => ({
  id: "p1",
  reference: "TRX-55712",
  plan_code: "dual",
  amount_minor: "8500000",
  period_label: "أكتوبر",
  image_name: "receipt-oct.jpg",
  image_size: 1258291,
  has_image: true,
  status: "pending",
  submitted_at: new Date(new Date().setHours(10, 14, 0, 0)).toISOString(),
  reviewed_at: "",
  reviewed_by_name: "",
  rejection_reason: "",
  extension_days: 0,
  ...o,
});
const payload = (proofs: unknown[] = []) => ({
  due: DUE,
  proofs,
  can_submit: true,
  review_sla: "يوم عمل واحد",
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

test.describe("ORG-07", () => {
  test("ready → validation_error → saving → success: الرقم إلزامي، الرفع يُسجَّل معلّقاً، ثم اعتُمد مرة واحدة", async ({
    page,
  }, info) => {
    let posted: Record<string, unknown> | null = null;
    let created: ReturnType<typeof proof> | null = null;
    await page.route("**/api/org/subscription/proofs", async (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        created = proof();
        await new Promise((r) => setTimeout(r, 400));
        return route.fulfill(json(201, { proof: created, ...payload([created]) }));
      }
      return route.fulfill(json(200, payload(created ? [created] : [])));
    });
    await login(page, "/org/subscription/renew");
    await expectFrame(page, info, {
      screenId: "ORG-07",
      state: "ready",
      texts: fromFrame("ORG-07", "ready", [
        "إثبات تحويل الاشتراك — الرفع لا يُفعِّل، والمراجعة بشرية معلَنة",
        "التاجر يرفع إيصال التحويل فتظهر حالة «معلّق» صريحة. لا نفعّل الاشتراك بمجرد وجود صورة، ولا نتركه يظن أنه دفع ومضى.",
        "رفع إثبات التحويل",
        "رقم العملية البنكية — مطلوب",
        "مسار الإثبات كما يراه التاجر",
        "«معلّق» حالة معلَنة لا صامتة.",
        "نعرض متوسط زمن المراجعة، ونبقي الخدمة عاملة خلالها، ولا نرسل تنبيه «تم الدفع» قبل الاعتماد.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="ORG-07"]');
    await expect(root).toContainText("المستحق: 85,000.00 SDG · الفترة: أكتوبر");
    // بلا رقم نمنع الإرسال
    await page.getByRole("button", { name: "إرسال الإثبات" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-07",
      state: "validation_error",
      texts: fromFrame("ORG-07", "validation_error", [
        "لو تُرك رقم العملية فارغاً نمنع الإرسال: بلا رقم لا يستطيع المراجع منع الاعتماد المزدوج (PLT-03).",
      ]),
    });
    expect(posted).toBeNull();
    // صورة + رقم → يُرفع (saving) ثم معلّق للمراجعة
    await page
      .locator('input[type="file"][aria-label="صورة الإيصال"]')
      .first()
      .setInputFiles({ name: "receipt-oct.jpg", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("رقم العملية البنكية — مطلوب").fill("TRX-55712");
    await page.getByRole("button", { name: "إرسال الإثبات" }).click();
    await expect(root).toHaveAttribute("data-state", "saving");
    await expect(root).toHaveAttribute("data-state", "success");
    expect(posted).toMatchObject({
      reference: "TRX-55712",
      plan_code: "dual",
      image_name: "receipt-oct.jpg",
    });
    await expect(root).toContainText("معلّق للمراجعة");
    await expect(root).toContainText("رُفع الإثبات");
    await expect(root).toContainText("اليوم 10:14 · يظهر لك فوراً في سجل الاشتراك");
    await expect(root).toContainText("بانتظار مراجعة بشرية");
    await expect(root).toContainText("متوسط المراجعة يوم عمل واحد. لا تفعيل آلي بمجرد الرفع.");
    await expect(root).toContainText("صورة الإيصال — مرفوعة · receipt-oct.jpg · 1.2 MB");
    await expect(root).toContainText("TRX-55712");
    // بعد الاعتماد (المراجعة البشرية) — الشاشة تعرض التمديد مرة واحدة
    created = proof({
      status: "approved",
      extension_days: 30,
      reviewed_by_name: "مراجع المنصة",
      reviewed_at: new Date().toISOString(),
    });
    await page.route("**/api/org/subscription", (route) =>
      route.fulfill(
        json(200, {
          plan: {
            code: "dual",
            name: "فرعان",
            trial: false,
            state: "active",
            expires_at: "2026-10-23T00:00:00Z",
            days_since_expiry: -30,
            price_minor: "8500000",
            currency: "SDG",
          },
          limits: {
            branches: { used: 1, max: 2 },
            devices: { used: 1, max: 6 },
            users: { used: 1, max: null },
            campaign_quota: { used: 0, max: 1200 },
          },
          features: [],
          if_expired: { continues: [], stops: [] },
          plans: [],
          can_see_amounts: true,
          can_renew: true,
        }),
      ),
    );
    await page.getByRole("link", { name: "الاشتراك", exact: true }).first().click();
    await expect(page).toHaveURL(/\/org\/subscription$/);
    await page.getByRole("button", { name: "تجديد الاشتراك" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-07",
      state: "success",
      texts: fromFrame("ORG-07", "success", [
        "اعتُمد — مُدّد الاشتراك شهراً واحداً",
        "التمديد كُتب مرة واحدة بمرجع رقم العملية. لو رُفع الإيصال نفسه ثانية تُرفض المحاولة بعرض الاعتماد الأول وتاريخه — لا شهر إضافي بالخطأ.",
        "خلال المراجعة كلها",
        "الخدمة تعمل كما هي. لا تعطيل استباقي ولا تحذير مفاجئ.",
        "ثابت",
      ]),
    });
  });

  test("server_error: فشل رفع الصورة — تُحفظ محلياً ويُسجَّل الرقم نصاً، ثم إعادة الرفع", async ({
    page,
  }, info) => {
    let attempts = 0;
    let imagePosted = false;
    await page.route("**/api/org/subscription/proofs", (route) => {
      if (route.request().method() === "POST") {
        attempts += 1;
        const body = route.request().postDataJSON() as { image_data?: string };
        if (body.image_data) return route.fulfill(json(502, { detail: "upstream" })); // الصورة تسقط
        return route.fulfill(
          json(201, {
            proof: proof({ has_image: false, image_name: "", image_size: 0 }),
            ...payload([]),
          }),
        );
      }
      return route.fulfill(json(200, payload([])));
    });
    await page.route("**/api/org/subscription/proofs/p1/image", (route) => {
      imagePosted = true;
      return route.fulfill(json(200, { proof: proof() }));
    });
    await login(page, "/org/subscription/renew");
    await page
      .locator('input[type="file"][aria-label="صورة الإيصال"]')
      .first()
      .setInputFiles({ name: "receipt-oct.jpg", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("رقم العملية البنكية — مطلوب").fill("TRX-55712");
    await page.getByRole("button", { name: "إرسال الإثبات" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-07",
      state: "server_error",
      texts: fromFrame("ORG-07", "server_error", [
        "فشل رفع الإثبات",
        "صورة التحويل لم تُرفع. المستخدم دفع فعلاً وهذا يزيد قلقه.",
        "لا نُضيّع الصورة",
        "تُحفظ محلياً وتُرفع تلقائياً عند عودة الشبكة، ونقول ذلك. طلبُ التصوير من جديد بعد دفعٍ تمّ استفزاز.",
        "مسار بديل",
        "رقم التحويل وتاريخه يُسجَّلان نصاً الآن — يكفيان للمراجعة اليدوية ريثما تصل الصورة.",
      ]),
    });
    expect(attempts).toBe(2); // الأولى بالصورة سقطت، الثانية نصّاً نجحت
    await expect(page.locator('[data-screen="ORG-07"]')).toContainText(
      "محفوظة محلياً: receipt-oct.jpg",
    );
    await page.getByRole("button", { name: "أعد رفع الصورة" }).click();
    await expect.poll(() => imagePosted).toBe(true);
    await expect(page.locator('[data-screen="ORG-07"]')).toHaveAttribute("data-state", "success");
  });
});
