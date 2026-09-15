/**
 * دفتر حسابات الأطراف — §٧.١: لا جدول Debt مستقل؛ الرصيد = مجموع المدين − مجموع الدائن.
 * `amount_minor > 0` دائماً والاتجاه debit|credit. دور العميل ودور المورد حسابان منفصلان حتى للشخص
 * نفسه؛ لا مقاصة تلقائية بينهما (المقاصة عملية صريحة بحركتين متقابلتين).
 */
import { DomainError, assertInt64 } from "./money";

export type AccountRole = "customer" | "supplier";
export type Direction = "debit" | "credit";

export interface AccountKey {
  readonly partyId: string;
  readonly role: AccountRole;
  readonly currency: string;
}

export interface LedgerEntry {
  readonly direction: Direction;
  /** > 0 دائماً؛ قيد صفري لا يُنشأ لإرضاء قالب عام. */
  readonly amountMinor: bigint;
}

/** رصيد مفتاح واحد (party, role, currency). موجب العميل «عليه»، سالب المورد «له علينا». */
export function balanceMinor(entries: readonly LedgerEntry[]): bigint {
  let balance = 0n;
  for (const e of entries) {
    if (e.amountMinor <= 0n)
      throw new DomainError("invalid_ledger_amount", e.amountMinor.toString());
    assertInt64(e.amountMinor, "amount_minor");
    balance = assertInt64(
      e.direction === "debit" ? balance + e.amountMinor : balance - e.amountMinor,
      "balance",
    );
  }
  return balance;
}

export type BalanceStatus = "owes_us" | "we_owe" | "settled";

/** تسمية الواجهة «عليه/له» لا تبدّل معنى الاتجاه بحسب الشاشة. */
export function balanceStatus(balance: bigint): BalanceStatus {
  if (balance > 0n) return "owes_us";
  if (balance < 0n) return "we_owe";
  return "settled";
}

export const accountKeyString = (k: AccountKey): string => `${k.partyId}|${k.role}|${k.currency}`;

/** يجمّع القيود بمفتاح الحساب الكامل — لا يجمع العملات ولا الدورين ضمناً (§٦.٤). */
export function balancesByAccount(
  entries: readonly (LedgerEntry & { readonly account: AccountKey })[],
): Map<string, bigint> {
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const key = accountKeyString(e.account);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  return new Map([...groups].map(([k, list]) => [k, balanceMinor(list)]));
}
