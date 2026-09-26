import "./brand.css";

/**
 * شعار فيزانو المعتمد (0005 §١٢٨) — علامة الأعمدة نفسها التي في أيقونة التطبيق
 * (`public/icons/icon.svg`)، بدل مربّع «ف». الحجم من صنف الحاوية (`lp__mark`، `acc-logo`).
 */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#F6F8FB" />
      <rect x="76" y="94" width="198" height="104" rx="40" fill="#0E7C86" />
      <rect x="238" y="204" width="198" height="104" rx="40" fill="#37B0B8" />
      <rect x="76" y="314" width="198" height="104" rx="40" fill="#0E7C86" />
      <rect x="218" y="78" width="76" height="356" rx="38" fill="#12253B" />
      <rect x="248" y="128" width="28" height="56" rx="14" fill="#F6F8FB" />
      <rect x="248" y="228" width="28" height="56" rx="14" fill="#F6F8FB" />
      <rect x="248" y="328" width="28" height="56" rx="14" fill="#F6F8FB" />
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
