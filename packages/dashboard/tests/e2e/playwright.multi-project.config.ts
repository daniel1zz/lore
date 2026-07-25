/**
 * SPEC-078 T11 — SEPARATE Playwright config for the multi-project e2e suite.
 *
 * Why a second config file rather than extending `../../playwright.config.ts` in
 * place: that file (and `../../vite.config.ts`'s hardcoded `/api` proxy target,
 * `http://localhost:8787`) is OUTSIDE this task's declared anchor
 * (`packages/dashboard/tests/e2e/`) — see `multi-project-global-setup.ts`'s header for
 * the full architectural reasoning (registry-absent vs registry-populated environments
 * cannot coexist within ONE `globalSetup`/server/vite instance, and both config files'
 * proxy target is fixed to 8787 regardless of which config launches vite).
 *
 * Run explicitly via `--config`:
 *   cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.multi-project.config.ts
 *
 * Deliberately NEVER run concurrently with the default `playwright.config.ts` suite —
 * both bind the SAME fixed ports (8787/5173). `multi-project-global-setup.ts`'s
 * `assertPortFree` guard fails loud if this invariant is violated.
 *
 * Source: SPEC-078 §Acceptance Criteria AC-078-6/7/8.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: ["multi-project-*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  globalSetup: "./multi-project-global-setup.ts",
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
