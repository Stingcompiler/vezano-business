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
