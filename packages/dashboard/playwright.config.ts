/**
 * Playwright config for the SPEC-022 dashboard write-flow e2e suite.
 *
 * `testMatch` covers `**\/*.pw.ts` AND `**\/*.spec.ts` (NOT bare `*.test.ts`) so these
 * browser tests are never picked up by vitest (root `vitest.config.ts`'s `include`
 * globs only match `*.test.ts(x)`, plus `packages/dashboard/vite.config.ts` excludes
 * the whole `tests/e2e/**` directory as belt-and-suspenders) nor by `bun test` (root
 * `test:bun` script is scoped to `packages/lore` only, so a `.spec.ts` file under
 * `packages/dashboard/` is never in that invocation's cwd regardless of naming). This
 * keeps `bun run test` (the default oracle gate) fully independent of a browser being
 * installed. `**\/*.spec.ts` was added by SPEC-074 T2 (`tests/e2e/issues.spec.ts`) —
 * the task packet's own oracle command names that literal filename; extending
 * `testMatch` (rather than renaming the new suite to `.pw.ts`) keeps it discoverable
 * both standalone (`playwright test tests/e2e/issues.spec.ts`) and as part of the bare
 * `playwright test` full-suite run this file's header already documents below.
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
  testMatch: ["**/*.pw.ts", "**/*.spec.ts"],
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
