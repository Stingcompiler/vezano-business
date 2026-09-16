import { defineConfig } from "vitest/config";

// مشروعان: node لكل الحزم، وjsdom لمكوّنات ui-web (testing-library + axe — 23-Handoff §٥).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/**/*.test.ts", "tools/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**", "packages/ui-web/**"],
          environment: "node",
        },
      },
      {
        plugins: [],
        test: {
          name: "ui-web",
          include: ["packages/ui-web/src/**/*.test.tsx", "packages/ui-web/src/**/*.test.ts"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./packages/ui-web/src/test/setup.ts"],
        },
        esbuild: { jsx: "automatic" },
      },
    ],
    passWithNoTests: false,
  },
});
