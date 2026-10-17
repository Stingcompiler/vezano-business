// يستخرج نصوص الواجهة العربية من شاشات الويب إلى `src/generated/texts.ts` (خطة الجوال M0 — 0005 §١٦٥).
// المصدر: كل ‎.tsx في apps/web/src/{app,features}. يُلتقط: نص JSX، والسلاسل الحرفية في خصائص JSX وفي
// تعابير JSX وفي القواميس/المصفوفات داخل الملف — ما احتوى حرفاً عربياً. المفتاح: معرّف الشاشة من
// `data-screen` في الملف (أو «shared:<المسار>» لملف بلا شاشة).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const roots = ["apps/web/src/app", "apps/web/src/features"].map((r) => join(repo, r));
const ARABIC = /[؀-ۿ]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

function collect(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts = new Set();
  const screens = new Set();
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const t = norm(node.getText(sf));
      if (ARABIC.test(t)) texts.add(t);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      // مسارات الاستيراد والتعليقات ليست نصوصاً؛ `data-screen` معرّف شاشة
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return;
      if (ts.isJsxAttribute(parent) && parent.name.getText(sf) === "data-screen") {
        screens.add(node.text);
        return;
      }
      const t = norm(node.text);
      if (ARABIC.test(t)) texts.add(t);
    } else if (ts.isTemplateExpression(node)) {
      // قالب بمتغيرات: الأجزاء الثابتة نصوص (الرقم يُدرج بجانبها)
      for (const part of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
        const t = norm(part.text);
        if (ARABIC.test(t)) texts.add(t);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // `data-screen={cond ? "A" : "B"}` وما شابه
  for (const m of src.matchAll(/data-screen=\{?[^}\n]*?"([A-Z]+-[0-9A-Z]+)"/g)) screens.add(m[1]);
  return { texts: [...texts].sort(), screens: [...screens].sort() };
}

const byKey = {};
for (const root of roots) {
  for (const file of walk(root).sort()) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const { texts, screens } = collect(file);
    if (!texts.length) continue;
    const rel = relative(repo, file);
    const keys = screens.length ? screens : [`shared:${rel.replace(/^apps\/web\/src\//, "")}`];
    for (const k of keys) byKey[k] = [...new Set([...(byKey[k] ?? []), ...texts])].sort();
  }
}
const keys = Object.keys(byKey).sort();
const total = new Set(keys.flatMap((k) => byKey[k])).size;
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(byKey[k])},`).join("\n");
writeFileSync(
  resolve(here, "../src/generated/texts.ts"),
  `/* مولَّد آلياً من شاشات الويب (pnpm --filter @sting/texts generate) — لا يُحرَّر يدوياً. */
/* ${keys.length} مفتاحاً، ${total} نصاً مختلفاً. */
export const TEXTS = {
${body}
} as const;
`,
);
console.log(`${keys.length} مفتاحاً، ${total} نصاً مختلفاً`);
