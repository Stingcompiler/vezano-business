"use client";

/**
 * تذييل الصفحات العامة (0005 §١٤٣): الهوية وسطر يقول ما هو النظام، ووسائل التواصل المحسومة (§١٢٣)،
 * وثلاثة أعمدة روابط بعلاقتها — المنتج، والبدء، والثقة والدعم — ثم سطر الحقوق. مشترك بين الهبوط
 * والباقات والسوق والشروط والحالة؛ شاشات الدخول والتسجيل تبقى بلا تذييل لتبقى مركّزة.
 */
import Link from "next/link";

import { BrandMark, BrandName } from "@/features/public/brand-mark";

import "./public-footer.css";

const EMAIL = "plus@vezano.app";
const PHONE = "0902929451";
const PHONE_INTL = "+249902929451";
/** المطوِّر (0005 §١٤٥) — يُفتح في تبويب جديد. */
const CREDIT_URL = "https://stingdev.pro";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "المنتج",
    links: [
      { href: "/#lp-features", label: "المزايا" },
      { href: "/#lp-flow", label: "كيف يعمل بلا شبكة" },
      { href: "/plans", label: "الباقات والأسعار" },
      { href: "/market", label: "السوق" },
      { href: "/#lp-faq", label: "الأسئلة الشائعة" },
    ],
  },
  {
    title: "ابدأ الآن",
    links: [
      { href: "/register", label: "ابدأ تجربتك المجانية" },
      { href: "/welcome", label: "دخول التطبيق" },
      { href: "/#lp-contact", label: "اطلب جولة قصيرة" },
      { href: "/demo/track", label: "تابع طلب الجولة" },
    ],
  },
  {
    title: "الثقة والدعم",
    links: [
      { href: "/status", label: "حالة الخدمة" },
      { href: "/legal", label: "الشروط وسياسة الخصوصية" },
      { href: "/#lp-promises", label: "بياناتك ملكك" },
    ],
  },
];

/**
 * `inFrame`: داخل خانة تذييل C-FRAME (وهي `<footer>` أصلاً) يكون الجذر `div` — لا تذييلان متداخلان.
 */
export function PublicFooter({
  inFrame = false,
  compact = false,
}: {
  inFrame?: boolean;
  /** شاشات مركّزة (الدخول، التسجيل، الترحيب، الصفحات الضالّة): سطر الحقوق و«مدعوم من» فقط (§١٤٥). */
  compact?: boolean;
}) {
  const Root = inFrame ? "div" : "footer";
  return (
    <Root
      className={`pf${compact ? " pf--compact" : ""}`}
      {...(inFrame ? {} : { "aria-label": "تذييل الموقع" })}
    >
      {compact ? null : (
        <div className="pf__inner">
          <div className="pf__brand">
            <Link href="/" className="pf__logo" aria-label="فيزانو بلص — الصفحة الرئيسية">
              <span className="pf__mark" aria-hidden="true">
                <BrandMark />
              </span>
              <BrandName />
            </Link>
            <p className="pf__about">
              نقطة بيع ومخزون وذمم تعمل وإن انقطعت الشبكة، للمحلات والبقالات والموزّعين في السودان.
              دفترك ملكك، وتصديره متاح في أي وقت.
            </p>
            <ul className="pf__contact">
              <li>
                <span className="pf__label">البريد</span>
                <a href={`mailto:${EMAIL}`} className="sting-mono" dir="ltr">
                  {EMAIL}
                </a>
              </li>
              <li>
                <span className="pf__label">الهاتف</span>
                <a href={`tel:${PHONE_INTL}`} className="sting-mono" dir="ltr">
                  {PHONE}
                </a>
              </li>
              <li>
                <span className="pf__label">المقرّ</span>
                <span>الخرطوم — السودان</span>
              </li>
            </ul>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} className="pf__col" aria-label={col.title}>
              <h2 className="pf__title">{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      )}

      <div className="pf__bar">
        {/* الحقوق ثم «مدعوم من»: بجانبها على الشاشات العريضة وتحتها على الجوال (0005 §١٤٥) */}
        <div className="pf__legal">
          <span>
            © <span className="sting-mono">2026</span> فيزانو بلص (Vezano Plus) · جميع الحقوق محفوظة
          </span>
          <a
            className="pf__credit"
            href={CREDIT_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="مدعوم من ستينج سيستم — Powered by Sting System (يفتح في تبويب جديد)"
          >
            <span>مدعوم من ستينج سيستم</span>
            <span aria-hidden="true">·</span>
            <span lang="en" dir="ltr">
              Powered by Sting System
            </span>
          </a>
        </div>
        {compact ? null : (
          <span className="pf__promise">
            يعمل بلا اتصال · سعر معلن قبل التسجيل · لا نبيع بياناتك
          </span>
        )}
      </div>
    </Root>
  );
}
