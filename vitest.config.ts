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
      // reason: SPEC-040 T1 introduces a dedicated packages/core/tests/ directory
      // (existing convention colocates *.test.ts next to source in src/) — both
      // layouts are valid; this glob just adds the new directory. SPEC-040 §T1.
      "packages/core/tests/**/*.test.ts",
      "packages/dashboard/tests/**/*.test.ts",
      "packages/dashboard/tests/**/*.test.tsx",
      "packages/dashboard/src/**/*.test.ts",
      "packages/dashboard/src/**/*.test.tsx",
    ],
    // reason: "**/*.pw.ts" (Playwright e2e specs, packages/dashboard/tests/e2e/**) already
    // fail to match the `include` globs above (which only list *.test.ts(x)), but this
    // exclude is a belt-and-suspenders guard so a future include-glob change can't
    // accidentally pull Playwright specs into the vitest run. SPEC-022 §9.7.
    exclude: ["**/*.bun.test.ts", "**/*.pw.ts", "node_modules/**"],
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
