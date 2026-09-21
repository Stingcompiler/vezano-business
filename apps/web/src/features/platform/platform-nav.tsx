"use client";

import { Button } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import "./platform.css";
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
  | "demo";

/** شريط المشغّل الموحَّد — مجموعات مفصولة بخطّ؛ على الهاتف يتمرّر أفقياً (لا التفاف على ثلاثة أسطر) */
type NavItem = { id: Exclude<PlatformSection, "login">; label: string };
const GROUPS: readonly { readonly items: readonly NavItem[] }[] = [
  {
    items: [
      { id: "overview", label: "النظرة العامة" },
      { id: "tenants", label: "المستأجرون" },
      { id: "proofs", label: "مراجعة الدفع" },
      { id: "entitlements", label: "الاستحقاقات" },
    ],
  },
  {
    items: [
      { id: "verifications", label: "طلبات التحقُّق" },
      { id: "reports", label: "البلاغات" },
      { id: "disputes", label: "الخلافات" },
    ],
  },
  {
    items: [
      { id: "outbound", label: "الإرسال" },
      { id: "announcements", label: "الإعلانات" },
      { id: "health", label: "الصحة" },
      { id: "backups", label: "النسخ" },
    ],
  },
  {
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
};

/** إطار المشغّل — منفصل عن تطبيق المتاجر؛ كل فتح سجل يُدقَّق. */
export function PlatformNav({ current }: { current: PlatformSection }) {
  const router = useRouter();
  const linksRef = useRef<HTMLElement | null>(null);
  // القسم الحالي يظهر داخل الشريط المتمرّر (على الهاتف قد يكون خارج المرئي)
  useEffect(() => {
    const on = linksRef.current?.querySelector<HTMLElement>(".plt-bar__link--on");
    on?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current]);
  return (
    <div className="plt-bar plt-nav">
      <div className="plt-bar__head">
        <span className="plt-badge plt-badge--admin">ADMIN</span>
        <strong className="plt-bar__title">إدارة فيزانو — مشغّل الخدمة</strong>
        <span className="plt-bar__hint">إطار منفصل عن تطبيق المتاجر · كل فتح سجل يُدقَّق</span>
        {current !== "login" ? (
          <div className="plt-bar__user">
            <span className="plt-bar__name">{operatorName()}</span>
            <Button
              variant="quiet"
              onClick={() => {
                clearOperatorSession();
                router.push("/platform/login");
              }}
            >
              خروج
            </Button>
          </div>
        ) : null}
      </div>
      {current !== "login" ? (
        <nav ref={linksRef} className="plt-bar__links" aria-label="أقسام المشغّل">
          {GROUPS.map((g, gi) => (
            <div key={gi} className="plt-bar__group">
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`plt-bar__link${current === it.id ? " plt-bar__link--on" : ""}`}
                  aria-current={current === it.id ? "page" : undefined}
                  onClick={() => router.push(HREF[it.id])}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
