/**
 * آثار العمليات — §٧.٢ و§٧.٤: دوالّ نقية تحوّل عملية إلى آثارها المستقلة على المخزون الصالح
 * للبيع والنقد والذمّة. الإشارات صريحة: مخزون وارد موجب وصادر سالب؛ نقد وارد موجب وصادر سالب.
 * لا تُشتق الإشارة من كلمة «مرتجع». النقد وحده يدخل الصندوق؛ التحويل البنكي «مسجَّل» لا «مطابق».
 */
import type { Direction } from "./ledger";
import { DomainError, assertInt64, invoiceTotalMinor, lineTotalMinor } from "./money";
import { toBaseQtyMilli, type UnitFactor } from "./quantities";

export interface LineInput {
  readonly itemId: string;
  /** بالوحدة المباعة (أجزاء الألف)، > 0. */
  readonly qtyMilli: bigint;
  readonly unitPriceMinor: bigint;
  /** معامل التحويل إلى وحدة المخزون الأساسية، محفوظ على السطر لحظة الحفظ. */
  readonly unitFactor: UnitFactor;
}

export interface Settlement {
  readonly cashMinor: bigint;
  /** تحويل بنكي مسجَّل — لا يدخل الصندوق ولا يُعتبر مطابقاً. */
  readonly bankMinor: bigint;
  readonly creditMinor: bigint;
}

export interface StockEffect {
  readonly itemId: string;
  readonly deltaBaseQtyMilli: bigint;
}

export interface LedgerEffect {
  readonly partyId: string;
  readonly role: "customer" | "supplier";
  readonly direction: Direction;
  readonly amountMinor: bigint;
}

export interface OperationEffects {
  readonly totalMinor: bigint;
  /** المخزون الصالح للبيع. */
  readonly stock: readonly StockEffect[];
  /** حجر التالف — ليس مخزوناً صالحاً (§٧.٢: مرتجع تالف). */
  readonly quarantine: readonly StockEffect[];
  /** الصندوق النقدي فقط. */
  readonly cashMinor: bigint;
  /** تحويلات بنكية مسجَّلة غير مطابقة. */
  readonly bankRecordedMinor: bigint;
  readonly ledger: LedgerEffect | null;
}

const nonNegative = (v: bigint, what: string): bigint => {
  if (v < 0n) throw new DomainError("negative_amount", what);
  return assertInt64(v, what);
};

function lineTotals(lines: readonly LineInput[]): bigint[] {
  return lines.map((l) => {
    if (l.qtyMilli <= 0n) throw new DomainError("invalid_quantity", l.itemId);
    return lineTotalMinor(l.qtyMilli, l.unitPriceMinor);
  });
}

function stockOut(lines: readonly LineInput[], sign: 1n | -1n): StockEffect[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    deltaBaseQtyMilli: sign * toBaseQtyMilli(l.qtyMilli, l.unitFactor),
  }));
}

function assertSettlement(total: bigint, s: Settlement): void {
  nonNegative(s.cashMinor, "cash");
  nonNegative(s.bankMinor, "bank");
  nonNegative(s.creditMinor, "credit");
  if (s.cashMinor + s.bankMinor + s.creditMinor !== total)
    throw new DomainError(
      "settlement_mismatch",
      `${s.cashMinor}+${s.bankMinor}+${s.creditMinor}≠${total}`,
    );
}

/** بيع نقدي/آجل/مختلط (§٧.٢ الصفوف 1–3، §٧.٤). البيع النقدي المجهول لا يحتاج عميلاً ولا قيداً صفرياً. */
export function computeSaleEffects(
  lines: readonly LineInput[],
  settlement: Settlement,
  partyId: string | null,
): OperationEffects {
  if (lines.length === 0) throw new DomainError("empty_operation", "sale");
  const totalMinor = invoiceTotalMinor(lineTotals(lines));
  assertSettlement(totalMinor, settlement);
  if (settlement.creditMinor > 0n && !partyId) throw new DomainError("party_required", "credit");
  return {
    totalMinor,
    stock: stockOut(lines, -1n),
    quarantine: [],
    cashMinor: settlement.cashMinor,
    bankRecordedMinor: settlement.bankMinor,
    ledger:
      settlement.creditMinor > 0n && partyId
        ? { partyId, role: "customer", direction: "debit", amountMinor: settlement.creditMinor }
        : null,
  };
}

export type PaymentMethod = "cash" | "bank";

/** سداد من عميل أو دفع لمورد (§٧.٢ الصف 4). يخفض الرصيد التراكمي دون توزيع على فواتير. */
export function computePaymentEffects(
  partyId: string,
  role: "customer" | "supplier",
  amountMinor: bigint,
  method: PaymentMethod,
): OperationEffects {
  if (amountMinor <= 0n) throw new DomainError("invalid_ledger_amount", amountMinor.toString());
  assertInt64(amountMinor, "amount_minor");
  const inbound = role === "customer";
  const signed = inbound ? amountMinor : -amountMinor;
  return {
    totalMinor: amountMinor,
    stock: [],
    quarantine: [],
    cashMinor: method === "cash" ? signed : 0n,
    bankRecordedMinor: method === "bank" ? signed : 0n,
    // العميل يسدد → دائن يخفض «عليه»؛ نحن ندفع للمورد → مدين يخفض «له علينا»
    ledger: { partyId, role, direction: inbound ? "credit" : "debit", amountMinor },
  };
}

export type ReturnCondition = "good" | "damaged";
export interface ReturnLineInput extends LineInput {
  readonly condition: ReturnCondition;
}
export interface Refund {
  readonly cashMinor: bigint;
  readonly bankMinor: bigint;
  /** تخفيض ذمّة العميل. */
  readonly creditReductionMinor: bigint;
}

/** مرتجع بيع (§٧.٢ الصفوف 5–7): وجهة الردّ صريحة ومجموعها = قيمة المرتجع؛ التالف إلى الحجر لا المخزون الصالح. */
export function computeReturnEffects(
  lines: readonly ReturnLineInput[],
  refund: Refund,
  partyId: string | null,
): OperationEffects {
  if (lines.length === 0) throw new DomainError("empty_operation", "return");
  const totalMinor = invoiceTotalMinor(lineTotals(lines));
  assertSettlement(totalMinor, {
    cashMinor: refund.cashMinor,
    bankMinor: refund.bankMinor,
    creditMinor: refund.creditReductionMinor,
  });
  if (refund.creditReductionMinor > 0n && !partyId)
    throw new DomainError("party_required", "credit_reduction");
  const good = lines.filter((l) => l.condition === "good");
  const damaged = lines.filter((l) => l.condition === "damaged");
  return {
    totalMinor,
    stock: stockOut(good, 1n),
    quarantine: stockOut(damaged, 1n),
    cashMinor: -refund.cashMinor,
    bankRecordedMinor: -refund.bankMinor,
    ledger:
      refund.creditReductionMinor > 0n && partyId
        ? {
            partyId,
            role: "customer",
            direction: "credit",
            amountMinor: refund.creditReductionMinor,
          }
        : null,
  };
}

export interface ReceiptLineInput {
  readonly itemId: string;
  readonly qtyMilli: bigint;
  readonly unitFactor: UnitFactor;
}

/** استلام شراء (§٧.٢ الصف 8، §٣.٣): لا يُشترط سعر تكلفة؛ إن وُجدت قيمة فذمّة المورد بحسب المتبقي. */
export function computeReceiptEffects(
  lines: readonly ReceiptLineInput[],
  valueMinor: bigint | null,
  paidCashMinor: bigint,
  supplierId: string | null,
): OperationEffects {
  if (lines.length === 0) throw new DomainError("empty_operation", "receipt");
  nonNegative(paidCashMinor, "paid_cash");
  const stock = lines.map((l) => {
    if (l.qtyMilli <= 0n) throw new DomainError("invalid_quantity", l.itemId);
    return { itemId: l.itemId, deltaBaseQtyMilli: toBaseQtyMilli(l.qtyMilli, l.unitFactor) };
  });
  if (valueMinor === null) {
    if (paidCashMinor > 0n) throw new DomainError("value_required", "paid without value");
    return {
      totalMinor: 0n,
      stock,
      quarantine: [],
      cashMinor: 0n,
      bankRecordedMinor: 0n,
      ledger: null,
    };
  }
  nonNegative(valueMinor, "value");
  if (paidCashMinor > valueMinor) throw new DomainError("settlement_mismatch", "paid > value");
  const remaining = valueMinor - paidCashMinor;
  if (remaining > 0n && !supplierId) throw new DomainError("party_required", "supplier");
  return {
    totalMinor: valueMinor,
    stock,
    quarantine: [],
    cashMinor: -paidCashMinor,
    bankRecordedMinor: 0n,
    ledger:
      remaining > 0n && supplierId
        ? { partyId: supplierId, role: "supplier", direction: "credit", amountMinor: remaining }
        : null,
  };
}

/** إعادة بضاعة للمورد واسترداد نقد (§٧.٢ الصف 9): مخزون سالب، نقد موجب، لا قيد عميل. */
export function computeSupplierReturnEffects(
  lines: readonly ReceiptLineInput[],
  refundCashMinor: bigint,
): OperationEffects {
  if (lines.length === 0) throw new DomainError("empty_operation", "supplier_return");
  nonNegative(refundCashMinor, "refund_cash");
  const stock = lines.map((l) => {
    if (l.qtyMilli <= 0n) throw new DomainError("invalid_quantity", l.itemId);
    return { itemId: l.itemId, deltaBaseQtyMilli: -toBaseQtyMilli(l.qtyMilli, l.unitFactor) };
  });
  return {
    totalMinor: refundCashMinor,
    stock,
    quarantine: [],
    cashMinor: refundCashMinor,
    bankRecordedMinor: 0n,
    ledger: null,
  };
}
