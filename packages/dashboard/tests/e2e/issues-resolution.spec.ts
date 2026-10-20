/**
 * AC-ICL-9 (spec-issue-closure-loop-computed-resolution-agent-reachable, D7/D8) —
 * the dashboard Issues page renders each report's COMPUTED resolution (open/resolving/fixed), and the nav badge
 * counts computed-`"open"` reports rather than raw `draft` docs.
 *
 * Runs against the SAME throwaway corpus + real HTTP/Vite servers `global-setup.ts` boots for the rest of this
 * Playwright suite (fixed ports 8787/5173, serialized by `workers: 1`). Run standalone with
 * `bunx playwright test tests/e2e/issues-resolution.spec.ts` against a FRESH throwaway corpus; every assertion
 * reasons about counts relative to ONLY the reports this file creates (unique `runId` titles).
 *
 * Fixture recipe (three ingredients per scenario):
 *   1. A genuine issue task, filed through the CURRENT report channel: the REAL `dist/lore report-issue` posting to
 *      the project's offline recording `gh` stub (`github-report-fixture.ts`; the stub dir is the whole PATH of the
 *      spawn). The retired SQLite `feedback.upstream.{corpus_path,root_prd}` shape is refused by `report-issue`
 *      with exit 4 and is no longer used.
 *   2. A "fixing" doc: a planless `--adhoc` task walked through `draft -> approved[-> active -> archived]`.
 *   3. A `resolves` link from the fixing doc to the issue task, via the cookie-gated dashboard write route
 *      `POST /api/dashboard/docs/:id/links` (the same path the dashboard's own `LinksPanel` uses).
 *
 * Test plan (six-dimension coverage), unchanged in intent:
 *   HAPPY — a report with no `resolves` in-edge renders `resolution: "open"` and IS counted by the nav badge.
 *   STATE — a `resolves` in-edge from a non-terminal (approved) fixing doc renders `"resolving"`.
 *   STATE — a `resolves` in-edge from a terminal (archived) fixing doc renders `"fixed"` while the issue task's OWN
 *     status stays `draft`.
 *   NEGATIVE — the nav badge / "N open" count EXCLUDES the resolving/fixed rows even though both still appear.
 *   BOUNDARY — the detail view renders the SAME computed resolution, distinct from its raw `status` badge.
 *   REGRESSION — newest-first row order and the `issue-report-row` / `issue-report-title` testids are unchanged.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable D7, D8, AC-ICL-9.
 * @spec_ref AC-ICL-9
 */

import { test, expect, type Page } from "@playwright/test";
import {
  buildDistLore,
  runLore,
  runLoreJson,
  startGithubReportFixture,
  type FiledGithubReport,
  type GithubReportFixture,
} from "./github-report-fixture.js";

/**
 * Creates a planless `--adhoc` "fixing" doc and walks it through `draft -> approved[-> active -> archived]`.
 * `finalStatus: "approved"` stops before `active` (the "resolving" case: an in-edge exists, no source doc is
 * terminal yet); `"archived"` reaches a terminal status (the "fixed" case).
 */
function createFixingDoc(corpusRoot: string, title: string, finalStatus: "approved" | "archived"): string {
  const created = runLoreJson<{ ok: true; data: { id: string } }>(
    ["create", "task", "--title", title, "--content", "fixes the defect", "--adhoc"],
    corpusRoot,
  );
  const fixId = created.data.id;

  const approveResult = runLore(["approve", fixId], corpusRoot);
  if (approveResult.status !== 0) {
    throw new Error(`Failed to approve fixing doc ${fixId}: ${approveResult.stderr}`);
  }

  if (finalStatus === "archived") {
    const activeResult = runLore(["set", fixId, "--status", "active"], corpusRoot);
    if (activeResult.status !== 0) {
      throw new Error(`Failed to activate fixing doc ${fixId}: ${activeResult.stderr}`);
    }
    const archivedResult = runLore(["set", fixId, "--status", "archived"], corpusRoot);
    if (archivedResult.status !== 0) {
      throw new Error(`Failed to archive fixing doc ${fixId}: ${archivedResult.stderr}`);
    }
  }

  return fixId;
}

/**
 * Creates the `resolves` edge via the cookie-gated dashboard write route. `page.request` shares the SAME `lore_sid`
 * cookie jar the page's own bootstrap navigation already minted.
 */
async function createResolvesLink(page: Page, fixId: string, issueId: string): Promise<void> {
  const res = await page.request.post(`/api/dashboard/docs/${encodeURIComponent(fixId)}/links`, {
    data: { to: issueId, type: "resolves" },
  });
  if (!res.ok()) {
    throw new Error(`Failed to create resolves link ${fixId} -> ${issueId}: ${res.status()} ${await res.text()}`);
  }
}

test.describe("AC-ICL-9 dashboard Issues page renders computed resolution", () => {
  const runId = Date.now();
  let sharedPage: Page;
  let fixture: GithubReportFixture;

  const titleOpen = `E2E ICL9 Open ${runId}`;
  const titleResolving = `E2E ICL9 Resolving ${runId}`;
  const titleFixed = `E2E ICL9 Fixed ${runId}`;
  let open: FiledGithubReport | undefined;
  let resolving: FiledGithubReport | undefined;
  let fixed: FiledGithubReport | undefined;

  test.beforeAll(() => {
    // Build dist/lore fresh (stale-binary false-oracle vector: root CLAUDE.md).
    buildDistLore();
    fixture = startGithubReportFixture("icl9");
  });

  test.beforeAll(async ({ browser }) => {
    // A full page load runs bootstrapAuthIfNeeded() and mints the lore_sid cookie every later navigation/request
    // this page(.request) makes reuses.
    sharedPage = await browser.newPage();
    await sharedPage.goto("/issues");
    await expect(sharedPage.getByRole("heading", { name: "Issues" })).toBeVisible();
  });

  test.afterAll(async () => {
    // Restore the shared "0 open" baseline for whichever suite runs next (same discipline as issues.spec.ts).
    for (const report of [open, resolving, fixed]) {
      if (report !== undefined) fixture.cleanupApprove(report.docId);
    }
    await sharedPage.close();
    fixture.stop();
  });

  function file(title: string, actor: string): FiledGithubReport {
    return fixture.fileReport({
      title,
      description: "full description of defect for AC-ICL-9 e2e",
      expected: "exit 0",
      actual: "exit 4 unexpectedly",
      actor,
    });
  }

  test("AC-ICL-9: Issues list renders each row's computed resolution and the nav badge counts computed-open reports only", async () => {
    // ── Ingredient 1: three genuine issue reports ──────────────────────────
    open = file(titleOpen, "agent:e2e-icl9-open");
    resolving = file(titleResolving, "agent:e2e-icl9-resolving");
    fixed = file(titleFixed, "agent:e2e-icl9-fixed");
    expect(new Set([open.docId, resolving.docId, fixed.docId]).size).toBe(3);

    // ── Ingredients 2+3: fixing docs + resolves edges ──────────────────────
    const resolvingFixId = createFixingDoc(fixture.corpusRoot, `Fixing doc (resolving) ${runId}`, "approved");
    await createResolvesLink(sharedPage, resolvingFixId, resolving.docId);

    const fixedFixId = createFixingDoc(fixture.corpusRoot, `Fixing doc (fixed) ${runId}`, "archived");
    await createResolvesLink(sharedPage, fixedFixId, fixed.docId);

    // ── HAPPY / STATE: each row renders its own computed resolution ───────
    await sharedPage.goto("/issues");

    const openRow = sharedPage.getByTestId("issue-report-row").filter({ hasText: titleOpen });
    const resolvingRow = sharedPage.getByTestId("issue-report-row").filter({ hasText: titleResolving });
    const fixedRow = sharedPage.getByTestId("issue-report-row").filter({ hasText: titleFixed });

    await expect(openRow).toHaveCount(1);
    await expect(resolvingRow).toHaveCount(1);
    await expect(fixedRow).toHaveCount(1);

    await expect(openRow.getByTestId("issue-report-resolution")).toHaveText("open");
    await expect(resolvingRow.getByTestId("issue-report-resolution")).toHaveText("resolving");
    await expect(fixedRow.getByTestId("issue-report-resolution")).toHaveText("fixed");

    // ── NEGATIVE: the nav badge / header count EXCLUDES resolving+fixed ───
    // Exactly ONE of our three fixtures ("open") is counted; the other two are STILL VISIBLE (asserted above).
    // reason: scoped to a fresh standalone corpus (this file's own oracle command boots its own globalSetup), so
    // the badge total is exactly the 1 open report this test filed, not a corpus-wide assumption.
    await expect(sharedPage.getByRole("link", { name: "Issues 1" })).toBeVisible();
    await expect(sharedPage.getByText("1 open", { exact: true })).toBeVisible();

    // ── REGRESSION: pre-existing row/title testids still work as before ──
    const titles = sharedPage.getByTestId("issue-report-title");
    await expect(titles).toHaveCount(3);

    // ── BOUNDARY: detail view renders the SAME resolution, distinct from the raw status badge (still "draft") ─
    await sharedPage.goto(`/issues/${fixed.docId}`);
    await expect(sharedPage.getByRole("heading", { name: titleFixed })).toBeVisible();
    await expect(sharedPage.getByTestId("issue-report-resolution")).toHaveText("fixed");
    await expect(sharedPage.getByText("draft", { exact: true })).toBeVisible();
  });
});
