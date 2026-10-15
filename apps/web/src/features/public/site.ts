import type { Metadata } from "next";

/** عنوان الموقع العام — لروابط robots/sitemap والمعاينة (0005 §١٥٤). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://plus.vezano.app").replace(
  /\/$/,
  "",
);
export const SITE_NAME = "فيزانو بلص";
export const SITE_DESCRIPTION =
  "نقطة بيع ومخزون وذمم تعمل وإن انقطعت الشبكة، للمحلات والبقالات والموزّعين في السودان. جرّب 30 يوماً مجاناً — دفترك ملكك.";

export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: SITE_NAME };

/**
 * بيانات صفحة عامة: العنوان (يُلحق به اسم الموقع من القالب)، والوصف، والرابط القانوني، والمعاينة.
 * `openGraph` في الصفحة يستبدل ما في الجذر كاملاً — فالصورة تُعاد هنا.
 */
export function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "ar_SD",
      siteName: SITE_NAME,
      title: `${title} · ${SITE_NAME}`,
      description,
      url: path,
      images: [OG_IMAGE],
    },
  };
}
