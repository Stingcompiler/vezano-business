/**
 * C-STATUS — شارة الحالة المعيارية للحالات الـ17. لا اعتماد على اللون وحده: النص العربي حاضر دائماً،
 * والنقطة زينة. الشارة غير قابلة للتركيز إلا حين تحمل تلميح سبب — حينها زر (23-Handoff).
 */
import { type StateCode, stateColor, stateLabel } from "@sting/design";
import type { CSSProperties, ReactNode } from "react";

export interface StatusProps {
  readonly state: StateCode;
  /** يستبدل النص المعياري — يُستعمل فقط بنص الإطار المرسوم. */
  readonly label?: ReactNode;
  readonly dot?: boolean;
  /** إن وُجد سبب فالشارة زر يفتحه (Enter/Esc في الحاوية). */
  readonly reason?: string;
  readonly onReason?: () => void;
}

const vars = (state: StateCode): CSSProperties =>
  ({
    "--c-status-bg": stateColor[`${state}.bg`],
    "--c-status-fg": stateColor[`${state}.fg`],
    "--c-status-border": stateColor[`${state}.border`],
  }) as CSSProperties;

export function Status({ state, label, dot = true, reason, onReason }: StatusProps) {
  const content = (
    <>
      {dot ? <span className="c-status__dot" aria-hidden="true" /> : null}
      <span>{label ?? stateLabel[state]}</span>
    </>
  );
  if (reason) {
    return (
      <button
        type="button"
        className="c-status c-status--button"
        style={vars(state)}
        data-state={state}
        title={reason}
        aria-label={`${stateLabel[state]} — ${reason}`}
        onClick={onReason}
      >
        {content}
      </button>
    );
  }
  return (
    <span className="c-status" style={vars(state)} data-state={state} role="status">
      {content}
    </span>
  );
}
