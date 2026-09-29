/**
 * الحركة (0005 §١٣٧): مكوّنات صغيرة بلا مكتبة — SVG وCSS فقط، `transform`/`opacity`/`stroke` وحدها،
 * وكلها ساكنة بحالتها النهائية عند `prefers-reduced-motion: reduce` (الأنماط في styles.css).
 *
 * - `SuccessMark`: دائرة ثم علامة ✓ تُرسم — تأكيد «حُفظ» يُقرأ بلا نصّ (إشعار النجاح).
 * - `ProgressRing`: حلقة تقدّم لنسبة حقيقية فقط (تجهيز الجهاز، المعالج) — لا نسبة مخترعة.
 */
import type { ReactNode } from "react";

export function SuccessMark({ size = 20 }: { readonly size?: number }) {
  return (
    <svg
      className="c-success-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="c-success-mark__ring" cx="12" cy="12" r="10" pathLength={1} />
      <path className="c-success-mark__check" d="M7.5 12.5 L10.5 15.5 L16.5 9" pathLength={1} />
    </svg>
  );
}

export interface ProgressRingProps {
  /** 0–100، يُقصّ إلى المدى. */
  readonly value: number;
  readonly label: string;
  readonly size?: number;
  /** ما يُكتب في المركز — افتراضياً النسبة بخطّ الأرقام. */
  readonly children?: ReactNode;
}

export function ProgressRing({ value, label, size = 56, children }: ProgressRingProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="c-ring"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      style={{ inlineSize: size, blockSize: size }}
      data-complete={v >= 100 || undefined}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="c-ring__track" cx="18" cy="18" r="15.5" pathLength={100} />
        <circle
          className="c-ring__value"
          cx="18"
          cy="18"
          r="15.5"
          pathLength={100}
          style={{ strokeDashoffset: 100 - v }}
        />
      </svg>
      <span className="c-ring__label">
        {children ?? (
          <>
            <span className="sting-mono">{v}</span>%
          </>
        )}
      </span>
    </div>
  );
}
