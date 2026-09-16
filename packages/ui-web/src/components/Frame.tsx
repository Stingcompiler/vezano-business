/**
 * C-FRAME — هيكل التطبيق: landmarks banner/navigation/main/contentinfo، Skip link أول عنصر قابل
 * للتركيز يقفز إلى المحتوى، F6 ينقل بين المناطق، الشريط الجانبي في الجانب الابتدائي (RTL: يمين).
 * الحالات: ready, offline, phase_locked — تُعرض شريطاً في الترويسة عبر `notice`.
 */
import { type ReactNode, useEffect, useRef } from "react";

export interface FrameProps {
  readonly title: string;
  readonly banner?: ReactNode;
  readonly nav?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /** نص الشريط العلوي لحالة offline أو phase_locked — نص الإطار المرسوم. */
  readonly notice?: ReactNode;
  readonly skipLabel?: string;
}

export function Frame({
  title,
  banner,
  nav,
  footer,
  children,
  notice,
  skipLabel = "تخطٍّ إلى المحتوى",
}: FrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
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
    <div ref={rootRef} className={`c-frame${nav ? " c-frame--sidebar" : ""}`}>
      <a className="c-frame__skip" href="#main">
        {skipLabel}
      </a>
      <header className="c-frame__banner" data-region tabIndex={-1}>
        <h1 style={{ fontSize: "var(--text-cardTitle)" }}>{title}</h1>
        {banner}
        {notice ? <div role="status">{notice}</div> : null}
      </header>
      {nav ? (
        <div className="c-frame__nav" data-region tabIndex={-1}>
          {nav}
        </div>
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
