import { describe, expect, it } from "vitest";
import { FORM_LOCAL_STATE, LIST_PENDING_STATE, STATE_CODES, states } from "./index";

describe("مفردات الحالات السبع عشرة (02-Design-System §٣)", () => {
  it("كل حالة لها رسالة وإجراء تالٍ واحد — لا حالة بلا إجراء", () => {
    for (const code of STATE_CODES) {
      const s = states[code];
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.message.length).toBeGreaterThan(0);
      expect(s.action.length).toBeGreaterThan(0);
    }
    expect(Object.keys(states).sort()).toEqual([...STATE_CODES].sort());
  });

  it("نصوص حرفية بعينها لا تُعاد صياغتها", () => {
    expect(states.saved_local.message).toBe("مسجَّل على هذا الجهاز ولم يصل الخادم بعد.");
    expect(states.conflict.action).toBe("مراجعة المالك: قبول أو رفض بسبب.");
    expect(states.saving.message).toBe("الحفظ جارٍ — لا رسالة نجاح قبل اكتماله.");
  });

  it("saved_local للنماذج وpending_sync للقوائم", () => {
    expect(FORM_LOCAL_STATE).toBe("saved_local");
    expect(LIST_PENDING_STATE).toBe("pending_sync");
  });
});
