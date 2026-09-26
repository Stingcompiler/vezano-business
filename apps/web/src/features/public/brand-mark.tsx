import "./brand.css";

/**
 * شعار «فيزانو بلص» المعتمد (0005 §١٣٣): «ف» كوفي رأسه دكّان بمظلّة وفي نافذته سطرا دفتر، ونقطته
 * ذهبية للاتصال والسوق — نفسه في أيقونة التطبيق (`public/icons/icon.svg`) وأفكاره في
 * `docs/brand/logo-concepts/`. الحجم من صنف الحاوية (`lp__mark`، `acc-logo`).
 */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect width="120" height="120" rx="28" fill="#12253B" />
      <rect x="16" y="78" width="88" height="14" rx="7" fill="#37B0B8" />
      <rect
        x="58"
        y="44"
        width="44"
        height="48"
        rx="11"
        fill="none"
        stroke="#37B0B8"
        strokeWidth="12"
      />
      <path d="M50 42 L57 28 H103 L110 42 Z" fill="#F6F8FB" />
      <path
        d="M50 42 a7.5 7 0 0 0 15 0 a7.5 7 0 0 0 15 0 a7.5 7 0 0 0 15 0 a7.5 7 0 0 0 15 0 Z"
        fill="#F6F8FB"
      />
      <rect x="70" y="58" width="20" height="5" rx="2.5" fill="#F6F8FB" />
      <rect x="70" y="68" width="13" height="5" rx="2.5" fill="#F6F8FB" />
      <circle cx="80" cy="15" r="7.5" fill="#E8A33D" />
    </svg>
  );
}

/**
 * اسم «فيزانو بلص» بخط الشعار Reem Kufi (0005 §١٣٢) — بجوار العلامة وحدها؛ الجمل التي تذكر الاسم
 * («الدخول إلى فيزانو بلص») تبقى بخط الواجهة. «بلص» بلون العلامة.
 */
export function BrandName() {
  return (
    <span className="brand-name">
      فيزانو <span className="brand-name__plus">بلص</span>
    </span>
  );
}
