import axe from "axe-core";
import { expect } from "vitest";

/** يفحص العقدة بـ axe ويفشل على أي مخالفة (23-Handoff §٥). */
export async function expectNoA11yViolations(node: Element): Promise<void> {
  const results = await axe.run(node, { rules: { "color-contrast": { enabled: false } } }); // jsdom لا يحسب الألوان
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}
