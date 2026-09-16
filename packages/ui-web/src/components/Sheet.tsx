/**
 * C-SHEET — bottom sheet: نصفي، كامل، قائمة إجراءات؛ سحب للإغلاق مع بديل زر إغلاق مرئي دائماً.
 * Esc يغلق؛ التركيز محصور؛ العنصر الأول قابل للتركيز عند الفتح. dialog مع aria-modal.
 */
import { X } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";

import { Button } from "./Button";
import { useFocusTrap } from "./focus-trap";

export interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly height?: "half" | "full" | "actions";
  readonly children: ReactNode;
}

export function Sheet({ open, title, onClose, height = "half", children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, { onEscape: onClose });
  if (!open) return null;
  return (
    <div className="c-sheet__backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`c-sheet c-sheet--${height}`}
      >
        <div className="c-sheet__handle" aria-hidden="true" />
        <div className="c-sheet__head">
          <h2 id={titleId} className="c-sheet__title">
            {title}
          </h2>
          <Button
            variant="icon"
            iconLabel="إغلاق"
            icon={<X size={20} />}
            onClick={onClose}
            data-initial-focus
          />
        </div>
        <div className="c-sheet__body">{children}</div>
      </div>
    </div>
  );
}
