import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/** T1.4 — ACC-06 (5 حالات) + ACC-07 (4 حالات). */
const json = (status: number, body: unknown) => ({ status, json: body });
const TOKEN = "demo-invite-baraka-storekeeper";
const INVITE = {
  status: "valid",
  tenant_name: "مخزن البركة",
  inviter_name: "عثمان الطيب",
  role_name: "أمين مخزن",
  branch_name: "المخزن الرئيسي",
  expires_at: new Date(Date.now() + 71.5 * 3_600_000).toISOString(),
  tenant_id: "t2",
  user_id: "",
};

async function loginThenInvite(page: Page, invite: unknown) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(json(200, { memberships: [], select_ticket: "ticket" })),
  );
  await page.route("**/api/account/memberships", (route) =>
    route.fulfill(json(200, { memberships: [], fetched_at: new Date().toISOString() })),
  );
  await page.route(`**/api/invites/${TOKEN}`, (route) => route.fulfill(json(200, invite)));
  await page.goto(`/invite/${TOKEN}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`/invite/${TOKEN}$`));
}

test.describe("ACC-06", () => {
  test("ready → success: الدعوة بحقائقها ثم ما صار يملكه", async ({ page }, info) => {
    await loginThenInvite(page, INVITE);
    await expectFrame(page, info, {
      screenId: "ACC-06",
      state: "ready",
      texts: fromFrame("ACC-06", "ready", [
        "دعوة من «مخزن البركة»",
        "دعاك عثمان الطيب للانضمام بدور",
        "أمين مخزن",
        "على المخزن الرئيسي.",
        "الدور الممنوح",
        "النطاق",
        "المخزن الرئيسي فقط",
        "صلاحية الرابط",
        "تنتهي بعد",
        "ساعة",
        "القبول يمنحك",
        "عضوية داخل هذه المنشأة فقط",
        ". لا يُنشئ لك ملفاً عاماً في السوق ولا ينشر اسمك لأحد.",
        "قبول الدعوة",
      ]),
      styles: [[".acc-item--ok", "background-color", "color.green.50"]],
    });
    await expect(page.locator(".acc-facts .sting-mono")).toHaveText("71");
    await page.route(`**/api/invites/${TOKEN}/accept`, (route) =>
      route.fulfill(json(200, { ...INVITE, status: "accepted", user_id: "u9" })),
    );
    await page.getByRole("button", { name: "قبول الدعوة" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-06",
      state: "success",
      texts: fromFrame("ACC-06", "success", ["قُبلت الدعوة", "أنت الآن"]),
    });
    await expect(page.locator('[data-screen="ACC-06"]')).toContainText(
      "أنت الآن أمين مخزن في المخزن الرئيسي",
    );
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page).toHaveURL(/\/select-org$/);
  });

  test("expired: رابط منتهٍ — لا حساب معلّق ولا تمديد", async ({ page }, info) => {
    await loginThenInvite(page, { ...INVITE, status: "expired" });
    await expectFrame(page, info, {
      screenId: "ACC-06",
      state: "expired",
      texts: fromFrame("ACC-06", "expired", [
        "رابط منتهٍ",
        "انتهت صلاحية الدعوة — اطلب دعوة جديدة من مالك المنشأة",
      ]),
    });
    await expect(page.getByRole("button", { name: "قبول الدعوة" })).toHaveCount(0);
  });

  test("permission_denied: هذه الدعوة لحسابٍ آخر — بلا اسم منشأة", async ({ page }, info) => {
    await loginThenInvite(page, {
      status: "not_for_you",
      tenant_name: "",
      inviter_name: "",
      role_name: "",
      branch_name: "",
      expires_at: "",
      tenant_id: "",
      user_id: "",
    });
    await expectFrame(page, info, {
      screenId: "ACC-06",
      state: "permission_denied",
      texts: fromFrame("ACC-06", "permission_denied", [
        "الدعوة ليست لك",
        "هذه الدعوة لحسابٍ آخر",
        "بدّل الحساب",
      ]),
    });
    await expect(page.locator('[data-screen="ACC-06"]')).not.toContainText("مخزن البركة");
    await page.getByRole("button", { name: "بدّل الحساب" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("server_error: القبول لا يُستهلك بالفشل — إعادة المحاولة آمنة", async ({ page }, info) => {
    await loginThenInvite(page, INVITE);
    let calls = 0;
    await page.route(`**/api/invites/${TOKEN}/accept`, (route) => {
      calls += 1;
      return calls === 1
        ? route.fulfill(json(500, { detail: "boom" }))
        : route.fulfill(json(200, { ...INVITE, status: "accepted", user_id: "u9" }));
    });
    await page.getByRole("button", { name: "قبول الدعوة" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-06",
      state: "server_error",
      texts: fromFrame("ACC-06", "server_error", [
        "خطأ أثناء القبول",
        "الدعوة تبقى صالحة حتى يُسجَّل القبول فعلاً. إعادة المحاولة آمنة",
      ]),
    });
    await page.getByRole("button", { name: "أعد المحاولة" }).click();
    await expect(page.locator('[data-screen="ACC-06"][data-state="success"]')).toBeVisible();
  });
});

// متجه خادمي (hashlib.pbkdf2_hmac، ملح أصفار، ١٠٠٠ دورة) لـ PIN 123456
const ENCODED =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$xLL5EYZbGlWr9962Y1Y77xBK9jK/wka5FYHqDqwRYw8=";

async function seedVerifiers(page: Page, rows: unknown[]) {
  // صفحة القفل تفتح التخزين المحلي (تنشئ مخازنه) — الترحيب لم يعد يقرؤه بلا جلسة (0005 §١٢٠)
  await page.goto("/lock");
  await page.evaluate(
    async ({ rows }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").put({
          key: "pin.verifiers",
          value: JSON.stringify({
            device_id: "d1",
            prefix: "DV-A19",
            branch_name: "فرع بحري",
            pin_length: 6,
            fetched_at: new Date().toISOString(),
            verifiers: rows,
          }),
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(new Error(String(tx.error)));
      });
      db.close();
    },
    { rows },
  );
}
const SUMAYA = {
  user_id: "u1",
  display_name: "سميّة عبد الله",
  role_name: "مدير فرع",
  branch_name: "فرع بحري",
  encoded: ENCODED,
  version: 1,
};

async function typePin(page: Page, digits: string) {
  for (const d of digits)
    await page.locator(".acc-keypad").getByRole("button", { name: d, exact: true }).click();
}

test.describe("ACC-07", () => {
  test("ready → فتح محلي: PIN يفتح الجهاز لمستخدم مسمّى بلا شبكة", async ({ page }, info) => {
    await seedVerifiers(page, [SUMAYA]);
    await page.goto("/lock");
    await expectFrame(page, info, {
      screenId: "ACC-07",
      state: "ready",
      texts: fromFrame("ACC-07", "ready", [
        "سميّة عبد الله",
        "مدير فرع · فرع بحري · الجهاز",
        "هذا قفل محلي لا تسجيل دخول. يعمل بلا شبكة ولا يُنشئ جلسة خادمية جديدة.",
      ]),
    });
    await expect(page.locator(".acc-pin__dot")).toHaveCount(6);
    await typePin(page, "12");
    await expect(page.locator(".acc-pin__dot--on")).toHaveCount(2);
    await typePin(page, "3456");
    // بلا جلسة خادمية (0005 §١٢٠): الرمز صحيح ويقود إلى الدخول بكلمة المرور مرة واحدة — لا الصفحة
    // العامة التي كانت تعيد إلى القفل
    await expect(page).toHaveURL(/\/login\?unlocked=1&next=%2F$/);
    await expect(page.locator('[data-screen="ACC-02"]')).toContainText(
      "رمزك صحيح — ادخل بكلمة المرور مرة واحدة",
    );
  });

  test("validation_error: محاولة خاطئة — N من 5، والخامسة تقفل 15 دقيقة محلياً", async ({
    page,
  }, info) => {
    await seedVerifiers(page, [SUMAYA]);
    await page.goto("/lock");
    await typePin(page, "000000");
    await typePin(page, "000000");
    await expectFrame(page, info, {
      screenId: "ACC-07",
      state: "validation_error",
      texts: fromFrame("ACC-07", "validation_error", [
        "محاولة خاطئة —",
        "بعد الخامسة يُقفل الجهاز",
        "دقيقة. لا يُحذف شيء ولا تُرسل عمليات، والمالك يستطيع فتحه من ORG-04.",
      ]),
    });
    await expect(page.locator(".c-notice .sting-mono").first()).toHaveText("2");
    for (let i = 0; i < 3; i++) await typePin(page, "000000");
    await expect(page.locator(".acc-count")).toHaveText(/^\d+$/);
    await expect(page.locator(".acc-keypad button").first()).toBeDisabled();
    // القفل محلي ويبقى بعد إعادة التحميل
    await page.reload();
    await expect(
      page.locator('[data-screen="ACC-07"][data-state="validation_error"]'),
    ).toBeVisible();
    await expect(page.locator(".acc-keypad button").first()).toBeDisabled();
  });

  test("offline: الفرق الوحيد مؤشّر «بلا اتصال» — والفتح يعمل", async ({ page, context }, info) => {
    await seedVerifiers(page, [SUMAYA]);
    await page.goto("/lock");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-07",
      state: "offline",
      texts: fromFrame("ACC-07", "offline", ["بلا اتصال"]),
    });
    await expect(page.locator(".c-frame__banner")).toContainText("بلا اتصال");
    await typePin(page, "1234");
    await expect(page.locator(".acc-pin__dot--on")).toHaveCount(4);
    await typePin(page, "56");
    // بلا اتصال وبلا جلسة (0005 §١٢٠): الرمز صحيح لكن لا جلسة تُفتح — يُقال ذلك في مكانه
    await expect(page).toHaveURL(/\/lock$/);
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText(
      "رمزك صحيح — لكن الجلسة انتهت",
    );
    await context.setOffline(false);
  });

  test("permission_denied: PIN صحيح لمستخدم سُحب وصوله إلى هذا الجهاز", async ({ page }, info) => {
    await seedVerifiers(page, [{ ...SUMAYA, revoked: true }]);
    await page.goto("/lock");
    await typePin(page, "123456");
    await expectFrame(page, info, {
      screenId: "ACC-07",
      state: "permission_denied",
      texts: fromFrame("ACC-07", "permission_denied", [
        "الرمز صحيح — لكن وصولك إلى هذا الجهاز سُحب",
        "إن كان له عملٌ معلّق على هذا الجهاز فله تصديره أو طلب استرداده",
      ]),
    });
  });
});
