"use client";

import { Button } from "@sting/ui-web";
import { useRouter } from "next/navigation";

export type EmptyKind = "catalog" | "no_match" | "unknown_barcode";

/**
 * POS-02 × empty (14-D9): «لا نتائج» ثلاث حالات لا واحدة — كتالوج فارغ، بحث بلا تطابق، باركود
 * مجهول — لكل واحدة مخرج مختلف. تُعرض داخل لوحة أصناف POS-01 مكان النتائج.
 */
export function EmptySearch({
  kind,
  query,
  total,
  nearest,
}: {
  kind: EmptyKind;
  query: string;
  total: number;
  nearest: readonly string[];
}) {
  const router = useRouter();
  const newItem = (params: Record<string, string>) =>
    router.push(`/catalog/new?${new URLSearchParams(params).toString()}`);
  if (kind === "catalog")
    return (
      <section className="pos-empty pos-empty--catalog" data-screen="POS-02" data-state="empty">
        <h2 className="pos-empty__title">كتالوج فارغ — محل جديد</h2>
        <div className="pos-empty__query">ابحث عن صنف…</div>
        <p>
          لا أصناف في كتالوجك بعد. هذه بداية طبيعية لا عطل: أضف صنفاً واحداً وابدأ البيع، والباقي
          يُبنى أثناء العمل.
        </p>
        <div className="pos-empty__actions">
          <Button onClick={() => newItem({})}>إضافة صنف سريع</Button>
          <span className="acc-choice__note">اسم ووحدة وسعر — ثلاثة حقول تكفي للبيع اليوم</span>
          <Button
            variant="secondary"
            disabledReason="متاح لاحقاً في «ربط الأطراف» — المرحلة غير مفعّلة"
          >
            استيراد من ملف
          </Button>
        </div>
        <p className="pos-empty__foot">لا نطلب إكمال الكتالوج قبل أول بيع. الصنف الواحد يكفي.</p>
      </section>
    );
  if (kind === "unknown_barcode")
    return (
      <section className="pos-empty pos-empty--barcode" data-screen="POS-02" data-state="empty">
        <h2 className="pos-empty__title">باركود مجهول</h2>
        <div className="pos-empty__query sting-mono">{query}</div>
        <p>قُرئ الباركود بنجاح ولا صنف مربوط به. العطل ليس في الماسح ولا في الشبكة.</p>
        <div className="pos-empty__actions">
          <Button onClick={() => router.push(`/catalog?q=${encodeURIComponent(query)}`)}>
            ربطه بصنف موجود
          </Button>
          <span className="acc-choice__note">
            الأرجح: عبوة جديدة لصنف تبيعه — الربط يتم مرة واحدة
          </span>
          <Button variant="secondary" onClick={() => newItem({ barcode: query })}>
            إنشاء صنف جديد بهذا الباركود
          </Button>
          <span className="acc-choice__note">الباركود يُحفظ تلقائياً في بطاقة الصنف</span>
        </div>
        <p className="pos-empty__foot">الرقم المقروء معروض كاملاً لتتحقق منه بعينك قبل الربط.</p>
      </section>
    );
  return (
    <section className="pos-empty pos-empty--nomatch" data-screen="POS-02" data-state="empty">
      <h2 className="pos-empty__title">بحث بلا تطابق</h2>
      <div className="pos-empty__query">{query}</div>
      <p>
        لا صنف بهذا الاسم بين <span className="sting-mono">{total}</span> صنفاً. الكتالوج ليس فارغاً
        — هذا الاسم تحديداً غير موجود.
      </p>
      <div className="pos-empty__actions">
        {nearest.length ? (
          <>
            <div className="pos-empty__nearest">
              أقرب الأسماء: {nearest.map((n) => `«${n}»`).join(" · ")}
            </div>
            <span className="acc-choice__note">
              اقتراح بحثي لا تصحيح تلقائي — لا نستبدل ما كتبته
            </span>
          </>
        ) : null}
        <Button onClick={() => newItem({ name: query })}>إضافته كصنف جديد</Button>
        <span className="acc-choice__note">يفتح الإضافة السريعة باسم «{query}» جاهزاً</span>
      </div>
      <p className="pos-empty__foot">البحث يشمل الاسم والباركود والرمز الداخلي — نقول أين بحثنا.</p>
    </section>
  );
}
