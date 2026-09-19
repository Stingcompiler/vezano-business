import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // زر أدوات التطوير العائم يغطي التنقل السفلي في 390 ويعترض النقر في Playwright — لا أثر له في الإنتاج
  devIndicators: false,
  // الحزم المشتركة تُترجم من المصدر (TS) داخل مساحة العمل
  transpilePackages: [
    "@sting/ui-web",
    "@sting/design",
    "@sting/domain",
    "@sting/sync-core",
    "@sting/platform",
    "@sting/contracts",
  ],
  // بيانات المستأجر لا تدخل كاشاً عاماً (§١٢.٤): لا ISR افتراضي؛ SSG للعام فقط عند بنائه
  experimental: {},
  // بوابة T1.43 والنشر بنفس الأصل: `/api/*` يُمرَّر إلى الخادم حين يُضبط `STING_API_UPSTREAM`
  // (مع `NEXT_PUBLIC_API_URL=""` فتصبح طلبات المتصفح نسبية — لا CORS ولا أصل ثانٍ)
  rewrites() {
    const upstream = process.env.STING_API_UPSTREAM;
    if (!upstream) return Promise.resolve([]);
    return Promise.resolve([{ source: "/api/:path*", destination: `${upstream}/api/:path*` }]);
  },
};

export default config;
