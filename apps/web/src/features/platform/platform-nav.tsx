"use client";

import { Button, Frame } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

import "./platform.css";
import { ThemeToggle } from "@/features/home/theme-toggle";
import { clearOperatorSession, operatorName } from "@/features/platform/operator-session";

export type PlatformSection =
  | "overview"
  | "tenants"
  | "login"
  | "proofs"
  | "announcements"
  | "outbound"
  | "verifications"
  | "reports"
  | "disputes"
  | "health"
  | "backups"
  | "m0"
  | "entitlements"
  | "demo"
  | "operators";

type NavItem = { id: Exclude<PlatformSection, "login">; label: string };

/** أقسام المشغّل في مجموعات — جانبي كحلي على الحاسوب، شريط أفقي متمرّر على الهاتف (C-NAV) */
const GROUPS: readonly { readonly title: string; readonly items: readonly NavItem[] }[] = [
  {
    title: "الاستحقاق",
    items: [
      { id: "overview", label: "النظرة العامة" },
      { id: "tenants", label: "المستأجرون" },
      { id: "proofs", label: "مراجعة الدفع" },
      { id: "entitlements", label: "الاستحقاقات" },
    ],
  },
  {
    title: "السوق",
    items: [
      { id: "verifications", label: "طلبات التحقُّق" },
      { id: "reports", label: "البلاغات" },
      { id: "disputes", label: "الخلافات" },
    ],
  },
  {
    title: "التشغيل",
    items: [
      { id: "outbound", label: "الإرسال" },
      { id: "announcements", label: "الإعلانات" },
      { id: "health", label: "الصحة" },
      { id: "backups", label: "النسخ" },
      { id: "operators", label: "المشغّلون" },
    ],
  },
  {
    title: "النموّ",
    items: [
      { id: "m0", label: "M0" },
      { id: "demo", label: "طلبات الجولة" },
    ],
  },
];

const HREF: Record<Exclude<PlatformSection, "login">, string> = {
  overview: "/platform",
  tenants: "/platform/tenants",
  proofs: "/platform/proofs",
  entitlements: "/platform/entitlements",
  verifications: "/platform/verifications",
  reports: "/platform/reports",
  disputes: "/platform/disputes",
  outbound: "/platform/outbound",
  announcements: "/platform/announcements",
  health: "/platform/health",
  backups: "/platform/backups",
  m0: "/platform/m0",
  demo: "/platform/demo-requests",
  operators: "/platform/operators",
};

/** القائمة الجانبية للمشغّل — أزرار (الجلسة في الذاكرة؛ تحميل رابط يعيد إلى الدخول) بأنماط C-NAV. */
export function PlatformNav({ current }: { current: PlatformSection }) {
  const router = useRouter();
  const listRef = useRef<HTMLUListElement | null>(null);
  // على الهاتف الشريط يتمرّر أفقياً — القسم الحالي يظهر داخل المرئي
  useEffect(() => {
    const on = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (on && window.matchMedia("(max-width: 833px)").matches)
      on.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current]);
  return (
    <nav aria-label="أقسام المشغّل" className="plt-nav">
      <ul ref={listRef} className="c-nav c-nav--side">
        {GROUPS.map((g) => (
          <li key={g.title} className="c-nav__section">
            <div className="c-nav__group">{g.title}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="c-nav__item plt-nav__item"
                aria-current={current === it.id ? "page" : undefined}
                onClick={() => router.push(HREF[it.id])}
              >
                {it.label}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** ترويسة المشغّل داخل شريط الإطار: شارة ADMIN، التلميح المرسوم، اسم المشغّل وخروج. */
function PlatformBanner({ current }: { current: PlatformSection }) {
  const router = useRouter();
  return (
    <div className="plt-banner">
      <span className="plt-badge plt-badge--admin">ADMIN</span>
      <span className="plt-banner__hint">إطار منفصل عن تطبيق المتاجر · كل فتح سجل يُدقَّق</span>
      {current !== "login" ? (
        <div className="plt-banner__user">
          <ThemeToggle className="plt-banner__theme" />
          <span className="plt-banner__name">{operatorName()}</span>
          <Button
            variant="quiet"
            className="plt-banner__logout"
            onClick={() => {
              clearOperatorSession();
              router.push("/platform/login");
            }}
          >
            خروج
          </Button>
        </div>
      ) : (
        <div className="plt-banner__user">
          <ThemeToggle className="plt-banner__theme" />
        </div>
      )}
    </div>
  );
}

/**
 * إطار مساحة المشغّل الموحَّد: ترويسة كحلية بعنوان «إدارة فيزانو — مشغّل الخدمة» وشارة ADMIN،
 * قائمة جانبية على الحاسوب وشريط أفقي على الهاتف، بلا زرّ رجوع (التنقل من القائمة).
 */
export function PlatformFrame({
  current,
  children,
}: {
  current: PlatformSection;
  children: ReactNode;
}) {
  return (
    <Frame
      title="إدارة فيزانو — مشغّل الخدمة"
      back={false}
      banner={<PlatformBanner current={current} />}
      nav={current === "login" ? undefined : <PlatformNav current={current} />}
      footer={null}
    >
      {children}
    </Frame>
  );
}
