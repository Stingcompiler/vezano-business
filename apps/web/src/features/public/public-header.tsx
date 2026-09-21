"use client";

import { Button } from "@sting/ui-web";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useState } from "react";

import "./landing.css";

/**
 * الترويسة العامة الموحَّدة (الهبوط، الترحيب، الدخول، التسجيل، الشروط، الحالة): شعار «ف فيزانو»،
 * روابط الأقسام، زرّ الدعوة، وعلى الهاتف زرّ قائمة يفتح لوحة الروابط واللغة ومبدّل المظهر.
 * روابط الأقسام تنزلق داخل صفحة الهبوط وتنتقل إليها من غيرها.
 */
const LINKS: readonly { href: string; label: string }[] = [
  { href: "/#lp-features", label: "المزايا" },
  { href: "/plans", label: "الباقات" },
  { href: "/#lp-faq", label: "أسئلة شائعة" },
  { href: "/market", label: "السوق" },
  { href: "/legal", label: "الشروط" },
  { href: "/status", label: "حالة الخدمة" },
  { href: "/#lp-contact", label: "تواصل" },
];

export function PublicHeader({ cta = "login" }: { cta?: "login" | "register" | "none" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  // على الهاتف فقط: يختفي بعد تمرير متّصل للأسفل ويعود بعد تمرير متّصل للأعلى — بتراكم ≥ 24px
  // كي لا يرتجف مع الاهتزازات الصغيرة؛ على الحاسوب يبقى ثابتاً دائماً
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 833px)");
    let last = window.scrollY;
    let acc = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!mq.matches) {
          setHidden(false);
          return;
        }
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const delta = y - last;
        last = y;
        if (y <= 0 || y >= max - 2) {
          acc = 0;
          setHidden(false);
          return;
        }
        acc = Math.sign(delta) === Math.sign(acc) ? acc + delta : delta;
        if (y > 120 && acc > 24) setHidden(true);
        else if (acc < -24) setHidden(false);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "dark" || t === "light" ? t : null);
  }, []);

  const toggleTheme = () => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = (theme ?? (dark ? "dark" : "light")) === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("vz-theme", next);
    } catch {
      /* لا تخزين — يبقى للجلسة */
    }
  };

  const themeButton = (cls: string) => (
    <button
      type="button"
      className={cls}
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "المظهر الفاتح" : "المظهر الداكن"}
      title={theme === "dark" ? "المظهر الفاتح" : "المظهر الداكن"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );

  const go = (href: string) => (e: MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    const hash = href.startsWith("/#") ? href.slice(2) : null;
    if (hash && pathname === "/") {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    router.push(href);
  };

  const ctaLabel = cta === "register" ? "حساب جديد" : "تسجيل الدخول";
  const ctaHref = cta === "register" ? "/register" : "/welcome";

  return (
    <div
      className={`lp__header${menuOpen ? " lp__header--open" : ""}${hidden && !menuOpen ? " lp__header--hidden" : ""}`}
    >
      <div className="lp__wrap lp__bar">
        <a className="lp__brand" href="/" onClick={go("/")}>
          <span className="lp__mark" aria-hidden="true">
            ف
          </span>
          <span>
            فيزانو <small>للمحلات</small>
          </span>
        </a>
        <nav id="lp-links" className="lp__links" aria-label="الصفحات العامة">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={go(l.href)}
              aria-current={pathname === l.href ? "page" : undefined}
            >
              {l.label}
            </a>
          ))}
          <div className="lp__links-foot">
            <Button variant="secondary" onClick={go("/register")} className="lp__links-cta">
              ابدأ تجربتك المجانية
            </Button>
            <div className="lp__links-tools">
              <span className="lp__lang" aria-label="اللغة: العربية">
                <span aria-hidden="true">🌐</span> العربية
              </span>
              {themeButton("lp__theme")}
            </div>
          </div>
        </nav>
        {themeButton("lp__theme lp__theme--bar")}
        {cta !== "none" ? (
          <Button pos onClick={go(ctaHref)} className="lp__login">
            {ctaLabel}
          </Button>
        ) : null}
        <button
          type="button"
          className="lp__menu"
          aria-expanded={menuOpen}
          aria-controls="lp-links"
          aria-label={menuOpen ? "أغلق القائمة" : "القائمة"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
        </button>
      </div>
    </div>
  );
}
