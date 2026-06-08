import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["tests/**/*.bun.test.ts", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@store": resolve(__dirname, "src/store"),
      "@service": resolve(__dirname, "src/service"),
      "@adapters": resolve(__dirname, "src/adapters"),
    },
  },
  // bun:sqlite is a Bun built-in — treat it as an external so Vite does not
  // attempt to resolve or bundle it. Tests that use SQLiteStore must run
  // under Bun (bun test) or via Vitest with the Bun runner.
  ssr: {
    external: ["bun:sqlite"],
  },
  optimizeDeps: {
    exclude: ["bun:sqlite"],
  },
});
