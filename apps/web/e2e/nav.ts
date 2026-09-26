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
    // روابط أشرطة التنقل أولاً (لا رابط محتوى يشبهها اسماً، كـ«مركز المزامنة» في الرئيسية)؛ المطويّ
    // منها (0005 §١٣٤) تُفتح مجموعته قبل النقر. `has` يُقيَّم نسبةً إلى المجموعة: الدور والاسم وحدهما
    const inNav = page
      .locator("nav")
      .getByRole("link", { ...byName, includeHidden: true })
      .first();
    if (await inNav.count()) {
      if (!(await inNav.isVisible())) {
        const section = page
          .locator(".c-nav--collapsible .c-nav__section")
          .filter({ has: page.getByRole("link", { ...byName, includeHidden: true }) });
        if (await section.count()) {
          await section.first().locator(".c-nav__group--toggle").click({ timeout: 10_000 });
        }
      }
      await inNav.click({ timeout: 10_000 });
      return;
    }
    await page.getByRole("link", byName).first().click({ timeout: 10_000 });
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
