import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T1.1 — ACC-01 (3 حالات) + ACC-02 (7 حالات). الخادم يُحاكى على مستوى الشبكة (لا Django في e2e)؛
 * عقود الاستجابات من packages/contracts، ومنطق الخادم مغطّى في backend/core/tests/test_account_auth.py.
 */
const POLICY = {
  code_length: 6,
  code_ttl_seconds: 600,
  resend_after_seconds: 60,
  max_resends: 2,
  max_send_failures: 3,
  max_confirm_attempts: 5,
};

async function mockHealth(page: Page, ok: boolean) {
  await page.route("**/api/health", (route) =>
    ok
      ? route.fulfill({ json: { ok: true } })
      : route.fulfill({ status: 503, json: { ok: false } }),
  );
}

const json = (status: number, body: unknown) => ({ status, json: body });

test.describe("ACC-01", () => {
  test("ready: الترحيب والخيارات الثلاثة", async ({ page }, info) => {
    await mockHealth(page, true);
    await page.goto("/welcome");
    await expectFrame(page, info, {
      screenId: "ACC-01",
      state: "ready",
      texts: fromFrame("ACC-01", "ready", [
        "أهلاً بك في فيزانو",
        "اختر ما جاء بك. الاختيار يحدّد نوع حسابك ولا يُغيَّر لاحقاً بضغطة.",
        "أدير متجراً — إنشاء منشأة جديدة",
        "حساب إدارة: نقاط بيع ومخزون ودفاتر. هذا ما يحتاجه صاحب المحل.",
        "لي حساب — دخول",
        "مالك أو موظف له عضوية في منشأة قائمة.",
        "أشتري من السوق باسم منشأتي",
        "نفس حساب الإدارة. لا حساب سوق منفصل — منشأة واحدة تشتري وتبيع بدفتر واحد.",
        "زبون محل وصلته رسالة؟ لا تحتاج حساباً هنا — افتح الرابط الذي وصلك مباشرة.",
      ]),
      styles: [
        [".acc-choice--primary", "background-color", "brand.tint"],
        [".acc-card", "background-color", "surface.card"],
      ],
    });
    await navTo(page, "لي حساب — دخول");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("offline: المنع وسببه وزرّ واحد", async ({ page, context }, info) => {
    await mockHealth(page, true);
    await page.goto("/welcome");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-01",
      state: "offline",
      texts: fromFrame("ACC-01", "offline", [
        "بلا اتصال",
        "جهازٌ جديد لا يستطيع الدخول ولا الإنشاء: كلاهما يحتاج الخادم.",
        "أعد المحاولة",
      ]),
    });
    // لا نموذج يفشل عند الضغط: الخيارات غير معروضة
    await expect(page.getByRole("link", { name: "لي حساب — دخول" })).toHaveCount(0);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator('[data-screen="ACC-01"][data-state="ready"]')).toBeVisible();
  });

  test("server_error: الشبكة تعمل والخادم لا يردّ — نقول أين العطب", async ({ page }, info) => {
    await mockHealth(page, false);
    await page.goto("/welcome");
    await expectFrame(page, info, {
      screenId: "ACC-01",
      state: "server_error",
      texts: fromFrame("ACC-01", "server_error", [
        "خطأ خادم",
        "الخدمة لا تستجيب — العطب ليس عندك",
        "حالة الخدمة",
        "أعد المحاولة",
      ]),
    });
    // لا عدّاد كاذب: لا «سنعود خلال» ولا أرقام دقائق
    await expect(page.locator('[data-screen="ACC-01"]')).not.toContainText("سنعود");
    await page.unroute("**/api/health");
    await mockHealth(page, true);
    await page.getByRole("button", { name: "أعد المحاولة" }).click();
    await expect(page.locator('[data-screen="ACC-01"][data-state="ready"]')).toBeVisible();
  });
});

test.describe("ACC-02 — الدخول", () => {
  test("ready: نموذج الدخول", async ({ page }, info) => {
    await page.goto("/login");
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "ready",
      texts: fromFrame("ACC-02", "ready", [
        "الدخول إلى فيزانو",
        "رقم الهاتف أو البريد",
        "كلمة المرور",
        "دخول",
        "نسيت كلمة المرور",
        "حساب إدارة المتجر. زبون المحل يدخل من رابط المحل ولا يحتاج حساباً هنا.",
      ]),
      styles: [[".c-btn--primary", "background-color", "brand.primary"]],
    });
    // 56px للفعل الأساسي على الهاتف (06-D2 يرسمه 56)
    if (page.viewportSize()?.width === 390) {
      const h = await page
        .getByRole("button", { name: "دخول" })
        .evaluate((e) => e.getBoundingClientRect().height);
      expect(h).toBeGreaterThanOrEqual(56);
    }
  });

  test("validation_error: رسالة واحدة لحالتين ومخرجان جنباً إلى جنب", async ({ page }, info) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(json(401, { detail: "invalid_credentials" })),
    );
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
    await page.getByLabel("كلمة المرور").fill("wrong");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "validation_error",
      texts: fromFrame("ACC-02", "validation_error", [
        "بيانات الدخول غير صحيحة",
        "نسيت كلمة المرور؟",
        "ليس لديك حساب؟",
      ]),
    });
    // الرقم يبقى
    await expect(page.getByLabel("رقم الهاتف أو البريد")).toHaveValue("0912447001");
  });

  test("validation_error بعد خمس محاولات: تأخير معلن بعدّاد ظاهر لا حظر صامت", async ({ page }) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(429, { detail: "retry_after", retry_after_seconds: 30, failed_logins: 5 }),
      ),
    );
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
    await page.getByLabel("كلمة المرور").fill("wrong");
    await page.getByRole("button", { name: "دخول" }).click();
    const root = page.locator('[data-screen="ACC-02"][data-state="validation_error"]');
    await expect(root).toBeVisible();
    await expect(root.locator(".acc-count")).toHaveText(/^\d+$/);
    expect(Number(await root.locator(".acc-count").innerText())).toBeLessThanOrEqual(30);
    await expect(page.getByRole("button", { name: "دخول" })).toBeDisabled();
  });

  test("offline: الدخول الأول يحتاج الخادم — لا نموذج معطّل", async ({ page, context }, info) => {
    await page.goto("/login");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "offline",
      texts: fromFrame("ACC-02", "offline", ["بلا اتصال", "الدخول الأول يحتاج الخادم."]),
    });
    await expect(page.getByLabel("كلمة المرور")).toHaveCount(0);
    // جهاز لم يُهيّأ: لا مدخل محلي
    await expect(page.getByRole("button", { name: "ادخل بـPIN المحلي" })).toHaveCount(0);
    await context.setOffline(false);
  });

  test("success: عضويتان → الانتقال فوري إلى اختيار المنشأة بلا شاشة تهنئة", async ({ page }) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(200, {
          memberships: [
            { user_id: "u1", tenant_id: "t1", tenant_name: "بقالة النيل", is_owner: true },
            { user_id: "u2", tenant_id: "t2", tenant_name: "مخزن البركة", is_owner: true },
          ],
          select_ticket: "ticket",
        }),
      ),
    );
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page).toHaveURL(/\/select-org$/);
    await expect(page.locator("body")).not.toContainText("تم الدخول بنجاح");
  });

  test("success: عضوية واحدة → الرئيسية مباشرة", async ({ page }) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(json(200, { access: "a", refresh: "r", session_id: "s" })),
    );
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("ACC-02 — رمز التحقق", () => {
  async function toVerify(page: Page) {
    await page.route("**/api/auth/verify/request", (route) =>
      route.fulfill(
        json(202, {
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          resend_after_seconds: 60,
          resends_left: 2,
          sends: 1,
          policy: POLICY,
        }),
      ),
    );
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
    await page.getByRole("button", { name: "نسيت كلمة المرور" }).click();
    await expect(page.locator('[data-screen="ACC-02"][data-step="verify"]')).toBeVisible();
  }

  test("ready: إدخال الرمز وعدّاد إعادة الإرسال", async ({ page }, info) => {
    await toVerify(page);
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "ready",
      texts: fromFrame("ACC-02", "ready", [
        "تحقق الحساب",
        "أدخل رمز التحقق",
        "أرسلنا رمزاً من ست خانات إلى وسيلة الاتصال المسجَّلة لهذا الحساب. صالح 10 دقائق.",
        "لم يصلك الرمز؟",
        "إعادة الإرسال متاحة بعد 60 ثانية، ومرتين كحد أقصى قبل أن نقترح التحقق اليدوي.",
        "تأكيد الرمز",
        "إعادة الإرسال —",
      ]),
    });
    await expect(page.getByRole("button", { name: /إعادة الإرسال — \d+ ثانية/ })).toBeDisabled();
    await expect(page.locator(".acc-code__box")).toHaveCount(6);
  });

  test("loading: جارٍ التحقق — الزرّ معطّل والحقل مقفل ولا إلغاء", async ({ page }, info) => {
    await toVerify(page);
    await page.route("**/api/auth/verify/confirm", async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.fulfill(json(200, { verified_ticket: "v" }));
    });
    await page.locator(".acc-code__box").first().fill("4");
    await page.locator(".acc-code__box").nth(1).fill("8");
    await page.locator(".acc-code__box").nth(2).fill("1");
    await page.locator(".acc-code__box").nth(3).fill("9");
    await page.locator(".acc-code__box").nth(4).fill("6");
    await page.locator(".acc-code__box").nth(5).fill("2");
    await page.getByRole("button", { name: "تأكيد الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "loading",
      texts: fromFrame("ACC-02", "loading", ["جارٍ التحقق"]),
    });
    await expect(page.getByRole("button", { name: "تأكيد الرمز" })).toBeDisabled();
    await expect(page.locator(".acc-code__box").first()).toHaveAttribute("readonly", "");
    await expect(page.getByRole("button", { name: "إلغاء" })).toHaveCount(0);
  });

  test("expired: انتهاؤه حدثٌ متوقّع لا خطأ — والرقم يبقى", async ({ page }, info) => {
    await toVerify(page);
    await page.route("**/api/auth/verify/confirm", (route) =>
      route.fulfill(json(410, { detail: "code_expired" })),
    );
    for (const [i, d] of ["1", "2", "3", "4", "5", "6"].entries()) {
      await page.locator(".acc-code__box").nth(i).fill(d);
    }
    await page.getByRole("button", { name: "تأكيد الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "expired",
      texts: fromFrame("ACC-02", "expired", ["انتهى رمز التحقق"]),
    });
    await expect(page.locator('[data-screen="ACC-02"]')).toContainText("إرسال رمز جديد");
    await expect(page.locator('[data-screen="ACC-02"]')).toContainText(
      "اطلب رمزاً جديداً — الرمز القديم لم يعد صالحاً حتى لو وصلك الآن.",
    );
    // لا لائمة: لا كلمة «خطأ» في رسالة الانتهاء
    await expect(page.locator(".acc-lead")).not.toContainText("خطأ");
  });

  test("server_error: فشل الإرسال ثلاث مرات → بديل يعمل الآن", async ({ page }, info) => {
    let n = 0;
    await page.route("**/api/auth/verify/request", (route) => {
      n += 1;
      return route.fulfill(
        json(503, {
          detail: "send_failed",
          send_failures: n,
          manual_suggested: n >= 3,
          policy: POLICY,
        }),
      );
    });
    await page.route("**/api/auth/verify/manual", (route) =>
      route.fulfill(
        json(201, { request_id: "01990000-0000-7000-8000-0000000000ff", status: "open" }),
      ),
    );
    await page.goto("/login");
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912447001");
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "نسيت كلمة المرور" }).click();
      if (i < 2)
        await expect(page.locator('[data-screen="ACC-02"]')).toContainText("تعذّر إرسال الرمز");
    }
    await expectFrame(page, info, {
      screenId: "ACC-02",
      state: "server_error",
      texts: fromFrame("ACC-02", "server_error", [
        "تعذّر إرسال الرمز",
        "بديل يعمل الآن",
        "فشل إرسال الرمز ثلاث مرات. لن نتركك في حلقة إعادة محاولة: التحقق اليدوي بالدعم مسار مكتمل لا استثناء طارئ.",
        "ما يطلبه التحقق اليدوي",
        "اسم المنشأة ومستند هويتها ومكالمة أو رسالة من الدعم. مدة الإنجاز معلنة: يوم عمل واحد.",
        "ما لن نفعله",
        "لا نفتح الحساب بلا تحقق ولا نقبل صورة شاشة كدليل. الحساب يحمل دفتراً مالياً.",
        "فتح طلب تحقق يدوي",
        "محاولة أخرى بوسيلة مختلفة",
      ]),
    });
    await page.getByRole("button", { name: "فتح طلب تحقق يدوي" }).click();
    await expect(page.getByRole("button", { name: "فتح طلب تحقق يدوي" })).toBeDisabled();
    await page.getByRole("button", { name: "محاولة أخرى بوسيلة مختلفة" }).click();
    await expect(page.locator('[data-screen="ACC-02"][data-step="login"]')).toBeVisible();
    await expect(page.getByLabel("رقم الهاتف أو البريد")).toHaveValue("");
  });
});
