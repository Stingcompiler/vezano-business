import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainError,
  formatIntegerString,
  invoiceTotalMinor,
  lineTotalMinor,
  parseExchangeRate,
  parseIntegerString,
  parseUnsignedString,
  roundHalfAwayDiv,
} from "./money";

interface ParseCase {
  input: string;
  valid: boolean;
  value?: string;
  scaled?: string;
  error?: string;
  note?: string;
}
interface DivCase {
  numerator: string;
  denominator: string;
  result?: string;
  error?: string;
}
interface LineCase {
  qty_milli: string;
  unit_price_minor: string;
  line_total_minor?: string;
  error?: string;
}
interface InvoiceCase {
  lines: [string, string][];
  invoice_total_minor?: string;
  error?: string;
}
interface Vectors {
  integer_strings: ParseCase[];
  unsigned_strings: ParseCase[];
  exchange_rates: ParseCase[];
  round_half_away_div: DivCase[];
  line_totals: LineCase[];
  invoice_totals: InvoiceCase[];
}

const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../vectors/money.json"), "utf8"),
) as Vectors;

const errorCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return "no_error";
};

describe("متجهات المال المشتركة — vectors/money.json (تُشغَّل أيضاً من pytest)", () => {
  it.each(vectors.integer_strings)("integer $input", (c) => {
    if (c.valid) expect(formatIntegerString(parseIntegerString(c.input))).toBe(c.value);
    else expect(errorCode(() => parseIntegerString(c.input))).toBe(c.error);
  });

  it.each(vectors.unsigned_strings)("unsigned $input", (c) => {
    if (c.valid) expect(formatIntegerString(parseUnsignedString(c.input))).toBe(c.value);
    else expect(errorCode(() => parseUnsignedString(c.input))).toBe(c.error);
  });

  it.each(vectors.exchange_rates)("exchange_rate $input", (c) => {
    if (c.valid) expect(parseExchangeRate(c.input).toString()).toBe(c.scaled);
    else expect(errorCode(() => parseExchangeRate(c.input))).toBe(c.error);
  });

  it.each(vectors.round_half_away_div)("round_half_away($numerator / $denominator)", (c) => {
    const run = () => roundHalfAwayDiv(BigInt(c.numerator), BigInt(c.denominator));
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else expect(run().toString()).toBe(c.result);
  });

  it.each(vectors.line_totals)("line_total qty=$qty_milli price=$unit_price_minor", (c) => {
    const run = () => lineTotalMinor(BigInt(c.qty_milli), BigInt(c.unit_price_minor));
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else expect(run().toString()).toBe(c.line_total_minor);
  });

  it.each(vectors.invoice_totals)("invoice_total %#", (c) => {
    const run = () =>
      invoiceTotalMinor(c.lines.map(([q, p]) => lineTotalMinor(BigInt(q), BigInt(p))));
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else expect(run().toString()).toBe(c.invoice_total_minor);
  });

  it("العدد العادي بدل السلسلة مرفوض (§٦.١)", () => {
    expect(errorCode(() => parseIntegerString(125000))).toBe("invalid_integer");
    expect(errorCode(() => parseExchangeRate(1))).toBe("invalid_exchange_rate");
  });
});
