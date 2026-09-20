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
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#115E59" };

/** الجذر: dir="rtl" وlang="ar" (القاعدة 1 من الأمر). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
