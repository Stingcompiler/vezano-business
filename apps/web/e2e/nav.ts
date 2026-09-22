import { type Page } from "@playwright/test";

/**
 * التنقل عبر روابط C-NAV: شريط جانبي ثابت على ≥ 834، ودرج يُفتح بزرّ «القائمة» على الهاتف
 * (0005 §١١٣). الروابط في DOM دائماً — فتح الدرج ضروري للنقر لا للقراءة.
 */
/** يفتح درج التنقل على الهاتف (< 834) وينتظر انزلاقه — الروابط في DOM دائماً، والفتح للنقر. */
export async function openDrawerIfPhone(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 834) return;
  const menu = page.getByRole("button", { name: "القائمة", exact: true });
  // الانتظار ضروري: الزرّ يظهر بعد الإماهة، و`isVisible` الفورية تسبقه
  if (
    !(await menu.waitFor({ state: "visible", timeout: 10_000 }).then(
      () => true,
      () => false,
    ))
  ) {
    return;
  }
  const open = page.locator(".c-frame--nav-open");
  for (let i = 0; i < 3 && (await open.count()) === 0; i += 1) {
    await menu.click({ timeout: 5000 }).catch(() => undefined);
    await open.waitFor({ state: "attached", timeout: 2000 }).catch(() => undefined);
  }
}

export async function navTo(page: Page, name: string, opts: { exact?: boolean } = {}) {
  await openDrawerIfPhone(page);
  await page
    .getByRole("link", { name, ...(opts.exact ? { exact: true } : {}) })
    .first()
    .click();
}
