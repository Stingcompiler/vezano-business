import { defineConfig, devices } from "@playwright/test";

/**
 * بوابة T1.43 (§١٥.٤): سيناريوهات بجهازين (سياقان) على خادم Django حقيقي — لا `page.route`.
 * Next يعمل على 3100 ويمرّر `/api/*` إلى Django على 8100 (`STING_API_UPSTREAM`)، والمتصفح
 * يطلب نسبياً (`NEXT_PUBLIC_API_URL=""`). تُشغَّل وحدها: `pnpm e2e:gate`.
 */
const backend = process.env.STING_GATE_BACKEND_DIR ?? "../../backend";
const db = process.env.DATABASE_URL ?? "postgresql:///sting_gate_test";
const backendEnv = `DATABASE_URL=${db} STING_ENV=${process.env.CI ? "ci" : "development"} STING_FAULTS_ENABLED=1 DJANGO_SECRET_KEY=gate-only`;

export default defineConfig({
  testDir: "./e2e-gate",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:3100", locale: "ar", trace: "retain-on-failure" },
  projects: [
    {
      name: "gate-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: `cd ${backend} && ${backendEnv} uv run python manage.py migrate --noinput && ${backendEnv} uv run python manage.py runserver 8100 --noreload`,
      url: "http://localhost:8100/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: "node scripts/prepare-fonts.mjs && NEXT_DIST_DIR=.next-gate next dev -p 3100",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: "", STING_API_UPSTREAM: "http://localhost:8100" },
    },
  ],
});
