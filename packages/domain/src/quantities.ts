/**
 * الكميات والوحدات — §٦.٢: مقياس الكمية ثابت عند ثلاثة منازل (أجزاء الألف)، ومعامل التحويل إلى
 * وحدة المخزون الأساسية يُحفظ على السطر بتمثيل صحيح أو نسبة صحيحة موجبة، مع قاعدة دقة تمنع
 * تقريب كميات غير قابلة للتمثيل **بصمت**.
 */
import {
  DomainError,
  QTY_SCALE,
  assertInt64,
  parseUnsignedString,
  roundHalfAwayDiv,
} from "./money";

export const QTY_DECIMALS = 3;
/** `decimal_places` للوحدة بين 0 و3 يحكم الإدخال والعرض. */
export type DecimalPlaces = 0 | 1 | 2 | 3;

/** معامل تحويل: عدد وحدات المخزون الأساسية في وحدة بديلة واحدة — نسبة موجبة num/den. */
export interface UnitFactor {
  readonly num: bigint;
  readonly den: bigint;
}

const QTY_STRING = /^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;

/** يقبل "12" أو "12/5"؛ الصفر مرفوض في البسط والمقام. */
export function parseUnitFactor(num: string, den = "1"): UnitFactor {
  const n = parseUnsignedString(num);
  const d = parseUnsignedString(den);
  if (n === 0n || d === 0n) throw new DomainError("invalid_unit_factor", `${num}/${den}`);
  return { num: n, den: d };
}

/** كمية غير سالبة بصيغة عشرية قانونية (حتى 3 منازل) → أجزاء الألف. */
export function parseQtyString(input: unknown): bigint {
  if (typeof input !== "string") throw new DomainError("invalid_quantity", "not a string");
  if (!QTY_STRING.test(input)) throw new DomainError("invalid_quantity", input);
  const [whole, frac = ""] = input.split(".") as [string, string?];
  return assertInt64(BigInt(whole) * QTY_SCALE + BigInt((frac ?? "").padEnd(QTY_DECIMALS, "0")));
}

/** عرض الكمية بعدد المنازل المعلن للوحدة؛ الكمية يجب أن تكون قابلة للتمثيل بهذه المنازل. */
export function formatQtyString(qtyMilli: bigint, decimalPlaces: DecimalPlaces): string {
  assertQtyPrecision(qtyMilli, decimalPlaces);
  const negative = qtyMilli < 0n;
  const abs = negative ? -qtyMilli : qtyMilli;
  const whole = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(QTY_DECIMALS, "0").slice(0, decimalPlaces);
  return `${negative ? "-" : ""}${whole}${decimalPlaces > 0 ? "." + frac : ""}`;
}

/** الكمية يجب أن تكون مضاعفاً لـ10^(3 − decimal_places)؛ وإلا `invalid_precision` — لا تقريب صامت. */
export function assertQtyPrecision(qtyMilli: bigint, decimalPlaces: DecimalPlaces): bigint {
  const step = 10n ** BigInt(QTY_DECIMALS - decimalPlaces);
  if (qtyMilli % step !== 0n)
    throw new DomainError("invalid_precision", `${qtyMilli} @ ${decimalPlaces}`);
  return qtyMilli;
}

/**
 * كمية بالوحدة البديلة → كمية بوحدة المخزون الأساسية (كلاهما بأجزاء الألف):
 * base = qty × num / den — تُقبل فقط إن كانت **دقيقة** بثلاثة منازل، وإلا `inexact_quantity`.
 */
export function toBaseQtyMilli(qtyMilli: bigint, factor: UnitFactor): bigint {
  assertInt64(qtyMilli, "qty_milli");
  const scaled = qtyMilli * factor.num;
  if (scaled % factor.den !== 0n)
    throw new DomainError("inexact_quantity", `${qtyMilli} × ${factor.num}/${factor.den}`);
  return assertInt64(scaled / factor.den, "base_qty_milli");
}

/**
 * كمية بوحدة المخزون الأساسية → كمية بالوحدة البديلة **للعرض فقط** (CAT-03 «أمثلة محسوبة»):
 * unit = base × den / num مقرَّبة إلى ثلاث منازل بالنصف بعيداً عن الصفر (§٦.٢). لا تُستعمل في حدث
 * أو رصيد — الرصيد يُعرض بالوحدة الأساس؛ التقريب هنا في المجال لا في الواجهة.
 */
export function fromBaseQtyMilliForDisplay(baseMilli: bigint, factor: UnitFactor): bigint {
  assertInt64(baseMilli, "base_qty_milli");
  return assertInt64(roundHalfAwayDiv(baseMilli * factor.den, factor.num), "unit_qty_milli");
}
