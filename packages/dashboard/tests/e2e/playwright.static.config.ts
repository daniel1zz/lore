/**
 * Playwright config for the SINGLE-PROCESS packaged-mode static e2e harness
 * (spec-dashboard-production-packaging-one-command-lore-dashboard DD-6).
 *
 * Run:
 *   cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts
 *   # or, by name (cold-start operator, no absolute path needed):
 *   cd packages/dashboard && bun run test:e2e:static
 *
 * `testMatch: ["**\/*.static.ts"]` is deliberately DISJOINT from the default
 * `playwright.config.ts`'s `["**\/*.pw.ts", "**\/*.spec.ts"]` and from
 * `playwright.multi-project.config.ts`'s `["multi-project-*.spec.ts"]` — no filename
 * in this repo can ever be picked up by more than one of the three configs, so running
 * any one suite never contaminates another's fixtures (`fullyParallel: false` inside
 * one config does not protect against a DIFFERENT config's globalSetup racing the same
 * fixed ports — the AC for this task requires the pre-existing two-process suite to
 * still pass AFTER this one runs, never concurrently).
 *
 * `baseURL: http://localhost:8787` (not 5173) — packaged mode is single-origin: the
 * lore HTTP server itself serves both the static SPA and `/api/*`, so every request in
 * this suite's spec files (page navigation AND `page.request` API calls) targets the
 * SAME origin as `dist/lore dashboard --no-open` actually binds. `globalSetup-static.ts`
 * asserts this port is free before spawning our own server and never spawns Vite at
 * all — the `VITE_DEV_PORT` (5173) staying unbound for the suite's whole duration is
 * itself one of this harness's assertions (`static-serving.static.ts`, "no vite
 * process").
 *
 * `workers: 1` + `fullyParallel: false` + `retries: 0`: ONE `dist/lore dashboard`
 * process serves the whole suite, minting exactly ONE single-use nonce at startup
 * (DD-2) — the "nonce" group's tests redeem it in a specific declared order (first
 * redemption, THEN the replay-is-410 assertion), so serial/deterministic execution is
 * a correctness requirement here, not just a speed/flakiness tradeoff (mirrors
 * `playwright.config.ts`'s identical reasoning for its own single shared corpus).
 *
 * CI wiring: run this suite SERIALLY with the existing default `playwright.config.ts`
 * e2e job — NEVER concurrently (both configs' servers ultimately bind port 8787; see
 * `assertPortFree` in each config's own globalSetup). A CI job step sequence:
 *   1. cd packages/dashboard && bunx playwright test                                   (--dev topology, port 5173+8787)
 *   2. cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts  (packaged topology, port 8787 only)
 * Same discipline `playwright.multi-project.config.ts`'s own header already documents
 * for its sibling relationship to the default config.
 *
 * Source: spec-dashboard-production-packaging-one-command-lore-dashboard DD-6;
 *   task-skill-test-f5a-single-process-static-e2e-harness (AC-F5A-1, AC-F5A-2, AC-F5A-8).
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: ["**/*.static.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  globalSetup: "./global-setup-static.ts",
  use: {
    baseURL: "http://localhost:8787",
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
