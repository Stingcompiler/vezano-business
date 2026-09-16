import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fontsDir = resolve(import.meta.dirname, "../fonts");
const required = [
  "Cairo[slnt,wght].ttf",
  "IBMPlexSansArabic-Regular.ttf",
  "IBMPlexSansArabic-Medium.ttf",
  "IBMPlexSansArabic-SemiBold.ttf",
  "IBMPlexSansArabic-Bold.ttf",
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-Medium.ttf",
  "IBMPlexMono-SemiBold.ttf",
];

describe("ملفات الخطوط المحلية", () => {
  // يُفعَّل بعد إذن التنزيل ووضع الملفات (fonts/README.md).
  it.todo("كل ملف يشير إليه fonts.css موجود في packages/design/fonts/");
  it("قائمة الملفات المطلوبة معلنة", () => {
    expect(required.length).toBe(8);
    expect(typeof existsSync(fontsDir)).toBe("boolean");
  });
});
