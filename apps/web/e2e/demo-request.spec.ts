import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * طلب الجولة ومتابعته (بأمر المالك 2026-10-02؛ 0005 §١٤٧): البريد يُؤكَّد برمز قبل الحفظ، والتكرار
 * يدلّ على صفحة المتابعة، والمتابعة ترسل الرمز إلى بريد الطلب وتعرض الحالة وتعليقات الفريق.
 * نصوص من عند المنفّذ (لا إطار مرسوم) — بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const SENT = {
  sent_to: "ah•••@example.com",
  code_length: 6,
  resend_after_seconds: 60,
  resends_left: 2,
};

async function fillCode(page: Page, code: string) {
  const boxes = page.locator(".acc-code__box");
  await expect(boxes).toHaveCount(code.length);
  for (const [i, d] of [...code].entries()) await boxes.nth(i).fill(d);
}

async function openContact(page: Page) {
  // بلا خادم في المواصفات: الباقات لا تُجلب والهبوط يُعرض بدونها
  await page.goto("/#lp-contact");
  const form = page.locator(".lp__contact");
  await form.getByLabel("اسمك").fill("أحمد الطيب");
  await form.getByLabel("رقم الواتساب").fill("0912345678");
  await form.getByLabel("بريدك").fill("ahmed@example.com");
  return form;
}

test.describe("طلب الجولة", () => {
  test("البريد يُؤكَّد برمز قبل الحفظ، ثم رقم الطلب ورابط المتابعة", async ({ page }) => {
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/public/contact/start", (route) => route.fulfill(json(200, SENT)));
    await page.route("**/api/public/contact", (route) => {
      const b = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(b);
      if (b.code !== "246810")
        return route.fulfill(json(400, { detail: "code_invalid", attempts_left: 4 }));
      return route.fulfill(json(201, { id: "x", reference: "AB12CD", track_url: "/demo/track" }));
    });
    const form = await openContact(page);
    await form.getByRole("button", { name: "اطلب الجولة — مجاناً" }).click();
    await expect(form).toHaveAttribute("data-step", "code");
    await expect(form).toContainText("أرسلنا رمز تأكيد إلى ah•••@example.com");
    await expect(form).toContainText("لا نحفظ شيئاً قبل تأكيد البريد");
    await fillCode(page, "111111");
    await form.getByRole("button", { name: "أكّد وأرسل الطلب" }).click();
    await expect(form).toContainText("الرمز غير صحيح.");
    await expect(page.locator(".acc-code")).toHaveAttribute("data-invalid", "true");
    await fillCode(page, "246810");
    await form.getByRole("button", { name: "أكّد وأرسل الطلب" }).click();
    await expect(form).toHaveAttribute("data-step", "done");
    await expect(form).toContainText("وصل طلبك");
    await expect(form).toContainText("AB12CD");
    expect(posted.at(-1)).toMatchObject({ email: "ahmed@example.com", code: "246810" });
    await form.getByRole("button", { name: "تابع طلبك" }).click();
    await expect(page).toHaveURL(/\/demo\/track$/);
  });

  test("طلب سابق بالبيانات نفسها: تحذير يدلّ على المتابعة بدل طلب جديد", async ({ page }) => {
    await page.route("**/api/public/contact/start", (route) =>
      route.fulfill(json(409, { detail: "duplicate", track_url: "/demo/track" })),
    );
    const form = await openContact(page);
    await form.getByRole("button", { name: "اطلب الجولة — مجاناً" }).click();
    await expect(form).toHaveAttribute("data-step", "duplicate");
    await expect(form).toContainText("طلبك وصلنا من قبل");
    await expect(form).toContainText("تابعه من صفحة المتابعة بدل إرسال طلب جديد");
    await form.getByRole("button", { name: "تابع طلبك" }).click();
    await expect(page).toHaveURL(/\/demo\/track$/);
  });

  test("البريد إلزامي — بلا بريد لا يُطلب رمز", async ({ page }) => {
    let called = false;
    await page.route("**/api/public/contact/start", (route) => {
      called = true;
      return route.fulfill(json(200, SENT));
    });
    const form = await openContact(page);
    await form.getByLabel("بريدك").fill("");
    await form.getByRole("button", { name: "اطلب الجولة — مجاناً" }).click();
    await expect(form).toContainText("البريد مطلوب");
    expect(called).toBe(false);
  });
});

test.describe("متابعة طلب الجولة (PUB-06)", () => {
  test("بحث بالهاتف ← رمز إلى بريد الطلب ← الحالة وتعليقات الفريق، والتحديث بلا رمز جديد", async ({
    page,
  }, info) => {
    const REQ = {
      reference: "AB12CD",
      name: "أحمد الطيب",
      channel_label: "واتساب",
      status: "new",
      status_label: "جديد",
      status_note: "وصل طلبك وينتظر أول تواصل من الفريق.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      email: "ah•••@example.com",
      comments: [] as { body: string; author: string; at: string }[],
    };
    const queries: unknown[] = [];
    await page.route("**/api/public/demo-track/start", (route) => {
      const q = (route.request().postDataJSON() as { query: string }).query;
      queries.push(q);
      if (q === "0900000000") return route.fulfill(json(404, { detail: "not_found" }));
      return route.fulfill(json(200, SENT));
    });
    await page.route("**/api/public/demo-track/verify", (route) =>
      route.fulfill(json(200, { token: "t1", request: REQ })),
    );
    await page.route(/\/api\/public\/demo-track\?token=/, (route) =>
      route.fulfill(
        json(200, {
          request: {
            ...REQ,
            status: "contacted",
            status_label: "تواصلنا",
            status_note: "تواصل الفريق معك أو يرتّب موعد الجولة.",
            comments: [
              {
                body: "سنتصل بك الأحد صباحاً.",
                author: "هدى — تشغيل",
                at: new Date().toISOString(),
              },
            ],
          },
        }),
      ),
    );
    await page.goto("/demo/track");
    const root = page.locator('[data-screen="PUB-06"]');
    await expectFrame(page, info, {
      screenId: "PUB-06",
      state: "ready",
      texts: [
        "طلب الجولة",
        "تابع طلبك",
        "ابحث بالبريد أو رقم الهاتف أو الاسم الذي سجّلت به. نرسل رمز الدخول إلى البريد المسجَّل في الطلب — فلا يرى الطلب غير صاحبه.",
        "البريد أو رقم الهاتف أو الاسم",
        "أرسل رمز الدخول",
      ],
    });
    await root.getByLabel("البريد أو رقم الهاتف أو الاسم").fill("0900000000");
    await root.getByRole("button", { name: "أرسل رمز الدخول" }).click();
    await expect(root).toContainText("لا طلب جولة بهذه البيانات");
    await root.getByLabel("البريد أو رقم الهاتف أو الاسم").fill("0912345678");
    await root.getByRole("button", { name: "أرسل رمز الدخول" }).click();
    await expect(root).toHaveAttribute("data-step", "code");
    await expect(root).toContainText(
      "أرسلنا رمزاً إلى ah•••@example.com — البريد المسجَّل في الطلب.",
    );
    await fillCode(page, "123456");
    await root.getByRole("button", { name: "اعرض طلبي" }).click();
    await expect(root).toHaveAttribute("data-step", "ready");
    await expectFrame(page, info, {
      screenId: "PUB-06",
      state: "ready",
      texts: [
        "طلب رقم",
        "AB12CD",
        "أحمد الطيب",
        "جديد",
        "وصل طلبك وينتظر أول تواصل من الفريق.",
        "تعليقات الفريق",
        "لا تعليقات بعد — سيظهر هنا ما يكتبه الفريق لك عن طلبك.",
        "حدّث الحالة",
      ],
    });
    await root.getByRole("button", { name: "حدّث الحالة" }).click();
    await expect(root.locator(".dt__comments")).toContainText("سنتصل بك الأحد صباحاً.");
    await expect(root.locator(".dt__status")).toContainText("تواصلنا");
    expect(queries).toEqual(["0900000000", "0912345678"]);
  });
});
