import { expect, test } from "@playwright/test";

import {
  addSugar,
  cutNetwork,
  newDevice,
  openShift,
  pendingCount,
  pickCustomer,
  resetScenario,
  restoreNetwork,
  saveCredit,
  setFault,
  statement,
  syncNow,
} from "./fixtures";

/**
 * بوابة T1.43 — سيناريوهات §١٥.٤ على خادم حقيقي بجهازين (سياقان). الحالة الابتدائية تُعاد قبل كل
 * تجربة: عميل برصيد صفر، مخزون سكر 10، صندوق صفر.
 */
test.describe("البوابة — جهازان والشبكة", () => {
  test("ACC-02/96 — جهازان دون شبكة: بيع آجل 100 من الأول و60 من الثاني ثم مزامنة → 160 بلا تكرار", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    const b = await newDevice(browser, "B");
    for (const d of [a, b]) await openShift(d.page);

    await cutNetwork(a);
    await cutNetwork(b);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    await saveCredit(a.page);
    await addSugar(b.page, "0.6");
    await pickCustomer(b.page);
    await saveCredit(b.page);
    // الدين تكوَّن محلياً على كل جهاز ولم يره الخادم
    await expect(a.page.locator('[data-screen="POS-06"]')).toContainText("آجل بلا اتصال");
    expect(await pendingCount(a.page)).toBeGreaterThanOrEqual(1);
    expect(await pendingCount(b.page)).toBeGreaterThanOrEqual(1);

    await restoreNetwork(a);
    await restoreNetwork(b);
    await syncNow(a.page);
    await syncNow(b.page);
    expect(await pendingCount(a.page)).toBe(0);
    expect(await pendingCount(b.page)).toBe(0);

    // الرصيد 160 من الجهازين بلا تكرار — فاتورتان مؤكدتان لا أكثر
    for (const d of [a, b]) {
      const text = await statement(d.page);
      const root = d.page.locator('[data-screen="PTY-05"]');
      await expect(root).toContainText("160.00");
      await expect(root.locator("tbody tr")).toHaveCount(2);
      expect(text).toContain("بيع آجل");
    }
    await a.context.close();
    await b.context.close();
  });

  test("ACC-05 — انقطاع الرد بعد الحفظ: بيع آجل 100 مع فقد ACK ثم إعادة الرفع → الرصيد يبقى 100", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    // الخادم يطبّق ولا يردّ (محاكاة فقد الإقرار) — الجهاز يظن أن الرفع لم يتم
    await setFault(request, "drop_ack", true);
    await saveCredit(a.page);
    expect(await pendingCount(a.page)).toBeGreaterThanOrEqual(1);
    await setFault(request, "drop_ack", false);
    await syncNow(a.page);
    expect(await pendingCount(a.page)).toBe(0);
    const root = a.page.locator('[data-screen="PTY-05"]');
    await statement(a.page);
    await expect(root).toContainText("100.00");
    await expect(root.locator("tbody tr")).toHaveCount(1);
    await expect(root).not.toContainText("200.00");
    await a.context.close();
  });
});
