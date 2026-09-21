"use client";

import { Nav } from "@sting/ui-web";
import { useRouter } from "next/navigation";

/** التنقل الرئيسي داخل التطبيق مجمَّعاً (C-NAV جانبي بعناوين مجموعات؛ درج على الهاتف): انتقال عميلي يحفظ الجلسة في الذاكرة (§٩.٤: لا localStorage). */
const G = {
  sell: "وضع البيع",
  manage: "الإدارة",
  market: "السوق",
  notify: "الإشعارات",
  reports: "التقارير",
  org: "المنشأة",
  device: "الجهاز والمزامنة",
};
const ITEMS = [
  { id: "pos", label: "نقطة البيع", href: "/pos", group: G.sell },
  { id: "invoices", label: "الفواتير", href: "/pos/invoices", group: G.sell },
  { id: "parties", label: "العملاء والذمم", href: "/parties", group: G.sell },
  { id: "shift", label: "الوردية والصندوق", href: "/shifts/current", group: G.sell },
  { id: "home", label: "الرئيسية", href: "/", group: G.manage },
  { id: "search", label: "بحث", href: "/search", group: G.manage },
  { id: "catalog", label: "الكتالوج", href: "/catalog", group: G.manage },
  { id: "inventory", label: "المخزون", href: "/inventory", group: G.manage },
  { id: "purchasing", label: "أوامر الشراء", href: "/purchasing/orders", group: G.manage },
  { id: "cost-margin", label: "التكلفة والهامش", href: "/purchasing/cost-margin", group: G.manage },
  { id: "market", label: "السوق", href: "/market", group: G.market },
  { id: "market-cart", label: "السلة", href: "/market/cart", group: G.market },
  { id: "market-orders", label: "طلباتي", href: "/market/orders", group: G.market },
  {
    id: "market-incoming",
    label: "طلبات العملاء",
    href: "/market/orders/incoming",
    group: G.market,
  },
  { id: "market-following", label: "متابعاتي", href: "/market/following", group: G.market },
  { id: "market-directory", label: "الدليل", href: "/market/directory", group: G.market },
  { id: "market-seller", label: "دور البائع", href: "/market/seller", group: G.market },
  { id: "market-profile", label: "صفحة المنشأة", href: "/market/profile", group: G.market },
  { id: "market-offers", label: "عروضي", href: "/market/offers", group: G.market },
  { id: "market-lists", label: "القوائم الخاصة", href: "/market/lists", group: G.market },
  { id: "market-share", label: "الروابط والدعوات", href: "/market/share", group: G.market },
  { id: "market-renewals", label: "تجديد التأكيد", href: "/market/renewals", group: G.market },
  { id: "market-reports", label: "بلاغاتي", href: "/market/reports", group: G.market },
  { id: "notify", label: "الإشعارات", href: "/notify", group: G.notify },
  { id: "inbox", label: "الوارد", href: "/notify/inbox", group: G.notify },
  { id: "prefs", label: "تفضيلات التنبيه", href: "/notify/preferences", group: G.notify },
  { id: "campaigns", label: "الحملات", href: "/notify/campaigns", group: G.notify },
  { id: "reports", label: "تقرير المبيعات", href: "/reports", group: G.reports },
  {
    id: "reports-receivables",
    label: "تقرير الذمم",
    href: "/reports/receivables",
    group: G.reports,
  },
  { id: "reports-stock", label: "تقرير المخزون", href: "/reports/stock", group: G.reports },
  { id: "reports-cash", label: "تقرير الصندوق", href: "/reports/cash", group: G.reports },
  { id: "reports-margin", label: "الهامش", href: "/reports/margin", group: G.reports },
  { id: "reports-export", label: "تصدير تقرير", href: "/reports/export", group: G.reports },
  { id: "org-users", label: "المستخدمون", href: "/org/users", group: G.org },
  { id: "org-roles", label: "الأدوار", href: "/org/roles", group: G.org },
  { id: "org-branches", label: "الفروع", href: "/org/branches", group: G.org },
  { id: "org-devices", label: "الأجهزة", href: "/org/devices", group: G.org },
  { id: "org-subscription", label: "الاشتراك", href: "/org/subscription", group: G.org },
  { id: "org-settings", label: "الإعدادات", href: "/org/settings", group: G.org },
  { id: "org-audit", label: "سجل التدقيق", href: "/org/audit", group: G.org },
  { id: "print", label: "الطابعة", href: "/print", group: G.org },
  { id: "sync", label: "المزامنة", href: "/sync", group: G.device },
  { id: "storage", label: "مساحة الجهاز", href: "/sync/storage", group: G.device },
  { id: "backup", label: "نسخة محلية", href: "/sync/backup", group: G.device },
  { id: "restore", label: "استعادة", href: "/sync/restore", group: G.device },
  { id: "recovery", label: "الأجهزة المسحوبة", href: "/sync/recovery", group: G.device },
  { id: "epoch", label: "جيل الخادم", href: "/sync/epoch", group: G.device },
  { id: "update", label: "تحديث التطبيق", href: "/sync/update", group: G.device },
  { id: "import", label: "استيراد بيانات", href: "/sync/import", group: G.device },
  { id: "install", label: "التثبيت", href: "/install", group: G.device },
  { id: "sessions", label: "الجلسات", href: "/account/sessions", group: G.device },
  { id: "support", label: "الدعم", href: "/support", group: G.device },
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
