/**
 * C-NOTICE — حالة فارغة/خطأ/تنبيه/نجاح/معلومة/شريط علوي مستمر.
 * كل إشعار: ماذا حدث، ما أثره على المال، ما الخطوة التالية. ممنوع «حدث خطأ ما». الحالة الفارغة
 * تحمل فعلاً أو سبباً (R-10). الخطأ role="alert" والمعلومة role="status"؛ الإجراء قابل للتركيز
 * والإشعار العابر لا يسرق التركيز (23-Handoff).
 */
import { AlertTriangle, CheckCircle2, Info, Inbox, Lock, WifiOff, XCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { type StateCode, stateColor } from "@sting/design";

export type NoticeKind = "empty" | "error" | "warning" | "success" | "info" | "offline" | "locked";

const kindState: Record<NoticeKind, StateCode> = {
  empty: "empty",
  error: "validation_error",
  warning: "stale",
  success: "success",
  info: "pending_sync",
  offline: "offline",
  locked: "phase_locked",
};
const kindIcon: Record<NoticeKind, ReactNode> = {
  empty: <Inbox size={20} />,
  error: <XCircle size={20} />,
  warning: <AlertTriangle size={20} />,
  success: <CheckCircle2 size={20} />,
  info: <Info size={20} />,
  offline: <WifiOff size={20} />,
  locked: <Lock size={20} />,
};

export interface NoticeProps {
  readonly kind: NoticeKind;
  /** العنوان الحرفي من الإطار — ماذا حدث. */
  readonly title: ReactNode;
  /** الأثر والخطوة التالية. */
  readonly children?: ReactNode;
  /** الفعل التالي الواحد — إلزامي للحالة الفارغة (R-10). */
  readonly action?: ReactNode;
  /** شريط علوي مستمر (offline/phase_locked في الإطار). */
  readonly bar?: boolean;
}

export function Notice({ kind, title, children, action, bar = false }: NoticeProps) {
  if (kind === "empty" && !action && !children) {
    throw new Error("C-NOTICE empty: الحالة الفارغة تحمل فعلاً أو سبباً (R-10)");
  }
  const state = kindState[kind];
  const vars = {
    "--c-status-bg": stateColor[`${state}.bg`],
    "--c-status-fg": stateColor[`${state}.fg`],
    "--c-status-border": stateColor[`${state}.border`],
  } as CSSProperties;
  const role = kind === "error" ? "alert" : "status";
  return (
    <div
      className={`c-notice c-notice--${kind}${bar ? " c-notice--bar" : ""}`}
      style={vars}
      role={role}
      data-kind={kind}
    >
      <span className="c-notice__icon" aria-hidden="true">
        {kindIcon[kind]}
      </span>
      <div className="c-notice__body">
        <p className="c-notice__title">{title}</p>
        {children ? <div className="c-notice__text">{children}</div> : null}
      </div>
      {action ? <div className="c-notice__action">{action}</div> : null}
    </div>
  );
}
