"use client";

import { Nav } from "@sting/ui-web";
import { useRouter } from "next/navigation";

/** التنقل الرئيسي داخل التطبيق: انتقال عميلي يحفظ الجلسة في الذاكرة (§٩.٤: لا localStorage). */
const ITEMS = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "search", label: "بحث", href: "/search" },
  { id: "catalog", label: "الكتالوج", href: "/catalog" },
  { id: "sessions", label: "الجلسات", href: "/account/sessions" },
  { id: "sync", label: "المزامنة", href: "/sync" },
  { id: "storage", label: "مساحة الجهاز", href: "/sync/storage" },
  { id: "support", label: "الدعم", href: "/support" },
  { id: "backup", label: "نسخة محلية", href: "/sync/backup" },
  { id: "restore", label: "استعادة", href: "/sync/restore" },
  { id: "recovery", label: "الأجهزة المسحوبة", href: "/sync/recovery" },
  { id: "epoch", label: "جيل الخادم", href: "/sync/epoch" },
  { id: "update", label: "تحديث التطبيق", href: "/sync/update" },
  { id: "import", label: "استيراد بيانات", href: "/sync/import" },
  { id: "install", label: "التثبيت", href: "/install" },
];

export function AppNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  return (
    <Nav
      label="التنقل الرئيسي"
      currentId={currentId}
      items={ITEMS}
      onNavigate={(item) => router.push(item.href)}
    />
  );
}
