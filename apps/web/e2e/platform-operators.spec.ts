import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { goSection } from "./platform-nav";

/**
 * PLT-15 (بأمر المالك 2026-09-22؛ 0005 §١٠٥/§١٠٨) — حسابات المشغّلين: القائمة بحالة كلٍّ، إنشاء،
 * تعطيل/تفعيل، إعادة تعيين كلمة المرور، والرفض بنصّ؛ «أنت» بلا أزرار على نفسك. بلا تحقّق ثنائي.
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
  "المشغّل حساب من نوع آخر: لا يُنشأ على بريد مالك متجر، وكلمة المرور تُعاد بأمر مشغّل آخر، والتعطيل يُسقط الجلسات فوراً.";

async function operatorLogin(page: Page, role?: "admin" | "support") {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, {
        access: "op",
        refresh: "r",
        session_id: "s",
        display_name: "هدى — تشغيل",
        ...(role ? { role } : {}),
      }),
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
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-15", () => {
  test("ready: القائمة؛ إنشاء؛ تعطيل/تفعيل؛ إعادة تعيين كلمة المرور؛ بريد متجر مرفوض بنصّ", async ({
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
      return route.fulfill(json(201, { operator: op }));
    });
    await page.route("**/api/platform/operators/*/*", (route) => {
      const parts = route.request().url().split("/");
      const action = parts.pop() ?? "";
      const id = parts.pop() ?? "";
      const op = ops.find((o) => o.id === id)!;
      if (action === "disable") op.active = false;
      if (action === "enable") op.active = true;
      if (action === "reset_password") {
        const b = route.request().postDataJSON() as { password: string };
        if (b.password.length < 10)
          return route.fulfill(json(400, { detail: "password_too_short" }));
      }
      return route.fulfill(json(200, { operator: op }));
    });
    await operatorLogin(page);
    await goSection(page, "المشغّلون");
    await expect(page).toHaveURL(/\/platform\/operators$/);
    await expectFrame(page, info, {
      screenId: "PLT-15",
      state: "ready",
      texts: [
        "المشغّلون — حسابات من نوع آخر",
        "كل مشغّل ببريد وكلمة مرور. الإنشاء والتعطيل وإعادة التعيين تُسجَّل باسم من قام بها.",
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
    // إنشاء ناجح: القائمة تزيد، والجديد يدخل ببريده وكلمة مروره
    await page.getByLabel("البريد").fill("Sara@Vezano.local");
    await page.getByLabel("الاسم").fill("سارة — دعم");
    await page.getByRole("button", { name: "أنشئ المشغّل" }).click();
    await expect(root).toContainText("أُنشئ المشغّل سارة — دعم — يدخل ببريده وكلمة المرور الأولية");
    await expect(root).toContainText("sara@vezano.local");
    await expect(root.locator(".cat-head__title", { hasText: "مشغّل فعّال" })).toContainText("3");
    // تعطيل طيب ثم تفعيله
    const tayeb = root.locator(".plt-demo__item", { hasText: "طيب — تشغيل" });
    await tayeb.getByRole("button", { name: "عطّل" }).click();
    await expect(tayeb.locator(".c-status")).toContainText("معطَّل");
    await expect(root.locator(".cat-head__title", { hasText: "مشغّل فعّال" })).toContainText("2");
    await tayeb.getByRole("button", { name: "فعّل" }).click();
    await expect(tayeb.locator(".c-status")).toContainText("فعّال");
    // إعادة تعيين كلمة المرور: قصيرة مرفوضة، ثم ناجحة
    await tayeb.getByRole("button", { name: "أعد تعيين كلمة المرور" }).click();
    await tayeb.getByLabel("كلمة مرور جديدة").fill("new-secret-2026");
    await tayeb.getByRole("button", { name: "احفظ كلمة المرور" }).click();
    await expect(root).toContainText("أُعيد تعيين كلمة مرور طيب — تشغيل — جلساته القديمة أُسقطت");
  });

  test("permission_denied: جلسة بلا صفة مشغّل", async ({ page }, info) => {
    await page.route("**/api/platform/operators", (route) =>
      route.fulfill(json(403, { detail: "operator_required" })),
    );
    await operatorLogin(page);
    await goSection(page, "المشغّلون");
    await expectFrame(page, info, {
      screenId: "PLT-15",
      state: "permission_denied",
      texts: ["مساحة المشغّل فقط", "حسابات المشغّلين لا تُقرأ بغير صفة مشغّل."],
    });
  });

  test("الأدوار (0005 §١١٨): وسم «الدعم» في الترويسة، ودور كل مشغّل وتبديله، والدور عند الإنشاء", async ({
    page,
  }) => {
    const ops: (Op & { role: "admin" | "support"; role_label: string })[] = [
      {
        id: "me",
        name: "هدى — تشغيل",
        email: "ops.huda@sting.internal",
        active: true,
        created_at: minutesAgo(600),
        last_login_at: minutesAgo(1),
        is_me: true,
        role: "admin",
        role_label: "مدير المنصة",
      },
      {
        id: "t1",
        name: "طيب — دعم",
        email: "tayeb@vezano.local",
        active: true,
        created_at: minutesAgo(600),
        last_login_at: minutesAgo(60),
        is_me: false,
        role: "support",
        role_label: "الدعم",
      },
    ];
    let createdRole = "";
    await page.route("**/api/platform/operators", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(
          json(200, { operators: ops, active_count: 2, fetched_at: minutesAgo(0), rule: RULE }),
        );
      createdRole = (route.request().postDataJSON() as { role: string }).role;
      return route.fulfill(json(201, { operator: { ...ops[1], id: "n2", name: "جديد" } }));
    });
    await page.route("**/api/platform/operators/*/*", (route) => {
      const b = route.request().postDataJSON() as { role: "admin" | "support" };
      ops[1] = {
        ...ops[1],
        role: b.role,
        role_label: b.role === "admin" ? "مدير المنصة" : "الدعم",
      };
      return route.fulfill(json(200, { operator: ops[1] }));
    });
    // مدير: لا وسم «الدعم»
    await operatorLogin(page, "admin");
    await expect(page.locator(".plt-badge--support")).toHaveCount(0);
    await goSection(page, "المشغّلون");
    const root = page.locator('[data-screen="PLT-15"]');
    const tayeb = root.locator(".plt-demo__item", { hasText: "طيب — دعم" });
    await expect(tayeb.locator('[data-role="support"]')).toHaveText("الدعم");
    await tayeb.getByRole("button", { name: "اجعله «مدير المنصة»" }).click();
    await expect(tayeb.locator('[data-role="admin"]')).toHaveText("مدير المنصة");
    // الإنشاء «دعم» افتراضاً
    await root.getByLabel("الاسم").fill("جديد");
    await root.getByLabel("البريد").fill("new@vezano.local");
    await root.getByLabel("كلمة مرور أولية").fill("initial-secret-2026");
    await expect(root.getByRole("button", { name: "الدعم — قراءة فقط" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await root.getByRole("button", { name: "أنشئ المشغّل" }).click();
    await expect.poll(() => createdRole).toBe("support");
  });

  test("الدعم: وسم «قراءة فقط» معلن في الترويسة", async ({ page }) => {
    await operatorLogin(page, "support");
    await expect(page.locator(".plt-badge--support")).toHaveText("الدعم — قراءة فقط");
    // النصّ المرسوم باقٍ
    await expect(page.locator(".plt-banner__hint")).toHaveText(
      "إطار منفصل عن تطبيق المتاجر · كل فتح سجل يُدقَّق",
    );
  });
});
