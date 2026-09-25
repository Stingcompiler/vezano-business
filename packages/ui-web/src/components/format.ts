/**
 * تنسيق العرض المالي — لا حساب هنا ولا تقريب (القسم ٦ من الأمر): يحوّل سلسلة قانونية بالوحدة
 * الصغرى إلى نص عرض بمنازل العملة، مع علامة سالب صريحة. الأرقام لاتينية (G-01).
 */

export function formatMinor(minor: string | bigint, exponent = 2, grouping = true): string {
  const v = typeof minor === "bigint" ? minor : BigInt(minor);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const scale = 10n ** BigInt(exponent);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(exponent, "0");
  const wholeStr = grouping
    ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : whole.toString();
  return `${negative ? "−" : ""}${wholeStr}${exponent > 0 ? "." + frac : ""}`;
}

/**
 * مبلغ للقراءة السريعة (بطاقات الرئيسية): بلا «.00» حين يكون المبلغ جنيهات كاملة، وبالمنازل حين
 * يكون فيه كسر — لا تقريب أبداً. المستندات والجداول والإدخال تبقى على `formatMinor` لمحاذاة المنازل
 * (0005 §١٢٨).
 */
export function formatMinorShort(minor: string | bigint, exponent = 2): string {
  const v = typeof minor === "bigint" ? minor : BigInt(minor);
  const full = formatMinor(v, exponent);
  return v % 10n ** BigInt(exponent) === 0n ? full.replace(/\.0+$/, "") : full;
}

/** كمية بأجزاء الألف → نص بعدد المنازل المعلن للوحدة (بلا تقريب — يفترض قابلية التمثيل). */
export function formatQty(milli: string | bigint, decimalPlaces: 0 | 1 | 2 | 3): string {
  const v = typeof milli === "bigint" ? milli : BigInt(milli);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, "0").slice(0, decimalPlaces);
  return `${negative ? "−" : ""}${whole}${decimalPlaces > 0 ? "." + frac : ""}`;
}

/** يقرأ إدخال المستخدم (أرقام لاتينية أو عربية، فاصلة عربية) إلى سلسلة قانونية بالوحدة الصغرى — قبل إنشاء الحدث (§٦.١). */
export function parseMoneyInput(text: string, exponent = 2): string | null {
  const latin = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[،,]/g, "")
    .replace(/[٫]/g, ".");
  const m = /^(-)?(\d+)(?:\.(\d{0,}))?$/.exec(latin);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  if (frac.length > exponent) return null; // لا تقريب في الواجهة
  const minor =
    BigInt(whole!) * 10n ** BigInt(exponent) + BigInt(frac.padEnd(exponent, "0") || "0");
  const s = (sign ? -minor : minor).toString();
  return s === "-0" ? "0" : s;
}
