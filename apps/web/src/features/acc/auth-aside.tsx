"use client";

import Link from "next/link";

/**
 * لوحة الهوية بجانب بطاقات الدخول/الترحيب/التسجيل على سطح المكتب (≥ 834): الاسم، الجملة الأولى من
 * صفحة الهبوط، وثلاثة وعود من PUB-01 — لا تُعرض على الهاتف (البطاقة وحدها).
 */
export function AuthAside({ hint }: { hint?: string | undefined }) {
  return (
    <aside className="auth-aside" aria-label="عن فيزانو">
      <h2 className="auth-aside__title">
        دفتر محلك يعمل وإن انقطعت الشبكة، ويبقى ملكك وإن توقف اشتراكك
      </h2>
      {hint ? <p className="auth-aside__hint">{hint}</p> : null}
      <ul className="auth-aside__list">
        <li>
          <span aria-hidden="true">✓</span> البيع يعمل بلا اتصال — ويُرفع عند عودة الشبكة
        </li>
        <li>
          <span aria-hidden="true">✓</span> دفترك ملكك — تصدير كامل في أي وقت
        </li>
        <li>
          <span aria-hidden="true">✓</span> عربية كاملة من اليمين — وسوق يصلك بموردي منطقتك
        </li>
      </ul>
      <div className="auth-aside__links">
        <Link href="/">تعرَّف على فيزانو</Link>
        <Link href="/legal">الشروط وسياسة الخصوصية</Link>
        <Link href="/status">حالة الخدمة</Link>
      </div>
    </aside>
  );
}

/** شريط ثقة تحت البطاقة على سطح المكتب — ثلاث حقائق قصيرة ورابط مساعدة. */
export function AuthExtras() {
  return (
    <div className="auth-extras" aria-label="ضمانات">
      <ul className="auth-chips">
        <li>
          <span aria-hidden="true">✓</span> بلا بطاقة ائتمان
        </li>
        <li>
          <span aria-hidden="true">✓</span> يعمل بلا إنترنت
        </li>
        <li>
          <span aria-hidden="true">✓</span> تصدير كامل في أي وقت
        </li>
      </ul>
      <Link href="/status" className="auth-extras__help">
        تحتاج مساعدة؟ حالة الخدمة
      </Link>
    </div>
  );
}

/** مؤشّر خطوات التسجيل الثلاث فوق البطاقة (سطح المكتب). */
export function AuthSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["المعرّف", "رمز التحقق", "كلمة المرور"] as const;
  return (
    <ol className="auth-steps" aria-label="خطوات التسجيل">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        return (
          <li
            key={label}
            aria-current={n === current ? "step" : undefined}
            data-done={n < current || undefined}
          >
            <span className="auth-steps__num sting-mono">{n}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
