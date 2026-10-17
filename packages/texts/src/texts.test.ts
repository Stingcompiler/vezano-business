import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TEXTS, textsOf, tx } from "./index";

const pkg = resolve(import.meta.dirname, "..");

describe("@sting/texts", () => {
  it("texts.ts يطابق ما يُستخرج من شاشات الويب الآن (لا انحراف)", () => {
    const file = resolve(pkg, "src/generated/texts.ts");
    const before = readFileSync(file, "utf8");
    execFileSync("node", ["scripts/extract.mjs"], { cwd: pkg, stdio: "ignore" });
    execFileSync("pnpm", ["exec", "prettier", "--write", "src/generated/texts.ts"], {
      cwd: pkg,
      stdio: "ignore",
    });
    expect(readFileSync(file, "utf8")).toBe(before);
  }, 60_000);

  it("كل شاشات الويب حاضرة، ونصوص ACC-02 منها", () => {
    expect(Object.keys(TEXTS).filter((k) => !k.startsWith("shared:")).length).toBeGreaterThan(150);
    expect(textsOf("ACC-02")).toContain("أرسل رمز التحقق");
    expect(tx("POS-05", textsOf("POS-05")[0]!)).toBe(textsOf("POS-05")[0]);
  });
});
