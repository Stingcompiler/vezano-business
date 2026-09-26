import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * إيصال الاشتراك (بأمر المالك 2026-09-22؛ 0005 §١١١) — الإثبات المعتمد يحمل رابط الإيصال في
 * سجل الاشتراك، وصفحة الإيصال تعرض الرقم والمنشأة والباقة والدورة والفترة والمبلغ ومن اعتمده، مع
 * زرّ الطباعة؛ للمالك فقط. بلا إطار مرسوم → بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const RECEIPT = {
  id: "rc1",
  number: "SR-2026-000007",
  tenant_name: "بقالة النيل",
  plan_code: "dual",
  plan_name: "فرعان",
  cycle: "quarterly",
  cycle_label: "ربعي",
  amount_minor: "23500000",
  currency: "SDG",
  reference: "TRX-55712",
  period_from: "2026-10-23T00:00:00Z",
  period_to: "2027-01-21T00:00:00Z",
  issued_at: "2026-09-22T09:30:00Z",
  issued_by_name: "هدى — تشغيل",
  proof_id: "p1",
  issuer: { name: "فيزانو بلص", legal: "[الاسم القانوني للمزوّد]", contact: "[البريد الرسمي]" },
  note: "إيصال اشتراك — ليس فاتورة ضريبية. يثبت استلام المبلغ عن الفترة المذكورة.",
};
const PROOF = {
  id: "p1",
  reference: "TRX-55712",
  plan_code: "dual",
  amount_minor: "23500000",
  period_label: "ربعي من أكتوبر",
  cycle: "quarterly",
  cycle_label: "ربعي",
  image_name: "",
  image_size: 0,
  has_image: false,
  status: "approved",
  submitted_at: "2026-09-01T10:14:00Z",
  // قرار أقدم من أسبوع — نموذج الرفع يظهر والإيصال في سجل الاشتراك
  reviewed_at: "2026-09-02T09:30:00Z",
  reviewed_by_name: "هدى — تشغيل",
  rejection_reason: "",
  extension_days: 90,
  receipt: { id: "rc1", number: "SR-2026-000007" },
};
const DUE = {
  plan_code: "dual",
  plan_name: "فرعان",
  amount_minor: "8500000",
  currency: "SDG",
  period_label: "نوفمبر",
  review_sla: "يوم عمل واحد",
  cycle: "monthly",
  cycles: [
    { cycle: "monthly", label: "شهري", days: 30, amount_minor: "8500000", available: true },
    { cycle: "quarterly", label: "ربعي", days: 90, amount_minor: "23500000", available: true },
    { cycle: "yearly", label: "سنوي", days: 365, amount_minor: "85000000", available: true },
  ],
};

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

test.describe("إيصال الاشتراك", () => {
  test("الإثبات المعتمد يحمل رابط الإيصال؛ الصفحة تعرض كل بنوده وزرّ الطباعة؛ حبّات الدورة تغيّر المستحق", async ({
    page,
  }, info) => {
    await page.route("**/api/org/subscription/proofs", (route) =>
      route.fulfill(
        json(200, { due: DUE, proofs: [PROOF], can_submit: true, review_sla: "يوم عمل واحد" }),
      ),
    );
    await page.route("**/api/org/subscription/receipts/rc1", (route) =>
      route.fulfill(json(200, { receipt: RECEIPT })),
    );
    await login(page, "/org/subscription/renew");
    const renew = page.locator('[data-screen="ORG-07"]');
    await expect(renew).toContainText("SR-2026-000007");
    // حبّة السنوي تغيّر المستحق المعروض
    await page.getByRole("button", { name: /سنوي/ }).click();
    await expect(renew).toContainText("850,000.00");
    await page.getByRole("link", { name: /الإيصال/ }).click();
    await expect(page).toHaveURL(/\/org\/subscription\/receipts\/rc1$/);
    await expectFrame(page, info, {
      screenId: "ORG-07",
      state: "ready",
      texts: [
        "إيصال اشتراك",
        "SR-2026-000007",
        "فيزانو",
        "بقالة النيل",
        "فرعان · ربعي",
        "TRX-55712",
        "هدى — تشغيل",
        "المبلغ المستلم",
        "235,000.00 SDG",
        "ليس فاتورة ضريبية",
        "اطبع / احفظ PDF",
      ],
    });
  });

  test("permission_denied: المدير لا يرى الإيصال", async ({ page }, info) => {
    await page.route("**/api/org/subscription/receipts/rc1", (route) =>
      route.fulfill(json(403, { detail: "owner_required" })),
    );
    await login(page, "/org/subscription/receipts/rc1");
    await expectFrame(page, info, {
      screenId: "ORG-07",
      state: "permission_denied",
      texts: ["للمالك فقط", "إيصالات الاشتراك يراها مالك المنشأة."],
    });
  });
});
