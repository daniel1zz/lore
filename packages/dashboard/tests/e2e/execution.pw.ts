/**
 * SPEC-077 dashboard execution read surface e2e coverage (AC-077-5).
 *
 * Covers the new `/execution` page end to end: the nav entry reaches the route,
 * a seeded plan renders all four SPEC-077 S2 panels (ready tasks w/ claim badge,
 * sessions, anchor conflicts, phase progress), and clicking a ready-task row
 * drills into the doc detail page with the SPEC-075 Evidence tab reachable —
 * this IS the F3 "evidence timelines" surface, by navigation linkage, never a
 * duplicated timeline component (SPEC-077 §Scope S2).
 *
 * Fixture seeding: `seed-execution-fixture.ts` (this directory) creates the
 * whole fixture — a plan promoted to `active`, two tasks sharing one declared
 * file anchor (one holds a FRESH claim, producing the ready-task claim badge
 * AND the one derived session; the other's un-claimed but overlapping anchor
 * produces the one anchor-conflict advisory), and a `phase`-typed doc — via a
 * single `bun` subprocess calling `CorpusService`/`TaskWorkflowService`
 * directly (see that file's header comment for why: a plan reaching `active`,
 * a `phase` doc, and a fresh claim are each unreachable through the CLI/
 * dashboard-UI surfaces alone). This is the same "separate bun process against
 * the shared throwaway corpus's SQLite file" pattern `seed-judgment.ts`
 * established for `review-loop.pw.ts`.
 *
 * Auth: no manual cookie minting — `global-setup.ts` boots Vite with
 * `VITE_LORE_BOOTSTRAP_TOKEN` set, so the first full page load triggers the
 * real `bootstrapAuthIfNeeded()` SPA path (SPEC-016 §3.8).
 *
 * Source: SPEC-077 §Scope S1/S2/S3/S4; AC-077-5.
 * @spec_ref spec-077-dashboard-execution-read-surface-prd-21-f3 AC-077-5
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT = join(__dirname, "seed-execution-fixture.ts");

interface SeededFixture {
  planId: string;
  planSlug: string;
  planTitle: string;
  taskAId: string;
  taskATitle: string;
  taskBId: string;
  taskBTitle: string;
  phaseId: string;
  phaseTitle: string;
  actorA: string;
}

/** Runs `seed-execution-fixture.ts` in a separate `bun` process; returns the parsed fixture. */
function seedExecutionFixture(runId: string): SeededFixture {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error(
      "LORE_E2E_DB_PATH is not set — global-setup.ts must run before this suite (see its comment).",
    );
  }
  const out = execFileSync("bun", [SEED_SCRIPT, dbPath, runId], {
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
  const lastLine = out.trim().split("\n").pop();
  if (lastLine === undefined || lastLine.length === 0) {
    throw new Error(`seed-execution-fixture.ts produced no output. stdout: ${out}`);
  }
  return JSON.parse(lastLine) as SeededFixture;
}

test.describe.configure({ mode: "serial" });

test.describe("SPEC-077 dashboard execution read surface", () => {
  let page: Page;
  let fixture: SeededFixture;
  const runId = String(Date.now());

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Trigger the real cookie-bootstrap path once up front (same convention as
    // review-loop.pw.ts / adjudication.pw.ts).
    await page.goto("/");
    fixture = seedExecutionFixture(runId);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("nav entry reaches /execution; seeded plan renders ready task + claim badge, session, anchor conflict, and phase scorecard", async () => {
    // AC-077-5: "via the nav entry reach /execution".
    await page.goto("/");
    await page.getByRole("link", { name: "Execution" }).click();
    await expect(page).toHaveURL(/\/execution$/);

    // Select the seeded plan (ExecutionPage's <select aria-label="Plan">,
    // labeled via <label htmlFor="execution-plan-select">).
    await page.getByLabel("Plan").selectOption({ label: fixture.planTitle });
    await expect(page).toHaveURL(new RegExp(`plan=${fixture.planId}`));

    // ── Ready tasks + claim badge ──────────────────────────────────────────
    const readyList = page.locator('[aria-label="Ready tasks"]');
    await expect(readyList).toBeVisible();
    const taskARow = readyList.locator('[role="button"]', { hasText: fixture.taskATitle });
    await expect(taskARow).toBeVisible();
    // Claim badge: holder actor name (never assert the exact remaining-minute
    // figure — time-dependent, per the task's own guidance).
    await expect(taskARow.getByText(fixture.actorA, { exact: true })).toBeVisible();
    await expect(taskARow.getByText(/m left/)).toBeVisible();

    // ── Sessions ────────────────────────────────────────────────────────────
    const sessionsPanel = page.locator('[aria-label="Sessions"]');
    await expect(sessionsPanel).toBeVisible();
    await expect(sessionsPanel.getByText(fixture.actorA, { exact: true })).toBeVisible();
    await expect(sessionsPanel.getByText("1 held", { exact: true })).toBeVisible();

    // ── Anchor conflicts ────────────────────────────────────────────────────
    // AnchorConflictsPanel renders the declaring task's slug conflicting with
    // the foreign claim holder plus the overlapping path (`AnchorConflict`,
    // `packages/lore/src/service/task-workflow-service.ts`) — asserting on the
    // holder actor name + the fixture's known overlapping path is sufficient
    // and avoids re-deriving task B's slug (not returned by the seed fixture).
    const anchorPanel = page.locator('[aria-label="Anchor conflicts"]');
    await expect(anchorPanel).toBeVisible();
    await expect(anchorPanel.getByText(fixture.actorA, { exact: true })).toBeVisible();
    await expect(anchorPanel.getByText(`src/e2e-fixture-${runId}.ts`, { exact: false })).toBeVisible();

    // ── Phase progress ──────────────────────────────────────────────────────
    const phasePanel = page.locator('[aria-label="Phase progress"]');
    await expect(phasePanel).toBeVisible();
    await expect(phasePanel.getByText(fixture.phaseTitle, { exact: true })).toBeVisible();
    // Exactly one scorecard for this single-phase fixture plan.
    const phaseCards = phasePanel.locator("> div");
    await expect(phaseCards).toHaveCount(1);
  });

  test("clicking a ready-task row navigates to doc detail with the Evidence tab visible", async () => {
    await page.goto(`/execution?plan=${fixture.planId}`);
    const readyList = page.locator('[aria-label="Ready tasks"]');
    const taskARow = readyList.locator('[role="button"]', { hasText: fixture.taskATitle });
    await taskARow.click();

    await expect(page).toHaveURL(new RegExp(`/docs/${fixture.taskAId}$`));
    await page.getByRole("button", { name: "evidence" }).click();
    await expect(page.locator('section[aria-label="Evidence"]')).toBeVisible();
  });
});
