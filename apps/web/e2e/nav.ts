import { type Page } from "@playwright/test";

/**
 * التنقل عبر روابط C-NAV: الشريط الجانبي على سطح المكتب وشريط أفقي مرئي على الهاتف — الرابط يُنقر
 * مباشرة (لا درج يُفتح؛ زرّ «القائمة» في الترويسة العامة قائمة أقسام لا تنقّل التطبيق).
 */
export async function navTo(page: Page, name: string, opts: { exact?: boolean } = {}) {
  await page
    .getByRole("link", { name, ...(opts.exact ? { exact: true } : {}) })
    .first()
    .click();
}
