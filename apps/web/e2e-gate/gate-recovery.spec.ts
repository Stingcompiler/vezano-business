import { expect, test } from "@playwright/test";

import {
  addSugar,
  goHome,
  nav,
  newDevice,
  openShift,
  pendingCount,
  pickCustomer,
  resetScenario,
  saveCredit,
  setFault,
  statement,
  syncNow,
} from "./fixtures";

/** بوابة T1.43 — المصالحة والاستعادة (§١٥.٤) على خادم حقيقي. */
test.describe("البوابة — المصالحة والاستعادة", () => {
  test("ACC-07 — لقطة أثناء البيع: تجميد المصالحة ثم بيع محلي إضافي → المجموع لا يتضاعف ولا يختفي عند التفعيل", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    await saveCredit(a.page);
    await syncNow(a.page);
    // الخادم يجمّد المصالحة: ما يُرفع الآن لا يُطبَّق ويبقى معلّقاً على الجهاز
    await setFault(request, "freeze_reconciliation", true);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    await saveCredit(a.page);
    await expect.poll(() => pendingCount(a.page)).toBeGreaterThanOrEqual(1);
    // المعلّق يظهر في الكشف فوراً «معلّق هذا الجهاز» والرصيد المركّب 200
    await statement(a.page);
    const root = a.page.locator('[data-screen="PTY-05"]');
    await expect(root).toContainText("200.00");
    await setFault(request, "freeze_reconciliation", false);
    await syncNow(a.page);
    await statement(a.page);
    await expect(root).toContainText("200.00");
    await expect(root.locator("tbody tr")).toHaveCount(2);
    await expect(root).not.toContainText("300.00");
    await a.context.close();
  });

  test("ACC-73 — استعادة نسخة مرتين على جهاز بديل: لا تكرار، الأصل باقٍ، وهوية جديدة للكتابات الجديدة", async ({
    browser,
    request,
  }) => {
    await resetScenario(request);
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    await saveCredit(a.page);
    await syncNow(a.page);
    // تصدير نسخة محلية من الجهاز الأول (كلمة حماية → AES-GCM)
    await goHome(a.page);
    await nav(a.page, "نسخة محلية", /\/sync\/backup$/);
    await a.page.getByLabel("كلمة الحماية").fill("sting-2026");
    const download = a.page.waitForEvent("download");
    await a.page.getByRole("button", { name: "حفظ بكلمة حماية" }).click();
    const d = await download;
    const fs = await import("node:fs/promises");
    const file = {
      name: d.suggestedFilename(),
      text: await fs.readFile(await d.path(), "utf8"),
    };
    await a.context.close();

    // جهاز بديل: يستعيد الملف مرتين
    const b = await newDevice(browser, "B");
    const restore = async () => {
      await goHome(b.page);
      await nav(b.page, "استعادة", /\/sync\/restore$/);
      await b.page.getByLabel("ملف النسخة").setInputFiles({
        name: file.name,
        mimeType: "application/json",
        buffer: Buffer.from(file.text, "utf8"),
      });
      await b.page.getByLabel("كلمة الحماية").fill("sting-2026");
      await b.page.getByRole("button", { name: "فتح الملف ومعاينته" }).click();
      const root = b.page.locator('[data-screen="SYS-06"]');
      await expect(root).toHaveAttribute("data-state", /ready|conflict/);
      if ((await root.getAttribute("data-state")) === "conflict")
        await b.page.getByRole("button", { name: "متابعة الاستعادة", exact: true }).click();
      return root;
    };
    let root = await restore();
    await expect(root).toContainText(/ستُضاف [1-9]\d* فاتورة/);
    await b.page.getByRole("button", { name: "استعادة الآن" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    root = await restore();
    await expect(root).toContainText("ستُضاف 0 فاتورة");
    await b.page.getByRole("button", { name: "استعادة الآن" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    // الأصل باقٍ والخادم لا يتكرر فيه شيء: كشف العميل من الجهاز البديل بعد مزامنته
    await syncNow(b.page);
    await statement(b.page);
    const st = b.page.locator('[data-screen="PTY-05"]');
    await expect(st).toContainText("100.00");
    await expect(st.locator("tbody tr")).toHaveCount(1);
    // كتابة جديدة على الجهاز البديل تأخذ هوية جديدة ولا تصطدم بالمستعاد
    await openShift(b.page);
    await addSugar(b.page, "1");
    await pickCustomer(b.page);
    await saveCredit(b.page);
    await syncNow(b.page);
    await statement(b.page);
    await expect(st).toContainText("200.00");
    await expect(st.locator("tbody tr")).toHaveCount(2);
    await b.context.close();
  });
});
