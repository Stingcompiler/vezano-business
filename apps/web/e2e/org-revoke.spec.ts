import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.3 — ORG-05 سحب مستخدم أو نطاق أو جهاز (5): السحب لا يمحو عملاً؛ العدد يُعرض قبل التأكيد؛
 * وردية مفتوحة باسمه مانع؛ مدير الفرع يسحب في فرعه؛ على جهاز مشترك لا يوقف البقية (ACC-45، 63، 64).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

const base = (o: Record<string, unknown> = {}) => ({
  user: { id: "u3", display_name: "سالم", is_owner: false, status: "active", deactivated_at: "" },
  scopes: [
    { branch_id: "b1", branch_name: "فرع السوق", role_name: "كاشير", in_actor_scope: true },
    { branch_id: "b2", branch_name: "فرع النور", role_name: "كاشير", in_actor_scope: true },
  ],
  devices: [
    {
      id: "d2",
      name: "كاشير 2",
      branch_name: "فرع السوق",
      status: "active",
      pending: 7,
      shared_with: [],
    },
  ],
  pending_total: 7,
  ledger: { invoices: 2140, shifts: 212, open_shift: null },
  can: { disable_user: true, revoke_branch: true, wipe_device: true },
  blockers: [] as string[],
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

test.describe("ORG-05", () => {
  test("ready → success: ما الذي يُسحب والعدد قبل التأكيد؛ الخيار الأوسط ليس الافتراضي؛ سُحب الوصول", async ({
    page,
  }, info) => {
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/org/users/u3/revocation", (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill(
          json(200, {
            action: "disable",
            sessions_ended: 0,
            sessions_deferred: 1,
            ...base({ user: { ...base().user, status: "disabled" } }),
          }),
        );
      }
      return route.fulfill(json(200, base()));
    });
    await login(page, "/org/users/u3/revoke");
    await expectFrame(page, info, {
      screenId: "ORG-05",
      state: "ready",
      texts: fromFrame("ORG-05", "ready", [
        "سحب مستخدم أو نطاق أو جهاز — السحب لا يمحو عملاً",
        "أخطر فعل إداري في المنشأة: قد يُنفَّذ في لحظة غضب أو بعد سرقة، وعلى الجهاز المسحوب عملٌ لم يُرفع. المنع فوريّ والعمل أمانة.",
        "سحب وصول — سالم",
        "ما الذي يُسحب",
        "الدخول إلى المنشأة",
        "يُمنع فوراً على كل الأجهزة",
        "جهاز «كاشير 2»",
        "نطاق فرع السوق",
        "على جهازه عملٌ لم يُرفع",
        "اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً",
        "ارفع المعلّق أولاً ثم اسحب — دقيقتان تقريباً",
        "اسحب فوراً وامحُ بيانات الجهاز — سرقة أو فقد",
        "الخيار الأوسط هو الصحيح في أغلب الحالات، وليس هو الافتراضي — لأن السحب العاجل حالةٌ حقيقية أيضاً، والاختيار للمالك لا لنا.",
        "مدير الفرع يسحب في فرعه",
        "يسحب وصول موظف عن فرعه، ولا يسحب المستخدم من المنشأة كلها ولا يمحو جهازاً.",
        "الحدّ",
        "السحب من المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان عهدةً — للمالك وحده.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="ORG-05"]');
    await expect(root).toContainText("7 عمليات معلّقة");
    await expect(root).toContainText("يبقى في فرع النور");
    // لا افتراضي: التأكيد معطّل حتى الاختيار
    await expect(page.getByRole("button", { name: "تأكيد السحب" })).toBeDisabled();
    await page.getByLabel("ارفع المعلّق أولاً ثم اسحب — دقيقتان تقريباً").check();
    await page.getByLabel("السبب — اختياري").fill("ترك العمل");
    await page.getByRole("button", { name: "تأكيد السحب" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-05",
      state: "success",
      texts: fromFrame("ORG-05", "success", [
        "سُحب الوصول",
        "لا اختفاء صامت",
        "الموظف يرى على جهازه رسالةً تقول إن وصوله سُحب — لا شاشةَ خطأٍ غامضة يظنّها عطباً فيتصل بالدعم",
        "في سجل التدقيق",
        "باسم من سحب ووقته وسببه إن كُتب. السحب فعلٌ يُراجَع لاحقاً كغيره.",
      ]),
    });
    await expect(root).toContainText("قابلة للاسترداد من شاشة «الاسترداد».");
    expect(posted).toMatchObject({ action: "disable", mode: "after_upload", reason: "ترك العمل" });
  });

  test("validation_error: وردية مفتوحة باسمه — إجراء محجوب؛ الحذف غير متاح", async ({
    page,
  }, info) => {
    await page.route("**/api/org/users/u3/revocation", (route) =>
      route.fulfill(
        json(
          200,
          base({
            user: { ...base().user, display_name: "الكاشير 2" },
            ledger: {
              invoices: 2140,
              shifts: 212,
              open_shift: { id: "s1", opened_at: daysAgo(3), branch_name: "فرع بحري" },
            },
            blockers: ["open_shift"],
          }),
        ),
      ),
    );
    await login(page, "/org/users/u3/revoke");
    await expectFrame(page, info, {
      screenId: "ORG-05",
      state: "validation_error",
      texts: fromFrame("ORG-05", "validation_error", [
        "إجراء محجوب",
        "تعطيل حساب «الكاشير 2»",
        "قبل التعطيل نعرض ما يتعلّق به ولا يزال مفتوحاً",
        "تعطيل الدخول فوراً",
        "حذف الحساب — غير متاح",
        "نقل ملكية المنشأة",
        "أخطر إجراء في النظام: ينقل الدفتر كله ومعه الذمم والأجهزة والاشتراك.",
        "لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع.",
        "يوقف",
        "مانع",
        "يبقى",
        "أفعاله في سجل التدقيق",
        "بما فيها ما اعتُمد له وما رُفض. لا تنظيف للسجل عند الخروج.",
      ]),
    });
    const root = page.locator('[data-screen="ORG-05"]');
    await expect(root).toContainText("وردية مفتوحة منذ 3 أيام باسمه");
    await expect(root).toContainText("2,140 فاتورة و212 وردية باسمه");
    await expect(page.getByRole("button", { name: "تعطيل الدخول فوراً" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "حذف الحساب — غير متاح" })).toBeDisabled();
  });

  test("pending_sync: تعطيل موظف على جهاز مشترك لا يوقف البقية ولا يُمحى معلّقه", async ({
    page,
  }, info) => {
    await page.route("**/api/org/users/u3/revocation", (route) => {
      if (route.request().method() === "POST")
        return route.fulfill(
          json(200, { action: "disable", sessions_ended: 0, sessions_deferred: 1, ...base() }),
        );
      return route.fulfill(
        json(
          200,
          base({
            user: { ...base().user, display_name: "محمد ب." },
            devices: [
              {
                id: "d2",
                name: "الكاشير 2",
                branch_name: "فرع بحري",
                status: "active",
                pending: 2,
                shared_with: ["سميرة ع.", "عثمان ك."],
              },
            ],
            pending_total: 2,
          }),
        ),
      );
    });
    await login(page, "/org/users/u3/revoke");
    await expectFrame(page, info, {
      screenId: "ORG-05",
      state: "pending_sync",
      texts: fromFrame("ORG-05", "pending_sync", [
        "معلّق المزامنة",
        "تعطيل المستخدم فقط",
        "إلغاء",
        "تعطيل المستخدم",
        "الجهاز يعمل · المستخدمون الآخرون يعملون",
        "سحب نطاق فرع",
        "يبقى الحساب نشطاً لكن يفقد الوصول إلى فرع بعينه — يُستعمل عند نقل موظف.",
        "يعمل في فروعه الأخرى",
        "إلغاء الجهاز",
        "يمحو حالة الجهاز نفسه ويقطعه عن المنشأة — يُستعمل عند ضياع أو سرقة الجهاز.",
        "يوقف كل من يعمل عليه · يحتاج استرداد المعلّق أولاً",
      ]),
    });
    const root = page.locator('[data-screen="ORG-05"]');
    await expect(root).toContainText("تعطيل محمد ب.");
    await expect(root).toContainText("جهاز مشترك مع سميرة ع. وعثمان ك.");
    await expect(root).toContainText("عمليتان معلقتان");
    await expect(root).toContainText("يواصلون العمل على الجهاز نفسه بلا انقطاع.");
    // «تعطيل المستخدم فقط» يعود إلى نموذج السحب بالخيار الأول محدَّداً
    await page.getByRole("button", { name: "تعطيل المستخدم فقط" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(
      page.getByLabel("اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً"),
    ).toBeChecked();
  });

  test("permission_denied: مدير الفرع يسحب في فرعه فقط", async ({ page }, info) => {
    await page.route("**/api/org/users/u3/revocation", (route) =>
      route.fulfill(
        json(200, base({ can: { disable_user: false, revoke_branch: false, wipe_device: false } })),
      ),
    );
    await login(page, "/org/users/u3/revoke");
    await expectFrame(page, info, {
      screenId: "ORG-05",
      state: "permission_denied",
      texts: fromFrame("ORG-05", "permission_denied", [
        "مدير الفرع يسحب في فرعه",
        "يسحب وصول موظف عن فرعه، ولا يسحب المستخدم من المنشأة كلها ولا يمحو جهازاً.",
        "الحدّ",
        "السحب من المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان عهدةً — للمالك وحده.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تأكيد السحب" })).toHaveCount(0);
  });
});
