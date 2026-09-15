import { expect, it } from "vitest";
import { CONTRACTS_SOURCE } from "./index";

it("يشير إلى مصدر التوليد", () => {
  expect(CONTRACTS_SOURCE).toBe("openapi.json");
});
