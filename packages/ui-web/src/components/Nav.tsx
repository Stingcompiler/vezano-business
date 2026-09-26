/**
 * C-NAV — جانبي (ويب/ديسكتوب)، سفلي (موبايل ≤5 عناصر)، علوي (إدارة Sting). ترتيب العناصر من اليمين.
 * العنصر المقيد يعلن سبب التقييد لا يُخفى صامتاً (permission_denied / phase_locked).
 * أسهم لأعلى/أسفل داخل القائمة، Home/End للطرفين (23-Handoff).
 *
 * `collapsible` (الجانبي، 0005 §١٣٤): المجموعات تُطوى — مجموعة الصفحة الحالية مفتوحة، والباقي عنوان
 * بعدد عناصره يُفتح بنقرة. العناصر بلا مجموعة (الرئيسية، البحث) ظاهرة دائماً أعلى القائمة. المطويّ
 * يبقى في DOM (`hidden`) فتجده المواصفات وتفتح مجموعته.
 */
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

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
  /** مجموعات قابلة للطيّ (الجانبي فقط). */
  readonly collapsible?: boolean;
}

export function Nav({
  items,
  currentId,
  variant = "side",
  label,
  onNavigate,
  collapsible = false,
}: NavProps) {
  if (variant === "bottom" && items.length > 5) throw new Error("C-NAV bottom: ≤5 عناصر");
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const currentGroup = items.find((i) => i.id === currentId)?.group;
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(currentGroup ? [currentGroup] : []),
  );
  const toggle = (g: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const visibleLinks = () =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("a,[role=link]") ?? [])].filter(
      (el) => !el.closest("[hidden]"),
    );
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const links = visibleLinks();
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
    links[Math.max(0, Math.min(target, links.length - 1))]?.focus();
  };

  const link = (item: NavItem) => {
    const current = item.id === currentId;
    const restricted = Boolean(item.restrictedReason);
    return (
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
          {restricted ? <span className="c-nav__reason"> — {item.restrictedReason}</span> : null}
        </span>
      </a>
    );
  };

  if (collapsible && variant === "side") {
    // المجموعات بترتيب أول ظهور؛ ما بلا مجموعة يُرسم أولاً ظاهراً دائماً
    const loose = items.filter((i) => !i.group);
    const groups: { name: string; items: NavItem[] }[] = [];
    for (const item of items) {
      if (!item.group) continue;
      const g = groups.find((x) => x.name === item.group);
      if (g) g.items.push(item);
      else groups.push({ name: item.group, items: [item] });
    }
    return (
      <nav aria-label={label}>
        <ul ref={listRef} className="c-nav c-nav--side c-nav--collapsible">
          {loose.map((item) => (
            <li key={item.id}>{link(item)}</li>
          ))}
          {groups.map((g, gi) => {
            const isOpen = open.has(g.name);
            const hasCurrent = g.items.some((i) => i.id === currentId);
            const panelId = `${baseId}-g${gi}`;
            return (
              <li key={g.name} className="c-nav__section" data-open={isOpen || undefined}>
                <button
                  type="button"
                  className="c-nav__group c-nav__group--toggle"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  data-current={hasCurrent || undefined}
                  // فتح مجموعة داخل درج الهاتف لا يغلق الدرج (Frame يغلقه عند أي زرّ إلا هذا)
                  data-keep-nav
                  onClick={() => toggle(g.name)}
                >
                  <span className="c-nav__group-label">{g.name}</span>
                  <span className="c-nav__group-count sting-mono">{g.items.length}</span>
                  <span className="c-nav__chevron" aria-hidden="true" />
                </button>
                <ul id={panelId} className="c-nav__sub" hidden={!isOpen}>
                  {g.items.map((item) => (
                    <li key={item.id}>{link(item)}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={label}>
      <ul ref={listRef} className={`c-nav c-nav--${variant}`}>
        {items.map((item, i) => {
          const heading =
            variant === "side" && item.group && items[i - 1]?.group !== item.group
              ? item.group
              : null;
          return (
            <li key={item.id} className={heading ? "c-nav__section" : undefined}>
              {heading ? <div className="c-nav__group">{heading}</div> : null}
              {link(item)}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
