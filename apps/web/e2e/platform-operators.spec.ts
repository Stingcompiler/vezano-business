import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * PLT-15 (بأمر المالك 2026-09-22؛ 0005 §١٠٥) — حسابات المشغّلين: القائمة بحالة كلٍّ، إنشاء بسرّ
 * TOTP يُعرض مرة واحدة، تعطيل/تفعيل، إعادة تعيين، والرفض بنصّ؛ «أنت» بلا أزرار على نفسك.
 * بلا إطار مرسوم → بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Op = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  created_at: string;
  last_login_at: string;
  is_me: boolean;
};
const RULE =
  "المشغّل حساب من نوع آخر: لا يُنشأ على بريد مالك متجر، وسرّ التحقّق الثنائي يُعرض مرة واحدة، والتعطيل يُسقط الجلسات فوراً.";

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
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
  await page.getByLabel("2FA").fill("123456");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-15", () => {
  test("ready: القائمة؛ إنشاء يعرض السرّ مرة؛ تعطيل/تفعيل؛ إعادة تعيين؛ بريد متجر مرفوض بنصّ", async ({
    page,
  }, info) => {
    let ops: Op[] = [
      {
        id: "me",
        name: "هدى — تشغيل",
        email: "ops.huda@sting.internal",
        active: true,
        created_at: minutesAgo(60 * 24 * 90),
        last_login_at: minutesAgo(1),
        is_me: true,
      },
      {
        id: "t1",
        name: "طيب — تشغيل",
        email: "tayeb@vezano.local",
        active: true,
        created_at: minutesAgo(60 * 24 * 30),
        last_login_at: minutesAgo(60 * 5),
        is_me: false,
      },
    ];
    const payload = () => ({
      operators: ops,
      active_count: ops.filter((o) => o.active).length,
      fetched_at: new Date().toISOString(),
      rule: RULE,
    });
    await page.route("**/api/platform/operators", (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, payload()));
      const b = route.request().postDataJSON() as { name: string; email: string; password: string };
      if (b.email === "owner@shop.example")
        return route.fulfill(json(409, { detail: "tenant_account_email" }));
      const op: Op = {
        id: "n1",
        name: b.name,
        email: b.email.toLowerCase(),
        active: true,
        created_at: new Date().toISOString(),
        last_login_at: "",
        is_me: false,
      };
      ops = [...ops, op];
      return route.fulfill(
        json(201, {
          operator: {
            ...op,
            totp_secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
            otpauth_uri: `otpauth://totp/Vezano%20Ops:${op.email}?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Vezano%20Ops`,
          },
        }),
      );
    });
    await page.route("**/api/platform/operators/*/*", (route) => {
      const parts = route.request().url().split("/");
      const action = parts.pop() ?? "";
      const id = parts.pop() ?? "";
      const op = ops.find((o) => o.id === id)!;
      if (action === "disable") op.active = false;
      if (action === "enable") op.active = true;
      const extra =
        action === "reset_totp"
          ? {
              totp_secret: "NEWSECRET2345NEWSECRET2345",
              otpauth_uri: "otpauth://totp/x?secret=NEWSECRET2345NEWSECRET2345",
            }
          : {};
      return route.fulfill(json(200, { operator: { ...op, ...extra } }));
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "المشغّلون" }).click();
    await expect(page).toHaveURL(/\/platform\/operators$/);
    await expectFrame(page, info, {
      screenId: "PLT-15",
      state: "ready",
      texts: [
        "المشغّلون — حسابات من نوع آخر",
        "كل مشغّل ببريد وكلمة مرور وتحقّق ثنائي دائم. الإنشاء والتعطيل وإعادة التعيين تُسجَّل باسم من قام بها.",
        "مشغّل فعّال",
        "هدى — تشغيل",
        "أنت",
        "طيب — تشغيل",
        "tayeb@vezano.local",
        "فعّال",
        "مشغّل جديد",
        "الاسم",
        "البريد",
        "كلمة مرور أولية",
        "أنشئ المشغّل",
        RULE,
      ],
    });
    const root = page.locator('[data-screen="PLT-15"]');
    const me = root.locator(".plt-demo__item", { hasText: "هدى — تشغيل" });
    await expect(me.getByRole("button", { name: "عطّل" })).toHaveCount(0);
    // بريد متجر مرفوض بنصّ
    await page.getByLabel("الاسم").fill("مالك");
    await page.getByLabel("البريد").fill("owner@shop.example");
    await page.getByLabel("كلمة مرور أولية").fill("owner-pass-12");
    await page.getByRole("button", { name: "أنشئ المشغّل" }).click();
    await expect(root).toContainText(
      "هذا بريد حساب متجر — المشغّل حساب من نوع آخر ولا يُنشأ عليه.",
    );
    // إنشاء ناجح: السرّ مرة واحدة، والقائمة تزيد
    await page.getByLabel("البريد").fill("Sara@Vezano.local");
    await page.getByLabel("الاسم").fill("سارة — دعم");
    await page.getByRole("button", { name: "أنشئ المشغّل" }).click();
    await expect(root).toContainText(
      "أُنشئ المشغّل سارة — دعم — سرّ التحقّق الثنائي يُعرض الآن فقط",
    );
    await expect(root.locator(".plt-secret")).toContainText("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
    await expect(root).toContainText("sara@vezano.local");
    await expect(root.locator(".cat-head__title", { hasText: "مشغّل فعّال" })).toContainText("3");
    await page.getByRole("button", { name: "أخفِ" }).click();
    await expect(root.locator(".plt-secret")).toHaveCount(0);
    // تعطيل طيب ثم تفعيله
    const tayeb = root.locator(".plt-demo__item", { hasText: "طيب — تشغيل" });
    await tayeb.getByRole("button", { name: "عطّل" }).click();
    await expect(tayeb.locator(".c-status")).toContainText("معطَّل");
    await expect(root.locator(".cat-head__title", { hasText: "مشغّل فعّال" })).toContainText("2");
    await tayeb.getByRole("button", { name: "فعّل" }).click();
    await expect(tayeb.locator(".c-status")).toContainText("فعّال");
    // إعادة تعيين: سرّ جديد مرة واحدة
    await tayeb.getByRole("button", { name: "أعد تعيين التحقّق الثنائي" }).click();
    await expect(root).toContainText("أُعيد تعيين التحقّق الثنائي لـطيب — تشغيل");
    await expect(root.locator(".plt-secret")).toContainText("NEWSECRET2345NEWSECRET2345");
  });

  test("permission_denied: جلسة بلا صفة مشغّل", async ({ page }, info) => {
    await page.route("**/api/platform/operators", (route) =>
      route.fulfill(json(403, { detail: "operator_required" })),
    );
    await operatorLogin(page);
    await page.getByRole("button", { name: "المشغّلون" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-15",
      state: "permission_denied",
      texts: ["مساحة المشغّل فقط", "حسابات المشغّلين لا تُقرأ بغير صفة مشغّل."],
    });
  });
});
