/**
 * مولِّد الرموز — المصدر الوحيد: design_handoff_sting_systems/handoff/tokens.json (DS-1.2).
 * يُنتج src/generated/tokens.ts وsrc/generated/theme.css. لا يُحرَّر المخرجان يدوياً؛
 * اختبار tokens.test.ts يفشل إن اختلفا عن نتيجة التوليد (drift).
 *
 * يعمل بـ node مباشرة (Node ≥ 24 يزيل الأنواع بلا أداة): `pnpm --filter @sting/design generate`.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type Leaf = { $value: string | number; $description?: string };

export const TOKENS_PATH = resolve(
  import.meta.dirname,
  "../../../design_handoff_sting_systems/handoff/tokens.json",
);

const isLeaf = (n: unknown): n is Leaf =>
  typeof n === "object" && n !== null && "$value" in (n as Record<string, unknown>);

/** يحوّل {a:{b:{$value}}} إلى خريطة مسطّحة "a.b" → القيمة، ويحلّ المراجع {color.teal.900}. */
function flatten(
  root: Record<string, unknown>,
  prefix = "",
  out = new Map<string, string | number>(),
) {
  for (const [k, v] of Object.entries(root)) {
    if (k.startsWith("$")) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out.set(key, v.$value);
    else if (typeof v === "object" && v !== null) flatten(v as Record<string, unknown>, key, out);
  }
  return out;
}

function resolveAliases(flat: Map<string, string | number>) {
  const resolved = new Map<string, string | number>();
  const get = (key: string, seen: string[] = []): string | number => {
    const v = flat.get(key);
    if (v === undefined)
      throw new Error(`رمز غير موجود: ${key} (المرجع من ${seen.join(" → ") || "الجذر"})`);
    if (typeof v === "string" && /^\{[^}]+\}$/.test(v)) {
      const target = v.slice(1, -1);
      if (seen.includes(target)) throw new Error(`مرجع دائري: ${[...seen, target].join(" → ")}`);
      return get(target, [...seen, key]);
    }
    return v;
  };
  for (const key of flat.keys()) resolved.set(key, get(key));
  return resolved;
}

const cssName = (key: string) => key.replace(/\./g, "-").replace(/[^A-Za-z0-9-]/g, "_");
const q = (s: string) => JSON.stringify(s);

export function generate(tokensJson: string = readFileSync(TOKENS_PATH, "utf8")) {
  const t = JSON.parse(tokensJson) as Record<string, unknown> & {
    $meta: { version: string; approved: string };
  };
  const flat = resolveAliases(flatten(t));
  const by = (section: string) =>
    [...flat.entries()].filter(([k]) => k === section || k.startsWith(`${section}.`));

  // ---------- theme.css (Tailwind 4 @theme + متغيرات جذر) ----------
  const css: string[] = [
    `/* مولَّد آلياً من handoff/tokens.json (${t.$meta.version} · ${t.$meta.approved}) — لا يُحرَّر يدوياً. */`,
    `/* الاسم هو المرجع لا القيمة: يُمنع استعمال قيمة سداسية مباشرة في أي شاشة (02-Design-System §١). */`,
    "@theme {",
  ];
  for (const [k, v] of by("color"))
    css.push(`  --color-${cssName(k.replace(/^color\./, ""))}: ${v};`);
  for (const [k, v] of by("semantic"))
    css.push(`  --color-${cssName(k.replace(/^semantic\./, ""))}: ${v};`);
  for (const [k, v] of by("stateColor"))
    css.push(`  --color-state-${cssName(k.replace(/^stateColor\./, ""))}: ${v};`);
  for (const [k, v] of by("font")) css.push(`  --font-${cssName(k.replace(/^font\./, ""))}: ${v};`);
  for (const [k, v] of by("fontWeight"))
    css.push(`  --font-weight-${cssName(k.replace(/^fontWeight\./, ""))}: ${v};`);
  for (const [k, v] of by("fontSize"))
    css.push(`  --text-${cssName(k.replace(/^fontSize\./, ""))}: ${v};`);
  for (const [k, v] of by("lineHeight"))
    css.push(`  --leading-${cssName(k.replace(/^lineHeight\./, ""))}: ${v};`);
  for (const [k, v] of by("space"))
    css.push(`  --spacing-${cssName(k.replace(/^space\./, ""))}: ${v};`);
  for (const [k, v] of by("radius"))
    css.push(`  --radius-${cssName(k.replace(/^radius\./, ""))}: ${v};`);
  for (const [k, v] of by("shadow"))
    css.push(`  --shadow-${cssName(k.replace(/^shadow\./, ""))}: ${v};`);
  css.push("}", "");
  // المتغيرات نفسها على :root حتى تعمل بلا Tailwind (Next.js/Vite بدون @theme) — نفس القيم بلا تكرار يدوي
  const themeLines = css.filter((l) => l.startsWith("  --"));
  css.push("/* نسخة :root من متغيرات @theme — لمستهلك بلا Tailwind */", ":root {", ...themeLines);
  for (const [k, v] of by("border"))
    css.push(`  --border-${cssName(k.replace(/^border\./, ""))}: ${v};`);
  for (const [k, v] of by("motion"))
    css.push(`  --motion-${cssName(k.replace(/^motion\./, ""))}: ${v};`);
  for (const [k, v] of by("layout"))
    css.push(`  --layout-${cssName(k.replace(/^layout\./, ""))}: ${v};`);
  css.push("}", "");
  // الوضع الداكن: تجاوزات الأسماء الدلالية فقط (tokens.json → dark) — النظام يتبع الجهاز أو data-theme
  const dark = Object.entries((t.dark as Record<string, string> | undefined) ?? {}).filter(
    ([k]) => !k.startsWith("$"),
  );
  if (dark.length) {
    const lines = dark.map(([k, v]) => `    --color-${cssName(k)}: ${v};`);
    const borderDark = dark.find(([k]) => k === "border")?.[1];
    if (borderDark) lines.push(`    --border-default: 1px solid ${borderDark};`);
    // ألوان الحالات الداكنة (tokens.json → darkStateColor): الشارات والتنبيهات تقرأ المتغيّرات لا القيم
    for (const [k, v] of Object.entries(
      (t.darkStateColor as Record<string, string> | undefined) ?? {},
    )) {
      if (!k.startsWith("$")) lines.push(`    --color-state-${cssName(k)}: ${v};`);
    }
    css.push(
      "/* الوضع الداكن — يتبع الجهاز ما لم يُثبَّت data-theme */",
      "@media (prefers-color-scheme: dark) {",
      '  :root:not([data-theme="light"]) {',
      ...lines,
      "  }",
      "}",
      ':root[data-theme="dark"] {',
      ...lines.map((l) => l.slice(2)),
      "}",
      "",
    );
  }
  css.push(
    "@media (prefers-reduced-motion: reduce) {",
    "  :root {",
    "    /* احترام prefers-reduced-motion: تعطيل الانتقالات لا الوظيفة (23-Handoff §٥) */",
    "    --motion-enter: 0ms;",
    "    --motion-exit: 0ms;",
    "  }",
    "}",
    "",
  );
  const themeCss = css.join("\n");

  // ---------- tokens.ts ----------
  const obj = (section: string, strip: RegExp) =>
    Object.fromEntries(by(section).map(([k, v]) => [k.replace(strip, ""), v]));
  const stateCodes = Object.keys(t.state as object).filter((k) => !k.startsWith("$"));
  const tokensTs = [
    `// مولَّد آلياً من handoff/tokens.json (${t.$meta.version}) — لا يُحرَّر يدوياً.`,
    `export const DESIGN_SYSTEM_VERSION = ${q(t.$meta.version)} as const;`,
    `export const DESIGN_SYSTEM_APPROVED = ${q(t.$meta.approved)} as const;`,
    ``,
    `/** القيم الخام بالمقياس — للاستعمال في المولِّدات فقط؛ الشاشات تستعمل الأسماء الدلالية. */`,
    `export const color = ${JSON.stringify(obj("color", /^color\./), null, 2)} as const;`,
    ``,
    `/** الأسماء الدلالية العشرون (02-Design-System §١). */`,
    `export const semantic = ${JSON.stringify(obj("semantic", /^semantic\./), null, 2)} as const;`,
    ``,
    `/** ألوان شارة كل حالة: bg / fg / border. */`,
    `export const stateColor = ${JSON.stringify(obj("stateColor", /^stateColor\./), null, 2)} as const;`,
    ``,
    `export const font = ${JSON.stringify(obj("font", /^font\./), null, 2)} as const;`,
    `export const fontWeight = ${JSON.stringify(obj("fontWeight", /^fontWeight\./), null, 2)} as const;`,
    `export const fontSize = ${JSON.stringify(obj("fontSize", /^fontSize\./), null, 2)} as const;`,
    `export const lineHeight = ${JSON.stringify(obj("lineHeight", /^lineHeight\./), null, 2)} as const;`,
    `export const space = ${JSON.stringify(obj("space", /^space\./), null, 2)} as const;`,
    `export const radius = ${JSON.stringify(obj("radius", /^radius\./), null, 2)} as const;`,
    `export const border = ${JSON.stringify(obj("border", /^border\./), null, 2)} as const;`,
    `export const shadow = ${JSON.stringify(obj("shadow", /^shadow\./), null, 2)} as const;`,
    `export const motion = ${JSON.stringify(obj("motion", /^motion\./), null, 2)} as const;`,
    `export const layout = ${JSON.stringify(obj("layout", /^layout\./), null, 2)} as const;`,
    ``,
    `/** الحالات الـ${stateCodes.length}: الرمز → الاسم العربي للشارة. */`,
    `export const stateLabel = ${JSON.stringify(obj("state", /^state\./), null, 2)} as const;`,
    `export type StateCode = keyof typeof stateLabel;`,
    `export const STATE_CODES = ${JSON.stringify(stateCodes)} as const;`,
    ``,
    `/** المنصات ومقاساتها المعتمدة (W/M/D/A/C). */`,
    `export const platform = ${JSON.stringify(t.platform, null, 2)} as const;`,
    `export type PlatformCode = keyof typeof platform;`,
    ``,
  ].join("\n");

  return { themeCss, tokensTs };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const out = resolve(import.meta.dirname, "../src/generated");
  mkdirSync(out, { recursive: true });
  const { themeCss, tokensTs } = generate();
  writeFileSync(resolve(out, "theme.css"), themeCss);
  writeFileSync(resolve(out, "tokens.ts"), tokensTs);
  process.stdout.write("generated: src/generated/theme.css, src/generated/tokens.ts\n");
}
