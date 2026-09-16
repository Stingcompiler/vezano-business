import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { matchesPrefix, normalizeSearch, type NormalizeOptions } from "./search";

interface Vectors {
  normalize: { in: string; options?: NormalizeOptions; out: string }[];
  prefix: { haystack: string; query: string; options?: NormalizeOptions; match: boolean }[];
}
const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../vectors/search.json"), "utf8"),
) as Vectors;

describe("تطبيع البحث (§٧.٥) — متجهات مشتركة", () => {
  it.each(vectors.normalize)("normalize $in", (v) => {
    expect(normalizeSearch(v.in, v.options)).toBe(v.out);
  });
  it.each(vectors.prefix)("prefix $haystack ← $query", (v) => {
    expect(matchesPrefix(v.haystack, v.query, v.options)).toBe(v.match);
  });
});
