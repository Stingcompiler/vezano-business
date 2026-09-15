import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const run = (...targets: string[]) =>
  spawnSync("pnpm", ["exec", "depcruise", "--config", ".dependency-cruiser.cjs", ...targets], {
    cwd: root,
    encoding: "utf8",
  });

describe("حدود الحزم (§٤.٦، معيار §١٨ ACC-115)", () => {
  it("الشجرة الحقيقية تمرّ", () => {
    const r = run("packages", "apps");
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("استيراد React من النواة يُرفض باسم القاعدة", () => {
    const r = run("tools/boundaries/fixtures/core");
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("core-no-platform-or-ui");
  });

  it("استيراد sync-core من domain يُرفض باسم القاعدة", () => {
    const r = run("tools/boundaries/fixtures/domain");
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("domain-is-leaf");
  });
});
