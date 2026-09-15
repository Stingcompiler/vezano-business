import { expect, it } from "vitest";
import { DESIGN_SYSTEM_VERSION } from "./index";

it("يثبت إصدار نظام التصميم", () => {
  expect(DESIGN_SYSTEM_VERSION).toBe("DS-1.2");
});
