/**
 * C-FRAME — هيكل التطبيق: landmarks banner/navigation/main/contentinfo، Skip link أول عنصر قابل
 * للتركيز يقفز إلى المحتوى، F6 ينقل بين المناطق، الشريط الجانبي في الجانب الابتدائي (RTL: يمين).
 * الحالات: ready, offline, phase_locked — تُعرض شريطاً في الترويسة عبر `notice`.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface FrameProps {
  readonly title: string;
  readonly banner?: ReactNode;
  readonly nav?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /** نص الشريط العلوي لحالة offline أو phase_locked — نص الإطار المرسوم. */
  readonly notice?: ReactNode;
  readonly skipLabel?: string;
  /** زرّ فتح التنقل على الهاتف (< 834): الشريط الجانبي يصير درجاً من الجانب الابتدائي. */
  readonly menuLabel?: string;
  /** `side` (الافتراضي): جانبي على ≥ 834 ودرج على الهاتف؛ `top`: شريط علوي تحت الترويسة بكل المقاسات (إدارة Sting). */
  readonly navLayout?: "side" | "top";
}

export function Frame({
  title,
  banner,
  nav,
  footer,
  children,
  notice,
  skipLabel = "تخطٍّ إلى المحتوى",
  menuLabel = "القائمة",
  navLayout = "side",
}: FrameProps) {
  const drawer = Boolean(nav) && navLayout === "side";
  const rootRef = useRef<HTMLDivElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  // Escape يغلق الدرج على الهاتف
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);
  // F6 ينقل بين مناطق الهيكل (23-Handoff C-FRAME) — مستمع على المستند لأن F6 مفتاح هيكل لا عنصر
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "F6" || !rootRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const regions = [...rootRef.current.querySelectorAll<HTMLElement>("[data-region]")];
      const active = regions.findIndex((r) => r.contains(document.activeElement));
      regions[(active + 1) % regions.length]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div
      ref={rootRef}
      className={`c-frame${drawer ? " c-frame--sidebar" : ""}${nav && !drawer ? " c-frame--topnav" : ""}${navOpen ? " c-frame--nav-open" : ""}`}
    >
      <a className="c-frame__skip" href="#main">
        {skipLabel}
      </a>
      <header className="c-frame__banner" data-region tabIndex={-1}>
        {drawer ? (
          <button
            type="button"
            className="c-frame__menu"
            aria-expanded={navOpen}
            aria-controls="frame-nav"
            onClick={() => setNavOpen((o) => !o)}
          >
            <span aria-hidden="true">☰</span>
            <span>{menuLabel}</span>
          </button>
        ) : null}
        <h1 style={{ fontSize: "var(--text-cardTitle)" }}>{title}</h1>
        {banner}
        {notice ? <div role="status">{notice}</div> : null}
      </header>
      {nav ? (
        <>
          {navOpen ? (
            <div
              className="c-frame__backdrop"
              onClick={() => setNavOpen(false)}
              aria-hidden="true"
            />
          ) : null}
          <div
            id="frame-nav"
            className="c-frame__nav"
            data-region
            data-open={navOpen || undefined}
            tabIndex={-1}
            // أي انتقال من الدرج يغلقه — الرابط نفسه يتولّى الانتقال
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("a")) setNavOpen(false);
            }}
          >
            {nav}
          </div>
        </>
      ) : null}
      <main id="main" className="c-frame__main" data-region tabIndex={-1}>
        {children}
      </main>
      <footer className="c-frame__footer" data-region tabIndex={-1}>
        {footer}
      </footer>
    </div>
  );
}
