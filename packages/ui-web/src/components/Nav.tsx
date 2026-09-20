/**
 * C-NAV — جانبي (ويب/ديسكتوب)، سفلي (موبايل ≤5 عناصر)، علوي (إدارة Sting). ترتيب العناصر من اليمين.
 * العنصر المقيد يعلن سبب التقييد لا يُخفى صامتاً (permission_denied / phase_locked).
 * أسهم لأعلى/أسفل داخل القائمة، Home/End للطرفين (23-Handoff).
 */
import { type KeyboardEvent, type ReactNode, useRef } from "react";

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: ReactNode;
  /** سبب التقييد — نص الإطار المرسوم. */
  readonly restrictedReason?: string;
  /** عنوان المجموعة — يُرسم مرة عند أول عنصر يحمله (الجانبي فقط). */
  readonly group?: string;
}

export interface NavProps {
  readonly items: readonly NavItem[];
  readonly currentId: string;
  readonly variant?: "side" | "bottom" | "top";
  readonly label: string;
  readonly onNavigate?: (item: NavItem) => void;
}

export function Nav({ items, currentId, variant = "side", label, onNavigate }: NavProps) {
  if (variant === "bottom" && items.length > 5) throw new Error("C-NAV bottom: ≤5 عناصر");
  const listRef = useRef<HTMLUListElement>(null);
  const focusAt = (index: number) => {
    const links = listRef.current?.querySelectorAll<HTMLElement>("a,[role=link]");
    links?.[Math.max(0, Math.min(index, (links?.length ?? 1) - 1))]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const links = [...(listRef.current?.querySelectorAll<HTMLElement>("a,[role=link]") ?? [])];
    const i = links.indexOf(document.activeElement as HTMLElement);
    const vertical = variant !== "bottom";
    const next = vertical ? "ArrowDown" : "ArrowLeft";
    const prev = vertical ? "ArrowUp" : "ArrowRight";
    const target =
      e.key === next
        ? i + 1
        : e.key === prev
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? links.length - 1
              : null;
    if (target === null) return;
    e.preventDefault();
    focusAt(target);
  };
  return (
    <nav aria-label={label}>
      <ul ref={listRef} className={`c-nav c-nav--${variant}`}>
        {items.map((item, i) => {
          const current = item.id === currentId;
          const restricted = Boolean(item.restrictedReason);
          const heading =
            variant === "side" && item.group && items[i - 1]?.group !== item.group
              ? item.group
              : null;
          return (
            <li key={item.id} className={heading ? "c-nav__section" : undefined}>
              {heading ? <div className="c-nav__group">{heading}</div> : null}
              <a
                className="c-nav__item"
                // المقيد يبقى رابطاً مرئياً بسببه لا مخفياً؛ الانتقال يُمنع في onClick (R-02)
                href={item.href}
                aria-current={current ? "page" : undefined}
                aria-disabled={restricted || undefined}
                onKeyDown={onKeyDown}
                onClick={(e) => {
                  if (restricted) {
                    e.preventDefault();
                    return;
                  }
                  if (onNavigate) {
                    e.preventDefault();
                    onNavigate(item);
                  }
                }}
              >
                {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                <span>
                  {item.label}
                  {restricted ? (
                    <span className="c-nav__reason"> — {item.restrictedReason}</span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
