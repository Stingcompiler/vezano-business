// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";

// الحزم التي تشكّل نواة العميل المشتركة (§٤.٦ بند ١): لا React ولا DOM ولا مشغّل منصة.
const CORE_PACKAGES = ["packages/domain/**", "packages/sync-core/**", "packages/platform/**"];
const PLATFORM_MODULES = [
  "react",
  "react-dom",
  "react-native",
  "next",
  "dexie",
  "expo",
  "expo-sqlite",
  "@tauri-apps/api",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/storybook-static/**",
      "design_handoff_sting_systems/**",
      "backend/**",
      "tools/boundaries/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["*.config.js", "*.config.ts", "*.cjs", "vitest.config.ts", "eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
  },
  {
    files: CORE_PACKAGES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: PLATFORM_MODULES.map((name) => ({
            name,
            message: `النواة المشتركة لا تستورد ${name} — تعتمد على عقود packages/platform فقط (§٤.٦).`,
          })),
          patterns: [
            "react/*",
            "react-dom/*",
            "next/*",
            "expo-*",
            "@tauri-apps/*",
            "@sting/ui-web",
            "@sting/ui-web/*",
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "لا DOM في النواة" },
        { name: "document", message: "لا DOM في النواة" },
        { name: "indexedDB", message: "التخزين يمرّ بعقد platform لا بالمشغّل مباشرة" },
        { name: "localStorage", message: "localStorage ليس قفلاً ولا دفتراً (§٨.٢)" },
      ],
    },
  },
  {
    files: ["packages/ui-web/**/*.tsx", "apps/web/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  prettier,
);
