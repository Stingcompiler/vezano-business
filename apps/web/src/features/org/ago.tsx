import { agoParts } from "@/features/home/format";

/** «قبل 40 ثانية» / «قبل 3 ساعات» / «قبل 5 أيام» — الرقم في mono والكلمة خارجه. */
export function Ago({ iso }: { iso: string }) {
  if (!iso) return <span>لم يظهر بعد</span>;
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60)
    return (
      <span>
        قبل <span className="sting-mono">{sec}</span> ثانية
      </span>
    );
  const p = agoParts(iso);
  const word =
    p.unit === "minute"
      ? p.n === 1
        ? "دقيقة"
        : p.n === 2
          ? "دقيقتين"
          : p.n <= 10
            ? "دقائق"
            : "دقيقة"
      : p.unit === "hour"
        ? p.n === 1
          ? "ساعة"
          : p.n === 2
            ? "ساعتين"
            : p.n <= 10
              ? "ساعات"
              : "ساعة"
        : p.n === 1
          ? "يوم"
          : p.n === 2
            ? "يومين"
            : p.n <= 10
              ? "أيام"
              : "يوماً";
  if (p.n === 1 || p.n === 2) return <span>قبل {word}</span>;
  return (
    <span>
      قبل <span className="sting-mono">{p.n}</span> {word}
    </span>
  );
}
