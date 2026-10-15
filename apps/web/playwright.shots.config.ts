import { defineConfig, devices } from "@playwright/test";

/**
 * لقطات المراجعة البصرية (docs/ui-profile.md §«أمر اللقطات»؛ 0005 §١٥٨) — أمر واحد:
 *   SHOTS_LABEL=before pnpm --filter @sting/web shots
 * يشغّل مواصفات الشاشات التمثيلية بمصفوفة: ثلاثة مقاسات × فاتح/داكن، والعربية، والحركة معطّلة، ويحفظ لقطة
 * كاملة الصفحة لحالة كل اختبار في آخره، في `shots/<الدفعة>/<مقاس>--<وضع>/…`.
 * الخادم يُحاكى على مستوى الشبكة (كما كل المواصفات)، فالبيانات ثابتة والتاريخ ثابت.
 * قيد معلن: لقطة واحدة لكل اختبار (حالته الأخيرة)؛ وللحالات الوسيطة تُضاف لقطات صريحة داخل المواصفة.
 */
const PORT = process.env.PLAYWRIGHT_PORT ?? "3000";
const LABEL = process.env.SHOTS_LABEL ?? "current";

const REPRESENTATIVE = [
  "public-pages.spec.ts", // PUB-01…05: الهبوط، الشروط، الحالة (بطاقات خدمة)، الباقات
  "platform-overview.spec.ts", // PLT-00 (مؤشرات، قوائم، صفوف)
  "platform-demo-requests.spec.ts", // PLT-14 (عدّادات، بطاقات طلبات، إجراءات)
  "platform-plans.spec.ts", // PLT-16 (بطاقات باقات)
  "home.spec.ts", // HOME-01/02/03 (لوحة المتجر، مؤشرات)
];

// الداكن اختياري (SHOTS_SCHEMES=dark|both): مواصفاتنا تطابق ألوان الرموز الفاتحة عند 1440 فتفشل في الداكن
// عمداً بعد أول إطار — اللقطة حينئذ لأول حالة فُحصت لا لآخرها. للداكن الموثوق: scripts/explore-status.mjs.
const scheme = process.env.SHOTS_SCHEMES ?? "light";
const dark = scheme === "dark" || scheme === "both";
const light = scheme !== "dark";
const project = (name: string, width: number, height: number, scheme: "light" | "dark") => ({
  name: `${name}--${scheme}`,
  testMatch: REPRESENTATIVE,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width, height },
    colorScheme: scheme,
  },
});

export default defineConfig({
  testDir: "./e2e",
  outputDir: `./shots/${LABEL}`,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3, // خادم تطوير واحد: أكثر من ثلاثة عمّال يُنتج مهلات لا نتائج
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ar",
    screenshot: { mode: "on", fullPage: true },
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    ...(light
      ? [
          project("phone-390", 390, 844, "light"),
          project("tablet-834", 834, 1194, "light"),
          project("desktop-1440", 1440, 900, "light"),
        ]
      : []),
    ...(dark
      ? [project("phone-390", 390, 844, "dark"), project("desktop-1440", 1440, 900, "dark")]
      : []),
  ],
  webServer: {
    command: `node scripts/prepare-fonts.mjs && NEXT_DIST_DIR=.next-e2e next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
