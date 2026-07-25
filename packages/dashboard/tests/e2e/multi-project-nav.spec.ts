/**
 * SPEC-078 multi-project nav-prefix regression coverage
 * (task-multi-project-nav-links-drop-the-p-name-prefix-clicking, AC 3).
 *
 * Runs under `playwright.multi-project.config.ts` (NOT the default config) — see
 * `multi-project-cache.spec.ts`'s header for the full "why a separate config" rationale;
 * this file reuses the SAME globalSetup/server/fixture.
 *
 * Bug this pins: `routes/__root.tsx`'s nav/header links (logo, Home, Library, Tree,
 * Execution, Settings, Issues) hardcoded unprefixed hrefs (`/`, `/library`, …). Clicking
 * any of them while routed under `/p/project-b/...` silently navigated back to the
 * server's TOP-LEVEL (unprefixed) `app` — which `multi-project-server.ts` mounts as
 * project A's OWN corpus (see that file's header) — so the user would appear to keep
 * working in "project-b" while every read/write actually landed against project-a's
 * data. This suite proves the real fix: clicking each nav item's ACTUAL `<Link>` (never
 * `page.goto`, which would bypass the very href-building bug under test) keeps the URL,
 * the `ProjectSwitcher` trigger label, and the header doc-count badge all pinned to
 * project-b throughout.
 *
 * @spec_ref task-multi-project-nav-links-drop-the-p-name-prefix-clicking
 */
import { test, expect, type Page } from "@playwright/test";
import { loadMultiProjectFixture, type MultiProjectFixture } from "./multi-project-fixture-data";

// Must run under `playwright.multi-project.config.ts` — see
// `multi-project-isolation.spec.ts`'s identical guard for the full rationale.
const MULTI_PROJECT_FIXTURE_PRESENT = process.env.LORE_E2E_MP_RUN_ID !== undefined;
test.skip(
  !MULTI_PROJECT_FIXTURE_PRESENT,
  "requires playwright.multi-project.config.ts — run via `bunx playwright test " +
    "--config=tests/e2e/playwright.multi-project.config.ts`",
);

test.describe.configure({ mode: "serial" });

/** Reads the header doc-count badge's visible text (e.g. "3 docs"). */
async function readDocCountBadge(page: Page): Promise<string> {
  return (await page.locator('[aria-label$=" documents"]').first().textContent())?.trim() ?? "";
}

/** Reads the ProjectSwitcher trigger's visible label (project name, or "Select project"). */
async function readSwitcherLabel(page: Page): Promise<string> {
  return (await page.getByTestId("project-switcher-trigger").textContent())?.trim() ?? "";
}

test.describe("SPEC-078 multi-project nav-prefix regression", () => {
  let page: Page;
  let fixture: MultiProjectFixture;

  test.beforeAll(async ({ browser }) => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    fixture = loadMultiProjectFixture();
    page = await browser.newPage();
    await page.goto("/p/project-a/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    // Switch A -> B via the REAL ProjectSwitcher UI (same mechanism
    // `multi-project-cache.spec.ts` uses), landing on project-b's home.
    await page.getByTestId("project-switcher-trigger").click();
    await page.getByTestId("project-row-project-b").click();
    await expect(page).toHaveURL(/\/p\/project-b/);
  });

  test.afterAll(async () => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    await page.close();
  });

  test("clicking every nav item keeps the URL, switcher label, and doc-count badge pinned to project-b", async () => {
    await expect(page.locator('[aria-label$=" documents"]').first()).toBeVisible();
    const baselineSwitcherLabel = await readSwitcherLabel(page);
    const baselineDocCount = await readDocCountBadge(page);
    expect(baselineSwitcherLabel).toBe("project-b");

    const navClicks: Array<{ name: string; urlPattern: RegExp }> = [
      { name: "Library", urlPattern: /\/p\/project-b\/library$/ },
      { name: "Tree", urlPattern: /\/p\/project-b\/tree$/ },
      { name: "Execution", urlPattern: /\/p\/project-b\/execution$/ },
      { name: "Settings", urlPattern: /\/p\/project-b\/settings$/ },
      { name: "Issues", urlPattern: /\/p\/project-b\/issues$/ },
      { name: "Home", urlPattern: /\/p\/project-b\/?$/ },
    ];

    for (const { name, urlPattern } of navClicks) {
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(urlPattern);

      // The regression itself: BEFORE the fix, every one of these clicks
      // dropped the /p/project-b prefix and silently re-pointed the page at
      // the server's unprefixed top-level app (project-a's own corpus) —
      // the switcher label would read "Select project" and the doc count
      // would flip to project-a's total.
      await expect(page.getByTestId("project-switcher-trigger")).toHaveText(baselineSwitcherLabel);
      expect(await readDocCountBadge(page)).toBe(baselineDocCount);
    }

    // The logo link ("Lore") targets the same home route as "Home" above.
    await page.getByRole("link", { name: "Lore", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/project-b\/?$/);
    await expect(page.getByTestId("project-switcher-trigger")).toHaveText(baselineSwitcherLabel);
  });

  test("project-b's library still shows only its own marker doc after the full nav loop", async () => {
    await page.getByRole("link", { name: "Library", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByText(fixture.seed.b.markerTaskTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.seed.a.markerTaskTitle, { exact: true })).not.toBeVisible();
  });
});
