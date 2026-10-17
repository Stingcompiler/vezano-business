import { expect, test } from "@playwright/test";

/**
 * تباين النص في الصفحات العامة فاتحاً وداكناً (مراجعة الهاتف 0005 §١٦٠): كل نص مرئي ≥ 4.5:1
 * (≥ 3:1 للكبير). وجد هذا الفحص رابطاً بأزرق المتصفح الافتراضي (1.8:1) في الداكن.
 */
const PLANS = {
  plans: [
    {
      code: "single",
      name: "فرع واحد",
      price_minor: "4500000",
      max_branches: 1,
      max_devices: 3,
      campaign_quota: 0,
      blurb: "3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
      trial: false,
    },
    {
      code: "trial",
      name: "تجريبية",
      price_minor: "0",
      max_branches: 1,
      max_devices: 3,
      campaign_quota: 0,
      blurb: "كل ميزات باقة الفرع الواحد.",
      trial: true,
    },
  ],
  on_expiry: { hidden: ["السوق"], never_hidden: ["البيع كاملاً"], grace_days: 14 },
  comparison: { limits: [], features: [], continues: ["البيع كاملاً"], stops: ["السوق"] },
};

test.beforeEach(({ browserName }, info) => {
  test.skip(
    browserName !== "chromium" || info.project.name !== "phone-390",
    "الفحص بمقاس الهاتف وحده",
  );
});

for (const scheme of ["light", "dark"] as const) {
  test(`تباين النص في الصفحات العامة (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.route("**/api/public/plans", (r) => r.fulfill({ status: 200, json: PLANS }));
    for (const path of ["/", "/plans", "/register", "/market"]) {
      await page.goto(path);
      await page.waitForTimeout(900);
      const bad = await page.evaluate(() => {
        const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        const parse = (c: string) => {
          cv.clearRect(0, 0, 1, 1);
          cv.fillStyle = "#000";
          cv.fillStyle = c;
          cv.fillRect(0, 0, 1, 1);
          const d = cv.getImageData(0, 0, 1, 1).data;
          return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! / 255 };
        };
        const lum = (c: { r: number; g: number; b: number }) => {
          const f = (v: number) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const bgOf = (el: Element) => {
          const stack: { r: number; g: number; b: number; a: number }[] = [];
          for (let e: Element | null = el; e; e = e.parentElement) {
            const c = parse(getComputedStyle(e).backgroundColor);
            if (c.a > 0) {
              stack.push(c);
              if (c.a >= 1) break;
            }
          }
          let acc = { r: 255, g: 255, b: 255 };
          for (const c of stack.reverse())
            acc = {
              r: c.r * c.a + acc.r * (1 - c.a),
              g: c.g * c.a + acc.g * (1 - c.a),
              b: c.b * c.a + acc.b * (1 - c.a),
            };
          return acc;
        };
        const out = new Map<string, string>();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const txt = walker.currentNode.textContent?.trim();
          const el = walker.currentNode.parentElement;
          if (!txt || !el) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          if (el.closest("[aria-hidden=true],script,style,[hidden],.c-frame__skip")) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const fg = parse(cs.color);
          const bg = bgOf(el);
          const mix = (a: number, b: number) => a * fg.a + b * (1 - fg.a);
          const f2 = { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
          const l1 = lum(f2);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const size = parseFloat(cs.fontSize);
          const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5))
            out.set(
              `${el.tagName}.${String(el.className).slice(0, 40)}`,
              `${ratio.toFixed(2)} «${txt.slice(0, 24)}»`,
            );
        }
        return [...out.entries()];
      });
      expect(bad, `${path} (${scheme})`).toEqual([]);
    }
    await ctx.close();
  });
}
