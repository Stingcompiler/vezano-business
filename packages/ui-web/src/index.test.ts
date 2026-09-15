import { expect, it } from "vitest";
import { UI_WEB_DESIGN_SYSTEM } from "./index";

it("يربط المكوّنات بإصدار نظام التصميم", () => {
  expect(UI_WEB_DESIGN_SYSTEM).toBe("DS-1.2");
});
