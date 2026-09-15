/**
 * الوردية والصندوق — §١٠.٣:
 * expected_cash = opening_float + cash_sales + cash_debt_receipts + cash_deposits − cash_refunds − cash_withdrawals
 * variance = counted_cash − expected_cash_at_close
 * المدفوعات البنكية والآجل خارج الصندوق. عند غياب العدّ يكون الفرق **غير معروف لا صفراً**.
 */
import { DomainError, assertInt64 } from "./money";

export interface CashTotals {
  readonly openingFloatMinor: bigint;
  readonly cashSalesMinor: bigint;
  readonly cashDebtReceiptsMinor: bigint;
  readonly cashDepositsMinor: bigint;
  readonly cashRefundsMinor: bigint;
  readonly cashWithdrawalsMinor: bigint;
}

const CASH_FIELDS = [
  "openingFloatMinor",
  "cashSalesMinor",
  "cashDebtReceiptsMinor",
  "cashDepositsMinor",
  "cashRefundsMinor",
  "cashWithdrawalsMinor",
] as const satisfies readonly (keyof CashTotals)[];

export function expectedCashMinor(t: CashTotals): bigint {
  for (const k of CASH_FIELDS) {
    const v = t[k];
    if (v < 0n) throw new DomainError("negative_amount", k);
    assertInt64(v, k);
  }
  return assertInt64(
    t.openingFloatMinor +
      t.cashSalesMinor +
      t.cashDebtReceiptsMinor +
      t.cashDepositsMinor -
      t.cashRefundsMinor -
      t.cashWithdrawalsMinor,
    "expected_cash",
  );
}

export type CountStatus = "counted" | "not_counted";

/** الفرق بعد الإغلاق؛ `null` يعني «بلا عدّ — غير معروف» ولا يُعرض صفراً (معيار §١٨ ACC-67). */
export function varianceMinor(
  countedCashMinor: bigint | null,
  expectedCashAtCloseMinor: bigint,
): bigint | null {
  if (countedCashMinor === null) return null;
  if (countedCashMinor < 0n) throw new DomainError("negative_amount", "counted_cash");
  return assertInt64(countedCashMinor - expectedCashAtCloseMinor, "variance");
}
