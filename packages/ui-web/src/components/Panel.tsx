/**
 * C-PANEL — لوحة تفاصيل/تحرير/مرشّحات تفتح من الجانب الابتدائي (RTL: يمين).
 * الحالات: ready, loading, empty, saving, conflict. Esc يغلق؛ التركيز محصور حين تكون معيارية
 * (modal) وحرّ حين تكون مرافقة؛ complementary أو dialog حسب المعيارية؛ عنوان اللوحة أول ما يُعلن.
 */
import { X } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";

import { Button } from "./Button";
import { useFocusTrap } from "./focus-trap";

export interface PanelProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly modal?: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function Panel({ open, title, onClose, modal = false, children, footer }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, { onEscape: onClose, trap: modal });
  if (!open) return null;
  const body = (
    <>
      <div className="c-panel__head">
        <h2 id={titleId} className="c-panel__title" tabIndex={-1} data-initial-focus>
          {title}
        </h2>
        <Button variant="icon" iconLabel="إغلاق" icon={<X size={20} />} onClick={onClose} />
      </div>
      <div className="c-panel__body">{children}</div>
      {footer ? <div className="c-panel__footer">{footer}</div> : null}
    </>
  );
  if (modal) {
    return (
      <div className="c-panel__backdrop">
        <section
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="c-panel c-panel--modal"
        >
          {body}
        </section>
      </div>
    );
  }
  return (
    <aside ref={ref} aria-labelledby={titleId} className="c-panel">
      {body}
    </aside>
  );
}
