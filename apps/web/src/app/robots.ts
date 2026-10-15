import type { MetadataRoute } from "next";

import { SITE_URL } from "@/features/public/site";

/**
 * محرّكات البحث (0005 §١٥٤): الصفحات العامة تُفهرس؛ التطبيق خلف الدخول ولوحة المشغّل والواجهة
 * البرمجية لا — لا محتوى عام فيها، وروابطها لا تُعرض في نتائج البحث.
 */
const PRIVATE = [
  "/api/",
  "/platform",
  "/pos",
  "/org",
  "/parties",
  "/inventory",
  "/catalog",
  "/reports",
  "/purchasing",
  "/shifts",
  "/sync",
  "/notify",
  "/grow",
  "/account",
  "/onboarding",
  "/create-org",
  "/select-org",
  "/setup-device",
  "/lock",
  "/session-expired",
  "/link-expired",
  "/forbidden",
  "/invite/",
  "/portal/",
  "/print",
  "/search",
  "/support",
  "/install",
  "/dev/",
  "/market/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    // عرض سوق عام برابط مشاركة يُفهرس رغم منع ما تحت /market/ (الأطول تطابقاً يغلب)
    rules: [{ userAgent: "*", allow: ["/", "/market/offers/public/"], disallow: PRIVATE }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
