/**
 * C-MONEY — إدخال مبلغ، عرض مبلغ، موجب/سالب (مدين/دائن)، وتسوية مختلطة.
 * الرقم mono واتجاه LTR داخل RTL؛ رمز العملة بجانب الرقم في span منفصل (لا حرف عربي داخل mono —
 * القاعدة 2). السالب يُعلن «مدين» نصاً لا بلون فقط. الأسهم تزيد/تنقص بخطوة معلنة.
 * سطر المطابقة إلزامي في كل تسوية مختلطة ويمنع الحفظ ما لم يساوِ المجموع الإجمالي (02-Design-System).
 * لا حساب ولا تقريب هنا: المطابقة من @sting/domain (القسم ٦ من الأمر).
 */
import { DomainError, invoiceTotalMinor, parseIntegerString } from "@sting/domain";
import { type ChangeEvent, type KeyboardEvent, useId, useState } from "react";

import { formatMinor, parseMoneyInput } from "./format";

export interface MoneyProps {
  /** سلسلة قانونية بالوحدة الصغرى. */
  readonly minor: string;
  readonly currency: string;
  readonly exponent?: number;
  /** يعرض «مدين/دائن» نصاً بدل الإشارة. */
  readonly ledger?: boolean;
  readonly size?: "body" | "title";
}

export function Money({
  minor,
  currency,
  exponent = 2,
  ledger = false,
  size = "body",
}: MoneyProps) {
  const negative = BigInt(minor) < 0n;
  const abs = negative ? (-BigInt(minor)).toString() : minor;
  return (
    <span className={`c-money c-money--${size}`} data-negative={negative || undefined}>
      {ledger ? <span className="c-money__side">{negative ? "دائن" : "مدين"}</span> : null}
      <span className="sting-mono">{formatMinor(ledger ? abs : minor, exponent)}</span>
      <span className="c-money__currency">{currency}</span>
      <span className="visually-hidden">{`${formatMinor(ledger ? abs : minor, exponent)} ${currency}${negative && !ledger ? " سالب" : ""}`}</span>
    </span>
  );
}

export interface MoneyInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (minor: string | null, raw: string) => void;
  readonly currency: string;
  readonly exponent?: number;
  readonly stepMinor?: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly disabledReason?: string | undefined;
  readonly max?: string | undefined;
}

export function MoneyInput({
  label,
  value,
  onChange,
  currency,
  exponent = 2,
  stepMinor = "100",
  error,
  hint,
  disabledReason,
  max,
}: MoneyInputProps) {
  const id = useId();
  const [raw, setRaw] = useState(() => (value === "" ? "" : formatMinor(value, exponent, false)));
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const describedBy =
    [
      error || localError ? `${id}-error` : hint ? `${id}-hint` : null,
      disabledReason ? `${id}-reason` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const commit = (text: string) => {
    setRaw(text);
    const parsed = text === "" ? "0" : parseMoneyInput(text, exponent);
    if (parsed === null) {
      setLocalError(`اكتب مبلغاً بمنزلتين على الأكثر — مثل 40.00`);
      onChange(null, text);
      return;
    }
    try {
      parseIntegerString(parsed);
    } catch (e) {
      setLocalError(
        e instanceof DomainError && e.code === "out_of_range"
          ? "المبلغ يتجاوز الحدّ المسموح"
          : "مبلغ غير مقبول",
      );
      onChange(null, text);
      return;
    }
    if (max !== undefined && BigInt(parsed) > BigInt(max)) {
      setLocalError(`المبلغ يتجاوز الحدّ ${formatMinor(max, exponent)}`);
      onChange(null, text);
      return;
    }
    setLocalError(undefined);
    onChange(parsed, text);
  };
  const step = (dir: 1n | -1n) => {
    const current = raw === "" ? "0" : (parseMoneyInput(raw, exponent) ?? "0");
    const next = BigInt(current) + dir * BigInt(stepMinor);
    if (next < 0n) return;
    commit(formatMinor(next, exponent, false));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1n);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1n);
    }
  };
  const shownError = error ?? localError;
  return (
    <div className={`c-field c-money-input${shownError ? " c-field--error" : ""}`}>
      <label className="c-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="c-money-input__row">
        <input
          id={id}
          className="c-field__input sting-mono"
          inputMode="decimal"
          value={raw}
          onChange={(e: ChangeEvent<HTMLInputElement>) => commit(e.target.value)}
          onKeyDown={onKey}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          aria-label={`${label} بـ${currency}`}
          disabled={Boolean(disabledReason)}
          autoComplete="off"
        />
        <span className="c-money__currency" aria-hidden="true">
          {currency}
        </span>
      </div>
      {hint && !shownError ? (
        <p id={`${id}-hint`} className="c-field__hint">
          {hint}
        </p>
      ) : null}
      {shownError ? (
        <p id={`${id}-error`} className="c-field__error" role="alert">
          {shownError}
        </p>
      ) : null}
      {disabledReason ? (
        <p id={`${id}-reason`} className="c-field__hint">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

export interface SettlementProps {
  readonly totalMinor: string;
  readonly cashMinor: string;
  readonly bankMinor: string;
  readonly creditMinor: string;
  readonly onChange: (part: "cash" | "bank" | "credit", minor: string | null) => void;
  readonly currency: string;
  readonly exponent?: number;
  /** الآجل يحتاج طرفاً؛ بلا طرف يُعطَّل بسبب. */
  readonly creditDisabledReason?: string | undefined;
}

/** تسوية مختلطة: النقد → الصندوق، الآجل → ذمّة، التحويل → «مسجَّل — غير مطابق» (القاعدة 7). */
export function Settlement({
  totalMinor,
  cashMinor,
  bankMinor,
  creditMinor,
  onChange,
  currency,
  exponent = 2,
  creditDisabledReason,
}: SettlementProps) {
  let sum: bigint | null = null;
  try {
    sum = invoiceTotalMinor([BigInt(cashMinor), BigInt(bankMinor), BigInt(creditMinor)]);
  } catch {
    sum = null;
  }
  const total = BigInt(totalMinor);
  const matched = sum !== null && sum === total;
  const f = (m: string) => formatMinor(m, exponent);
  return (
    <fieldset className="c-settlement">
      <legend className="c-field__label">التسوية</legend>
      <div className="c-settlement__total">
        <span>الإجمالي</span>
        <Money minor={totalMinor} currency={currency} exponent={exponent} size="title" />
      </div>
      <div className="c-settlement__parts">
        <MoneyInput
          label="نقداً"
          value={cashMinor}
          currency={currency}
          exponent={exponent}
          onChange={(m) => onChange("cash", m)}
          hint="يدخل الصندوق"
        />
        <MoneyInput
          label="آجل"
          value={creditMinor}
          currency={currency}
          exponent={exponent}
          onChange={(m) => onChange("credit", m)}
          hint="ذمّة على العميل"
          disabledReason={creditDisabledReason}
        />
        <MoneyInput
          label="تحويل"
          value={bankMinor}
          currency={currency}
          exponent={exponent}
          onChange={(m) => onChange("bank", m)}
          hint="مسجَّل — غير مطابق حتى التأكيد"
        />
      </div>
      <p
        className={`c-settlement__match${matched ? " c-settlement__match--ok" : " c-settlement__match--bad"}`}
        role="status"
        data-matched={matched}
      >
        {sum === null ? (
          "أكمل المبالغ"
        ) : matched ? (
          <>
            مطابق{" "}
            <span className="sting-mono">{`${f(cashMinor)} + ${f(creditMinor)} + ${f(bankMinor)} = ${f(totalMinor)}`}</span>
          </>
        ) : (
          <>
            مجموع التسوية <span className="sting-mono">{f(sum.toString())}</span>{" "}
            {sum > total ? "يتجاوز" : "أقل من"} الإجمالي{" "}
            <span className="sting-mono">{f(totalMinor)}</span> — عدّل أحد المبالغ.
          </>
        )}
      </p>
    </fieldset>
  );
}
