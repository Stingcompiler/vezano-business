/**
 * حصر التركيز وإعادته لمصدره عند الإغلاق، وEsc — مشترك بين C-DIALOG وC-SHEET وC-PANEL.
 * المستمع على جذر الطبقة (وليس على عنصر ثابت في JSX) لأن Esc وTab مفاتيح طبقة لا عنصر.
 */
import { type RefObject, useEffect } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Esc داخل الطبقة — يُستدعى في اللوحة المرافقة أيضاً (بلا حصر). */
  readonly onEscape?: (() => void) | undefined;
  /** حصر التركيز وإعادته للمصدر — للطبقات المعيارية فقط. */
  readonly trap?: boolean | undefined;
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus, onEscape, trap = true } = options;
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    if (trap) {
      const target =
        initialFocus?.current ?? root.querySelector<HTMLElement>("[data-initial-focus]") ?? root;
      target.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab" || !trap) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (trap) opener?.focus();
    };
  }, [ref, active, initialFocus, onEscape, trap]);
}
