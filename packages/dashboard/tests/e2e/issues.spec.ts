/**
 * SPEC-074 dashboard Issues triage e2e coverage (AC-074-1..4).
 *
 * Runs against the SAME throwaway corpus + real HTTP/Vite servers `global-setup.ts` boots for the rest of this
 * Playwright suite (fixed ports 8787/5173). The file is also its OWN standalone unit —
 * `bunx playwright test tests/e2e/issues.spec.ts [-g 'AC-074-N']` runs it (or one AC's block) alone against a FRESH
 * throwaway corpus — so every AC's `describe` block is SELF-CONTAINED: it files its own report(s), asserts, then
 * cleans up (approves everything it created) so a whole-file run leaves the SAME "0 open reports" baseline behind.
 *
 * Reports are filed through the CURRENT report channel: the REAL compiled `dist/lore report-issue` posts to GitHub
 * (the project's offline recording `gh` stub, `packages/lore/tests/integration/helpers/recording-gh-stub.ts`, is the
 * whole PATH of the spawn, so a real `gh` is unreachable) and the filing corpus gets the issue task
 * `task-gh-<repo_id>-<number>` the dashboard projection reads. See `github-report-fixture.ts`. The retired SQLite
 * `feedback.upstream.{corpus_path,root_prd}` shape is gone: `report-issue` refuses it with exit 4.
 *
 * Intent kept per AC (what the Issues page shows/does), with these channel-driven changes:
 *   - There is no consumer/upstream corpus pair any more: the corpus that files is the corpus the dashboard reads.
 *   - AC-074-1's row fields reporter_project / reported_at are NOT asserted: a GitHub-filed issue task carries
 *     neither (the row shows "unknown project" / "unknown time"). Reported for supersession, not blessed here.
 *   - AC-074-3's reason echo no longer goes through `report-issue --list` (that verb now lists GitHub, whose
 *     rejection state is not the corpus review audit). The recorded reason is read from the audit trail of the
 *     report's task (`lore audit <doc> --action reject`), which is what the dashboard reject writes.
 *
 * AC-074-1: 2 seeded reports -> nav badge shows 2, Issues page lists 2 rows (title/reporter_project/reported_at),
 *   newest first.
 * AC-074-2: approving one report from its detail view drops the badge to 1, the approved report appears in
 *   `lore ready --adhoc`, the other is untouched (still absent: review-gated).
 * AC-074-3: rejecting requires a non-empty reason (submit disabled when empty), the reason is recorded, and the
 *   badge drops to 0.
 * AC-074-4: home card shows the open count + up to 3 recent titles when reports are open, and an explicit empty
 *   state (badge hidden) at 0.
 *
 * Auth: no manual cookie minting; `global-setup.ts` boots Vite with `VITE_LORE_BOOTSTRAP_TOKEN` set, so the real
 * `bootstrapAuthIfNeeded()` SPA path (SPEC-016 3.8) runs on first page load.
 *
 * Source: SPEC-074 Scope, Design, Acceptance Criteria AC-074-1..4.
 * @spec_ref AC-074-1, AC-074-2, AC-074-3, AC-074-4
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

test.describe("SPEC-074 dashboard Issues triage", () => {
  const runId = Date.now();
  let sharedPage: Page;
  let fixture: GithubReportFixture;

  test.beforeAll(() => {
    // Build dist/lore fresh (stale-binary false-oracle vector: root CLAUDE.md "Four false-oracle vectors").
    buildDistLore();
    fixture = startGithubReportFixture("issues");
  });

  test.beforeAll(async ({ browser }) => {
    // A full page load runs bootstrapAuthIfNeeded() and mints the lore_sid cookie every later navigation reuses.
    sharedPage = await browser.newPage();
    await sharedPage.goto("/issues");
    await expect(sharedPage.getByRole("heading", { name: "Issues" })).toBeVisible();
  });

  test.afterAll(async () => {
    await sharedPage.close();
    fixture.stop();
  });

  function file(title: string, actor: string, actual = "exit 4"): FiledGithubReport {
    return fixture.fileReport({
      title,
      description: `full description of ${title}`,
      expected: "exit 0",
      actual,
      actor,
    });
  }

  // ── AC-074-1: nav badge + Issues page list, newest first ────────────────

  test.describe("AC-074-1", () => {
    const titleAlpha = `E2E Issue A1 Alpha ${runId}`;
    const titleBeta = `E2E Issue A1 Beta ${runId}`;
    let alpha: FiledGithubReport | undefined;
    let beta: FiledGithubReport | undefined;

    test.afterAll(() => {
      if (alpha !== undefined) fixture.cleanupApprove(alpha.docId);
      if (beta !== undefined) fixture.cleanupApprove(beta.docId);
    });

    test("AC-074-1: nav badge shows 2 and the Issues page lists 2 rows (title/reporter_project/reported_at), newest first", async () => {
      alpha = file(titleAlpha, "agent:e2e-ac1-alpha", "exit 4 with a confusing message");
      beta = file(titleBeta, "agent:e2e-ac1-beta", "exit 1 unexpectedly");
      expect(alpha.docId).not.toBe(beta.docId);

      await sharedPage.goto("/issues");

      await expect(sharedPage.getByRole("link", { name: "Issues 2" })).toBeVisible();

      const rows = sharedPage.getByTestId("issue-report-row");
      await expect(rows).toHaveCount(2);

      const titles = sharedPage.getByTestId("issue-report-title");
      // Beta was filed after Alpha: newest first means Beta's row precedes Alpha's.
      await expect(titles.nth(0)).toHaveText(titleBeta);
      await expect(titles.nth(1)).toHaveText(titleAlpha);

      // NOT asserted, deliberately: the row's reporter_project / reported_at. The GitHub-filed issue task carries
      // neither (its `extra.issue_report` holds severity/category/tags/reporter_corpus/github, see
      // `service/issue-task-shaping.ts`), so the projection renders "unknown project" / "unknown time" for every
      // row and newest-first has no timestamp to sort on. Asserting those placeholders would bless the gap; the
      // original AC-074-1 wording is reported for supersession instead (see this file's header).
    });
  });

  // ── AC-074-2: approve drops the badge to 1, appears in `ready --adhoc` ──

  test.describe("AC-074-2", () => {
    const titleApprove = `E2E Issue A2 Approve ${runId}`;
    const titleOther = `E2E Issue A2 Other ${runId}`;
    let approve: FiledGithubReport | undefined;
    let other: FiledGithubReport | undefined;

    test.afterAll(() => {
      if (other !== undefined) fixture.cleanupApprove(other.docId);
    });

    test("AC-074-2: approving from the detail view drops the badge to 1 and the report appears in `lore ready --adhoc`", async () => {
      approve = file(titleApprove, "agent:e2e-ac2-approve");
      other = file(titleOther, "agent:e2e-ac2-other");

      await sharedPage.goto(`/issues/${approve.docId}`);
      await expect(sharedPage.getByRole("heading", { name: titleApprove })).toBeVisible();

      await sharedPage.getByRole("button", { name: "Approve" }).click();
      await expect(sharedPage).toHaveURL(/\/issues$/);

      await expect(sharedPage.getByRole("link", { name: "Issues 1" })).toBeVisible();

      const ready = runLoreJson<{
        ok: true;
        data: { adhoc: { records: Array<{ task: { id: string; status: string }; ready: boolean }> } };
      }>(["ready", "--adhoc"], fixture.corpusRoot);

      const approvedRecord = ready.data.adhoc.records.find((r) => r.task.id === approve?.docId);
      expect(approvedRecord).toBeTruthy();
      expect(approvedRecord?.task.status).toBe("approved");
      expect(approvedRecord?.ready).toBe(true);

      // The untouched report stays absent from ready --adhoc (still draft, review-gated).
      const untouchedRecord = ready.data.adhoc.records.find((r) => r.task.id === other?.docId);
      expect(untouchedRecord).toBeUndefined();

      // And the Issues list itself now shows exactly the remaining open report.
      await expect(sharedPage.getByTestId("issue-report-row")).toHaveCount(1);
      await expect(sharedPage.getByTestId("issue-report-title")).toHaveText(titleOther);
    });
  });

  // ── AC-074-3: reject requires a non-empty reason; reason recorded; badge to 0 ──

  test.describe("AC-074-3", () => {
    const titleReject = `E2E Issue A3 Reject ${runId}`;
    const rejectReasonText = `not a lore defect: e2e ${runId}`;
    let reject: FiledGithubReport | undefined;

    test.afterAll(() => {
      if (reject !== undefined) fixture.cleanupApprove(reject.docId);
    });

    test("AC-074-3: reject requires a non-empty reason, records the reason, and drops the badge to 0", async () => {
      reject = file(titleReject, "agent:e2e-ac3-reject");

      await sharedPage.goto(`/issues/${reject.docId}`);
      await expect(sharedPage.getByRole("heading", { name: titleReject })).toBeVisible();

      await sharedPage.getByRole("button", { name: "Reject" }).click();
      const confirmButton = sharedPage.getByRole("button", { name: "Confirm reject" });
      await expect(confirmButton).toBeVisible();
      await expect(confirmButton).toBeDisabled();

      const reasonInput = sharedPage.getByLabel("Rejection reason (required)");
      // Whitespace-only input must NOT enable submit (AC-074-3's "non-empty" bar).
      await reasonInput.fill("   ");
      await expect(confirmButton).toBeDisabled();

      await reasonInput.fill(rejectReasonText);
      await expect(confirmButton).toBeEnabled();
      await confirmButton.click();

      await expect(sharedPage).toHaveURL(/\/issues$/);

      // Reason-echo half: the rejection reason the dashboard wrote is on the report task's audit trail.
      const audit = runLore(["audit", reject.docId, "--action", "reject", "--json"], fixture.corpusRoot);
      expect(audit.status, audit.stderr).toBe(0);
      expect(audit.stdout).toContain(rejectReasonText);

      // Badge half: a rejected report leaves the open set.
      await expect(sharedPage.getByRole("link", { name: "Issues", exact: true })).toBeVisible();
      await expect(sharedPage.getByTestId("issue-report-row")).toHaveCount(0);
    });
  });

  // ── AC-074-4: home card open-count/recent-titles + explicit empty state ──

  test.describe("AC-074-4", () => {
    test.describe("with reports open", () => {
      const titleFirst = `E2E Issue A4 First ${runId}`;
      const titleSecond = `E2E Issue A4 Second ${runId}`;
      let first: FiledGithubReport | undefined;
      let second: FiledGithubReport | undefined;

      test.afterAll(() => {
        if (first !== undefined) fixture.cleanupApprove(first.docId);
        if (second !== undefined) fixture.cleanupApprove(second.docId);
      });

      test("AC-074-4: home card shows the open count and recent titles linking to the Issues page while reports are open", async () => {
        first = file(titleFirst, "agent:e2e-ac4-first");
        second = file(titleSecond, "agent:e2e-ac4-second");

        await sharedPage.goto("/");

        const card = sharedPage.getByRole("region", { name: "Incoming issue reports" });
        await expect(card).toBeVisible();
        await expect(card.getByText("2 open")).toBeVisible();
        await expect(card.getByRole("button", { name: titleFirst })).toBeVisible();
        await expect(card.getByRole("button", { name: titleSecond })).toBeVisible();

        await card.getByRole("link", { name: "See all →" }).click();
        await expect(sharedPage).toHaveURL(/\/issues$/);
      });
    });

    test.describe("with zero reports open", () => {
      test("AC-074-4: home card shows an explicit empty state and the nav badge is hidden at 0 open reports", async () => {
        await sharedPage.goto("/issues");
        // reason: guard this test's own precondition. If an earlier block in a whole-file run failed to clean up,
        // fail loud here rather than silently asserting a false "empty state" against a non-empty corpus.
        await expect(sharedPage.getByTestId("issue-report-row")).toHaveCount(0);

        await sharedPage.goto("/");
        await expect(sharedPage.getByRole("link", { name: "Issues", exact: true })).toBeVisible();
        await expect(sharedPage.getByRole("link", { name: /^Issues \d/ })).toHaveCount(0);

        const card = sharedPage.getByRole("region", { name: "Incoming issue reports" });
        await expect(card).toBeVisible();
        await expect(card.getByText("No open issue reports.")).toBeVisible();
      });
    });
  });
});
