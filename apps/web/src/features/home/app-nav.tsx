"use client";

import { Nav } from "@sting/ui-web";
import { useRouter } from "next/navigation";

import { LogoutButton } from "@/features/home/logout-button";
import { ThemeToggle } from "@/features/home/theme-toggle";
import "./home.css";

/**
 * التنقل الرئيسي داخل التطبيق (0005 §١٣٤): مجموعات بعلاقة موضوعاتها وبترتيب تكرار الاستعمال — البيع
 * اليومي أولاً، والتقنيّ آخراً. المجموعات تُطوى (مجموعة الصفحة الحالية مفتوحة) فتبقى القائمة قصيرة
 * على الحاسوب والدرج. الرئيسية والبحث بلا مجموعة ظاهران دائماً. التسميات ثابتة (المواصفات تنقر بها).
 * انتقال عميلي يحفظ الجلسة في الذاكرة (§٩.٤: لا localStorage).
 */
const G = {
  sell: "البيع اليومي",
  stock: "المخزون والمشتريات",
  reports: "التقارير",
  buy: "السوق — الشراء",
  sellMarket: "السوق — البيع",
  notify: "التواصل مع الزبائن",
  org: "المنشأة",
  device: "الأجهزة والمزامنة",
  data: "البيانات والاستعادة",
  help: "المساعدة",
};
const ITEMS = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "search", label: "بحث", href: "/search" },
  // البيع اليومي: ما يفعله الكاشير والمالك كل ساعة
  { id: "pos", label: "نقطة البيع", href: "/pos", group: G.sell },
  { id: "invoices", label: "الفواتير", href: "/pos/invoices", group: G.sell },
  { id: "shift", label: "الوردية والصندوق", href: "/shifts/current", group: G.sell },
  { id: "parties", label: "العملاء والذمم", href: "/parties", group: G.sell },
  // البضاعة: الأصناف ثم الرصيد ثم الشراء وكلفته
  { id: "catalog", label: "الكتالوج", href: "/catalog", group: G.stock },
  { id: "inventory", label: "المخزون", href: "/inventory", group: G.stock },
  { id: "purchasing", label: "أوامر الشراء", href: "/purchasing/orders", group: G.stock },
  { id: "cost-margin", label: "التكلفة والهامش", href: "/purchasing/cost-margin", group: G.stock },
  // التقارير: المال أولاً (المبيعات، الصندوق، الذمم) ثم البضاعة ثم التصدير
  { id: "reports", label: "تقرير المبيعات", href: "/reports", group: G.reports },
  { id: "reports-cash", label: "تقرير الصندوق", href: "/reports/cash", group: G.reports },
  {
    id: "reports-receivables",
    label: "تقرير الذمم",
    href: "/reports/receivables",
    group: G.reports,
  },
  { id: "reports-stock", label: "تقرير المخزون", href: "/reports/stock", group: G.reports },
  { id: "reports-margin", label: "الهامش", href: "/reports/margin", group: G.reports },
  { id: "reports-export", label: "تصدير تقرير", href: "/reports/export", group: G.reports },
  // السوق مشترياً: من تشتري منه وماذا طلبت
  { id: "market", label: "السوق", href: "/market", group: G.buy },
  { id: "market-cart", label: "السلة", href: "/market/cart", group: G.buy },
  { id: "market-orders", label: "طلباتي", href: "/market/orders", group: G.buy },
  { id: "market-following", label: "متابعاتي", href: "/market/following", group: G.buy },
  { id: "market-directory", label: "الدليل", href: "/market/directory", group: G.buy },
  // السوق بائعاً: من يطلب منك وما تعرضه
  {
    id: "market-incoming",
    label: "طلبات العملاء",
    href: "/market/orders/incoming",
    group: G.sellMarket,
  },
  { id: "market-offers", label: "عروضي", href: "/market/offers", group: G.sellMarket },
  { id: "market-lists", label: "القوائم الخاصة", href: "/market/lists", group: G.sellMarket },
  {
    id: "market-renewals",
    label: "تجديد التأكيد",
    href: "/market/renewals",
    group: G.sellMarket,
  },
  { id: "market-profile", label: "صفحة المنشأة", href: "/market/profile", group: G.sellMarket },
  { id: "market-seller", label: "دور البائع", href: "/market/seller", group: G.sellMarket },
  { id: "market-share", label: "الروابط والدعوات", href: "/market/share", group: G.sellMarket },
  { id: "market-reports", label: "بلاغاتي", href: "/market/reports", group: G.sellMarket },
  // التواصل: ما يصلك وما ترسله
  { id: "notify", label: "الإشعارات", href: "/notify", group: G.notify },
  { id: "inbox", label: "الوارد", href: "/notify/inbox", group: G.notify },
  { id: "campaigns", label: "الحملات", href: "/notify/campaigns", group: G.notify },
  { id: "prefs", label: "تفضيلات التنبيه", href: "/notify/preferences", group: G.notify },
  // المنشأة: الناس وصلاحياتهم ثم الفروع ثم الاشتراك والإعدادات والتدقيق
  { id: "org-users", label: "المستخدمون", href: "/org/users", group: G.org },
  { id: "org-roles", label: "الأدوار", href: "/org/roles", group: G.org },
  { id: "org-branches", label: "الفروع", href: "/org/branches", group: G.org },
  { id: "org-subscription", label: "الاشتراك", href: "/org/subscription", group: G.org },
  { id: "org-settings", label: "الإعدادات", href: "/org/settings", group: G.org },
  { id: "org-audit", label: "سجل التدقيق", href: "/org/audit", group: G.org },
  // الأجهزة: كل ما يخص الجهاز الذي في يدك وتشغيله
  { id: "sync", label: "المزامنة", href: "/sync", group: G.device },
  { id: "org-devices", label: "الأجهزة", href: "/org/devices", group: G.device },
  { id: "print", label: "الطابعة", href: "/print", group: G.device },
  { id: "install", label: "التثبيت", href: "/install", group: G.device },
  { id: "update", label: "تحديث التطبيق", href: "/sync/update", group: G.device },
  { id: "storage", label: "مساحة الجهاز", href: "/sync/storage", group: G.device },
  { id: "sessions", label: "الجلسات", href: "/account/sessions", group: G.device },
  // البيانات: النسخ والاستعادة والاستيراد — نادرة وحسّاسة، آخر القائمة
  { id: "backup", label: "نسخة محلية", href: "/sync/backup", group: G.data },
  { id: "restore", label: "استعادة", href: "/sync/restore", group: G.data },
  { id: "import", label: "استيراد بيانات", href: "/sync/import", group: G.data },
  { id: "recovery", label: "الأجهزة المسحوبة", href: "/sync/recovery", group: G.data },
  { id: "epoch", label: "جيل الخادم", href: "/sync/epoch", group: G.data },
  { id: "support", label: "الدعم", href: "/support", group: G.help },
];

export function AppNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  return (
    <>
      <Nav
        label="التنقل الرئيسي"
        currentId={currentId}
        items={ITEMS}
        collapsible
        onNavigate={(item) => router.push(item.href)}
      />
      {/* المظهر الفاتح/الداكن — آخر عنصر في القائمة الجانبية، وحبّة في شريط الهاتف */}
      <div className="app-nav__tools">
        <ThemeToggle label />
        <LogoutButton />
      </div>
    </>
  );
}
