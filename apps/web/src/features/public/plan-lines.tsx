/** السطور من `@sting/app-core` (مشتركة مع الجوال)؛ العرض بخط mono هنا. */
export { planLines, type PlanLike } from "@sting/app-core";

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
