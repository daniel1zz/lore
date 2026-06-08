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
});
