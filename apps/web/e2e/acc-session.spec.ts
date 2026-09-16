import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/** T1.5 — ACC-08 (5 حالات) + ACC-09 (6 حالات). */
const json = (status: number, body: unknown) => ({ status, json: body });

async function login(page: Page) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto("/login");
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("ACC-08", () => {
  test("expired: بلا معلّق — الحالة وزرّا الدخول والتصدير", async ({ page }, info) => {
    await login(page);
    // 401 على مسار مُصادَق → ACC-08 مع مسار العودة
    await page.route("**/api/account/sessions", (route) =>
      route.fulfill(json(401, { detail: "token_invalid" })),
    );
    await page.getByRole("link", { name: "الجلسات" }).click();
    await expect(page).toHaveURL(/\/session-expired\?return=/);
    await expectFrame(page, info, {
      screenId: "ACC-08",
      state: "expired",
      texts: fromFrame("ACC-08", "expired", [
        "انتهت جلستك",
        "سجّل الدخول مجدداً لمتابعة المزامنة.",
        "حالة عملك الآن",
        "عمليات محفوظة محلياً",
        "آمنة",
        "الرفع إلى الخادم",
        "متوقف",
        "لم يُفقد شيء. البيع المحلي يستمر بعد إعادة الدخول",
        "تُرفع تلقائياً. لن نطلب منك إعادة إدخالها.",
        "إعادة تسجيل الدخول",
        "تصدير نسخة محلية أولاً",
      ]),
      styles: [[".acc-item--ok", "background-color", "color.green.50"]],
    });
    // التصدير يعمل ويُبلّغ العدد
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "تصدير نسخة محلية أولاً" }).click();
    expect((await dl).suggestedFilename()).toMatch(/^sting-backup-.*\.json$/);
  });

  test("saved_local → pending_sync → success: العمل باقٍ ويُرفع بعد التحقق بالترتيب", async ({
    page,
  }, info) => {
    await login(page);
    await page.goto("/dev/probe");
    await page.getByTestId("save-probe").click();
    await expect(page.getByTestId("stored")).toContainText("محفوظ");
    await page.getByTestId("to-session-expired").click();
    await expectFrame(page, info, {
      screenId: "ACC-08",
      state: "saved_local",
      texts: fromFrame("ACC-08", "saved_local", [
        "جلستك انتهت — وعملك محفوظ",
        "على هذا الجهاز ولم يُرفع بعد",
        "أعِد التحقق ليُرفع كل ذلك باسمك.",
        "لا نمسح شيئاً",
        ": العمل باقٍ على الجهاز حتى لو أغلقتَ التطبيق أو انتظرتَ أياماً.",
        "ما لا نفعله:",
        "لا نرفع العمل بجلسة منتهية ولو كان محفوظاً — الرفع يحتاج هويةً حيّة، وإلا نُسب عملٌ لمن لم يكن حاضراً. ولا نمسحه لإنهاء الجلسة «نظيفةً»؛ النظافة هنا إتلاف.",
        "أعد التحقق وارفع",
        "صدّر نسخة أولاً",
      ]),
    });
    await expect(page.locator(".acc-facts dd.sting-mono")).toHaveText("1");
    // إعادة التحقق ثم الرفع
    let pushed = 0;
    await page.route("**/api/sync/push", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        operations: { operation_id: string }[];
        request_id: string;
        pending_after: number;
      };
      pushed += body.operations.length;
      expect(body.pending_after).toBe(0);
      await new Promise((r) => setTimeout(r, 1500));
      return route.fulfill(
        json(200, {
          protocol_version: 1,
          sync_epoch: "",
          request_id: body.request_id,
          results: body.operations.map((o) => ({
            operation_id: o.operation_id,
            status: "accepted",
            receipts: [],
          })),
          server_seq_high: "9",
        }),
      );
    });
    await page.getByRole("button", { name: "أعد التحقق وارفع" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-08",
      state: "pending_sync",
      texts: fromFrame("ACC-08", "pending_sync", [
        "الرفع جارٍ بعد التحقق",
        "في الطابور تُرفع بالترتيب الذي وقعت به لا بترتيب حجمها.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "ACC-08",
      state: "success",
      texts: fromFrame("ACC-08", "success", [
        "عاد كل شيء",
        "التحقق تمّ و",
        "رُفعت ونُسبت إليك.",
        "العودة",
      ]),
    });
    expect(pushed).toBe(1);
    await page.getByRole("button", { name: "العودة" }).click();
    await expect(page).toHaveURL(/\/dev\/probe$/);
  });

  test("offline: لا يمكن التحقق بلا شبكة — صدّر نسخة محلية", async ({ page, context }, info) => {
    await login(page);
    await page.goto("/session-expired");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ACC-08",
      state: "offline",
      texts: fromFrame("ACC-08", "offline", [
        "انتهت الجلسة وأنت بلا اتصال",
        "لا يمكن التحقق بلا شبكة. الجلسة منتهية والعمل محفوظ ومعلّق، والجهاز مقفل على شاشة واحدة.",
        "صدّر نسخة محلية",
      ]),
    });
    await context.setOffline(false);
  });
});

const S = {
  me: {
    session_id: "s1",
    kind: "own",
    session_label: "هذا الجهاز — سطح المكتب",
    is_current: true,
    tenant_id: "t1",
    tenant_name: "بقالة النيل",
    branch_name: "",
    device_id: "",
    last_seen_at: new Date().toISOString(),
    revoked_at: "",
    revoke_after_upload: false,
    reported_pending: 0,
    can_revoke: true,
  },
  tablet: {
    session_id: "s2",
    kind: "device",
    session_label: "كاشير 2 — لوحي",
    is_current: false,
    tenant_id: "t1",
    tenant_name: "بقالة النيل",
    branch_name: "الخرطوم",
    device_id: "d2",
    last_seen_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    revoked_at: "",
    revoke_after_upload: false,
    reported_pending: 84,
    can_revoke: true,
  },
  phone: {
    session_id: "s3",
    kind: "own",
    session_label: "هاتف غير معروف — أُبطلت",
    is_current: false,
    tenant_id: "t1",
    tenant_name: "بقالة النيل",
    branch_name: "",
    device_id: "",
    last_seen_at: "2026-09-11T10:00:00Z",
    revoked_at: "2026-09-11T10:05:00Z",
    revoke_after_upload: false,
    reported_pending: 0,
    can_revoke: true,
  },
} as const;

async function openSessions(page: Page, rows: unknown[]) {
  await login(page);
  await page.route("**/api/account/sessions", (route) =>
    route.fulfill(json(200, { sessions: rows })),
  );
  await page.getByRole("link", { name: "الجلسات" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

test.describe("ACC-09", () => {
  test("ready: الجدول بأعمدته الثلاثة والمعلّق بالأرقام", async ({ page }, info) => {
    await openSessions(page, [S.me, S.tablet, S.phone]);
    await expectFrame(page, info, {
      screenId: "ACC-09",
      state: "ready",
      texts: fromFrame("ACC-09", "ready", [
        "· الجلسات النشطة",
        "إبطال الجلسة يمنع الاستمرار لا الماضي",
        "الجلسة",
        "معلّق محلي",
        "أثر الإبطال",
        "هذا الجهاز — سطح المكتب",
        "نشطة الآن",
        "الجلسة الحالية. إبطالها يخرجك أنت.",
        "كاشير 2 — لوحي",
        "آخر نشاط قبل",
        "ساعات",
        "الإبطال يمنع بيعاً جديداً من هذا الجهاز، وتبقى الـ",
        "عملية في طابوره حتى ترفعها جلسة مصرَّحة. لا تُمحى.",
        "هاتف غير معروف — أُبطلت",
        "لا نمحو عملية معلّقة عند الإبطال.",
        "الجهاز المُبطَلة جلسته يُمنع من بيع جديد، وتبقى عملياته المحفوظة محلياً في الطابور حتى ترفعها جلسة مصرَّحة. الخيار الآخر — محوها — يعني إتلاف بيع حقيقي حدث فعلاً.",
      ]),
    });
    await expect(page.locator('[data-screen="ACC-09"]')).toContainText("84");
  });

  test("loading: جلب الجلسات من الخادم دائماً", async ({ page }, info) => {
    await login(page);
    await page.route("**/api/account/sessions", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      return route.fulfill(json(200, { sessions: [S.me] }));
    });
    await page.getByRole("link", { name: "الجلسات" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-09",
      state: "loading",
      texts: fromFrame("ACC-09", "loading", ["جلب الجلسات"]),
    });
  });

  test("pending_sync → success: نقول العدد قبل التأكيد ثم أنهِ بعد رفع المعلّق", async ({
    page,
  }, info) => {
    await openSessions(page, [S.me, S.tablet]);
    await page
      .locator('[data-screen="ACC-09"]')
      .getByRole("button", { name: "إنهاء الجلسة" })
      .nth(1)
      .click();
    await expectFrame(page, info, {
      screenId: "ACC-09",
      state: "pending_sync",
      texts: fromFrame("ACC-09", "pending_sync", [
        "إنهاء جلسة على جهاز فيه معلّق",
        "هذا الجهاز عليه",
        "عملية لم تُرفع",
        "الإنهاء يقطع الرفع.",
        "أنهِ بعد رفع المعلّق",
      ]),
    });
    await page.route("**/api/account/sessions/s2/revoke", (route) =>
      route.fulfill(json(200, { ...S.tablet, revoke_after_upload: true })),
    );
    await page.getByRole("button", { name: "أنهِ بعد رفع المعلّق" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-09",
      state: "success",
      texts: fromFrame("ACC-09", "success", ["أُنهيت الجلسة", "الإنهاء لا يُلغى."]),
    });
  });

  test("server_error: لا تفاؤل — الجلسة لا تُعرض منتهية قبل تأكيد الخادم", async ({
    page,
  }, info) => {
    await openSessions(page, [S.me, S.tablet]);
    await page.route("**/api/account/sessions/s1/revoke", (route) => route.fulfill(json(500, {})));
    await page
      .locator('[data-screen="ACC-09"]')
      .getByRole("button", { name: "إنهاء الجلسة" })
      .first()
      .click();
    await expectFrame(page, info, {
      screenId: "ACC-09",
      state: "server_error",
      texts: fromFrame("ACC-09", "server_error", [
        "تعذّر إنهاء الجلسة",
        "لا نُظهر الجلسة كمنتهية قبل تأكيد الخادم",
      ]),
    });
    await expect(page.locator('[data-screen="ACC-09"]')).not.toContainText("أُنهيت الجلسة");
  });

  test("permission_denied: إنهاء جلسة جهاز آخر للمالك وحده", async ({ page }, info) => {
    await openSessions(page, [S.me, { ...S.tablet, reported_pending: 0 }]);
    await page.route("**/api/account/sessions/s2/revoke", (route) =>
      route.fulfill(json(403, { detail: "permission_denied" })),
    );
    await page
      .locator('[data-screen="ACC-09"]')
      .getByRole("button", { name: "إنهاء الجلسة" })
      .nth(1)
      .click();
    await expectFrame(page, info, {
      screenId: "ACC-09",
      state: "permission_denied",
      texts: fromFrame("ACC-09", "permission_denied", [
        "إنهاء جلسة جهاز آخر",
        "الجهاز عهدةُ المنشأة لا ملكُ من دخل عليه.",
      ]),
    });
  });
});
