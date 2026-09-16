/**
 * C-ORDTL — خط زمني لطلب شراء/بيع مع نقاط فشل واستلام جزئي. الحالات: ready, loading, partial,
 * conflict, stale, server_error. تقدّم الطلب من البداية إلى النهاية (RTL: يمين→يسار)؛ أسهم بين
 * المراحل؛ Enter يفتح تفصيل المرحلة؛ المرحلة الحالية aria-current؛ المستقبلية تُعلن غير مكتملة لا
 * معطّلة. الحالات من §٧.٨: draft→submitted→quoted→confirmed ثم التنفيذ منفصلاً.
 */
import { AlertTriangle, Check, Circle } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";

export type StageState = "done" | "current" | "upcoming" | "failed" | "partial";

export interface OrderStage {
  readonly id: string;
  readonly label: string;
  readonly state: StageState;
  readonly atLabel?: string | undefined;
  readonly detail?: string | undefined;
}

export interface OrderTimelineProps {
  readonly label: string;
  readonly stages: readonly OrderStage[];
  readonly onOpen?: ((stage: OrderStage) => void) | undefined;
}

const ICON: Record<StageState, typeof Check> = {
  done: Check,
  current: Circle,
  upcoming: Circle,
  failed: AlertTriangle,
  partial: AlertTriangle,
};
const SR: Record<StageState, string> = {
  done: "مكتملة",
  current: "الحالية",
  upcoming: "غير مكتملة بعد",
  failed: "فشلت",
  partial: "جزئية",
};

export function OrderTimeline({ label, stages, onOpen }: OrderTimelineProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const focusAt = (i: number) => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-stage]");
    items?.[Math.max(0, Math.min(i, (items?.length ?? 1) - 1))]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, i: number, stage: OrderStage) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === "Enter" && onOpen) {
      e.preventDefault();
      onOpen(stage);
    }
  };
  return (
    <ol ref={listRef} className="c-ordtl" aria-label={label}>
      {stages.map((s, i) => {
        const Icon = ICON[s.state];
        return (
          <li
            key={s.id}
            className={`c-ordtl__stage c-ordtl__stage--${s.state}`}
            aria-current={s.state === "current" ? "step" : undefined}
          >
            <button
              type="button"
              className="c-ordtl__button"
              data-stage
              onClick={() => onOpen?.(s)}
              onKeyDown={(e) => onKey(e, i, s)}
              aria-label={`${s.label} — ${SR[s.state]}${s.atLabel ? ` ${s.atLabel}` : ""}`}
            >
              <span className="c-ordtl__icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="c-ordtl__label">{s.label}</span>
              {s.atLabel ? <span className="c-ordtl__at sting-mono">{s.atLabel}</span> : null}
              {s.detail ? <span className="c-ordtl__detail">{s.detail}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
