/**
 * مساعد «مطابقة الإطار» (القسم ٣ من الأمر — معيار القبول لكل شاشة):
 * 1) النص الحرفي: كل نص مطلوب من الإطار موجود في الشاشة — في كل مقاس.
 * 2) الأنماط المحسوبة مقابل الرموز — عند المقاس الأساسي (1440) فقط.
 * 3) لقطة شاشة تُحفظ لاعتماد صاحب المشروع؛ لا مقارنة بكسلية مع dc.html.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

import { color, semantic } from "@sting/design";

export interface FrameExpectation {
  readonly screenId: string;
  readonly state: string;
  /** النصوص الحرفية المطلوبة (تُقرأ من tools/frame-text أو تُدرج يدوياً بنص الإطار). */
  readonly texts: readonly string[];
  /** فحوص أنماط عند 1440: [selector, cssProperty, tokenName] */
  readonly styles?: readonly (readonly [
    string,
    string,
    keyof typeof semantic | `color.${string}`,
  ])[];
}

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

function tokenValue(name: string): string {
  if (name.startsWith("color.")) return (color as Record<string, string>)[name.slice(6)]!;
  return (semantic as Record<string, string>)[name]!;
}

export async function expectFrame(page: Page, info: TestInfo, f: FrameExpectation): Promise<void> {
  const root = page.locator(`[data-screen="${f.screenId}"][data-state="${f.state}"]`);
  await expect(root, `الشاشة ${f.screenId} بحالة ${f.state} غير معروضة`).toBeVisible();
  const body = await page.locator("body").innerText();
  const normalized = body.replace(/\s+/g, " ");
  const missing = f.texts.filter((t) => !normalized.includes(t.replace(/\s+/g, " ")));
  expect(
    missing,
    `نصوص حرفية ناقصة في ${f.screenId}/${f.state} @${page.viewportSize()?.width}`,
  ).toEqual([]);

  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1440 && f.styles) {
    for (const [selector, prop, token] of f.styles) {
      const actual = await page
        .locator(selector)
        .first()
        .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
      expect(actual.trim(), `${selector} ${prop}`).toBe(hexToRgb(tokenValue(token)));
    }
  }
  // لا معنى باللون وحده ولا حرف عربي داخل mono (القاعدة 2) — يُفحص في كل مقاس
  const monoArabic = await page
    .locator(".sting-mono")
    .evaluateAll((els) =>
      els.map((e) => e.textContent ?? "").filter((t) => /[\u0600-\u06FF]/.test(t)),
    );
  expect(monoArabic, "حرف عربي داخل mono").toEqual([]);
  // هدف اللمس ≥ 44px لكل عنصر تفاعلي مرئي (القاعدة 10)
  // داخل هيكل التطبيق فقط — أدوات تطوير Next المحقونة خارج نطاق الحزمة
  const small = await page
    .locator(
      ".c-frame button:visible, .c-frame a[href]:visible, .c-frame input:visible, .c-frame select:visible",
    )
    .evaluateAll((els) =>
      els
        .map((e) => ({
          t:
            (e as HTMLElement).innerText ||
            (e as HTMLElement).getAttribute("aria-label") ||
            e.tagName,
          h: e.getBoundingClientRect().height,
        }))
        .filter((x) => x.h > 0 && x.h < 44),
    );
  expect(small, "أهداف لمس أقل من 44px").toEqual([]);
  const axe = await new AxeBuilder({ page }).include(`[data-screen="${f.screenId}"]`).analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.help}`),
    "axe",
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`${f.screenId}-${f.state}-${width}.png`),
    fullPage: true,
  });
}
