import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: [
      "packages/lore/tests/**/*.test.ts",
      "packages/lore/src/**/*.test.ts",
      "packages/core/src/**/*.test.ts",
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
