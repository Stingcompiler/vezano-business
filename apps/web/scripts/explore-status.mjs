/* global document */
// استكشاف اتجاهات بطاقات الحالة على شاشة تمثيلية واحدة (PUB-03) بمحتوى واقعي — نقطة التوقف في docs/brand/ui-review-guide.md §٨.
//   PLAYWRIGHT_PORT=3011 node apps/web/scripts/explore-status.mjs <مجلد المخرجات>
// يحمّل الصفحة الحقيقية (الخطوط والرموز والإطار) ويستبدل قائمة الخدمات بتكوين كل اتجاه ثم يلتقط 390 و1440 فاتحاً وداكناً.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "shots/explore";
const base = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3000"}`;
mkdirSync(out, { recursive: true });

// حالة واقعية: تعطّل جزئي — المزامنة متوقفة، والسوق متعثّر، وأسماء طويلة
const payload = {
  checked_at: new Date().toISOString(),
  interval_seconds: 60,
  overall: "down",
  maintenance: { notice: "", from: "", until: "" },
  events: [
    {
      at: new Date(Date.now() - 5 * 60_000).toISOString(),
      text: "تأكيد التعطل في المزامنة. البيع المحلي غير متأثر.",
    },
    {
      at: new Date(Date.now() - 22 * 60_000).toISOString(),
      text: "تأخير في الرفع منذ 09:10 — استُعيد بعد 20 دقيقة.",
    },
  ],
  components: [
    {
      id: "pos",
      name: "البيع على الأجهزة المثبَّتة",
      state: "ok",
      detail: "محلي — لا يعتمد على الخادم",
    },
    { id: "sync", name: "المزامنة", state: "down", detail: "الرفع متوقف · المعلّق محفوظ عندك" },
    {
      id: "market",
      name: "السوق والطلبات",
      state: "affected",
      detail: "التصفح يعمل، والإرسال متأخر",
    },
    { id: "sms", name: "بوابة الزبون والحملات", state: "ok", detail: "الإرسال يعمل" },
    {
      id: "link",
      name: "ربط الأطراف بمنشآت السوق (M3)",
      state: "not_launched",
      detail: "لم يُفتح بعد — المرحلة M3",
    },
  ],
};
const LABEL = {
  ok: "يعمل",
  affected: "متوقفة جزئياً",
  down: "متوقفة",
  not_launched: "لم يُفتح بعد",
};
const ORDER = { down: 0, affected: 1, ok: 2, not_launched: 3 };
const sorted = [...payload.components].sort((a, b) => ORDER[a.state] - ORDER[b.state]);

/* ───────────── الاتجاه A — «سطور هادئة»: لا كروت؛ سطح واحد بسطور مفصولة، والحالة كلمة ونقطة ───────────── */
const A_CSS = `
.dx{display:grid;gap:0;border:1px solid var(--color-border);border-radius:16px;background:var(--color-surface-card);overflow:hidden}
.dx-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;align-items:center;padding:14px 18px;border-block-start:1px solid var(--color-border)}
.dx-row:first-child{border-block-start:0}
.dx-name{font-weight:700;font-size:16px;color:var(--color-ink-strong);line-height:1.4}
.dx-detail{grid-column:1;margin:0;font-size:14px;color:var(--color-ink-muted);line-height:1.6}
.dx-state{grid-column:2;grid-row:1;display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:14px;white-space:nowrap}
.dx-state i{inline-size:8px;block-size:8px;border-radius:50%;background:currentColor}
.dx-row[data-s=ok] .dx-state{color:var(--color-ok)}
.dx-row[data-s=affected] .dx-state{color:var(--color-warn)}
.dx-row[data-s=down] .dx-state{color:var(--color-danger)}
.dx-row[data-s=not_launched] .dx-state{color:var(--color-ink-muted)}
.dx-row[data-s=not_launched] .dx-name{color:var(--color-ink-muted);font-weight:500}
.dx-row[data-s=down],.dx-row[data-s=affected]{background:color-mix(in srgb,var(--color-surface-card),var(--k) 7%)}
.dx-row[data-s=down]{--k:var(--color-danger)}.dx-row[data-s=affected]{--k:var(--color-warn)}
@media(max-width:520px){.dx-row{grid-template-columns:1fr}.dx-state{grid-column:1;grid-row:auto}}
`;
const A = `<div class="dx">${sorted
  .map(
    (c) =>
      `<div class="dx-row" data-s="${c.state}"><span class="dx-name">${c.name}</span><span class="dx-state"><i></i>${LABEL[c.state]}</span><p class="dx-detail">${c.detail}</p></div>`,
  )
  .join("")}</div>`;

/* ───────────── الاتجاه B — «الأولوية أولاً»: ما تعطّل كروت كبيرة بسطح مصبوغ وشرح، وما يعمل سطر مضغوط واحد ───────────── */
const B_CSS = `
.dx{display:grid;gap:14px}
.dx-alert{display:grid;gap:6px;padding:18px 20px;border-radius:18px;border:1px solid color-mix(in srgb,var(--k) 30%,var(--color-border));background:color-mix(in srgb,var(--color-surface-card),var(--k) 9%)}
.dx-alert[data-s=down]{--k:var(--color-danger)}.dx-alert[data-s=affected]{--k:var(--color-warn)}
.dx-alert h3{margin:0;font-size:18px;color:var(--color-ink-strong)}
.dx-alert .w{font-weight:800;font-size:14px;color:var(--k)}
.dx-alert p{margin:0;color:var(--color-ink-muted);font-size:15px;line-height:1.65}
.dx-alert .keep{margin-block-start:4px;font-size:14px;color:var(--color-ink-strong)}
.dx-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.dx-ok{display:grid;gap:10px;padding:16px 20px;border-radius:18px;border:1px solid var(--color-border);background:var(--color-surface-card)}
.dx-ok h4{margin:0;font-size:14px;color:var(--color-ink-muted);font-weight:700}
.dx-ok ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.dx-ok li{display:flex;justify-content:space-between;gap:12px;font-size:15px;color:var(--color-ink-strong)}
.dx-ok li span:last-child{color:var(--color-ink-muted);font-size:14px}
`;
const alerts = sorted.filter((c) => c.state === "down" || c.state === "affected");
const oks = sorted.filter((c) => c.state === "ok");
const later = sorted.filter((c) => c.state === "not_launched");
const B = `<div class="dx"><div class="dx-grid">${alerts
  .map(
    (c) =>
      `<div class="dx-alert" data-s="${c.state}"><span class="w">${LABEL[c.state]}</span><h3>${c.name}</h3><p>${c.detail}</p>${
        c.state === "down"
          ? '<p class="keep">يعمل عندك الآن: البيع والفواتير والورديات على الأجهزة المثبَّتة.</p>'
          : ""
      }</div>`,
  )
  .join("")}</div><div class="dx-ok"><h4>تعمل بلا مشكلة</h4><ul>${oks
  .map((c) => `<li><span>${c.name}</span><span>${c.detail}</span></li>`)
  .join(
    "",
  )}${later.map((c) => `<li><span style="color:var(--color-ink-muted)">${c.name}</span><span>${LABEL[c.state]}</span></li>`).join("")}</ul></div></div>`;

/* ───────────── الاتجاه C — «عمق ناعم + تفاوت أحجام» (Bento): الأهمّ كرت واسع بعمق، والباقي وحدات مسطّحة ───────────── */
const C_CSS = `
.dx{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr))}
.dx-hero{grid-column:span 2;grid-row:span 2;display:grid;align-content:space-between;gap:18px;padding:24px;border-radius:22px;background:var(--color-surface-card);border:1px solid var(--color-border);box-shadow:0 1px 2px rgb(15 29 44/.05),0 20px 48px -24px rgb(15 29 44/.3)}
.dx-hero .w{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:800;font-size:13px;background:var(--color-danger);color:#fff;justify-self:start}
.dx-hero h3{margin:8px 0 6px;font-size:24px;line-height:1.35;color:var(--color-ink-strong)}
.dx-hero p{margin:0;color:var(--color-ink-muted);font-size:15px;line-height:1.7}
.dx-hero .keep{padding-block-start:14px;border-block-start:1px solid var(--color-border);color:var(--color-ink-strong);font-size:15px}
.dx-tile{display:grid;align-content:start;gap:6px;padding:16px 18px;border-radius:16px;border:1px solid var(--color-border);background:var(--color-surface-card)}
.dx-tile .n{font-weight:700;font-size:15px;color:var(--color-ink-strong);line-height:1.4}
.dx-tile .s{font-size:13px;font-weight:800}
.dx-tile[data-s=ok] .s{color:var(--color-ok)}.dx-tile[data-s=affected] .s{color:var(--color-warn)}.dx-tile[data-s=not_launched] .s{color:var(--color-ink-muted)}
.dx-tile p{margin:0;font-size:13.5px;color:var(--color-ink-muted);line-height:1.6}
@media(max-width:1000px){.dx{grid-template-columns:repeat(2,minmax(0,1fr))}.dx-hero{grid-column:span 2;grid-row:auto}}
@media(max-width:520px){.dx{grid-template-columns:1fr}.dx-hero{grid-column:auto}}
`;
const top = sorted[0];
const C = `<div class="dx"><div class="dx-hero"><div><span class="w">${LABEL[top.state]}</span><h3>${top.name}</h3><p>${top.detail}</p></div><p class="keep">يعمل عندك الآن: البيع والفواتير والورديات على الأجهزة المثبَّتة. المعلّق يُرفع تلقائياً عند العودة.</p></div>${sorted
  .slice(1)
  .map(
    (c) =>
      `<div class="dx-tile" data-s="${c.state}"><span class="s">${LABEL[c.state]}</span><span class="n">${c.name}</span><p>${c.detail}</p></div>`,
  )
  .join("")}</div>`;

const DIRS = { A: [A_CSS, A], B: [B_CSS, B], C: [C_CSS, C] };

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const [w, h, vp] of [
    [390, 844, "phone-390"],
    [1440, 900, "desktop-1440"],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      colorScheme: scheme,
      locale: "ar",
      reducedMotion: "reduce",
    });
    ctx.setDefaultTimeout(120_000);
    ctx.setDefaultNavigationTimeout(120_000);
    const page = await ctx.newPage();
    await page.route("**/api/public/status", (r) => r.fulfill({ status: 200, json: payload }));
    for (const [key, [css, html]] of Object.entries(DIRS)) {
      await page.goto(`${base}/status`, { waitUntil: "load" });
      await page.waitForSelector(".pb-services");
      await page.addStyleTag({ content: css });
      await page.evaluate((markup) => {
        document
          .querySelector(".pb-services")
          ?.replaceWith(
            Object.assign(document.createElement("div"), { innerHTML: markup }).firstElementChild,
          );
      }, html);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${key}--${vp}--${scheme}.png`, fullPage: true });
    }
    // مرجع: الوضع الحالي بجانب الاتجاهات
    await page.goto(`${base}/status`, { waitUntil: "load" });
    await page.waitForSelector(".pb-services");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/0-current--${vp}--${scheme}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(`explore → ${out}`);
