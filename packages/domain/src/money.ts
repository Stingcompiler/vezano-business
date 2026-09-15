/**
 * المال والأعداد والتقريب — §٦.١ و§٦.٢ من الوثيقة v21.
 *
 * - المبلغ بوحدته الصغرى `BIGINT` على الخادم، سلسلة قانونية في JSON، و`bigint` محلياً.
 *   لا يمر مبلغ أو كمية أو مؤشر عبر `Number` عند التحويل أو المقارنة.
 * - التقريب المعتمد: **النصف بعيداً عن الصفر**، بقسمة صحيحة مع باقٍ — لا float.
 * - نفس المنطق في backend/core/money.py؛ يثبت التطابق ملف vectors/money.json على الطرفين.
 */

export type DomainErrorCode =
  | "invalid_integer"
  | "invalid_unsigned"
  | "invalid_exchange_rate"
  | "out_of_range"
  | "too_long"
  | "division_by_zero";

/** خطأ مجال: الرمز للبرمجة والاختبار؛ نص الواجهة يأتي من الإطار المرسوم لا من هنا. */
export class DomainError extends Error {
  override readonly name = "DomainError";
  constructor(
    readonly code: DomainErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

// التعبيرات القانونية (§٦.١) — ترفض -0 والأصفار البادئة والمسافات والأُسّ.
export const INTEGER_STRING = /^(0|[1-9][0-9]*|-[1-9][0-9]*)$/;
export const UNSIGNED_STRING = /^(0|[1-9][0-9]*)$/;
export const EXCHANGE_RATE_STRING = /^(?:0|[1-9][0-9]*)\.[0-9]{8}$/;

/** حدود BIGINT (int64) على الخادم — تُفحص بعد الحساب الدقيق لا قبله (§٦.١). */
export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;
/** 19 رقماً + إشارة: حدّ طول المدخل قبل أي تحليل. */
export const MAX_INTEGER_STRING_LENGTH = 20;
/** الكمية بأجزاء الألف (ثلاث منازل ثابتة — §٦.٢). */
export const QTY_SCALE = 1000n;
/** سعر الصرف بمقياس 10^8 (§٦.١). */
export const EXCHANGE_RATE_SCALE = 100_000_000n;

export function assertInt64(value: bigint, what = "value"): bigint {
  if (value < INT64_MIN || value > INT64_MAX) throw new DomainError("out_of_range", what);
  return value;
}

/** يقبل سلسلة قانونية فقط؛ العدد العادي بدل السلسلة مرفوض (§٦.١). */
export function parseIntegerString(input: unknown): bigint {
  if (typeof input !== "string") throw new DomainError("invalid_integer", "not a string");
  if (input.length > MAX_INTEGER_STRING_LENGTH)
    throw new DomainError("too_long", String(input.length));
  if (!INTEGER_STRING.test(input)) throw new DomainError("invalid_integer", input);
  return assertInt64(BigInt(input));
}

export function parseUnsignedString(input: unknown): bigint {
  if (typeof input !== "string") throw new DomainError("invalid_unsigned", "not a string");
  if (input.length > MAX_INTEGER_STRING_LENGTH)
    throw new DomainError("too_long", String(input.length));
  if (!UNSIGNED_STRING.test(input)) throw new DomainError("invalid_unsigned", input);
  return assertInt64(BigInt(input));
}

/** الصيغة القانونية للإخراج — ما يُرسل في JSON. */
export function formatIntegerString(value: bigint): string {
  return assertInt64(value).toString();
}

/** سعر الصرف: `^(?:0|[1-9][0-9]*)\.[0-9]{8}$` وقيمته > 0؛ يعود مقياس 10^8 كعدد صحيح. */
export function parseExchangeRate(input: unknown): bigint {
  if (typeof input !== "string") throw new DomainError("invalid_exchange_rate", "not a string");
  if (!EXCHANGE_RATE_STRING.test(input)) throw new DomainError("invalid_exchange_rate", input);
  const [whole, frac] = input.split(".") as [string, string];
  const scaled = BigInt(whole) * EXCHANGE_RATE_SCALE + BigInt(frac);
  if (scaled <= 0n) throw new DomainError("invalid_exchange_rate", "must be > 0");
  return assertInt64(scaled, "exchange_rate");
}

/**
 * قسمة صحيحة بتقريب النصف بعيداً عن الصفر:
 * round_half_away(2.5) = 3 · round_half_away(-2.5) = -3 · round_half_away(2.4) = 2
 * تعمل على البسط والمقام كعددين صحيحين — لا تمثيل عشري وسيط.
 */
export function roundHalfAwayDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new DomainError("division_by_zero");
  let num = numerator;
  let den = denominator;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const negative = num < 0n;
  const abs = negative ? -num : num;
  const quotient = abs / den;
  const remainder = abs % den;
  const rounded = remainder * 2n >= den ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** `line_total_minor = round_half_away(qty_milli × unit_price_minor / 1000)` (§٦.٢). */
export function lineTotalMinor(qtyMilli: bigint, unitPriceMinor: bigint): bigint {
  assertInt64(qtyMilli, "qty_milli");
  assertInt64(unitPriceMinor, "unit_price_minor");
  // المضاعفة دقيقة بلا حدّ ثم يُفحص الناتج ضمن BIGINT (§٦.١)
  return assertInt64(roundHalfAwayDiv(qtyMilli * unitPriceMinor, QTY_SCALE), "line_total_minor");
}

/** `invoice_total_minor = sum(rounded_line_totals)` — لا يُعاد تقريب مجموع غير مقرَّب (§٦.٢). */
export function invoiceTotalMinor(lineTotals: readonly bigint[]): bigint {
  let total = 0n;
  for (const line of lineTotals) {
    assertInt64(line, "line_total_minor");
    total = assertInt64(total + line, "invoice_total_minor");
  }
  return total;
}
