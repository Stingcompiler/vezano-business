/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-no-platform-or-ui",
      comment:
        "النواة المشتركة (domain, sync-core, platform) لا تستورد React أو DOM أو Next أو Expo أو Tauri أو Dexie أو SQLite ولا حزمة ui-web ولا أي تطبيق (§٤.٦ بند ١، معيار §١٨ ACC-115).",
      severity: "error",
      from: {
        path: "^(packages/(domain|sync-core)|packages/platform/src/(?!dexie)|tools/boundaries/fixtures/core)/",
      },
      to: {
        path: "^(node_modules/)?(react|react-dom|react-native|next|dexie|expo|expo-sqlite|@tauri-apps|@sting/ui-web)(/|$)|^packages/ui-web/|^apps/",
      },
    },
    {
      name: "domain-is-leaf",
      comment: "packages/domain لا تعتمد على sync-core ولا platform — حسابات نقية فقط.",
      severity: "error",
      from: { path: "^(packages/domain|tools/boundaries/fixtures/domain)/" },
      to: { path: "^packages/(sync-core|platform|contracts|design|ui-web)/" },
    },
    {
      name: "apps-no-cross-app",
      comment: "التطبيقات لا تستورد بعضها؛ المشترك يعيش في packages/.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/(?!$1/)[^/]+/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|\\.next|storybook-static)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
