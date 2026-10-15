import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // خادما التطوير (المعاينة 3100 والاختبار 3011/3100) لا يتشاركان مخرجات البناء — وإلا يكتب أحدهما
  // بيئة الآخر (NEXT_PUBLIC_API_URL) فتطلب المعاينة localhost:8000 مباشرةً وتسقط بـCORS
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
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
  experimental: {
    // الإنتاج: CSS مضمَّن في HTML بدل تسعة ملفات تحجب الرسم الأول (PageSpeed: ‎3.3 ث على شبكة الجوال؛
    // 0005 §١٤٢). لا أثر في التطوير.
    inlineCss: true,
  },
  // ترويسات الأمان (0005 §١٥٤): لا تضمين في إطار غريب (clickjacking)، ولا تخمين نوع المحتوى، ولا
  // تسريب المسار الكامل لمواقع أخرى، وHTTPS إلزامي سنة. لا CSP كامل بعد: CSS المضمَّن (inlineCss)
  // وسكربتات Next المضمَّنة تحتاج nonce — `frame-ancestors` وحده يكفي ضد التضمين.
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ]);
  },
  // بوابة T1.43 والنشر بنفس الأصل: `/api/*` يُمرَّر إلى الخادم حين يُضبط `STING_API_UPSTREAM`
  // (مع `NEXT_PUBLIC_API_URL=""` فتصبح طلبات المتصفح نسبية — لا CORS ولا أصل ثانٍ)
  rewrites() {
    const raw = process.env.STING_API_UPSTREAM;
    if (!raw) return Promise.resolve([]);
    // Render يعطي عنوان الخدمة الخاصة «مضيف:منفذ» بلا بروتوكول (0005 §١١٨)
    const upstream = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
    return Promise.resolve([{ source: "/api/:path*", destination: `${upstream}/api/:path*` }]);
  },
};

export default config;
