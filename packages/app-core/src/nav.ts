/**
 * بنود التنقّل الرئيسي (0005 §١٣٤) — مشتركة بين الويب (القائمة الجانبية) والجوال (تبويب «المزيد»)
 * (خطة الجوال M1). مجموعات بعلاقة موضوعاتها وبترتيب تكرار الاستعمال؛ التسميات ثابتة (المواصفات تنقر بها).
 */
export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group?: string;
}

export const NAV_GROUPS = {
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
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "search", label: "بحث", href: "/search" },
  // البيع اليومي: ما يفعله الكاشير والمالك كل ساعة
  { id: "pos", label: "نقطة البيع", href: "/pos", group: NAV_GROUPS.sell },
  { id: "invoices", label: "الفواتير", href: "/pos/invoices", group: NAV_GROUPS.sell },
  { id: "shift", label: "الوردية والصندوق", href: "/shifts/current", group: NAV_GROUPS.sell },
  { id: "parties", label: "العملاء والذمم", href: "/parties", group: NAV_GROUPS.sell },
  // البضاعة: الأصناف ثم الرصيد ثم الشراء وكلفته
  { id: "catalog", label: "الكتالوج", href: "/catalog", group: NAV_GROUPS.stock },
  { id: "inventory", label: "المخزون", href: "/inventory", group: NAV_GROUPS.stock },
  { id: "purchasing", label: "أوامر الشراء", href: "/purchasing/orders", group: NAV_GROUPS.stock },
  {
    id: "cost-margin",
    label: "التكلفة والهامش",
    href: "/purchasing/cost-margin",
    group: NAV_GROUPS.stock,
  },
  // التقارير: المال أولاً (المبيعات، الصندوق، الذمم) ثم البضاعة ثم التصدير
  { id: "reports", label: "تقرير المبيعات", href: "/reports", group: NAV_GROUPS.reports },
  { id: "reports-cash", label: "تقرير الصندوق", href: "/reports/cash", group: NAV_GROUPS.reports },
  {
    id: "reports-receivables",
    label: "تقرير الذمم",
    href: "/reports/receivables",
    group: NAV_GROUPS.reports,
  },
  {
    id: "reports-stock",
    label: "تقرير المخزون",
    href: "/reports/stock",
    group: NAV_GROUPS.reports,
  },
  { id: "reports-margin", label: "الهامش", href: "/reports/margin", group: NAV_GROUPS.reports },
  {
    id: "reports-export",
    label: "تصدير تقرير",
    href: "/reports/export",
    group: NAV_GROUPS.reports,
  },
  // السوق مشترياً: من تشتري منه وماذا طلبت
  { id: "market", label: "السوق", href: "/market", group: NAV_GROUPS.buy },
  { id: "market-cart", label: "السلة", href: "/market/cart", group: NAV_GROUPS.buy },
  { id: "market-orders", label: "طلباتي", href: "/market/orders", group: NAV_GROUPS.buy },
  { id: "market-following", label: "متابعاتي", href: "/market/following", group: NAV_GROUPS.buy },
  { id: "market-directory", label: "الدليل", href: "/market/directory", group: NAV_GROUPS.buy },
  // السوق بائعاً: من يطلب منك وما تعرضه
  {
    id: "market-incoming",
    label: "طلبات العملاء",
    href: "/market/orders/incoming",
    group: NAV_GROUPS.sellMarket,
  },
  { id: "market-offers", label: "عروضي", href: "/market/offers", group: NAV_GROUPS.sellMarket },
  {
    id: "market-lists",
    label: "القوائم الخاصة",
    href: "/market/lists",
    group: NAV_GROUPS.sellMarket,
  },
  {
    id: "market-renewals",
    label: "تجديد التأكيد",
    href: "/market/renewals",
    group: NAV_GROUPS.sellMarket,
  },
  {
    id: "market-profile",
    label: "صفحة المنشأة",
    href: "/market/profile",
    group: NAV_GROUPS.sellMarket,
  },
  {
    id: "market-seller",
    label: "دور البائع",
    href: "/market/seller",
    group: NAV_GROUPS.sellMarket,
  },
  {
    id: "market-share",
    label: "الروابط والدعوات",
    href: "/market/share",
    group: NAV_GROUPS.sellMarket,
  },
  { id: "market-reports", label: "بلاغاتي", href: "/market/reports", group: NAV_GROUPS.sellMarket },
  // التواصل: ما يصلك وما ترسله
  { id: "notify", label: "الإشعارات", href: "/notify", group: NAV_GROUPS.notify },
  { id: "inbox", label: "الوارد", href: "/notify/inbox", group: NAV_GROUPS.notify },
  { id: "campaigns", label: "الحملات", href: "/notify/campaigns", group: NAV_GROUPS.notify },
  { id: "prefs", label: "تفضيلات التنبيه", href: "/notify/preferences", group: NAV_GROUPS.notify },
  // المنشأة: الناس وصلاحياتهم ثم الفروع ثم الاشتراك والإعدادات والتدقيق
  { id: "org-users", label: "المستخدمون", href: "/org/users", group: NAV_GROUPS.org },
  { id: "org-roles", label: "الأدوار", href: "/org/roles", group: NAV_GROUPS.org },
  { id: "org-branches", label: "الفروع", href: "/org/branches", group: NAV_GROUPS.org },
  { id: "org-subscription", label: "الاشتراك", href: "/org/subscription", group: NAV_GROUPS.org },
  { id: "org-settings", label: "الإعدادات", href: "/org/settings", group: NAV_GROUPS.org },
  { id: "org-audit", label: "سجل التدقيق", href: "/org/audit", group: NAV_GROUPS.org },
  // الأجهزة: كل ما يخص الجهاز الذي في يدك وتشغيله
  { id: "sync", label: "المزامنة", href: "/sync", group: NAV_GROUPS.device },
  { id: "org-devices", label: "الأجهزة", href: "/org/devices", group: NAV_GROUPS.device },
  { id: "print", label: "الطابعة", href: "/print", group: NAV_GROUPS.device },
  { id: "install", label: "التثبيت", href: "/install", group: NAV_GROUPS.device },
  { id: "update", label: "تحديث التطبيق", href: "/sync/update", group: NAV_GROUPS.device },
  { id: "storage", label: "مساحة الجهاز", href: "/sync/storage", group: NAV_GROUPS.device },
  { id: "sessions", label: "الجلسات", href: "/account/sessions", group: NAV_GROUPS.device },
  // البيانات: النسخ والاستعادة والاستيراد — نادرة وحسّاسة، آخر القائمة
  { id: "backup", label: "نسخة محلية", href: "/sync/backup", group: NAV_GROUPS.data },
  { id: "restore", label: "استعادة", href: "/sync/restore", group: NAV_GROUPS.data },
  { id: "import", label: "استيراد بيانات", href: "/sync/import", group: NAV_GROUPS.data },
  { id: "recovery", label: "الأجهزة المسحوبة", href: "/sync/recovery", group: NAV_GROUPS.data },
  { id: "epoch", label: "جيل الخادم", href: "/sync/epoch", group: NAV_GROUPS.data },
  { id: "support", label: "الدعم", href: "/support", group: NAV_GROUPS.help },
];
