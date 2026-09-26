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
  // CI أبطأ: الزرّ قد يظهر قبل الترطيب فلا يستجيب للنقر — نعيد حتى يُفتح الدرج أو تنقضي 25 ثانية
  const ready = await menu.waitFor({ state: "visible", timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  if (!ready) return;
  const open = page.locator(".c-frame--nav-open");
  const deadline = Date.now() + 25_000;
  while ((await open.count()) === 0 && Date.now() < deadline) {
    await menu.click({ timeout: 5000 }).catch(() => undefined);
    await open.waitFor({ state: "attached", timeout: 2500 }).catch(() => undefined);
  }
}

export async function navTo(page: Page, name: string, opts: { exact?: boolean } = {}) {
  await clickInDrawer(page, async () => {
    const byName = { name, ...(opts.exact ? { exact: true } : {}) };
    // المرئي أولاً (أشرطة غير قابلة للطيّ كشريط نقطة البيع)؛ وإلا رابط مطويّ داخل الشريط القابل
    // للطيّ (0005 §١٣٤) — تُفتح مجموعته ثم يُنقر
    const visible = page.getByRole("link", byName).first();
    if ((await visible.count()) && (await visible.isVisible())) {
      await visible.click({ timeout: 10_000 });
      return;
    }
    const collapsed = page
      .locator(".c-nav--collapsible")
      .getByRole("link", { ...byName, includeHidden: true })
      .first();
    if (await collapsed.count()) {
      const section = page.locator(".c-nav__section").filter({ has: collapsed });
      await section.first().locator(".c-nav__group--toggle").click({ timeout: 10_000 });
      await collapsed.click({ timeout: 10_000 });
      return;
    }
    await visible.click({ timeout: 10_000 });
  });
}

/** يفتح الدرج وينقر؛ إن أُغلق الدرج قبل النقر (ترطيب متأخر يعيد الحالة) يُعاد الفتح مرة. */
export async function clickInDrawer(page: Page, click: () => Promise<void>) {
  await openDrawerIfPhone(page);
  try {
    await click();
  } catch (e) {
    if ((page.viewportSize()?.width ?? 0) >= 834) throw e;
    await openDrawerIfPhone(page);
    await click();
  }
}
