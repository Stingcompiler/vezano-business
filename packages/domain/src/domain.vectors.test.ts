import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainError,
  balanceMinor,
  balanceStatus,
  balancesByAccount,
  computePaymentEffects,
  computeReceiptEffects,
  computeReturnEffects,
  computeSaleEffects,
  computeSupplierReturnEffects,
  expectedCashMinor,
  formatQtyString,
  parseQtyString,
  parseUnitFactor,
  toBaseQtyMilli,
  fromBaseQtyMilliForDisplay,
  varianceMinor,
  type AccountRole,
  type DecimalPlaces,
  type Direction,
  type OperationEffects,
  type PaymentMethod,
  type ReturnCondition,
  type UnitFactor,
} from "./index";

type Factor = [string, string];
interface QtyVectors {
  parse: { input: string; milli?: string; error?: string }[];
  format: { milli: string; decimal_places: number; output?: string; error?: string }[];
  unit_factor: { num: string; den: string; valid?: boolean; error?: string }[];
  to_base: { qty_milli: string; factor: Factor; base_milli?: string; error?: string }[];
  from_base_display: { base_milli: string; factor: Factor; unit_milli: string }[];
  sum_weights: { qty_milli: string[]; total_milli: string };
}
interface LedgerVectors {
  balances: {
    entries: { direction: Direction; amount: string }[];
    balance?: string;
    status?: string;
    error?: string;
  }[];
  by_account: {
    entries: {
      party: string;
      role: AccountRole;
      currency: string;
      direction: Direction;
      amount: string;
    }[];
    balances: Record<string, string>;
  };
}
interface VLine {
  item: string;
  qty_milli: string;
  unit_price_minor: string;
  factor: Factor;
  condition?: ReturnCondition;
}
interface VReceiptLine {
  item: string;
  qty_milli: string;
  factor: Factor;
}
interface EffectCase {
  id: string;
  kind: "sale" | "payment" | "return" | "receipt" | "supplier_return";
  lines?: VLine[];
  settlement?: { cash: string; bank: string; credit: string };
  refund?: { cash: string; bank: string; credit_reduction: string };
  party?: string | null;
  role?: AccountRole;
  method?: PaymentMethod;
  amount?: string;
  value?: string | null;
  paid_cash?: string;
  refund_cash?: string;
  expect?: unknown;
  error?: string;
}
interface EffectsVectors {
  cases: EffectCase[];
}
interface ShiftVectors {
  expected: Record<string, string> & { expected?: string; error?: string };
  variance: {
    counted: string | null;
    expected: string;
    variance?: string | null;
    error?: string;
  }[];
}

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../vectors/${name}.json`), "utf8")) as T;

const errorCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return "no_error";
};
const B = (s: string) => BigInt(s);
const factor = (f: Factor): UnitFactor => parseUnitFactor(f[0], f[1]);

/** تسلسل موحّد للمقارنة بالمتجه (سلاسل فقط). */
const serialize = (e: OperationEffects) => ({
  total: e.totalMinor.toString(),
  stock: e.stock.map((s) => ({ item: s.itemId, delta: s.deltaBaseQtyMilli.toString() })),
  quarantine: e.quarantine.map((s) => ({ item: s.itemId, delta: s.deltaBaseQtyMilli.toString() })),
  cash: e.cashMinor.toString(),
  bank_recorded: e.bankRecordedMinor.toString(),
  ledger: e.ledger
    ? {
        party: e.ledger.partyId,
        role: e.ledger.role,
        direction: e.ledger.direction,
        amount: e.ledger.amountMinor.toString(),
      }
    : null,
});

describe("vectors/qty.json — الكميات والوحدات (§٦.٢)", () => {
  const v = load<QtyVectors>("qty");
  it.each(v.parse)("parse $input", (c) => {
    if (c.error) expect(errorCode(() => parseQtyString(c.input))).toBe(c.error);
    else expect(parseQtyString(c.input).toString()).toBe(c.milli);
  });
  it.each(v.format)("format $milli @ $decimal_places", (c) => {
    const run = () => formatQtyString(B(c.milli), c.decimal_places as DecimalPlaces);
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else expect(run()).toBe(c.output);
  });
  it.each(v.unit_factor)("factor $num/$den", (c) => {
    if (c.error) expect(errorCode(() => parseUnitFactor(c.num, c.den))).toBe(c.error);
    else expect(parseUnitFactor(c.num, c.den)).toEqual({ num: B(c.num), den: B(c.den) });
  });
  it.each(v.to_base)("to_base $qty_milli × $factor", (c) => {
    const run = () => toBaseQtyMilli(B(c.qty_milli), factor(c.factor));
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else expect(run().toString()).toBe(c.base_milli);
  });
  it.each(v.from_base_display)("from_base_display $base_milli ÷ $factor", (c) => {
    expect(fromBaseQtyMilliForDisplay(B(c.base_milli), factor(c.factor)).toString()).toBe(
      c.unit_milli,
    );
  });
  it("مجموع الأوزان دقيق (ACC-20)", () => {
    const sum = v.sum_weights.qty_milli.reduce((a, q) => a + B(q), 0n);
    expect(sum.toString()).toBe(v.sum_weights.total_milli);
  });
});

describe("vectors/ledger.json — دفتر الأطراف (§٧.١)", () => {
  const v = load<LedgerVectors>("ledger");
  it.each(v.balances)("balance %#", (c) => {
    const entries = c.entries.map((e) => ({ direction: e.direction, amountMinor: B(e.amount) }));
    if (c.error) expect(errorCode(() => balanceMinor(entries))).toBe(c.error);
    else {
      const b = balanceMinor(entries);
      expect(b.toString()).toBe(c.balance);
      expect(balanceStatus(b)).toBe(c.status);
    }
  });
  it("الشخص نفسه عميل ومورد: رصيدان منفصلان ولا جمع عملات (ACC-28)", () => {
    const entries = v.by_account.entries.map((e) => ({
      account: { partyId: e.party, role: e.role, currency: e.currency },
      direction: e.direction,
      amountMinor: B(e.amount),
    }));
    const out = Object.fromEntries(
      [...balancesByAccount(entries)].map(([k, b]) => [k, b.toString()]),
    );
    expect(out).toEqual(v.by_account.balances);
  });
});

describe("vectors/effects.json — آثار العمليات (§٧.٢، §٧.٤)", () => {
  const v = load<EffectsVectors>("effects");
  const lines = (ls: VLine[]) =>
    ls.map((l) => ({
      itemId: l.item,
      qtyMilli: B(l.qty_milli),
      unitPriceMinor: B(l.unit_price_minor),
      unitFactor: factor(l.factor),
    }));
  const rlines = (ls: VReceiptLine[]) =>
    ls.map((l) => ({ itemId: l.item, qtyMilli: B(l.qty_milli), unitFactor: factor(l.factor) }));
  const run = (c: EffectCase): OperationEffects => {
    switch (c.kind) {
      case "sale":
        return computeSaleEffects(
          lines(c.lines ?? []),
          {
            cashMinor: B(c.settlement!.cash),
            bankMinor: B(c.settlement!.bank),
            creditMinor: B(c.settlement!.credit),
          },
          c.party ?? null,
        );
      case "payment":
        return computePaymentEffects(c.party!, c.role!, B(c.amount!), c.method!);
      case "return":
        return computeReturnEffects(
          lines(c.lines ?? []).map((l, i) => ({
            ...l,
            condition: c.lines![i]!.condition ?? "good",
          })),
          {
            cashMinor: B(c.refund!.cash),
            bankMinor: B(c.refund!.bank),
            creditReductionMinor: B(c.refund!.credit_reduction),
          },
          c.party ?? null,
        );
      case "receipt":
        return computeReceiptEffects(
          rlines(c.lines ?? []),
          c.value === null || c.value === undefined ? null : B(c.value),
          B(c.paid_cash!),
          c.party ?? null,
        );
      case "supplier_return":
        return computeSupplierReturnEffects(rlines(c.lines ?? []), B(c.refund_cash!));
    }
  };
  it.each(v.cases)("$id", (c) => {
    if (c.error) expect(errorCode(() => run(c))).toBe(c.error);
    else expect(serialize(run(c))).toEqual(c.expect);
  });
  it("المرتجع الكامل الصالح بعكس التسوية يعيد الحالة الابتدائية بالضبط (ACC-09)", () => {
    const sale = v.cases.find((c) => c.id === "cash_sale_100")!;
    const ret = v.cases.find((c) => c.id === "full_return_good_cash")!;
    const a = run(sale);
    const b = run(ret);
    expect(a.cashMinor + b.cashMinor).toBe(0n);
    expect(a.stock[0]!.deltaBaseQtyMilli + b.stock[0]!.deltaBaseQtyMilli).toBe(0n);
    expect(a.ledger).toBeNull();
    expect(b.ledger).toBeNull();
  });
});

describe("vectors/shift.json — الوردية (§١٠.٣)", () => {
  const v = load<ShiftVectors>("shift");
  it.each(v.expected as unknown as Record<string, string>[])("expected %#", (c) => {
    const run = () =>
      expectedCashMinor({
        openingFloatMinor: B(c.opening!),
        cashSalesMinor: B(c.cash_sales!),
        cashDebtReceiptsMinor: B(c.cash_debt_receipts!),
        cashDepositsMinor: B(c.cash_deposits!),
        cashRefundsMinor: B(c.cash_refunds!),
        cashWithdrawalsMinor: B(c.cash_withdrawals!),
      });
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else expect(run().toString()).toBe(c.expected);
  });
  it.each(v.variance)("variance %#", (c) => {
    const run = () => varianceMinor(c.counted === null ? null : B(c.counted), B(c.expected));
    if (c.error) expect(errorCode(run)).toBe(c.error);
    else {
      const r = run();
      expect(r === null ? null : r.toString()).toBe(c.variance);
    }
  });
});
