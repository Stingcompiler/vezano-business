/**
 * C-RECV — استلام كامل/جزئي/بفرق كمية/بفرق سعر. الحالات: ready, validation_error, partial,
 * saving, saved_local, conflict. أربع كميات مستقلة لا تُدمج في رقم واحد أبداً — مطلوب/مؤكد/مستلم/
 * متبقٍ (ACC-127/128/129). المستلم لا يتجاوز المؤكد، والمؤكد لا يتجاوز المطلوب. المتبقي يُلغى بفعل
 * صريح ولا يُمحى ما سُلّم. الفرق يُعلن رقماً واتجاهاً («ناقص ٣ حبة») لا لوناً فقط.
 */
import { useId } from "react";

import { formatQty } from "./format";

export interface ReceiveLineProps {
  readonly item: string;
  readonly unitLabel: string;
  readonly decimalPlaces: 0 | 1 | 2 | 3;
  readonly requestedMilli: string;
  readonly confirmedMilli: string;
  readonly shippedMilli?: string | undefined;
  readonly receivedMilli: string;
  /** المستلم يُدخله المستخدم؛ التحقق من الحدود من النواة عبر onChange(null) عند الخطأ. */
  readonly onReceived: (milli: string | null) => void;
  readonly error?: string | undefined;
  readonly readOnly?: boolean | undefined;
}

export function ReceiveLine({
  item,
  unitLabel,
  decimalPlaces,
  requestedMilli,
  confirmedMilli,
  shippedMilli,
  receivedMilli,
  onReceived,
  error,
  readOnly,
}: ReceiveLineProps) {
  const id = useId();
  const q = (m: string) => formatQty(m, decimalPlaces);
  const cap = BigInt(shippedMilli ?? confirmedMilli);
  const received = BigInt(receivedMilli || "0");
  const remaining = cap - received;
  const diffText =
    remaining === 0n
      ? "مكتمل"
      : remaining > 0n
        ? `ناقص ${q(remaining.toString())} ${unitLabel}`
        : `زائد ${q((-remaining).toString())} ${unitLabel}`;
  const commit = (text: string) => {
    const latin = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace("٫", ".");
    const m = /^(\d+)(?:\.(\d{0,3}))?$/.exec(latin.trim());
    if (!m) {
      onReceived(null);
      return;
    }
    const milli = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0") || "0");
    onReceived(milli.toString());
  };
  return (
    <div className={`c-recv${error ? " c-field--error" : ""}`} role="group" aria-label={item}>
      <p className="c-recv__item">{item}</p>
      <dl className="c-recv__grid">
        <div className="c-recv__cell">
          <dt>مطلوب</dt>
          <dd className="sting-mono">{q(requestedMilli)}</dd>
        </div>
        <div className="c-recv__cell">
          <dt>مؤكد</dt>
          <dd className="sting-mono">{q(confirmedMilli)}</dd>
        </div>
        {shippedMilli !== undefined ? (
          <div className="c-recv__cell">
            <dt>مشحون</dt>
            <dd className="sting-mono">{q(shippedMilli)}</dd>
          </div>
        ) : null}
        <div className="c-recv__cell c-recv__cell--input">
          <dt>
            <label htmlFor={id}>مستلم</label>
          </dt>
          <dd>
            <input
              id={id}
              className="c-field__input sting-mono"
              inputMode="decimal"
              defaultValue={q(receivedMilli)}
              onChange={(e) => commit(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-diff${error ? ` ${id}-error` : ""}`}
              readOnly={readOnly}
            />
          </dd>
        </div>
        <div className="c-recv__cell">
          <dt>متبقٍ</dt>
          <dd className="sting-mono">{q((remaining > 0n ? remaining : 0n).toString())}</dd>
        </div>
      </dl>
      <p
        id={`${id}-diff`}
        className={`c-recv__diff${remaining < 0n ? " c-field__error" : " c-field__hint"}`}
        role="status"
      >
        {diffText}
      </p>
      {error ? (
        <p id={`${id}-error`} className="c-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
