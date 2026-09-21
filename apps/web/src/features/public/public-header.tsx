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
  { href: "/#lp-plans", label: "الباقات" },
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
    <div className={`lp__header${menuOpen ? " lp__header--open" : ""}`}>
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
              <button
                type="button"
                className="lp__theme"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "المظهر الفاتح" : "المظهر الداكن"}
              >
                <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
              </button>
            </div>
          </div>
        </nav>
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
