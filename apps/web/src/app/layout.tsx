import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { CSSProperties, ReactNode } from "react";

import "@sting/design/fonts.css";
import "./fonts.generated.css";
import "@sting/ui-web/styles.css";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "فيزانو بلص",
  description: "نقطة بيع وذمم ومخزون تعمل بلا اتصال أولاً",
  manifest: "/manifest.webmanifest",
  // أيقونات هوية فيزانو (0005 §١٢٤ — مجموعة rebrand من vezano-site)
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};
/**
 * خط الواجهة Tajawal عبر next/font (0005 §١٤٢): يُحمَّل مسبقاً من <head> فيصل مع الصفحة، وبخط احتياطي
 * مضبوط المقاييس — كان يصل بعد الرسم الأول فيتّسع النصّ وتنزاح الصفحة (CLS في PageSpeed).
 * الرموز `--font-ui`/`--font-heading` تبدأ به ثم سلسلة التصميم كما هي.
 */
const vezanoUi = localFont({
  src: [
    { path: "../../../../packages/design/fonts/Tajawal-Regular.woff2", weight: "400" },
    { path: "../../../../packages/design/fonts/Tajawal-Medium.woff2", weight: "500" },
    { path: "../../../../packages/design/fonts/Tajawal-Bold.woff2", weight: "700" },
    { path: "../../../../packages/design/fonts/Tajawal-ExtraBold.woff2", weight: "800" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
});
const FONT_TOKENS = {
  "--font-ui": `${vezanoUi.style.fontFamily}, "IBM Plex Sans Arabic", system-ui, sans-serif`,
  "--font-heading": `${vezanoUi.style.fontFamily}, Cairo, sans-serif`,
} as CSSProperties;

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F1D2C" };

// اختيار المظهر المحفوظ (فاتح/داكن) يُطبَّق قبل الرسم كي لا يومض؛ بلا اختيار يتبع الجهاز
const THEME_BOOT = `try{var t=localStorage.getItem("vz-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** الجذر: dir="rtl" وlang="ar" (القاعدة 1 من الأمر). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning style={FONT_TOKENS}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
