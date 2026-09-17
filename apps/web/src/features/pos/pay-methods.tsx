"use client";

import { useRouter } from "next/navigation";

/**
 * وسيلة الدفع (03-D2 POS-07 / 42-D34): «نقداً» POS-05، «آجل» POS-06، «مختلط» POS-07 — شرائح
 * تنقّل بين شاشات الدفع الثلاث على السلة نفسها.
 */
const METHODS = [
  { id: "cash", label: "نقداً", href: "/pos/pay" },
  { id: "credit", label: "آجل", href: "/pos/pay/credit" },
  { id: "mixed", label: "مختلط", href: "/pos/pay/mixed" },
] as const;

export function PayMethods({ current }: { current: (typeof METHODS)[number]["id"] }) {
  const router = useRouter();
  return (
    <div className="pos-chips" role="group" aria-label="وسيلة الدفع">
      {METHODS.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`pos-chip${current === m.id ? " pos-chip--on" : ""}`}
          aria-pressed={current === m.id}
          onClick={() => {
            if (current !== m.id) router.push(m.href);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
