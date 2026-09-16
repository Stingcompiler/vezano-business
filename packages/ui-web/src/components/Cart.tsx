/**
 * C-CART — سلة POS، سلة سوق B2B، ملخص دفع، دفع جزئي/آجل. الحالات: ready, empty,
 * validation_error, saving, saved_local, pending_sync, offline.
 * بنود السلة في البداية والمبالغ في النهاية بعمود mono؛ أسهم بين البنود، Delete يحذف بنداً؛
 * إجمالي السلة يُعلن عند كل تغيير؛ الحذف قابل للتراجع مع إعلان (23-Handoff).
 * الإجمالي يُمرَّر من النواة (لا حساب في الواجهة).
 */
import { Trash2, Undo2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "./Button";
import { formatMinor } from "./format";
import { Money } from "./Money";

export interface CartLine {
  readonly id: string;
  readonly name: string;
  readonly qtyLabel: string;
  readonly unitLabel: string;
  readonly unitPriceMinor: string;
  readonly lineTotalMinor: string;
  readonly note?: string | undefined;
}

export interface CartProps {
  readonly lines: readonly CartLine[];
  readonly totalMinor: string;
  readonly currency: string;
  readonly exponent?: number;
  readonly onRemove: (id: string) => void;
  readonly onUndoRemove?: ((id: string) => void) | undefined;
  readonly onQty?: ((id: string) => void) | undefined;
  readonly empty: ReactNode;
  readonly footer?: ReactNode;
  readonly saving?: boolean | undefined;
}

export function Cart({
  lines,
  totalMinor,
  currency,
  exponent = 2,
  onRemove,
  onUndoRemove,
  onQty,
  empty,
  footer,
  saving,
}: CartProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [live, setLive] = useState("");
  const [lastRemoved, setLastRemoved] = useState<CartLine | null>(null);
  useEffect(() => {
    setLive(`إجمالي السلة ${formatMinor(totalMinor, exponent)} ${currency}`);
  }, [totalMinor, currency, exponent]);

  const focusAt = (i: number) => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-cart-line]");
    items?.[Math.max(0, Math.min(i, (items?.length ?? 1) - 1))]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, line: CartLine, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === "Delete") {
      e.preventDefault();
      remove(line);
    } else if (e.key === "Enter" && onQty) {
      e.preventDefault();
      onQty(line.id);
    }
  };
  const remove = (line: CartLine) => {
    setLastRemoved(line);
    onRemove(line.id);
    setLive(`حُذف ${line.name} — يمكنك التراجع`);
  };
  return (
    <section className="c-cart" aria-label="السلة" aria-busy={saving || undefined}>
      {lines.length === 0 ? (
        <div className="c-cart__empty">{empty}</div>
      ) : (
        <ul ref={listRef} className="c-cart__lines">
          {lines.map((line, i) => (
            <li key={line.id} className="c-cart__line">
              <div
                className="c-cart__line-main"
                data-cart-line
                tabIndex={0}
                role="button"
                aria-label={`${line.name} — ${line.qtyLabel} ${line.unitLabel}`}
                onKeyDown={(e) => onKey(e, line, i)}
                onClick={() => onQty?.(line.id)}
              >
                <span className="c-cart__name">{line.name}</span>
                <span className="c-cart__qty">
                  <span className="sting-mono">{line.qtyLabel}</span> {line.unitLabel} ×{" "}
                  <span className="sting-mono">{formatMinor(line.unitPriceMinor, exponent)}</span>
                </span>
                {line.note ? <span className="c-field__hint">{line.note}</span> : null}
              </div>
              <span className="c-cart__total sting-mono">
                {formatMinor(line.lineTotalMinor, exponent)}
              </span>
              <Button
                variant="icon"
                iconLabel={`حذف ${line.name}`}
                icon={<Trash2 size={18} />}
                onClick={() => remove(line)}
                disabledReason={saving ? "انتظر اكتمال الحفظ" : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      {lastRemoved && onUndoRemove ? (
        <div className="c-cart__undo" role="status">
          حُذف {lastRemoved.name}.{" "}
          <Button
            variant="quiet"
            icon={<Undo2 size={16} />}
            onClick={() => {
              onUndoRemove(lastRemoved.id);
              setLastRemoved(null);
            }}
          >
            تراجع
          </Button>
        </div>
      ) : null}
      <div className="c-cart__sum">
        <span>الإجمالي</span>
        <Money minor={totalMinor} currency={currency} exponent={exponent} size="title" />
      </div>
      {footer ? <div className="c-cart__footer">{footer}</div> : null}
      <span className="visually-hidden" aria-live="polite">
        {live}
      </span>
    </section>
  );
}
