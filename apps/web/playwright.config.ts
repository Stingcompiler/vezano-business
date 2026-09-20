import { defineConfig, devices } from "@playwright/test";

/**
 * المقاسات المعتمدة (tokens.json platform.W): 390 · 834 · 1440.
 * النصوص الحرفية تُطابَق في كلها؛ الأنماط المحسوبة عند 1440 (القسم ٣ من الأمر).
 */
// منفذ آخر حين يشغل مشروعٌ آخر على الجهاز 3000 (`PLAYWRIGHT_PORT=3011`)؛ CI على 3000.
const PORT = process.env.PLAYWRIGHT_PORT ?? "3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // أول زيارة لكل صفحة تُترجم على خادم التطوير تحت حمل العمّال المتوازين — مهلة التوقعات أطول من الافتراضي
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, locale: "ar", trace: "retain-on-failure" },
  projects: [
    {
      name: "phone-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-834",
      use: { ...devices["Desktop Chrome"], viewport: { width: 834, height: 1194 } },
    },
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `node scripts/prepare-fonts.mjs && NEXT_DIST_DIR=.next-e2e next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
