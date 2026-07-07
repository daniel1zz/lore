/**
 * SPEC-036 dashboard browsing UX e2e coverage.
 *
 * Two independent journeys against the real running server (no mocked fetch),
 * seeded via out-of-band `POST /api/dashboard/docs` calls through the shared
 * browser-context cookie jar (`page.request`) — the same pattern
 * `write-flow.pw.ts`'s "conflict" scenario uses for setup that the UI itself
 * doesn't expose (tags aren't settable via NewDocModal's form (SPEC-022), but
 * the write endpoint accepts them per `createDocInputSchema`).
 *
 * 1. Breadcrumb: PRD -> spec -> plan -> task (a 3-ancestor chain), then verify
 *    the detail page's breadcrumb renders the full chain and each crumb
 *    navigates (AC-36-3), plus a Home-crumb roundtrip.
 * 2. Library filters: seed docs with distinct tags, apply type + status + tag
 *    filters via the chip UI, reload the page, and confirm every filter
 *    (including the URL) survived the reload (AC-36-5) and the tag filter's
 *    AND semantics hold (AC-36-6).
 *
 * Auth: no manual cookie minting — `global-setup.ts` boots Vite with
 * `VITE_LORE_BOOTSTRAP_TOKEN` set, so the real `bootstrapAuthIfNeeded()` SPA
 * path (SPEC-016 §3.8) runs on first page load.
 *
 * Source: SPEC-036 §1 D1/D2, AC-36-3, AC-36-5, AC-36-6.
 * @spec_ref AC-36-3, AC-36-5, AC-36-6
 */

import { test, expect, type Page } from "@playwright/test";

const API_ORIGIN = "http://localhost:8787";

test.describe.configure({ mode: "serial" });

interface CreatedDoc {
  id: string;
  slug: string;
}

async function createDoc(
  page: Page,
  payload: Record<string, unknown>,
): Promise<CreatedDoc> {
  const response = await page.request.post(`${API_ORIGIN}/api/dashboard/docs`, {
    headers: { "Content-Type": "application/json" },
    data: payload,
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { ok: boolean; data: { doc: CreatedDoc } };
  expect(body.ok).toBe(true);
  return body.data.doc;
}

test.describe("SPEC-036 dashboard browsing UX", () => {
  let page: Page;
  const runId = Date.now();

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // A full page load runs bootstrapAuthIfNeeded() and mints the lore_sid cookie
    // that page.request (same context) then reuses for the out-of-band POSTs below.
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── 1. Breadcrumb navigation roundtrip (AC-36-3) ────────────────────────────

  test.describe("breadcrumb", () => {
    let prdId = "";
    let specId = "";
    let planId = "";
    let taskId = "";
    const prdTitle = `E2E Breadcrumb Root PRD ${runId}`;
    const specTitle = `E2E Breadcrumb Spec ${runId}`;
    const planTitle = `E2E Breadcrumb Plan ${runId}`;
    const taskTitle = `E2E Breadcrumb Task ${runId}`;

    test("seed: PRD -> spec -> plan -> task chain", async () => {
      const prd = await createDoc(page, { type: "prd", title: prdTitle });
      prdId = prd.id;

      const spec = await createDoc(page, { type: "spec", title: specTitle, parent_id: prdId });
      specId = spec.id;

      const plan = await createDoc(page, { type: "plan", title: planTitle, parent_id: specId });
      planId = plan.id;

      const task = await createDoc(page, {
        type: "task",
        title: taskTitle,
        parent_id: planId,
        extra: { plan_id: planId },
      });
      taskId = task.id;

      expect([prdId, specId, planId, taskId].every((id) => id.length > 0)).toBe(true);
    });

    test("renders the full 3-ancestor chain on the task detail page and navigates on ancestor click", async () => {
      await page.goto(`/docs/${taskId}`);
      await expect(page.getByRole("heading", { name: taskTitle })).toBeVisible();

      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
      await expect(breadcrumb).toBeVisible();
      await expect(breadcrumb.getByText(prdTitle)).toBeVisible();
      await expect(breadcrumb.getByText(specTitle)).toBeVisible();
      await expect(breadcrumb.getByText(planTitle)).toBeVisible();
      // No overflow ellipsis at exactly 3 ancestors (AC-36-4 boundary).
      await expect(breadcrumb.getByText("…")).not.toBeVisible();
      // Current title renders as plain text (aria-current), not a link.
      await expect(page.locator('[aria-current="page"]', { hasText: taskTitle })).toBeVisible();

      await breadcrumb.getByText(specTitle).click();
      await expect(page).toHaveURL(new RegExp(`/docs/${specId}$`));
      await expect(page.getByRole("heading", { name: specTitle })).toBeVisible();
    });

    test("Home crumb navigates to the resolved living PRD at /", async () => {
      await page.goto(`/docs/${taskId}`);
      await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Home" }).click();
      await expect(page).toHaveURL("http://localhost:5173/");
    });
  });

  // ── 2. Library filter URL-state roundtrip (AC-36-5, AC-36-6) ────────────────

  test.describe("library filters", () => {
    const tagA = `e2ebrowsetagalpha${runId}`;
    const tagB = `e2ebrowsetagbeta${runId}`;
    const bothTitle = `E2E Filter Both Tags ${runId}`;
    const onlyATitle = `E2E Filter Only TagA ${runId}`;

    test("seed: two plan docs, one carrying both tags, one carrying only tagA", async () => {
      await createDoc(page, { type: "plan", title: bothTitle, tags: [tagA, tagB] });
      await createDoc(page, { type: "plan", title: onlyATitle, tags: [tagA] });
    });

    test("selecting type + status filters updates the URL and survives reload", async () => {
      await page.goto("/library");
      await page.getByRole("group", { name: "Filter by type" }).getByText("plan", { exact: true }).click();
      await page.getByRole("group", { name: "Filter by status" }).getByText("draft", { exact: true }).click();

      await expect(page).toHaveURL(/type=plan/);
      await expect(page).toHaveURL(/status=draft/);

      await page.reload();

      await expect(page).toHaveURL(/type=plan/);
      await expect(page).toHaveURL(/status=draft/);
      // Selected chips render with the "default" (filled) variant after reload —
      // asserted via the still-present filtered results rather than a CSS class,
      // to stay resilient to shadcn variant class churn.
      await expect(page.getByText(bothTitle)).toBeVisible();
    });

    test("selecting two tags filters to only docs carrying BOTH (AND semantics, AC-36-6)", async () => {
      await page.goto("/library");
      const tagGroup = page.getByRole("group", { name: "Tags (all of)" });
      await expect(tagGroup).toBeVisible();

      await tagGroup.getByText(tagA, { exact: false }).click();
      await expect(page).toHaveURL(new RegExp(`tags=${tagA}`));
      await expect(page.getByText(bothTitle)).toBeVisible();
      await expect(page.getByText(onlyATitle)).toBeVisible();

      await tagGroup.getByText(tagB, { exact: false }).click();
      await expect(page).toHaveURL(new RegExp(`tags=${tagA}%2C${tagB}|tags=${tagA},${tagB}`));

      // AND semantics: only the doc carrying BOTH tags remains.
      await expect(page.getByText(bothTitle)).toBeVisible();
      await expect(page.getByText(onlyATitle)).not.toBeVisible();

      // Reload: both selected tag chips + the AND-filtered result survive.
      await page.reload();
      await expect(page.getByText(bothTitle)).toBeVisible();
      await expect(page.getByText(onlyATitle)).not.toBeVisible();
    });
  });
});
