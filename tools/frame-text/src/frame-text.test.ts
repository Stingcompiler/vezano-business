import { describe, expect, it } from "vitest";

import { drawnStates, frameRefFor, frameTexts, frameTextsAll, readMatrix } from "./index";

describe("مستخرج النصوص الحرفية للإطارات", () => {
  const matrix = readMatrix();

  it("يقرأ المصفوفة: 4069 صفاً، 788 مرسوماً، 754 زوجاً", () => {
    expect(matrix).toHaveLength(4069);
    const drawn = matrix.filter((r) => r.design_status === "drawn");
    expect(drawn).toHaveLength(788);
    expect(new Set(drawn.map((r) => `${r.screen_id}|${r.state_code}`)).size).toBe(754);
  });

  it("frameRefFor يعيد الصف المرسوم عند التركيبة الأساسية", () => {
    const row = frameRefFor("ACC-08", "saved_local", matrix);
    expect(row?.frame_ref).toBe("34-D26-Access-All-States.dc.html#ACC-08");
    expect(row?.platform).toBe("W");
    expect(row?.viewport_px).toBe("1440");
    expect(frameRefFor("POS-11", "ready", matrix)).toBeUndefined(); // POS-11 بلا ready عمداً
  });

  it("يستخرج نصوص ACC-08/saved_local الحرفية من الماركب والسكربت معاً", () => {
    const t = frameTexts("ACC-08", "saved_local", matrix);
    expect(t.staticTexts).toContain("جلستك انتهت — وعملك محفوظ");
    expect(t.staticTexts).toContain("أعد التحقق وارفع");
    expect(t.staticTexts).toContain("صدّر نسخة أولاً");
    expect(t.scriptTexts.some((s) => s.includes("الرفع جارٍ بعد التحقق"))).toBe(true);
    expect(t.staticTexts.some((s) => s.includes("{{"))).toBe(false);
  });

  it("drawnStates لكل شاشة يطابق coverage: POS-01 ست حالات", () => {
    const st = drawnStates("POS-01", matrix)
      .map((s) => s.state)
      .sort();
    expect(st).toEqual(["empty", "loading", "offline", "permission_denied", "ready", "stale"]);
  });

  it("كل الأزواج الـ754 قابلة للاستخراج (القسم موجود في ملفه)", () => {
    const pairs = new Map<string, { screen: string; state: string }>();
    for (const r of matrix)
      if (r.design_status === "drawn")
        pairs.set(`${r.screen_id}|${r.state_code}`, { screen: r.screen_id, state: r.state_code });
    const failures: string[] = [];
    for (const { screen, state } of pairs.values()) {
      try {
        const t = frameTexts(screen, state, matrix);
        if (t.staticTexts.length + t.scriptTexts.length === 0)
          failures.push(`${screen}/${state}: no texts`);
      } catch (e) {
        failures.push(`${screen}/${state}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

describe("رسمة ثانية للزوج نفسه", () => {
  it("SHIFT-05/conflict: 06-D2 (المصفوفة) ثم 15-D10 (سجل الورديات بسطر المرجع نفسه)", () => {
    const all = frameTextsAll("SHIFT-05", "conflict");
    expect(all.map((f) => f.file)).toEqual([
      "06-D2-Shifts-Access.dc.html",
      "15-D10-Parties-Shifts-Org.dc.html",
    ]);
    const d10 = all[1]!;
    expect(d10.staticTexts).toContain("الوردية والمسؤول");
    expect(d10.scriptTexts).toContain("مقفلة · معلّقة الرفع");
    expect(d10.scriptTexts).toContain("فارق غير معتمد");
  });

  it("لا رسمة ثانية لزوج مرسوم مرة واحدة", () => {
    expect(frameTextsAll("SHIFT-05", "ready").map((f) => f.file)).toEqual([
      "38-D30-Catalog-Shifts-Link-Growth.dc.html",
    ]);
  });
});
