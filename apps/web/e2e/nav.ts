import { type Page } from "@playwright/test";

/**
 * التنقل عبر روابط C-NAV: شريط جانبي ثابت على ≥ 834، ودرج يُفتح بزرّ «القائمة» على الهاتف
 * (0005 §١١٣). الروابط في DOM دائماً — فتح الدرج ضروري للنقر لا للقراءة.
 */
/** يفتح درج التنقل على الهاتف (< 834) وينتظر انزلاقه — الروابط في DOM دائماً، والفتح للنقر. */
export async function openDrawerIfPhone(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 834) return;
  // زرّ درج الإطار وحده (`.c-frame__menu`) — لا زرّ قائمة الترويسة العامة ذي الاسم نفسه
  // صفحات بلا شريط جانبي (العامة، الدخول) لا درج لها — لا انتظار
  if ((await page.locator(".c-frame--sidebar").count()) === 0) return;
  const menu = page.locator(".c-frame--sidebar .c-frame__menu");
  const ready = await menu.waitFor({ state: "visible", timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  if (!ready) return;
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
