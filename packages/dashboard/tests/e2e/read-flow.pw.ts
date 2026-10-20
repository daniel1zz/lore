/**
 * SPEC-031 dashboard read-path e2e coverage.
 *
 * Regression oracle for the `/tree` and `/search` contract-drift bug: the frontend's
 * `TreeNode` / `SearchResponse` types previously guessed a shape the HTTP server never
 * sent (`nodes.map is not a function` on `/tree`; `Cannot read properties of undefined
 * (reading 'map')` on `/search`). This suite drives both pages against the REAL running
 * server (no mocked fetch) so any future envelope drift fails loud here, exactly the way
 * `write-flow.pw.ts` is the regression oracle for the write path and the `@lore/core`
 * browser-safety invariant.
 *
 * Seeding: rather than depending on the shared throwaway corpus's pre-existing state (its
 * exact contents are an implementation detail of `global-setup.ts` and may legitimately
 * change), this suite creates its own root PRD and its own uniquely-titled searchable doc
 * through the real UI "New doc" flow — mirroring write-flow.pw.ts's own self-contained
 * seeding rather than shelling out to the CLI or hitting the API directly. `CorpusService.tree()`
 * defaults to the first PRD found when no `root` is given (`packages/lore/src/service/corpus-service.ts`),
 * so creating exactly one PRD here makes the tree page's root deterministic.
 *
 * Auth: no manual cookie minting — `global-setup.ts` boots Vite with
 * `VITE_LORE_BOOTSTRAP_TOKEN` set, so every full page load triggers the real
 * `bootstrapAuthIfNeeded()` SPA path (SPEC-016 §3.8).
 *
 * Source: SPEC-031 §4 (AC-1, AC-2, AC-4).
 * @spec_ref AC-1, AC-2, AC-4
 */

import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("SPEC-031 dashboard read flow", () => {
  let page: Page;
  const runId = Date.now();
  const prdTitle = `E2E Read Flow Root PRD ${runId}`;
  // A token unlikely to collide with any pre-existing corpus content, embedded in a
  // second doc's title so FTS5 full-text search (which indexes title + content + tags)
  // reliably matches it.
  const searchMarker = `ReadFlowSearchMarker${runId}`;
  const searchableTitle = `E2E Read Flow Searchable Doc ${searchMarker}`;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── 1. Seed: create the root PRD ────────────────────────────────────────────

  test("seed: create a PRD doc via the New doc modal", async () => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    await page.getByRole("button", { name: "New doc" }).click();
    const dialog = page.getByRole("dialog", { name: "Create new document" });
    await expect(dialog).toBeVisible();

    await dialog.locator("#doc-type").selectOption("prd");
    await dialog.locator("#doc-title").fill(prdTitle);
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText(`Created prd-`, { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/docs\/[^/]+$/);
    await expect(page.getByRole("heading", { name: prdTitle })).toBeVisible();
  });

  // ── 2. Seed: create a second, uniquely-titled doc to search for ─────────────

  test("seed: create a second doc with a unique searchable title", async () => {
    await page.goto("/library");
    await page.getByRole("button", { name: "New doc" }).click();
    const dialog = page.getByRole("dialog", { name: "Create new document" });
    await expect(dialog).toBeVisible();

    // "plan" needs no parent_id / extra fields — keeps seeding focused on the search term.
    await dialog.locator("#doc-type").selectOption("plan");
    await dialog.locator("#doc-title").fill(searchableTitle);
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText(`Created plan-`, { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/docs\/[^/]+$/);
    await expect(page.getByRole("heading", { name: searchableTitle })).toBeVisible();
  });

  // ── 3. Tree: renders the real single-root envelope, no crash ────────────────

  test("tree: renders the root PRD node and navigates to its detail page on click (AC-1)", async () => {
    await page.goto("/tree");
    await expect(page.getByRole("heading", { name: "Document Tree" })).toBeVisible();

    // No uncaught page error (the historical `nodes.map is not a function` crash).
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // reason: the tree's default root is the OLDEST live PRD (`pickStrategyDocument`), and the
    // other e2e files share this corpus and may have created an older PRD first, so the root
    // is read from the API instead of assumed to be this file's `prdTitle` (GitHub #321).
    const treeResponse = await page.request.get("http://localhost:8787/api/tree");
    expect(treeResponse.ok()).toBe(true);
    const treeBody = (await treeResponse.json()) as { ok: boolean; data: { doc: { title: string } } };
    const rootTitle = treeBody.data.doc.title;

    const rootRow = page.getByText(rootTitle, { exact: true });
    await expect(rootRow).toBeVisible();
    // Type badge renders from `node.doc.type`, not a flattened `node.type`.
    await expect(page.getByText("prd", { exact: true }).first()).toBeVisible();

    await rootRow.click();
    await expect(page).toHaveURL(/\/docs\/[^/]+$/);
    await expect(page.getByRole("heading", { name: rootTitle })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  // ── 4. Search: renders data.results, no crash ────────────────────────────────

  test("search: renders at least one result for the seeded term (AC-2)", async () => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`/search?q=${encodeURIComponent(searchMarker)}`);
    await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();

    await expect(page.getByText(searchableTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(/^\d+ results? for/)).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
