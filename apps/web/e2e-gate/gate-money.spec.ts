import { expect, test } from "@playwright/test";

import {
  addSugar,
  goPos,
  nav,
  newDevice,
  openInvoice,
  openShift,
  pickCustomer,
  resetScenario,
  saveCash,
  saveMixed,
  setFault,
  shiftScreen,
  statement,
  stockScreen,
  syncNow,
} from "./fixtures";

/** بوابة T1.43 — أموال ومخزون وطباعة (§١٥.٤) على خادم حقيقي. */
test.describe("البوابة — الأموال والمخزون", () => {
  test("ACC-09 — بيع ومرتجع: بيع نقدي 100 لكيلو ثم مرتجع صالح كامل نقداً → مخزون 10 وصندوق 0 وذمة 0", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    const number = await saveCash(a.page);
    await syncNow(a.page);
    expect(await stockScreen(a.page)).toMatch(/9(\.000)?/);
    await openInvoice(a.page, number);
    await a.page.getByRole("button", { name: "مرتجع كلي أو جزئي" }).click();
    await expect(a.page).toHaveURL(/\/return$/);
    await a.page.getByRole("button", { name: "زيادة سكر" }).click();
    await a.page.getByLabel("نقداً من الصندوق").check();
    await a.page.getByRole("button", { name: "تسجيل المرتجع" }).click();
    await expect(a.page.locator('[data-screen="POS-10"]')).toHaveAttribute("data-state", "success");
    await syncNow(a.page);
    const stock = await stockScreen(a.page);
    expect(stock).toContain("سكر");
    expect(stock).toMatch(/10(\.000)?/);
    const shift = await shiftScreen(a.page);
    // الصندوق صفر: بيع نقدي 100 ثم مرتجع نقدي −100 على نفس الفاتورة، والمتوقع في الدرج 0.00
    expect(shift).toMatch(/النقد المتوقع في الدرج\s*0\.00/);
    expect(shift).toContain("مرتجع نقدي");
    expect(shift).toContain("−100.00");
    expect(shift).toContain(number);
    // الذمة صفر: العميل بلا حركة آجلة
    await statement(a.page);
    await expect(a.page.locator('[data-screen="PTY-05"]')).not.toContainText("بيع آجل");
    await a.context.close();
  });

  test("ACC-08 — بيع مختلط 100 = 40 نقداً + 60 آجلاً → مخزون 9 وصندوق 40 ودين 60 — قبل المزامنة وبعدها", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    await saveMixed(a.page, "40", "60");
    const check = async () => {
      const shift = await shiftScreen(a.page);
      expect(shift).toContain("40.00");
      await statement(a.page);
      await expect(a.page.locator('[data-screen="PTY-05"]')).toContainText("60.00");
      expect(await stockScreen(a.page)).toMatch(/9(\.000)?/);
    };
    await check();
    await syncNow(a.page);
    await check();
    await a.context.close();
  });

  test("ACC-84 — فشل الطباعة: طباعة بيع ثم قطع الطابعة وإعادة طباعة → بيع واحد ونفس الرقم ونسخة معلّمة", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    const number = await saveCash(a.page);
    await a.page.evaluate(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await a.page.getByRole("button", { name: "طباعة الإيصال" }).click();
    await expect(a.page).toHaveURL(/\/pos\/receipt\//);
    await a.page.getByRole("button", { name: "طباعة الإيصال" }).click();
    await expect(a.page.getByRole("button", { name: "إعادة طباعة نسخة" })).toBeVisible();
    // قطع طاقة الطابعة
    await setFault(request, "printer_fail", true);
    await a.page.getByRole("button", { name: "إعادة طباعة نسخة" }).click();
    const root = a.page.locator('[data-screen="POS-08"]');
    await expect(root).toContainText("حُفظ البيع — لم تتم الطباعة");
    await setFault(request, "printer_fail", false);
    await a.page.getByRole("button", { name: "إعادة محاولة الطباعة" }).click();
    await expect(root).not.toContainText("حُفظ البيع — لم تتم الطباعة");
    await expect(root.locator(".c-print__copy")).toHaveText("نسخة");
    expect(await a.page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(
      2,
    );
    // بيع واحد بنفس الرقم على الخادم وفي القائمة
    await syncNow(a.page);
    await openInvoice(a.page, number);
    await goPos(a.page);
    await nav(a.page, "الفواتير", /\/pos\/invoices$/);
    await expect(a.page.locator("tbody tr", { hasText: "INV-" })).toHaveCount(1);
    await a.context.close();
  });
});
