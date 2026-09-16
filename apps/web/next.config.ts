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
};

export default config;
