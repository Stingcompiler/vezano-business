"use client";

import Link from "next/link";

/**
 * لوحة الهوية بجانب بطاقات الدخول/الترحيب/التسجيل على سطح المكتب (≥ 834): الاسم، الجملة الأولى من
 * صفحة الهبوط، وثلاثة وعود من PUB-01 — لا تُعرض على الهاتف (البطاقة وحدها).
 */
export function AuthAside({ hint }: { hint?: string | undefined }) {
  return (
    <aside className="auth-aside" aria-label="عن فيزانو">
      <div className="auth-aside__brand">
        <span className="auth-aside__mark" aria-hidden="true">
          ف
        </span>
        <span>
          فيزانو <small>للمحلات</small>
        </span>
      </div>
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
