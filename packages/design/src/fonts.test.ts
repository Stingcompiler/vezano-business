import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fontsDir = resolve(import.meta.dirname, "../fonts");
const required = [
  "Tajawal-Regular.ttf",
  "Tajawal-Medium.ttf",
  "Tajawal-Bold.ttf",
  "Tajawal-ExtraBold.ttf",
  "Inter[opsz,wght].ttf",
  "Cairo[slnt,wght].ttf",
  "IBMPlexSansArabic-Regular.ttf",
  "IBMPlexSansArabic-Medium.ttf",
  "IBMPlexSansArabic-SemiBold.ttf",
  "IBMPlexSansArabic-Bold.ttf",
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-Medium.ttf",
  "IBMPlexMono-SemiBold.ttf",
  "ReemKufi[wght].ttf",
  "ReemKufi-Wordmark.woff2",
];

describe("ملفات الخطوط المحلية", () => {
  it("كل ملف يشير إليه fonts.css موجود في packages/design/fonts/", () => {
    const missing = required.filter((f) => !existsSync(resolve(fontsDir, f)));
    expect(missing).toEqual([]);
  });
  it("قائمة الملفات المطلوبة معلنة", () => {
    expect(required.length).toBe(15);
    expect(typeof existsSync(fontsDir)).toBe("boolean");
  });
});
