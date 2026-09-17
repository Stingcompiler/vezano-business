"use client";

import { Nav } from "@sting/ui-web";
import { useRouter } from "next/navigation";

/**
 * تنقّل نقطة البيع كما في إطار POS-01 (03-D2): «وضع البيع» و«الإدارة» مجموعتان؛ المقيَّد يعلن سببه
 * («— لا صلاحية») لا يُخفى. المسارات غير المبنية بعد (الفواتير/الأطراف/المخزون/السوق/التقارير)
 * تُبنى بمهامها في PLAN.md.
 */
const SELL = [
  { id: "pos", label: "نقطة البيع", href: "/pos" },
  { id: "invoices", label: "الفواتير", href: "/pos/invoices" },
  { id: "parties", label: "العملاء والذمم", href: "/parties" },
  { id: "shift", label: "الوردية والصندوق", href: "/shifts/current" },
];

export function PosNav({
  currentId,
  canSeeReports,
}: {
  currentId: string;
  canSeeReports: boolean;
}) {
  const router = useRouter();
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
