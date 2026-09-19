import { expect, test } from "@playwright/test";

import {
  addSugar,
  CASHIER,
  cutNetwork,
  goHome,
  nav,
  newDevice,
  openShift,
  OWNER,
  pendingCount,
  pickCustomer,
  resetScenario,
  restoreNetwork,
  saveCredit,
  statement,
  switchUser,
  syncNow,
} from "./fixtures";

/**
 * بوابة المرحلة ٢ — ORG-05 (§١٥.٤ «موظف معطل»): تعطيل موظف ثم دخول موظف آخر على جهاز مشترك → لا محو
 * لعمليات الآخرين ولا لمعلّق المعطَّل، والآخرون يواصلون (ACC-63)؛ دخوله الجديد يُرفض بحالة معلنة
 * لا شاشة خطأ غامضة (ACC-45).
 */
test("ACC-63 — موظف معطل على جهاز مشترك: معلّقه يبقى ويُرفع، والآخرون يواصلون، ودخوله يُرفض بوضوح", async ({
  browser,
  request,
}) => {
  await resetScenario(request);
  // جهاز مشترك: المالك يجهّزه ويفتح وردية اليوم عليه
  const shared = await newDevice(browser, "S", OWNER);
  await openShift(shared.page);
  // الكاشير يدخل على الجهاز نفسه ويبيع آجلاً بلا شبكة — يبقى معلّقاً على الجهاز
  await switchUser(shared, CASHIER);
  await cutNetwork(shared);
  await addSugar(shared.page, "1");
  await pickCustomer(shared.page);
  await saveCredit(shared.page);
  expect(await pendingCount(shared.page)).toBeGreaterThanOrEqual(1);
  await restoreNetwork(shared);

  // المالك يعود إلى الجهاز نفسه ويعطّل الكاشير من ORG-05 — «اسحب الآن — ويبقى المعلّق محفوظاً»
  await switchUser(shared, OWNER);
  expect(await pendingCount(shared.page)).toBeGreaterThanOrEqual(1); // معلّق الكاشير لم يُمحَ بتبديل المستخدم
  await goHome(shared.page);
  await nav(shared.page, "المستخدمون", /\/org\/users$/);
  const row = shared.page.locator("tbody tr", { hasText: "أحمد الطيب — تجريبي" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "سحب الوصول" }).click();
  await expect(shared.page).toHaveURL(/\/org\/users\/[^/]+\/revoke$/);
  const root = shared.page.locator('[data-screen="ORG-05"]');
  await expect(root).toHaveAttribute("data-state", /ready|pending_sync/);
  if ((await root.getAttribute("data-state")) === "pending_sync")
    await shared.page.getByRole("button", { name: "تعطيل المستخدم فقط" }).click();
  await shared.page.getByLabel("اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً").check();
  await shared.page.getByLabel("السبب — اختياري").fill("ترك العمل");
  await shared.page.getByRole("button", { name: "تأكيد السحب" }).click();
  await expect(root).toHaveAttribute("data-state", "success");
  await expect(root).toContainText("سُحب الوصول");

  // القائمة: معطَّل ويبقى باسمه — التعطيل ليس حذفاً
  await nav(shared.page, "المستخدمون", /\/org\/users$/);
  await expect(shared.page.locator("tbody tr", { hasText: "أحمد الطيب — تجريبي" })).toContainText(
    "معطَّل",
  );
  // المالك يواصل على الجهاز نفسه: معلّق الكاشير يُرفع (لا يُمحى) ويظهر في كشف العميل
  await syncNow(shared.page);
  expect(await pendingCount(shared.page)).toBe(0);
  await statement(shared.page);
  const st = shared.page.locator('[data-screen="PTY-05"]');
  await expect(st).toContainText("100.00");
  await expect(st.locator("tbody tr")).toHaveCount(1);
  // ويبيع بلا انقطاع
  await addSugar(shared.page, "1");
  await pickCustomer(shared.page);
  await saveCredit(shared.page);
  await syncNow(shared.page);
  await statement(shared.page);
  await expect(st).toContainText("200.00");
  await expect(st.locator("tbody tr")).toHaveCount(2);

  // الكاشير المعطَّل يحاول الدخول على الجهاز نفسه: حالة معلنة لا شاشة خطأ غامضة (ACC-45)
  await shared.page.goto("/login");
  await shared.page.getByLabel("رقم الهاتف أو البريد").fill(CASHIER.identifier);
  await shared.page.getByLabel("كلمة المرور").fill(CASHIER.password);
  await shared.page.getByRole("button", { name: "دخول" }).click();
  await expect(shared.page.locator("body")).toContainText(/موقوف|لا منشأة بعد|سُحب/, {
    timeout: 20_000,
  });
  await shared.context.close();
});
