"use client";

import Link from "next/link";

import { HomeClient } from "@/features/home/home-client";
import { useApp } from "@/lib/app-context";

export function RootClient() {
  const app = useApp();
  if (app.tokens && app.session.tenantId) return <HomeClient />;
  return (
    <main style={{ padding: "var(--layout-pagePadding)" }}>
      <h1>Sting</h1>
      <p>نقطة بيع وذمم ومخزون تعمل بلا اتصال أولاً — لمحلات التجزئة الصغيرة في السودان.</p>
      <p>
        <Link href="/welcome">ابدأ — الترحيب والدخول</Link>
      </p>
      <p>
        <Link href="/setup-device">تجهيز الجهاز</Link>
      </p>
      <p>
        <Link href="/account/sessions">الجلسات</Link>
      </p>
      <p>
        <Link href="/onboarding">معالج بدء الاستخدام</Link>
      </p>
      <p>
        <Link href="/dev/probe">صفحة الفحص التقني</Link>
      </p>
    </main>
  );
}
