import { describe, expect, it } from "vitest";
import { DOMAIN_CONTRACT_VERSION, INTEGER_STRING } from "./index";

describe("@sting/domain skeleton", () => {
  it("يعلن إصدار العقد", () => {
    expect(DOMAIN_CONTRACT_VERSION).toBe(1);
  });
  it("التعبير القانوني يرفض -0 والأصفار البادئة (§٦.١)", () => {
    expect(INTEGER_STRING.test("125000")).toBe(true);
    expect(INTEGER_STRING.test("-40")).toBe(true);
    expect(INTEGER_STRING.test("-0")).toBe(false);
    expect(INTEGER_STRING.test("007")).toBe(false);
    expect(INTEGER_STRING.test("1e3")).toBe(false);
    expect(INTEGER_STRING.test(" 1")).toBe(false);
  });
});
