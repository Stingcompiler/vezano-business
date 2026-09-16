/**
 * C-FIELD — نص/رقم/منطقة نص/اختيار/مفتاح/راديو؛ مع/بدون تلميح؛ قراءة فقط.
 * الحالات: ready, validation_error, saving, disabled, permission_denied.
 * الخطأ نص كامل تحت الحقل يقول ما الخطأ وكيف يُصلح (لا «قيمة غير صحيحة»)، مرتبط بـ aria-describedby
 * وaria-invalid. حقول المال بخط mono واتجاه LTR داخل صفحة RTL (23-Handoff، 02-Design-System).
 */
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
} from "react";

interface FieldBase {
  readonly label: string;
  readonly hint?: string | undefined;
  /** نص الخطأ الكامل من الإطار المرسوم: ما الخطأ وكيف يُصلح. */
  readonly error?: string | undefined;
  readonly readOnly?: boolean | undefined;
  /** سبب التعطيل — لا حقل معطّل صامت (R-02). */
  readonly disabledReason?: string | undefined;
  readonly saving?: boolean | undefined;
  /** الأرقام والمال والمعرفات: mono + LTR معزول (القاعدة 2). */
  readonly mono?: boolean | undefined;
  readonly required?: boolean | undefined;
}

export interface TextFieldProps
  extends
    FieldBase,
    Omit<InputHTMLAttributes<HTMLInputElement>, "readOnly" | "required" | "disabled"> {
  readonly kind?: "text" | "number" | "tel" | "password" | "date";
}

function Wrapper({
  id,
  label,
  hint,
  error,
  disabledReason,
  saving,
  required,
  children,
}: FieldBase & { id: string; children: ReactNode }) {
  return (
    <div className={`c-field${error ? " c-field--error" : ""}`}>
      <label className="c-field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="c-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="c-field__error" role="alert">
          {error}
        </p>
      ) : null}
      {disabledReason ? (
        <p id={`${id}-reason`} className="c-field__hint">
          {disabledReason}
        </p>
      ) : null}
      {saving ? (
        <p className="c-field__hint" role="status">
          جارٍ الحفظ…
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, f: FieldBase) =>
  [f.error ? `${id}-error` : f.hint ? `${id}-hint` : null, f.disabledReason ? `${id}-reason` : null]
    .filter(Boolean)
    .join(" ") || undefined;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    readOnly,
    disabledReason,
    saving,
    mono,
    required,
    kind = "text",
    className,
    id: givenId,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const base = { label, hint, error, readOnly, disabledReason, saving, mono, required };
  return (
    <Wrapper id={id} {...base}>
      <input
        ref={ref}
        id={id}
        type={kind}
        className={["c-field__input", mono ? "sting-mono" : "", className]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, base)}
        aria-required={required || undefined}
        readOnly={readOnly}
        disabled={Boolean(disabledReason) || saving}
        inputMode={mono && kind === "text" ? "decimal" : undefined}
        {...rest}
      />
    </Wrapper>
  );
});

export interface TextAreaFieldProps
  extends
    FieldBase,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "readOnly" | "required" | "disabled"> {}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    {
      label,
      hint,
      error,
      readOnly,
      disabledReason,
      saving,
      required,
      className,
      id: givenId,
      ...rest
    },
    ref,
  ) {
    const autoId = useId();
    const id = givenId ?? autoId;
    const base = { label, hint, error, readOnly, disabledReason, saving, required };
    return (
      <Wrapper id={id} {...base}>
        <textarea
          ref={ref}
          id={id}
          className={["c-field__input", className].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, base)}
          aria-required={required || undefined}
          readOnly={readOnly}
          disabled={Boolean(disabledReason) || saving}
          {...rest}
        />
      </Wrapper>
    );
  },
);

export interface SelectFieldProps
  extends FieldBase, Omit<SelectHTMLAttributes<HTMLSelectElement>, "required" | "disabled"> {
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  {
    label,
    hint,
    error,
    disabledReason,
    saving,
    required,
    options,
    className,
    id: givenId,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const base = { label, hint, error, disabledReason, saving, required };
  return (
    <Wrapper id={id} {...base}>
      <select
        ref={ref}
        id={id}
        className={["c-field__input", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, base)}
        aria-required={required || undefined}
        disabled={Boolean(disabledReason) || saving}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
});

export interface SwitchFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string;
  readonly disabledReason?: string;
}

export function SwitchField({ label, checked, onChange, hint, disabledReason }: SwitchFieldProps) {
  const id = useId();
  return (
    <div className="c-field c-field--switch">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint || disabledReason ? `${id}-hint` : undefined}
        disabled={Boolean(disabledReason)}
        className="c-field__switch sting-touch"
        onClick={() => onChange(!checked)}
      >
        <span className="c-field__switch-track" aria-hidden="true">
          <span className="c-field__switch-thumb" />
        </span>
        <span>{label}</span>
      </button>
      {hint || disabledReason ? (
        <p id={`${id}-hint`} className="c-field__hint">
          {disabledReason ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export interface RadioGroupFieldProps {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly hint?: string;
  }[];
  readonly error?: string;
}

export function RadioGroupField({
  label,
  name,
  value,
  onChange,
  options,
  error,
}: RadioGroupFieldProps) {
  const id = useId();
  return (
    <fieldset
      className={`c-field${error ? " c-field--error" : ""}`}
      aria-describedby={error ? `${id}-error` : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="c-field__label">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="c-field__radio sting-touch">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>
            {o.label}
            {o.hint ? <span className="c-field__hint"> — {o.hint}</span> : null}
          </span>
        </label>
      ))}
      {error ? (
        <p id={`${id}-error`} className="c-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
