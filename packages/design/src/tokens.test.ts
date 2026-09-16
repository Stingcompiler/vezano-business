import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generate, TOKENS_PATH } from "../scripts/generate.ts";
import {
  DESIGN_SYSTEM_VERSION,
  STATE_CODES,
  color,
  font,
  layout,
  platform,
  semantic,
  stateColor,
  stateLabel,
} from "./index";

const gen = resolve(import.meta.dirname, "generated");
const read = (f: string) => readFileSync(resolve(gen, f), "utf8");
const tokensJson = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Record<string, unknown>;

describe("توليد الرموز من handoff/tokens.json (T0.2)", () => {
  it("المخرجان المُلتزَمان مطابقان لنتيجة التوليد الآن (لا انحراف)", () => {
    const { themeCss, tokensTs } = generate();
    expect(read("theme.css")).toBe(themeCss);
    expect(read("tokens.ts")).toBe(tokensTs);
  });

  it("الإصدار DS-1.2 وخط العناوين Cairo وبلا Noto", () => {
    expect(DESIGN_SYSTEM_VERSION).toBe("DS-1.2");
    expect(font.heading).toMatch(/^Cairo/);
    expect(font.ui).toMatch(/^IBM Plex Sans Arabic/);
    expect(font.mono).toMatch(/^IBM Plex Mono/);
    const css = (
      read("theme.css") + readFileSync(resolve(import.meta.dirname, "fonts.css"), "utf8")
    )
      // التعليقات تذكر الخطوط الممنوعة بالاسم؛ الفحص على القيم الفعلية فقط
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/Noto|Inter\b|Roboto|fonts\.googleapis|fonts\.gstatic/);
  });

  it("كل قيمة لون خام في tokens.json موجودة في theme.css باسمها", () => {
    const css = read("theme.css");
    const leafValue = (x: unknown): string | undefined =>
      typeof x === "object" && x !== null && "$value" in x ? String(x.$value) : undefined;
    const colors = tokensJson.color as Record<string, unknown>;
    let checked = 0;
    for (const [scale, shades] of Object.entries(colors)) {
      if (scale.startsWith("$")) continue;
      const direct = leafValue(shades);
      if (direct !== undefined) {
        expect(css).toContain(`--color-${scale}: ${direct};`);
        checked++;
        continue;
      }
      for (const [shade, leaf] of Object.entries(shades as Record<string, unknown>)) {
        if (shade.startsWith("$")) continue;
        expect(css).toContain(`--color-${scale}-${shade}: ${leafValue(leaf) ?? "?"};`);
        checked++;
      }
    }
    // 26 قيمة أصلية + 19 مضافة من 02-Design-System (decisions/0003)
    expect(checked).toBe(45);
  });

  it("الأسماء الدلالية العشرون تُحلّ إلى قيم 02-Design-System", () => {
    expect(semantic["brand.strong"]).toBe("#115E59");
    expect(semantic["brand.primary"]).toBe("#0F766E");
    expect(semantic.accent).toBe("#F59E0B");
    expect(semantic["ink.faint"]).toBe("#64748B");
    expect(semantic.conflict).toBe("#86198F");
    expect(semantic.denied).toBe("#5B21B6");
    expect(semantic.expire).toBe("#9A3412");
    expect(Object.keys(semantic)).toHaveLength(20);
    expect(read("theme.css")).toContain("--color-brand-strong: #115E59;");
  });

  it("17 حالة، لكل واحدة أرضية ونص وحد، وأسماؤها من tokens.json", () => {
    expect(STATE_CODES).toHaveLength(17);
    for (const code of STATE_CODES) {
      expect(stateColor[`${code}.bg`]).toMatch(/^#[0-9A-F]{6}$/);
      expect(stateColor[`${code}.fg`]).toMatch(/^#[0-9A-F]{6}$/);
      expect(stateColor[`${code}.border`]).toMatch(/^#[0-9A-F]{6}$/);
      expect(stateLabel[code]).toBeTruthy();
    }
    expect(stateColor["conflict.fg"]).toBe(color["fuchsia.800"]);
    expect(stateColor["phase_locked.border"]).toBe("#94A3B8");
    expect(stateLabel.phase_locked).toBe("مرحلة غير مفعّلة");
  });

  it("المقاسات المعتمدة والحد الأدنى لهدف اللمس", () => {
    expect(platform.W.viewports).toEqual([390, 834, 1440]);
    expect(platform.D.viewports).toEqual([1366, 1920]);
    expect(layout.touchTarget).toBe("44px");
  });
});
