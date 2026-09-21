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
  /** `side` (الافتراضي): جانبي على ≥ 834 ودرج على الهاتف؛ `top`: شريط علوي تحت الترويسة بكل المقاسات (إدارة Sting). */
  readonly navLayout?: "side" | "top";
  /** زرّ «رجوع» في الترويسة: `auto` (الافتراضي) يظهر حين يوجد سجل تصفح والصفحة ليست الجذر؛ `false` يخفيه. */
  readonly back?: "auto" | false;
  readonly backLabel?: string;
  readonly onBack?: () => void;
  /** ترويسة عامة تحلّ محل شريط التطبيق كاملاً (الصفحات العامة: الهبوط، الدخول، الشروط…). */
  readonly chrome?: ReactNode;
}

export function Frame({
  title,
  banner,
  nav,
  footer,
  children,
  notice,
  skipLabel = "تخطٍّ إلى المحتوى",
  navLayout = "side",
  back = "auto",
  backLabel = "عودة",
  onBack,
  chrome,
}: FrameProps) {
  const side = Boolean(nav) && navLayout === "side";
  const [canBack, setCanBack] = useState(false);
  // يُحسب بعد الإماهة: لا سجل على الخادم، والجذر بلا رجوع
  useEffect(() => {
    if (back === false) return;
    setCanBack(window.history.length > 1 && window.location.pathname !== "/");
  }, [back]);
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
    <div
      ref={rootRef}
      className={`c-frame${side ? " c-frame--sidebar" : ""}${nav && !side ? " c-frame--topnav" : ""}`}
    >
      <a className="c-frame__skip" href="#main">
        {skipLabel}
      </a>
      {chrome ? (
        <header className="c-frame__banner c-frame__banner--public" data-region tabIndex={-1}>
          {chrome}
          {notice ? <div role="status">{notice}</div> : null}
        </header>
      ) : (
        <header className="c-frame__banner" data-region tabIndex={-1}>
          {back !== false && canBack ? (
            <button
              type="button"
              className="c-frame__back"
              onClick={() => (onBack ? onBack() : window.history.back())}
            >
              <span aria-hidden="true">→</span>
              <span>{backLabel}</span>
            </button>
          ) : null}
          <h1 style={{ fontSize: "var(--text-cardTitle)" }}>{title}</h1>
          {banner}
          {notice ? <div role="status">{notice}</div> : null}
        </header>
      )}
      {nav ? (
        // على الهاتف (< 834) شريط أفقي قابل للتمرير تحت الترويسة — مرئي دائماً لا درج مخفي
        <div id="frame-nav" className="c-frame__nav" data-region tabIndex={-1}>
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
