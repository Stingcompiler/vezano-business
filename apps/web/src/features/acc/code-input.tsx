"use client";

import { type CSSProperties, useRef } from "react";

/**
 * ست خانات لرمز التحقق (13-D8 M/ACC-02/390/ready): أرقام لاتينية في mono، اتجاه LTR معزول.
 * الخانة تنتقل تلقائياً للتالية؛ Backspace على خانة فارغة يعود للسابقة؛ اللصق يوزّع الأرقام.
 */
export interface CodeInputProps {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly length: number;
  readonly locked?: boolean | undefined;
  readonly label: string;
  /** رمز مرفوض (غير صحيح أو منتهٍ): الخانات بلون الخطأ ومُعلنة `aria-invalid` (0005 §١٤٦). */
  readonly invalid?: boolean | undefined;
}

const DIGITS = /[0-9٠-٩۰-۹]/g;
const toLatin = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

export function CodeInput({ value, onChange, length, locked, label, invalid }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");
  const set = (i: number, ch: string) => {
    const next = chars.slice();
    next[i] = ch;
    onChange(next.join(""));
  };
  return (
    <div
      className="acc-code"
      role="group"
      aria-label={label}
      data-invalid={invalid || undefined}
      style={{ "--n": length } as CSSProperties}
    >
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="acc-code__box sting-mono"
          data-filled={ch ? "" : undefined}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={ch}
          readOnly={locked}
          aria-label={`${i + 1}`}
          onChange={(e) => {
            const digits = toLatin(e.target.value).match(DIGITS)?.join("") ?? "";
            if (digits.length > 1) {
              onChange((value.slice(0, i) + digits).slice(0, length));
              refs.current[Math.min(i + digits.length, length - 1)]?.focus();
              return;
            }
            set(i, digits);
            if (digits) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !ch) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
