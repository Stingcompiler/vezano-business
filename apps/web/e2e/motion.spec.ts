import { expect, test } from "@playwright/test";

import { json, listBody, listRoute, login, seed, serverRow, today } from "./pos-invoices-fixtures";

/**
 * الحركة (0005 §١٣٧) — بقية المواصفات تعمل بـ«تقليل الحركة» (حتمية)؛ هنا الحركة مفعّلة لنفحصها هي:
 * أنها تحدث، وأنها لا تغيّر نصّاً ولا تكسر تنقّلاً، وأنها تختفي عند «تقليل الحركة».
 */
test.describe("مع الحركة", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("الهبوط: العنوان كلمةً كلمة، النافذة تنكشف، الأرقام تتدحرج ونصّها كما هو، المسار والجسيمات", async ({
    page,
  }) => {
    await page.goto("/");
    const h1 = page.locator(".lp-words");
    await expect(h1).toHaveText("دفتر محلك يعمل وإن انقطعت الشبكة، ويبقى ملكك وإن توقف اشتراكك");
    const firstWord = h1.locator(".lp-words__w").first();
    expect(await firstWord.evaluate((el) => getComputedStyle(el).animationName)).toBe("vz-rise");
    expect(
      await page.locator(".lp__window").evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("lp-reveal");
    // العدّاد: النصّ الحقيقي باقٍ، والعمود من ::before
    const odo = page.locator(".lp-odo").first();
    await expect(odo).toHaveText("184,500.00");
    await expect(odo).toHaveAttribute("data-armed");
    // المسار: يدخل المجال فتُرسم خطوطه وتجري نقاطه
    const flow = page.locator("#lp-flow");
    await flow.scrollIntoViewIfNeeded();
    await expect(flow).toHaveAttribute("data-in");
    expect(
      await flow
        .locator(".lp-flow__dot")
        .first()
        .evaluate((el) => getComputedStyle(el).animationPlayState),
    ).toBe("running");
    // الجسيمات تتجمّع ثم تحلّ العلامة محلّها
    const particles = page.locator(".lp-particles");
    await particles.scrollIntoViewIfNeeded();
    await expect(particles).toHaveAttribute("data-done", { timeout: 8000 });
  });

  test("الشرائح: الكبسولة تنزلق أثناء التبديل فقط ثم تعود الشريحة إلى مظهرها", async ({ page }) => {
    await page.goto("/");
    // بعد الترطيب (العدّاد يُسلَّح بعد التركيب) — وإلا يسبق التبديلُ المراقبَ
    await expect(page.locator(".lp-odo").first()).toHaveAttribute("data-armed");
    await page.evaluate(() => {
      const g = document.createElement("div");
      g.className = "pos-chips";
      g.id = "probe-chips";
      for (const [i, t] of ["اليوم", "7 أيام", "هذا الشهر"].entries()) {
        const b = document.createElement("button");
        b.className = i === 0 ? "pos-chip pos-chip--on" : "pos-chip";
        b.textContent = t;
        g.appendChild(b);
      }
      document.body.appendChild(g);
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const [a, , c] = document.querySelectorAll("#probe-chips .pos-chip");
      a?.classList.remove("pos-chip--on");
      c?.classList.add("pos-chip--on");
    });
    const group = page.locator("#probe-chips");
    await expect(group).toHaveAttribute("data-moving");
    await expect(group.locator(".chip-slider")).toHaveCount(1);
    // بعد الانتقال: لا حالة حركة، والشريحة المفعّلة بلونها الأصلي
    await expect(group).not.toHaveAttribute("data-moving");
    const bg = await group
      .locator(".pos-chip--on")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("الفاتورة: الانتقال من القائمة إلى التفصيل يصل والرقم في رأسه", async ({ page }) => {
    await seed(page, []);
    const row = serverRow("s1040", "1040", today(9, 58), "نقدي", "64000", "64000", "0");
    await listRoute(page, listBody([row]));
    await page.route("**/api/sales/s1040", (route) =>
      route.fulfill(
        json(200, {
          ...row,
          subtotal_minor: "64000",
          discount_minor: "0",
          lines: [],
          reversal: null,
        }),
      ),
    );
    await login(page, "/pos/invoices");
    await page.getByRole("button", { name: "فتح", exact: true }).first().click();
    await expect(page).toHaveURL(/\/pos\/invoices\/s1040$/);
    await expect(page.locator('[data-vt="vt-1040"]')).toHaveText("1040");
  });
});

test.describe("مع «تقليل الحركة»", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("لا حركة: الكلمات والأرقام ساكنة، ولا كبسولة للشرائح", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const word = page.locator(".lp-words__w").first();
    expect(await word.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await expect(page.locator(".lp-odo").first()).not.toHaveAttribute("data-armed");
    await page.evaluate(() => {
      const g = document.createElement("div");
      g.className = "pos-chips";
      g.id = "probe-chips";
      g.innerHTML =
        '<button class="pos-chip pos-chip--on">أ</button><button class="pos-chip">ب</button>';
      document.body.appendChild(g);
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const [a, b] = document.querySelectorAll("#probe-chips .pos-chip");
      a?.classList.remove("pos-chip--on");
      b?.classList.add("pos-chip--on");
    });
    await page.waitForTimeout(100);
    await expect(page.locator("#probe-chips .chip-slider")).toHaveCount(0);
  });
});
