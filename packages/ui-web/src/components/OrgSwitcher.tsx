/**
 * C-ORGSW — محوّل منشأة وفرع: combobox/listbox؛ قراءة فقط حين لا يملك المستخدم إلا منشأة واحدة؛
 * تغيير المنشأة يُعلن عبر live region لأنه يُبطل محتوى الشاشة (23-Handoff).
 * Enter/Space يفتح، أسهم للتنقل، Esc يغلق ويعيد التركيز للزر.
 */
import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface OrgOption {
  readonly id: string;
  readonly name: string;
  readonly branch?: string;
}

export interface OrgSwitcherProps {
  readonly options: readonly OrgOption[];
  readonly selectedId: string;
  readonly onChange: (option: OrgOption) => void;
  readonly label?: string;
  /** نص الإعلان عند التغيير — نص الإطار. */
  readonly announce?: (option: OrgOption) => string;
}

export function OrgSwitcher({
  options,
  selectedId,
  onChange,
  label = "المنشأة والفرع",
  announce = (o) => `تم الانتقال إلى ${o.name}`,
}: OrgSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(
    Math.max(
      0,
      options.findIndex((o) => o.id === selectedId),
    ),
  );
  const [live, setLive] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === selectedId) ?? options[0];
  const readOnly = options.length <= 1;

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.focus();
  }, [open, active, listId]);

  const choose = (o: OrgOption) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (o.id !== selectedId) {
      onChange(o);
      setLive(announce(o));
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(options[active]!);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      default:
    }
  };

  return (
    <div className="c-orgsw">
      <button
        ref={triggerRef}
        type="button"
        className="c-btn c-btn--secondary c-orgsw__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        aria-disabled={readOnly || undefined}
        onClick={() => !readOnly && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>
          {selected?.name}
          {selected?.branch ? <span className="c-orgsw__branch">{selected.branch}</span> : null}
        </span>
        {readOnly ? null : <ChevronDown size={18} aria-hidden="true" />}
      </button>
      {open ? (
        <ul id={listId} role="listbox" className="c-orgsw__list" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={i === active ? 0 : -1}
              aria-selected={o.id === selectedId}
              className="c-orgsw__option"
              onClick={() => choose(o)}
              onKeyDown={onListKey}
              onMouseEnter={() => setActive(i)}
            >
              {o.name}
              {o.branch ? <span className="c-orgsw__branch">{o.branch}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {live}
      </span>
    </div>
  );
}
