import { defineConfig } from "vitest/config";

// مشروع Vitest واحد على مستوى الجذر: كل حزمة تضع اختباراتها بجانب مصدرها.
// اختبارات المتصفح الحقيقي (IndexedDB) تُضاف في T0.11 عبر Playwright لا هنا.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "tools/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
    environment: "node",
    passWithNoTests: false,
  },
});
