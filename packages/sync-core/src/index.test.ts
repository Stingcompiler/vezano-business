import { expect, it } from "vitest";
import { SYNC_PROTOCOL_VERSION, SYNC_DEPENDS_ON_DOMAIN } from "./index";

it("يعلن إصدار البروتوكول ويستورد النواة عبر workspace", () => {
  expect(SYNC_PROTOCOL_VERSION).toBe(1);
  expect(SYNC_DEPENDS_ON_DOMAIN).toBe(1);
});
