import Link from "next/link";

/** الصفحة العامة (SSG لاحقاً — §١٢.٤). لا بيانات مستأجر هنا. */
export default function HomePage() {
  return (
    <main style={{ padding: "var(--layout-pagePadding)" }}>
      <h1>Sting</h1>
      <p>نقطة بيع وذمم ومخزون تعمل بلا اتصال أولاً — لمحلات التجزئة الصغيرة في السودان.</p>
      <p>
        <Link href="/dev/probe">صفحة الفحص التقني</Link>
      </p>
    </main>
  );
}
