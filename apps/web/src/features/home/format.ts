/** أوقات الرئيسية بأرقام لاتينية داخل mono: «HH:MM» و«قبل N دقيقة/ساعة». */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

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

/** «09 سبتمبر»: اليوم بأرقام لاتينية (داخل mono عند العرض) والشهر بالعربية — من تاريخ ISO. */
export function dayMonth(iso: string): { day: string; month: string } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return { day: String(dt.getDate()).padStart(2, "0"), month: MONTHS_AR[dt.getMonth()] ?? "" };
}
