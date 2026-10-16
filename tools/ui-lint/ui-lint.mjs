#!/usr/bin/env node
// فحص الأنماط الممنوعة في الواجهة (docs/ui-profile.md §«الأنماط الممنوعة»؛ 0005 §١٥٨).
// ينتهي بالفشل (1) ويعرض المواضع إن وُجدت مخالفة غير مستثناة، وبنجاح بلا مخرجات إن خلا النطاق.
// الاستثناء الموثَّق: تعليق `ui-allow: السبب` على سطر المخالفة أو داخل قاعدته أو السطر الذي قبلها.
// يكشف أنماطاً معروفة فقط ويمكن الالتفاف عليه — لا يحكم على الأناقة ولا يغني عن المراجعة البصرية.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCOPE = ["apps/web/src", "packages/ui-web/src"];
const NEUTRAL = /var\(--color-border\)|currentColor|transparent/;

/** قاعدة CSS: المحدِّد والمتن وسطر البداية. */
function* rules(css) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(css));) {
    const start = css.slice(0, m.index + m[1].length - m[1].trimStart().length).split("\n").length;
    yield { selector: m[1].trim(), body: m[2], line: start, raw: m[0] };
  }
}

const found = [];
const add = (file, r, rule, why) =>
  found.push({ file, line: r.line, rule, why, sel: r.selector.split("\n").pop().slice(0, 80) });

function checkCss(file, css) {
  const lines = css.split("\n");
  for (const r of rules(css)) {
    const before = lines[Math.max(0, r.line - 2)] ?? "";
    if (/ui-allow:/.test(r.raw) || /ui-allow:/.test(before)) continue;
    const { selector: sel, body } = r;
    const pseudo = /::?(before|after)/.test(sel);

    // 1) شريط ملوّن على جانب الكرت أو أعلاه: بحدّ
    const side = body.match(
      /border-(?:inline|block|left|right|top|bottom)(?:-(?:start|end))?\s*:\s*([2-9])px\s+solid\s+([^;]+)/,
    );
    if (side && !NEUTRAL.test(side[2]))
      add(file, r, "stripe-border", `حدّ ${side[1]}px ملوّن على جانب`);
    // 2) شريط بعنصر زائف رفيع ممتدّ على حافة
    if (pseudo) {
      const thin = /(?:inline-size|block-size|width|height)\s*:\s*([2-6])px/.test(body);
      const edge =
        /inset-inline-(?:start|end)\s*:\s*0|inset-block(?:-start)?\s*:\s*0|(?:left|right|top)\s*:\s*0\b/.test(
          body,
        );
      if (thin && edge && /background/.test(body))
        add(file, r, "stripe-pseudo", "عنصر زائف رفيع ملوّن على حافة");
    }
    // 3) ظلّ داخلي يرسم شريطاً
    if (
      /box-shadow\s*:[^;]*inset\s+-?[3-9]px\s+0|box-shadow\s*:[^;]*inset\s+0\s+-?[3-9]px\s+0/.test(
        body,
      )
    )
      add(file, r, "stripe-inset", "ظلّ داخلي يرسم شريطاً");
    // 4) أيقونة في دائرة/مربع مصبوغ بلون الحالة
    const round = /border-radius\s*:\s*(?:50%|999px|9999px|\d{2,3}px)/.test(body);
    const center =
      /place-items\s*:\s*center|display\s*:\s*(?:inline-)?grid|justify-content\s*:\s*center/.test(
        body,
      );
    const tinted = /background\s*:[^;]*(?:color-mix\(|-tint|var\(--tone\))/.test(body);
    const small =
      /(?:inline-size|width)\s*:\s*(?:[2-4]\d)px/.test(body) &&
      /(?:block-size|height)\s*:\s*(?:[2-4]\d)px/.test(body);
    if (round && center && tinted && small)
      add(file, r, "icon-tint-circle", "أيقونة داخل دائرة مصبوغة بلون الحالة");
    // 5) حركة مستمرة على عنصر ليس عملية جارية
    if (
      /animation(?:-iteration-count)?\s*:[^;]*infinite/.test(body) &&
      !/spin|loading|skeleton|progress|ring|spinner|busy/i.test(sel + body)
    )
      add(file, r, "infinite-motion", "حركة مستمرة على عنصر ساكن");
    // 6) تدرّج على الأزرار والعناوين
    if (
      /\.c-btn|\bbutton\b|\bh[1-4]\b|__title|__heading/.test(sel) &&
      /linear-gradient|background-clip\s*:\s*text/.test(body)
    )
      add(file, r, "gradient-ui", "تدرّج لوني على زرّ أو عنوان");
  }
}

function checkTsx(file, src) {
  src.split("\n").forEach((l, i) => {
    if (/ui-allow:/.test(l) || /ui-allow:/.test(src.split("\n")[i - 1] ?? "")) return;
    // Tailwind احتياطاً (غير مستعمل هنا): شريط جانبي أو علوي
    if (/border-(?:l|r|s|e|t)-(?:2|4|8)\b|border-\[(?:2|3|4|5|6)px\]/.test(l))
      found.push({
        file,
        line: i + 1,
        rule: "stripe-class",
        why: "صنف شريط جانبي/علوي",
        sel: l.trim().slice(0, 80),
      });
    // ألوان حرفية في style المضمَّن لشريط
    if (/borderInlineStart\s*:\s*["'`]\s*[2-9]px/.test(l))
      found.push({
        file,
        line: i + 1,
        rule: "stripe-inline-style",
        why: "شريط في style مضمَّن",
        sel: l.trim().slice(0, 80),
      });
  });
}

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".next")) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const scope of SCOPE)
  for (const p of walk(join(ROOT, scope))) {
    const f = relative(ROOT, p);
    if (p.endsWith(".css")) checkCss(f, readFileSync(p, "utf8"));
    else if (/\.(tsx|jsx)$/.test(p)) checkTsx(f, readFileSync(p, "utf8"));
  }

if (found.length) {
  const by = {};
  for (const h of found) (by[h.rule] ??= []).push(h);
  for (const [rule, hs] of Object.entries(by)) {
    console.log(`\n[${rule}] ${hs.length}`);
    for (const h of hs) console.log(`  ${h.file}:${h.line}  ${h.sel}  — ${h.why}`);
  }
  console.log(`\nالمجموع: ${found.length}. للاستثناء الموثَّق: تعليق «ui-allow: السبب» على السطر.`);
  process.exit(1);
}
