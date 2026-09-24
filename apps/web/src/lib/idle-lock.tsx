"use client";

/**
 * قفل الخمول (§٩.١ — 20 دقيقة؛ 0005 §٧ أجّله إلى هيكل حيّ، وبُني في مراجعة §١٢٠).
 *
 * يعمل حين: جلسة خادمية حيّة داخل منشأة + جهاز مُجهَّز محلياً (له متحققات PIN). بعد 20 دقيقة بلا
 * لمس ولا نقر ولا كتابة ينتقل إلى `/lock?next=<الشاشة الحالية>`. الجلسة تبقى في الذاكرة فيعود الفتح
 * إلى الشاشة نفسها — القفل لا يغلق الوردية ولا يقطع البيع المعلّق (معيار ACC-62).
 * الخمول يُقاس بالزمن الفعلي (`Date.now`) لا بعدّاد يتجمّد حين تنام الشاشة أو يُخفى التبويب.
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useApp } from "@/lib/app-context";
import { hasLocalSetup } from "@/lib/device-setup";

export const IDLE_LOCK_MINUTES = 20;

/** مسارات لا يُقفَل فيها: القفل نفسه، الدخول والترحيب، الصفحات العامة، ومساحة المشغّل. */
const EXEMPT = [
  "/lock",
  "/login",
  "/welcome",
  "/register",
  "/setup-device",
  "/session-expired",
  "/invite",
  "/legal",
  "/status",
  "/plans",
  "/platform",
  "/print",
];

export function isExempt(pathname: string): boolean {
  return pathname === "/"
    ? false
    : EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** `next` آمن: مسار داخلي فقط (لا `//host` ولا عنوان كامل)، وإلا الرئيسية. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.startsWith("/lock")) return "/";
  return raw;
}

const EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function IdleLock({ minutes = IDLE_LOCK_MINUTES }: { minutes?: number }) {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const last = useRef(Date.now());
  const active = Boolean(app.tokens && app.session.tenantId) && !isExempt(pathname);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const bump = () => {
      last.current = Date.now();
    };
    const check = () => {
      if (Date.now() - last.current < minutes * 60_000) return;
      void hasLocalSetup().then((ready) => {
        if (cancelled || !ready) return;
        const here = `${location.pathname}${location.search}`;
        router.push(`/lock?next=${encodeURIComponent(here)}`);
      });
    };
    bump();
    for (const e of EVENTS) window.addEventListener(e, bump, { passive: true });
    // العودة إلى التبويب بعد غياب طويل تُفحص فوراً لا بعد دورة المؤقّت
    document.addEventListener("visibilitychange", check);
    timer = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      for (const e of EVENTS) window.removeEventListener(e, bump);
      document.removeEventListener("visibilitychange", check);
      if (timer) clearInterval(timer);
    };
  }, [active, minutes, router]);

  return null;
}
