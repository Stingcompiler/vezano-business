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
  { id: "notify", label: "الإشعارات", href: "/notify" },
  { id: "inbox", label: "الوارد", href: "/notify/inbox" },
  { id: "prefs", label: "تفضيلات التنبيه", href: "/notify/preferences" },
  { id: "campaigns", label: "الحملات", href: "/notify/campaigns" },
  { id: "purchasing", label: "أوامر الشراء", href: "/purchasing/orders" },
  { id: "print", label: "الطابعة", href: "/print" },
  { id: "org-users", label: "المستخدمون", href: "/org/users" },
  { id: "org-roles", label: "الأدوار", href: "/org/roles" },
  { id: "org-branches", label: "الفروع", href: "/org/branches" },
  { id: "org-devices", label: "الأجهزة", href: "/org/devices" },
  { id: "org-subscription", label: "الاشتراك", href: "/org/subscription" },
  { id: "org-settings", label: "الإعدادات", href: "/org/settings" },
  { id: "org-audit", label: "سجل التدقيق", href: "/org/audit" },
  { id: "reports", label: "تقرير المبيعات", href: "/reports" },
  { id: "reports-receivables", label: "تقرير الذمم", href: "/reports/receivables" },
  { id: "reports-stock", label: "تقرير المخزون", href: "/reports/stock" },
  { id: "reports-cash", label: "تقرير الصندوق", href: "/reports/cash" },
  { id: "reports-margin", label: "الهامش", href: "/reports/margin" },
  { id: "reports-export", label: "تصدير تقرير", href: "/reports/export" },
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
