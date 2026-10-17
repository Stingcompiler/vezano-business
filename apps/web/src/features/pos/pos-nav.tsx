"use client";

import { Nav } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { readHomeCache } from "@/features/home/home-cache";
import { api } from "@/lib/api";

/**
 * تنقّل نقطة البيع كما في إطار POS-01 (03-D2): «وضع البيع» و«الإدارة» مجموعتان؛ المقيَّد يعلن سببه
 * («— لا صلاحية») لا يُخفى.
 *
 * فحص 2026-10-17 F06: كانت كل شاشة تحسب أهلية التقارير بطريقتها (اسم الدور، `isOwner`، بل `false`
 * ثابتاً) فظهرت «لا صلاحية» للمالك. المصدر الآن واحد: `can_see_finance` من الخادم (ملخّص الرئيسية
 * المخزَّن) — وبلا معرفة لا يُعلَن منع؛ صفحة التقارير نفسها تعرض المنع الحقيقي إن وُجد.
 */
let financeOnce: Promise<boolean | null> | null = null;

/** مرة لكل جلسة صفحة: الملخّص المخزَّن، وإلا الخادم؛ وبلا جواب (بلا اتصال) لا يُعلَن منع. */
function financeAccess(): Promise<boolean | null> {
  financeOnce ??= (async () => {
    const cached = await readHomeCache();
    if (cached) return cached.summary.can_see_finance;
    try {
      const { data, response } = await api().GET("/api/home", {});
      return response.ok && data ? data.can_see_finance : null;
    } catch {
      return null;
    }
  })();
  return financeOnce;
}

function useCanSeeReports(): boolean {
  const [can, setCan] = useState(true);
  useEffect(() => {
    let alive = true;
    void financeAccess().then((v) => {
      if (alive && v !== null) setCan(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return can;
}
const SELL = [
  { id: "pos", label: "نقطة البيع", href: "/pos" },
  { id: "invoices", label: "الفواتير", href: "/pos/invoices" },
  { id: "parties", label: "العملاء والذمم", href: "/parties" },
  { id: "shift", label: "الوردية والصندوق", href: "/shifts/current" },
];

export function PosNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  const canSeeReports = useCanSeeReports();
  const manage = [
    { id: "catalog", label: "الأصناف", href: "/catalog" },
    { id: "inventory", label: "المخزون", href: "/inventory" },
    { id: "market", label: "السوق", href: "/market" },
    {
      id: "reports",
      label: "التقارير",
      href: "/reports",
      ...(canSeeReports ? {} : { restrictedReason: "لا صلاحية" }),
    },
  ];
  return (
    <div className="pos-nav">
      <div className="pos-nav__group">وضع البيع</div>
      <Nav
        label="وضع البيع"
        currentId={currentId}
        items={SELL}
        onNavigate={(item) => router.push(item.href)}
      />
      <div className="pos-nav__group">الإدارة</div>
      <Nav
        label="الإدارة"
        currentId={currentId}
        items={manage}
        onNavigate={(item) => router.push(item.href)}
      />
    </div>
  );
}
