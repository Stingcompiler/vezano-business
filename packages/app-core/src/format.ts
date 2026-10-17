/**
 * تنسيق العرض — لا حساب هنا ولا تقريب (القسم ٦ من الأمر). الأرقام لاتينية (G-01) وتُعرض داخل
 * `.sting-mono` في الويب وما يقابلها في الجوال. نُقل من `ui-web/components/format.ts` و
 * `apps/web/src/features/home/format.ts` و`features/public/money.ts` ليشترك فيه الويب والجوال
 * (خطة الجوال M0 — §٢.١).
 */

/** سلسلة قانونية بالوحدة الصغرى ← نص عرض بمنازل العملة، مع علامة سالب صريحة. */
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
 * يكون فيه كسر — لا تقريب أبداً. المستندات والجداول والإدخال تبقى على `formatMinor` (0005 §١٢٨).
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

/** الأرقام العربية الهندية ← لاتينية. */
export function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** يقرأ إدخال المستخدم (أرقام لاتينية أو عربية، فاصلة عربية) إلى سلسلة قانونية بالوحدة الصغرى — قبل إنشاء الحدث (§٦.١). */
export function parseMoneyInput(text: string, exponent = 2): string | null {
  const latin = latinDigits(text.trim()).replace(/[،,]/g, "").replace(/[٫]/g, ".");
  const m = /^(-)?(\d+)(?:\.(\d{0,}))?$/.exec(latin);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  if (frac.length > exponent) return null; // لا تقريب في الواجهة
  const minor =
    BigInt(whole!) * 10n ** BigInt(exponent) + BigInt(frac.padEnd(exponent, "0") || "0");
  const s = (sign ? -minor : minor).toString();
  return s === "-0" ? "0" : s;
}

/**
 * أسعار الباقات بالجنيه الصحيح (0005 §١٢٧): «45,000» لا «45,000.00» — الكسر العشري ضجيج في سعر
 * لا قروش فيه. غير الصحيح يبقى بخانتيه. العملة «ج.س» تُكتب بجانبه.
 */
export function pounds(minor: string | number): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return "—";
  const whole = n % 100 === 0;
  return (n / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** «HH:MM» بأرقام لاتينية. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** «قبل N دقيقة/ساعة/يوم» — الرقم والوحدة، والكلمة يكتبها العرض. */
export function agoParts(iso: string): { n: number; unit: "minute" | "hour" | "day" } {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 60) return { n: min, unit: "minute" };
  const h = Math.floor(min / 60);
  if (h < 24) return { n: h, unit: "hour" };
  return { n: Math.floor(h / 24), unit: "day" };
}

export const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;

/** «09 سبتمبر»: اليوم بأرقام لاتينية والشهر بالعربية — من تاريخ ISO. */
export function dayMonth(iso: string): { day: string; month: string } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return { day: String(dt.getDate()).padStart(2, "0"), month: MONTHS_AR[dt.getMonth()] ?? "" };
}

export interface PlanLike {
  max_branches: number;
  max_devices: number;
  blurb: string;
}

/**
 * سطور مزايا الباقة: الفروع ثم كل بند من وصف الباقة (`blurb` يفصل بنوده بـ« · ») في سطر مستقل.
 * عدد الأجهزة سطر خاص إن لم يذكره الوصف (0005 §١٦٠).
 */
export function planLines(p: PlanLike): string[] {
  const parts = p.blurb
    .split("·")
    .map((t) => t.trim().replace(/[.،]$/, ""))
    .filter(Boolean);
  const branches = `${p.max_branches} ${p.max_branches === 1 ? "فرع" : "فروع"}`;
  const devices = `${p.max_devices} ${p.max_devices <= 10 ? "أجهزة" : "جهازاً"}`;
  const hasDevices = parts.some((t) => /جهاز|أجهزة/.test(t));
  return [branches, ...(hasDevices ? [] : [devices]), ...parts];
}
