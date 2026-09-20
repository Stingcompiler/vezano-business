import { type Page } from "@playwright/test";

/**
 * التنقل عبر روابط C-NAV: على الهاتف (< 834) الشريط الجانبي درج يفتحه زرّ «القائمة» في الترويسة،
 * فنفتحه أولاً إن كان ظاهراً ثم ننقر الرابط. الانتقال عميلي فتبقى الجلسة في الذاكرة.
 */
export async function navTo(page: Page, name: string, opts: { exact?: boolean } = {}) {
  const menu = page.getByRole("button", { name: "القائمة" });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("link", { name, ...(opts.exact ? { exact: true } : {}) })
    .first()
    .click();
}
