"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** المظهر المحفوظ في المتصفح (`vz-theme`)؛ يُطبَّق قبل الرسم من `layout.tsx`، وهنا يُقلب ويُحفظ. */
export function useTheme(): { theme: Theme | null; toggle: () => void } {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "dark" || t === "light" ? t : null);
  }, []);
  const toggle = () => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next: Theme = (theme ?? (dark ? "dark" : "light")) === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("vz-theme", next);
    } catch {
      /* لا تخزين — يبقى للجلسة */
    }
  };
  return { theme, toggle };
}

/** زرّ المظهر الفاتح/الداكن الموحَّد — أيقونة ☾/☀ بحجم لمس 44، والتسمية للقارئ الشاشي. */
export function ThemeToggle({
  className = "",
  label = false,
}: {
  className?: string;
  label?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const text = theme === "dark" ? "المظهر الفاتح" : "المظهر الداكن";
  return (
    <button
      type="button"
      className={`vz-theme${className ? ` ${className}` : ""}`}
      onClick={toggle}
      aria-label={text}
      title={text}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      {label ? <span className="vz-theme__label">{text}</span> : null}
    </button>
  );
}
