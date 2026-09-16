/**
 * C-PICK — اختيار واحد/متعدد/بحث مع اقتراحات/اختيار من خادم (نتائج مؤجلة).
 * الحالات: ready, loading, empty, offline (نتائج محلية فقط), stale.
 * combobox + aria-expanded؛ عدد النتائج يُعلن في live region مهذّب؛ أسهم للتنقل، Enter للاختيار،
 * Esc للإغلاق، Backspace يحذف آخر وسم في المتعدد (23-Handoff). البحث بالبادئة أولاً (§٧.٥).
 */
import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface PickOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
}

export interface PickProps {
  readonly label: string;
  readonly options: readonly PickOption[];
  readonly value: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
  readonly multiple?: boolean | undefined;
  readonly query: string;
  readonly onQuery: (q: string) => void;
  readonly loading?: boolean | undefined;
  /** نص فراغ النتائج من الإطار — بسبب أو فعل (R-10). */
  readonly emptyText?: ReactNode;
  /** offline: تُعرض نتائج محلية فقط مع بيانه. */
  readonly offlineText?: string | undefined;
  readonly countLabel: (n: number) => string;
  readonly placeholder?: string | undefined;
}

export function Pick({
  label,
  options,
  value,
  onChange,
  multiple = false,
  query,
  onQuery,
  loading,
  emptyText,
  offlineText,
  countLabel,
  placeholder,
}: PickProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();
  useEffect(() => setActive(0), [options]);
  const selectedOptions = value
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is PickOption => Boolean(o));

  const choose = (o: PickOption) => {
    if (multiple) {
      if (!value.includes(o.id)) onChange([...value, o.id]);
      onQuery("");
      inputRef.current?.focus();
    } else {
      onChange([o.id]);
      onQuery(o.label);
      setOpen(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpen(true);
        setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (open && options[active]) {
          e.preventDefault();
          choose(options[active]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Backspace":
        if (multiple && query === "" && value.length > 0) {
          e.preventDefault();
          onChange(value.slice(0, -1));
        }
        break;
      default:
    }
  };

  return (
    <div className="c-pick">
      <label className="c-field__label" htmlFor={inputId}>
        {label}
      </label>
      {multiple && selectedOptions.length > 0 ? (
        <ul className="c-pick__tags" aria-label="المختارة">
          {selectedOptions.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="c-filter__chip"
                aria-label={`إزالة ${o.label}`}
                onClick={() => onChange(value.filter((v) => v !== o.id))}
              >
                {o.label}
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        className="c-field__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          onQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        autoComplete="off"
      />
      {offlineText ? (
        <p className="c-field__hint" role="status">
          {offlineText}
        </p>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {loading ? "جارٍ الجلب" : countLabel(options.length)}
      </p>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="c-pick__list"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={value.includes(o.id)}
              className={`c-orgsw__option${i === active ? " c-pick__option--active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(o);
                }
              }}
            >
              {o.label}
              {o.hint ? <span className="c-orgsw__branch">{o.hint}</span> : null}
            </li>
          ))}
          {!loading && options.length === 0 ? (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="c-orgsw__option c-pick__empty"
            >
              {emptyText}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
