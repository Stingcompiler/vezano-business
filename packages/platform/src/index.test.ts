import { expect, it } from "vitest";
import { systemClock } from "./index";

it("ساعة النظام تعطي تاريخاً", () => {
  expect(systemClock.now()).toBeInstanceOf(Date);
});
