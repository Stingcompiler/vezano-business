/**
 * سطور مزايا الباقة للقراءة على الهاتف: الفروع ثم كل بند من وصف الباقة (`blurb` يفصل بنوده
 * بـ« · ») في سطر مستقل بدل جملة صغيرة متصلة (مراجعة الهاتف 2026-10-16 — 0005 §١٦٠).
 * عدد الأجهزة سطر خاص إن لم يذكره الوصف.
 */
export interface PlanLike {
  max_branches: number;
  max_devices: number;
  blurb: string;
}

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

/** السطر برقمه الأول بخط mono (القاعدة 2): «3 أجهزة» → <mono>3</mono> أجهزة. */
export function PlanLine({ line }: { line: string }) {
  const m = /^(\d+)(\s.*)?$/.exec(line);
  if (!m) return <>{line}</>;
  return (
    <>
      <span className="sting-mono">{m[1]}</span>
      {m[2] ?? ""}
    </>
  );
}
