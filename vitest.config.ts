import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // reason: dashboard src uses "@/" path alias; root vitest must resolve it to
      // packages/dashboard/src/ for component tests to find ui primitives. SPEC-015 §4 M6.
      "@": fileURLToPath(new URL("./packages/dashboard/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: [
      // reason: dashboard component tests need jest-dom matchers + React cleanup wired before
      // each test. vitest globals:false prevents @testing-library/react auto-detecting afterEach,
      // so setup.ts registers it explicitly. SPEC-015 §4 M6.
      "packages/dashboard/tests/setup.ts",
    ],
    include: [
      "packages/lore/tests/**/*.test.ts",
      "packages/lore/src/**/*.test.ts",
      "packages/core/src/**/*.test.ts",
      "packages/dashboard/tests/**/*.test.ts",
      "packages/dashboard/tests/**/*.test.tsx",
      "packages/dashboard/src/**/*.test.ts",
      "packages/dashboard/src/**/*.test.tsx",
    ],
    exclude: ["**/*.bun.test.ts", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/lore/src/index.ts"],
    },
  },
  ssr: { external: ["bun:sqlite"] },
  optimizeDeps: { exclude: ["bun:sqlite"] },
});
