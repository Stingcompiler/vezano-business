import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
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
