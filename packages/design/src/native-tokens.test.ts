import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "../scripts/generate.ts";
import { STATE_CODES } from "./index";
import {
  darkColors,
  fontFamily,
  fontSize,
  lightColors,
  lineHeight,
  radius,
  space,
} from "./generated/native-tokens";

const gen = resolve(import.meta.dirname, "generated");
const read = (f: string) => readFileSync(resolve(gen, f), "utf8");
const css = read("theme.css");

/** متغيرات كتلة CSS تبدأ بالسطر `header` → خريطة الاسم → القيمة. */
function block(header: string) {
  const start = css.indexOf(`\n${header}\n`);
  expect(start, header).toBeGreaterThan(-1);
  const body = css.slice(start + header.length + 2, css.indexOf("\n}", start + 1));
  return new Map(
    [...body.matchAll(/^\s*(--[\w-]+): (.+);$/gm)].map((m) => [m[1] as string, m[2] as string]),
  );
}
const root = block(":root {");
const dark = block(':root[data-theme="dark"] {');
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** كل مسار ورقي في الكائن: "inkStrong" / "state.ready.bg". */
const leaves = (o: object, prefix = ""): [string, unknown][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
const cssVar = (path: string) => {
  const [head, code, part] = path.split(".");
  return head === "state" ? `--color-state-${code}-${part}` : `--color-${kebab(head as string)}`;
};

describe("رموز الجوال native-tokens.ts (خطة الجوال M0 §٢.١)", () => {
  it("الملف المُلتزَم مطابق لنتيجة التوليد الآن (لا انحراف) ولا يستورد DOM ولا React", () => {
    const src = read("native-tokens.ts");
    expect(src).toBe(generate().tokensNativeTs);
    expect(src).not.toMatch(/^\s*import\b|require\(/m);
  });

  it("الفاتح والداكن بالمفاتيح نفسها، وفيهما الحالات الـ17 كاملة", () => {
    expect(leaves(darkColors).map(([k]) => k)).toEqual(leaves(lightColors).map(([k]) => k));
    expect(Object.keys(lightColors.state)).toEqual([...STATE_CODES]);
    for (const k of ["inkStrong", "inkMuted", "surfacePage", "surfaceCard", "border"])
      expect(lightColors).toHaveProperty(k);
    for (const k of [
      "brandPrimary",
      "brandStrong",
      "brandTint",
      "brandLine",
      "ok",
      "warn",
      "danger",
    ])
      expect(lightColors).toHaveProperty(k);
  });

  it("كل لون فاتح يساوي متغيّره في :root من theme.css", () => {
    const all = leaves(lightColors);
    expect(all.length).toBe(24 + 17 * 3);
    for (const [path, v] of all) expect(v, path).toBe(root.get(cssVar(path)));
  });

  it("كل لون داكن يساوي تجاوزه في data-theme=dark، وإلا قيمة :root الموروثة", () => {
    for (const [path, v] of leaves(darkColors))
      expect(v, path).toBe(dark.get(cssVar(path)) ?? root.get(cssVar(path)));
    // الداكن يختلف فعلاً حيث يتجاوز CSS
    expect(darkColors.surfacePage).not.toBe(lightColors.surfacePage);
    expect(darkColors.state.ready.bg).not.toBe(lightColors.state.ready.bg);
  });

  it("المقاسات أرقام بلا px تساوي قيم CSS، والخط أول عائلة في سلسلة CSS", () => {
    const pxOf = (name: string) => Number(root.get(name)?.replace(/px$/, ""));
    for (const [k, v] of Object.entries(fontSize)) {
      expect(typeof v).toBe("number");
      expect(v, k).toBe(pxOf(`--text-${k}`));
    }
    for (const [k, v] of Object.entries(lineHeight)) expect(v, k).toBe(pxOf(`--leading-${k}`));
    for (const [k, v] of Object.entries(space))
      expect(v, k).toBe(pxOf(`--spacing-${k.replace(".", "-")}`));
    for (const [k, v] of Object.entries(radius)) expect(v, k).toBe(pxOf(`--radius-${k}`));
    for (const [k, v] of Object.entries(fontFamily))
      expect(v, k).toBe(root.get(`--font-${k}`)?.split(",")[0]?.trim());
    expect(fontFamily.ui).toBe("Tajawal");
    expect(fontFamily.mono).toBe("IBM Plex Mono");
    expect(space["1.5"]).toBe(6);
  });
});
