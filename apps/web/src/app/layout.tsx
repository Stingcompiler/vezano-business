import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@sting/design/fonts.css";
import "./fonts.generated.css";
import "@sting/ui-web/styles.css";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "فيزانو",
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
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F1D2C" };

// اختيار المظهر المحفوظ (فاتح/داكن) يُطبَّق قبل الرسم كي لا يومض؛ بلا اختيار يتبع الجهاز
const THEME_BOOT = `try{var t=localStorage.getItem("vz-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** الجذر: dir="rtl" وlang="ar" (القاعدة 1 من الأمر). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
