/**
 * C-DIALOG — تأكيد، تأكيد خطر (يطلب كتابة أو اختياراً)، نموذج، رسالة معلومة.
 * الحالات: ready, saving, validation_error, server_error.
 * أزرار الإجراء أسفل بداية السطر (RTL: يمين)؛ الإجراء الأساسي أول ما يُقرأ. Esc يغلق (إلا حوار
 * الخطر)، التركيز محصور ويعود لمصدره. role="dialog" aria-modal مع عنوان؛ التركيز ينتقل للعنوان.
 * الفعل المدمّر: معاينة الأثر وإقرار إنسان (R-03).
 */
import { type ReactNode, useId, useRef, useState } from "react";

import { Button } from "./Button";
import { useFocusTrap } from "./focus-trap";

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children?: ReactNode;
  readonly onClose: () => void;
  readonly kind?: "confirm" | "danger" | "form" | "info";
  readonly primaryLabel?: string | undefined;
  readonly onPrimary?: (() => void) | undefined;
  readonly cancelLabel?: string;
  readonly saving?: boolean | undefined;
  /** خطأ الخادم بمعرّف للدعم — نص الإطار. */
  readonly error?: string | undefined;
  /** حوار الخطر: كلمة يجب كتابتها حرفياً قبل التنفيذ. */
  readonly confirmWord?: string | undefined;
  readonly confirmPrompt?: string | undefined;
}

export function Dialog({
  open,
  title,
  children,
  onClose,
  kind = "confirm",
  primaryLabel,
  onPrimary,
  cancelLabel = "إلغاء",
  saving,
  error,
  confirmWord,
  confirmPrompt,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [typed, setTyped] = useState("");
  const danger = kind === "danger";
  useFocusTrap(ref, open, {
    initialFocus: titleRef,
    onEscape: danger || saving ? undefined : onClose,
  });
  if (!open) return null;
  const armed = !danger || !confirmWord || typed === confirmWord;
  return (
    <div className="c-dialog__backdrop">
      <div
        ref={ref}
        role={danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`c-dialog c-dialog--${kind}`}
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="c-dialog__title">
          {title}
        </h2>
        <div className="c-dialog__body">{children}</div>
        {error ? (
          <p className="c-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        {danger && confirmWord ? (
          <label className="c-dialog__confirm">
            <span>{confirmPrompt ?? `اكتب «${confirmWord}» للتأكيد`}</span>
            <input
              className="c-field__input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </label>
        ) : null}
        <div className="c-dialog__actions">
          {primaryLabel ? (
            <Button
              variant={danger ? "danger" : "primary"}
              onClick={onPrimary}
              loading={saving}
              disabledReason={armed ? undefined : "اكتب كلمة التأكيد أولاً"}
            >
              {primaryLabel}
            </Button>
          ) : null}
          {kind !== "info" ? (
            <Button
              variant="secondary"
              onClick={onClose}
              disabledReason={saving ? "انتظر اكتمال الحفظ" : undefined}
            >
              {cancelLabel}
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              إغلاق
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
