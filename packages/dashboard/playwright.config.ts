/**
 * Playwright config for the SPEC-022 dashboard write-flow e2e suite.
 *
 * `testMatch` is deliberately `**\/*.pw.ts` (NOT `*.test.ts` / `*.spec.ts`) so these
 * browser tests are never picked up by vitest (root `vitest.config.ts`'s `include`
 * globs only match `*.test.ts(x)`) nor by `bun test` (root `test:bun` script is scoped
 * to `packages/lore` only, and Bun's default test matcher looks for `*.test.*` /
 * `*.spec.*` regardless). This keeps `bun run test` (the default oracle gate) fully
 * independent of a browser being installed.
 *
 * `workers: 1` + `fullyParallel: false`: the whole suite shares ONE throwaway Lore
 * corpus + ONE HTTP server + ONE Vite dev server (booted once in globalSetup) on fixed
 * ports 8787/5173 (see global-setup.ts for why the ports are fixed). Running two test
 * files/workers concurrently against the same corpus would race on doc IDs and the
 * fixed ports, so we run serially — deterministic over fast.
 *
 * Source: SPEC-022 §9.7.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
