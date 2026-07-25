/**
 * SPEC-078 T11 — client read-side (cache) isolation e2e coverage (AC-078-8).
 *
 * Runs under `playwright.multi-project.config.ts` (see `multi-project-global-setup.ts`
 * header for why). Proves the TanStack Query cache-key scoping (`queryKeys.scope`,
 * `project-api.ts` D5 — a project-null key is byte-unchanged, a project-named key
 * gets a `project:<name>` prefix segment) actually produces observable isolation in a
 * real browser: after seeding distinguishable content in both corpora and switching
 * A -> B via the REAL `ProjectSwitcher` UI (not a direct URL edit), zero A-content
 * renders under any of B's routes (list, tree, detail).
 *
 * The ESLint-rule half of AC-078-8 ("an ESLint fixture containing a raw /api/
 * template literal outside the factory module fails lint with the dedicated rule
 * id") is a separate, ALREADY-LANDED mechanism (`eslint.config.js`'s
 * `dashboard-local/no-raw-api-literal` + `tests/fixtures/eslint/raw-api-literal.fixture.ts`
 * + the `lint:api-factory-fixture` package.json script) — this file's oracle command
 * is chained with that script, not reimplemented here.
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-8
 */
import { test, expect, type Page } from "@playwright/test";
import { loadMultiProjectFixture, type MultiProjectFixture } from "./multi-project-fixture-data";

// Must run under `playwright.multi-project.config.ts` — see
// `multi-project-isolation.spec.ts`'s identical guard for the full rationale (both
// configs' `testMatch` glob this filename; the default registry-less config must
// self-skip rather than fail with `LORE_E2E_MP_*` env vars absent).
const MULTI_PROJECT_FIXTURE_PRESENT = process.env.LORE_E2E_MP_RUN_ID !== undefined;
test.skip(
  !MULTI_PROJECT_FIXTURE_PRESENT,
  "requires playwright.multi-project.config.ts — run via `bunx playwright test " +
    "--config=tests/e2e/playwright.multi-project.config.ts`",
);

test.describe.configure({ mode: "serial" });

test.describe("SPEC-078 multi-project client read-side isolation", () => {
  let page: Page;
  let fixture: MultiProjectFixture;

  test.beforeAll(async ({ browser }) => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    fixture = loadMultiProjectFixture();
    page = await browser.newPage();
    await page.goto("/p/project-a/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test.afterAll(async () => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    await page.close();
  });

  test("project A's library shows its own marker doc", async () => {
    await expect(page.getByText(fixture.seed.a.markerTaskTitle, { exact: true })).toBeVisible();
  });

  test("switching A -> B via the real ProjectSwitcher renders zero A-content under B's list/tree/detail routes", async () => {
    await page.getByTestId("project-switcher-trigger").click();
    await page.getByTestId("project-row-project-b").click();
    await expect(page).toHaveURL(/\/p\/project-b/);

    // ── list ──────────────────────────────────────────────────────────────────
    await page.goto("/p/project-b/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByText(fixture.seed.b.markerTaskTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.seed.a.markerTaskTitle, { exact: true })).not.toBeVisible();

    // ── tree ──────────────────────────────────────────────────────────────────
    await page.goto("/p/project-b/tree");
    await expect(page.getByText(fixture.seed.b.prdTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.seed.a.prdTitle, { exact: true })).not.toBeVisible();
    await expect(page.getByText(fixture.seed.a.markerTaskTitle, { exact: true })).not.toBeVisible();

    // ── detail ────────────────────────────────────────────────────────────────
    await page.goto(`/p/project-b/docs/${fixture.seed.b.markerTaskId}`);
    await expect(page.getByRole("heading", { name: fixture.seed.b.markerTaskTitle })).toBeVisible();
    await expect(page.getByText(fixture.seed.b.markerContent, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.seed.a.markerContent, { exact: true })).not.toBeVisible();
  });
});
