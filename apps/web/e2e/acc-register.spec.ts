import { expect, type Page, test } from "@playwright/test";

/**
 * التسجيل (ACC-02): بالبريد وحده حتى تُربط قناة الهاتف (0005 §١٤٩)، ورقم واتساب إلزامي للتواصل لا للتحقق
 * (§١٥٠) — يُرسل مع إنشاء الحساب، وإن رفضه الخادم عاد المستخدم إلى خطوته ليصحّحه.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function fillForm(page: Page, email: string, phone: string) {
  await page.goto("/register");
  const root = page.locator('[data-screen="ACC-02"]');
  await root.getByLabel("اسمك").fill("عثمان");
  await root.getByLabel("بريدك").fill(email);
  await root.getByLabel("رقم واتساب").fill(phone);
  await root.getByRole("button", { name: "أرسل رمز التحقق" }).click();
  return root;
}

test.describe("ACC-02 · التسجيل", () => {
  test("بريد ورقم واتساب ← رمز ← كلمة مرور؛ الرقم يُرسل مع الحساب", async ({ page }) => {
    let requested = 0;
    const registered: Record<string, unknown>[] = [];
    await page.route("**/api/auth/verify/request", (route) => {
      requested += 1;
      return route.fulfill(
        json(202, {
          policy: { code_length: 6, resend_after_seconds: 60, resends_left: 2 },
          sent_to: "ow•••@example.com",
        }),
      );
    });
    await page.route("**/api/scenario/verification-code**", (route) =>
      route.fulfill(json(404, {})),
    );
    await page.route("**/api/auth/verify/confirm", (route) =>
      route.fulfill(json(200, { verified_ticket: "t1" })),
    );
    let reject = true;
    await page.route("**/api/auth/account/register", (route) => {
      registered.push(route.request().postDataJSON() as Record<string, unknown>);
      if (reject) {
        reject = false;
        return route.fulfill(json(400, { detail: "phone_invalid" }));
      }
      return route.fulfill(json(201, { select_ticket: "s1", memberships: [] }));
    });

    // الهاتف معرّفاً مرفوض قبل أي طلب، والرقم القصير كذلك
    let root = await fillForm(page, "0912345678", "0912345678");
    await expect(root).toContainText("التسجيل بالبريد");
    root = await fillForm(page, "owner@example.com", "0912");
    await expect(root).toContainText("اكتب رقم واتساب صحيحاً");
    expect(requested).toBe(0);

    await root.getByLabel("رقم واتساب").fill("0912 345 678");
    await root.getByRole("button", { name: "أرسل رمز التحقق" }).click();
    const boxes = page.locator(".acc-code__box");
    await expect(boxes).toHaveCount(6);
    for (const [i, d] of [..."123456"].entries()) await boxes.nth(i).fill(d);
    await root.getByRole("button", { name: "تأكيد الرمز" }).click();
    await root.getByRole("textbox", { name: "كلمة المرور", exact: true }).fill("long-enough-1");
    await root.getByRole("textbox", { name: "تأكيد كلمة المرور" }).fill("long-enough-1");
    await root.getByRole("button", { name: "أنشئ الحساب وتابع إلى المنشأة" }).click();
    // رفض الخادم للرقم يعيد إلى الخطوة الأولى حيث حقله
    await expect(root.getByLabel("رقم واتساب")).toBeVisible();
    await expect(root).toContainText("اكتب رقم واتساب صحيحاً");
    expect(registered.at(-1)).toMatchObject({ verified_ticket: "t1", phone: "0912 345 678" });
  });
});
