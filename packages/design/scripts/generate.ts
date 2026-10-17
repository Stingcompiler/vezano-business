/**
 * مولِّد الرموز — المصدر الوحيد: design_handoff_sting_systems/handoff/tokens.json (DS-1.2).
 * يُنتج src/generated/tokens.ts وsrc/generated/theme.css وsrc/generated/tokens.native.ts (الجوال —
 * خطة الجوال §٢.١). لا تُحرَّر المخرجات يدوياً؛ اختبارا tokens.test.ts وtokens.native.test.ts يفشلان
 * إن اختلفت عن نتيجة التوليد (drift).
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

  return { themeCss, tokensTs, tokensNativeTs: nativeTs(t, by) };
}

// ---------- tokens.native.ts (React Native — خطة الجوال §٢.١) ----------
// القيم نفسها التي يأخذها theme.css لكن بشكل يفهمه React Native: ألوان فاتحة وداكنة كاملة المفاتيح
// (الداكن = الفاتح + تجاوزات dark/darkStateColor كما يفعل CSS بالتوارث)، والمقاسات أرقاماً بلا px،
// والخط عائلة واحدة (RN لا يعرف سلاسل البدائل). لا استيراد لـ DOM ولا React.

/** "16px" → 16؛ أي وحدة أخرى خطأ توليد لا قيمة صامتة. */
function px(key: string, v: string | number) {
  if (typeof v === "number") return v;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  if (!m) throw new Error(`قيمة غير بكسلية لا تُحوَّل للجوال: ${key} = ${v}`);
  return Number(m[1]);
}

/** "ink.strong" / "sidebar-text" → "inkStrong" / "sidebarText". */
const camel = (key: string) => key.replace(/[.-]([a-z0-9])/gi, (_, c: string) => c.toUpperCase());

/** "Tajawal, IBM Plex Sans Arabic, system-ui, sans-serif" → العائلات المسمّاة بلا العامة. */
const families = (stack: string) =>
  stack
    .split(",")
    .map((f) => f.trim())
    .filter((f) => !/^(system-ui|sans-serif|serif|monospace)$/.test(f));

function nativeTs(
  t: Record<string, unknown> & { $meta: { version: string } },
  by: (section: string) => [string, string | number][],
) {
  const own = (o: unknown) =>
    Object.entries((o as Record<string, string> | undefined) ?? {}).filter(
      ([k]) => !k.startsWith("$"),
    );
  const strip = (section: string) =>
    by(section).map(([k, v]) => [k.slice(section.length + 1), v] as const);

  const semanticLight = strip("semantic");
  const darkOverride = new Map(own(t.dark));
  for (const k of darkOverride.keys())
    if (!semanticLight.some(([s]) => s === k))
      throw new Error(`dark.${k} لا يقابله اسم دلالي في semantic`);
  const stateLight = strip("stateColor");
  const darkState = new Map(own(t.darkStateColor));
  for (const k of darkState.keys())
    if (!stateLight.some(([s]) => s === k))
      throw new Error(`darkStateColor.${k} لا يقابله لون حالة في stateColor`);

  const colors = (dark: boolean) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of semanticLight) {
      if (camel(k) in out) throw new Error(`تصادم مفاتيح الجوال: semantic.${k}`);
      out[camel(k)] = (dark && darkOverride.get(k)) || v;
    }
    const state: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of stateLight) {
      const [code, part] = k.split(".") as [string, string];
      (state[code] ??= {})[part] = (dark && darkState.get(k)) || v;
    }
    out.state = state;
    return out;
  };
  // المفاتيح بلا camel في space: "1.5" يبقى "1.5" (camel يجعله "15")
  const nums = (section: string, key: (k: string) => string = camel) => {
    const out: Record<string, number> = {};
    for (const [k, v] of strip(section)) {
      if (key(k) in out) throw new Error(`تصادم مفاتيح الجوال: ${section}.${k}`);
      out[key(k)] = px(`${section}.${k}`, v);
    }
    return out;
  };
  const fontStacks = Object.fromEntries(strip("font").map(([k, v]) => [k, families(String(v))]));
  const js = (v: unknown) => JSON.stringify(v, null, 2);

  return [
    `// مولَّد آلياً من handoff/tokens.json (${t.$meta.version}) لـ React Native — لا يُحرَّر يدوياً.`,
    `// الشاشات تقرأ الأسماء الدلالية لا القيم (02-Design-System §١)؛ نفس قيم theme.css حرفياً.`,
    ``,
    `/** ألوان الوضع الفاتح: الأسماء الدلالية + ألوان شارات الحالات الـ17 (bg/fg/border). */`,
    `export const lightColors = ${js(colors(false))} as const;`,
    ``,
    `/** ألوان الوضع الداكن — المفاتيح نفسها؛ ما لا تجاوز له في dark يبقى بقيمته الفاتحة كما في CSS. */`,
    `export const darkColors = ${js(colors(true))} as const;`,
    ``,
    `type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };`,
    `/** شكل لوحة الألوان (مفاتيح الفاتح، قيم نصية) — لسياق السمة في تطبيق الجوال. */`,
    `export type NativeColors = Widen<typeof lightColors>;`,
    `export type ColorScheme = "light" | "dark";`,
    `/** satisfies: الداكن يُرفض في typecheck إن نقصه مفتاح من الفاتح. */`,
    `export const colors = { light: lightColors, dark: darkColors } as const satisfies Record<ColorScheme, NativeColors>;`,
    ``,
    `/** العائلة الأولى من كل سلسلة في tokens.json (RN لا يدعم البدائل)؛ اسم الخط كما يُحمَّل. */`,
    `export const fontFamily = ${js(Object.fromEntries(Object.entries(fontStacks).map(([k, v]) => [k, v[0]])))} as const;`,
    `/** السلسلة كاملة بلا العائلات العامة — للمنصة التي تحمّل بديلاً. */`,
    `export const fontFamilyFallbacks = ${js(fontStacks)} as const;`,
    `/** أوزان RN نصوص ("400") لا أرقام. */`,
    `export const fontWeight = ${js(Object.fromEntries(strip("fontWeight").map(([k, v]) => [k, String(v)])))} as const;`,
    `/** بالنقاط (dp) بلا px. */`,
    `export const fontSize = ${js(nums("fontSize"))} as const;`,
    `/** مضاعِفات كما في CSS؛ RN يريد نقاطاً: Math.round(fontSize * lineHeight). */`,
    `export const lineHeight = ${js(nums("lineHeight"))} as const;`,
    `export const space = ${js(nums("space", (k) => k))} as const;`,
    `export const radius = ${js(nums("radius"))} as const;`,
    `/** touchTarget = 44: الحد الأدنى لكل هدف لمس. */`,
    `export const layout = ${js(nums("layout"))} as const;`,
    ``,
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const out = resolve(import.meta.dirname, "../src/generated");
  mkdirSync(out, { recursive: true });
  const { themeCss, tokensTs, tokensNativeTs } = generate();
  writeFileSync(resolve(out, "theme.css"), themeCss);
  writeFileSync(resolve(out, "tokens.ts"), tokensTs);
  writeFileSync(resolve(out, "tokens.native.ts"), tokensNativeTs);
  process.stdout.write(
    "generated: src/generated/theme.css, src/generated/tokens.ts, src/generated/tokens.native.ts\n",
  );
}
