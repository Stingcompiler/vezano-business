import { expect, test } from "@playwright/test";

import {
  addSugar,
  newDevice,
  openShift,
  resetScenario,
  saveCash,
  setFault,
  syncNow,
} from "./fixtures";

/**
 * بوابة المرحلة ٢ — الصفحات العامة: ACC-114 تعطل المزامنة والإشعارات → البيع المحلي مستمر وحالة
 * الخدمة تُنشر بمكوّناتها وإعلان الصيانة (صفحة تقرأ الخادم ولا تعتمد عليه)؛ ACC-60 رابط لمنشأة
 * أخرى أو لا وجود له → الصفحة نفسها بالحرف بلا تسريب وجود المستند.
 */
test.describe("البوابة — الصفحات العامة", () => {
  test("ACC-114 — تجميد المصالحة وصيانة معلنة: صفحة الحالة تقول «متأثر» وتعلن الصيانة، والجهاز يبيع محلياً ويرفع بعد العودة", async ({
    browser,
    request,
    page,
  }) => {
    await resetScenario(request);
    // الجهاز يفتح ورديته قبل التعطل ثم يبيع أثناءه
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await setFault(request, "freeze_reconciliation", true);
    await setFault(request, "maintenance", true);
    await page.goto("/status");
    const root = page.locator('[data-screen="PUB-03"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("تعطل جزئي");
    await expect(root).toContainText("صيانة مجدولة");
    await expect(root.locator(".pb-service", { hasText: "المزامنة" })).toContainText(
      "متوقفة جزئياً",
    );
    await expect(root.locator(".pb-service", { hasText: "البيع على الأجهزة" })).toContainText(
      "يعمل",
    );
    await expect(root).toContainText("تأكيد التعطل في المزامنة");
    // البيع المحلي مستمر رغم التعطل — محفوظ عندك حتى العودة
    await addSugar(a.page, "1");
    const number = await saveCash(a.page);
    expect(number).toMatch(/^INV-/);
    // العودة: كل الخدمات تعمل، والمعلّق يُرفع
    await setFault(request, "freeze_reconciliation", false);
    await setFault(request, "maintenance", false);
    await syncNow(a.page);
    await page.getByRole("button", { name: "أعد الفحص" }).click();
    await expect(root).toContainText("كل الخدمات تعمل");
    await a.context.close();
  });

  test("ACC-60 — رابط لا وجود له ورابط بصيغة رابط منشأة أخرى: الصفحة نفسها بالحرف، لا «موجود لكن ممنوع»", async ({
    page,
    request,
  }) => {
    await resetScenario(request);
    const texts: string[] = [];
    for (const token of ["nope-does-not-exist", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]) {
      await page.goto(`/api/parties/exports/${token}`);
      await expect(page).toHaveURL(/\/link-expired$/);
      const root = page.locator('[data-screen="PUB-04"][data-state="expired"]');
      await expect(root).toContainText("الرابط لم يعد صالحاً");
      await expect(root).toContainText("لا نقول إن كان موجوداً أصلاً");
      texts.push((await root.innerText()).replace(/\s+/g, " "));
    }
    expect(texts[0]).toBe(texts[1]);
    // البرامج: 404 بلا تفصيل
    const r = await request.get("/api/parties/exports/nope-does-not-exist", {
      headers: { Accept: "application/json" },
    });
    expect(r.status()).toBe(404);
  });
});
