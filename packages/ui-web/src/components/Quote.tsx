/**
 * C-QUOTE — إنشاء عرض سعر، مراجعة، إرسال، منتهي الصلاحية. الحالات: ready, saving,
 * validation_error, expired, permission_denied, success. جدول بنود العرض بترتيب RTL والمبالغ في
 * النهاية؛ Tab بين البنود؛ Enter يضيف بنداً في آخر صف. تاريخ الصلاحية يُعلن نصاً كاملاً؛ الإرسال
 * يطلب تأكيداً لا يحدث بضغطة واحدة. أي تعديل يولّد revision جديداً (§٧.٨).
 */
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { formatMinor } from "./format";
import { MoneyInput } from "./Money";
import { Status } from "./Status";

export interface QuoteLine {
  readonly id: string;
  readonly item: string;
  readonly unitLabel: string;
  readonly qtyLabel: string;
  readonly unitPriceMinor: string;
  readonly lineTotalMinor: string;
}

export interface QuoteProps {
  readonly revision: number;
  readonly lines: readonly QuoteLine[];
  readonly totalMinor: string;
  readonly currency: string;
  readonly validUntilLabel: string;
  readonly expired?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly saving?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onPrice?: ((id: string, minor: string | null) => void) | undefined;
  readonly onAddLine?: (() => void) | undefined;
  readonly onRemoveLine?: ((id: string) => void) | undefined;
  readonly onSend?: (() => void) | undefined;
  readonly sendConfirmText: string;
  /** الشروط الظاهرة قبل التأكيد: هوية البائع، التوصيل، التحصيل، المرتجع (§١٧.٤). */
  readonly terms: readonly string[];
}

export function Quote({
  revision,
  lines,
  totalMinor,
  currency,
  validUntilLabel,
  expired,
  readOnly,
  saving,
  error,
  onPrice,
  onAddLine,
  onRemoveLine,
  onSend,
  sendConfirmText,
  terms,
}: QuoteProps) {
  const [confirm, setConfirm] = useState(false);
  const captionId = useId();
  const editable = !readOnly && !expired;
  return (
    <section className="c-quote" aria-labelledby={captionId} aria-busy={saving || undefined}>
      <header className="c-quote__head">
        <h3 id={captionId}>
          عرض سعر — النسخة <span className="sting-mono">{revision}</span>
        </h3>
        <p className="c-quote__valid">
          صالح حتى <span className="sting-mono">{validUntilLabel}</span>
          {expired ? (
            <>
              {" "}
              <Status state="expired" label="انتهت صلاحية العرض — اطلب عرضاً جديداً" />
            </>
          ) : null}
        </p>
      </header>
      <table className="c-ledline c-quote__table">
        <caption className="visually-hidden">بنود العرض</caption>
        <thead>
          <tr>
            <th scope="col">الصنف</th>
            <th scope="col">الكمية</th>
            <th scope="col" className="c-table__num">
              سعر الوحدة
            </th>
            <th scope="col" className="c-table__num">
              الإجمالي
            </th>
            {editable && onRemoveLine ? (
              <th scope="col" className="visually-hidden">
                حذف
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <td data-label="الصنف">{l.item}</td>
              <td data-label="الكمية">
                <span className="sting-mono">{l.qtyLabel}</span> {l.unitLabel}
              </td>
              <td data-label="سعر الوحدة" className="c-table__num">
                {editable && onPrice ? (
                  <MoneyInput
                    label={`سعر ${l.item}`}
                    value={l.unitPriceMinor}
                    onChange={(m) => onPrice(l.id, m)}
                    currency={currency}
                  />
                ) : (
                  <span className="sting-mono">{formatMinor(l.unitPriceMinor)}</span>
                )}
              </td>
              <td data-label="الإجمالي" className="c-table__num">
                <span className="sting-mono">{formatMinor(l.lineTotalMinor)}</span>
              </td>
              {editable && onRemoveLine ? (
                <td>
                  <Button
                    variant="icon"
                    iconLabel={`حذف ${l.item}`}
                    icon={<Trash2 size={16} />}
                    onClick={() => onRemoveLine(l.id)}
                  />
                </td>
              ) : null}
              {editable && onAddLine && i === lines.length - 1 ? (
                <td className="visually-hidden">Enter يضيف بنداً</td>
              ) : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              الإجمالي
            </th>
            <td className="c-table__num">
              <span className="sting-mono">{formatMinor(totalMinor)}</span>{" "}
              <span className="c-money__currency">{currency}</span>
            </td>
            {editable && onRemoveLine ? <td /> : null}
          </tr>
        </tfoot>
      </table>
      {editable && onAddLine ? (
        <Button
          variant="secondary"
          icon={<Plus size={16} />}
          onClick={onAddLine}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddLine();
            }
          }}
        >
          أضف بنداً
        </Button>
      ) : null}
      <ul className="c-quote__terms" aria-label="الشروط">
        {terms.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {error ? (
        <p className="c-field__error" role="alert">
          {error}
        </p>
      ) : null}
      {editable && onSend ? (
        <Button onClick={() => setConfirm(true)} loading={saving}>
          أرسل العرض
        </Button>
      ) : null}
      <Dialog
        open={confirm}
        title="إرسال العرض؟"
        onClose={() => setConfirm(false)}
        primaryLabel="أرسل"
        onPrimary={() => {
          setConfirm(false);
          onSend?.();
        }}
      >
        {sendConfirmText}
      </Dialog>
    </section>
  );
}
