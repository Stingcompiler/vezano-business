// صورة المعاينة عند مشاركة الرابط (Open Graph؛ 0005 §١٥٤) — 1200×630 تُولَّد من HTML بخطوط الهوية
// وشعار «ف» ثم تُلتزم في public/og.png. أعد توليدها عند تغيّر الهوية أو العبارة:
//   pnpm --filter @sting/web exec node scripts/make-og.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const fonts = resolve(here, "../../../packages/design/fonts");
const font = (f) =>
  `url(data:font/woff2;base64,${readFileSync(resolve(fonts, f)).toString("base64")})`;
const mark = readFileSync(resolve(here, "../public/icons/icon.svg"), "utf8");

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:T;font-weight:400;src:${font("Tajawal-Regular.woff2")}}
@font-face{font-family:T;font-weight:700;src:${font("Tajawal-Bold.woff2")}}
@font-face{font-family:T;font-weight:800;src:${font("Tajawal-ExtraBold.woff2")}}
@font-face{font-family:W;src:${font("ReemKufi-Wordmark.woff2")}}
@font-face{font-family:L;src:${font("Inter-Latin[wght].woff2")}}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#0F1D2C;color:#F6F8FB;font-family:T,sans-serif;
  display:flex;flex-direction:column;justify-content:space-between;padding:72px 84px;position:relative;overflow:hidden}
.glow{position:absolute;inset:auto -160px -260px auto;width:620px;height:620px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(55,176,184,.35),rgba(55,176,184,0))}
.brand{display:flex;align-items:center;gap:26px}
.brand svg{width:112px;height:112px}
.name{font-family:W,T,sans-serif;font-size:76px;line-height:1}
h1{font-size:62px;font-weight:800;line-height:1.25;max-width:980px}
h1 b{color:#37B0B8;font-weight:800}
.sub{font-size:32px;color:#B9C6D3;margin-top:18px}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:28px;color:#B9C6D3}
.pill{background:#37B0B8;color:#0F1D2C;font-weight:700;border-radius:999px;padding:12px 30px}
.url{font-family:L,sans-serif;direction:ltr;letter-spacing:.5px}
</style></head><body>
<div class="glow"></div>
<div class="brand">${mark}<span class="name">فيزانو بلص</span></div>
<div><h1>نقطة بيع ومخزون وذمم <b>تعمل وإن انقطعت الشبكة</b></h1>
<p class="sub">للمحلات والبقالات والموزّعين في السودان — دفترك ملكك</p></div>
<div class="foot"><span class="pill">جرّب 30 يوماً مجاناً</span><span class="url">plus.vezano.app</span></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate("document.fonts.ready");
await page.screenshot({ path: resolve(here, "../public/og.png") });
await browser.close();
console.log("public/og.png");
