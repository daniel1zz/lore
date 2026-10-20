/**
 * SPEC-074 dashboard Issues triage e2e coverage (AC-074-1..4).
 *
 * Runs against the SAME throwaway corpus + real HTTP/Vite servers
 * `global-setup.ts` boots for the rest of this Playwright suite (fixed ports
 * 8787/5173 — see that file's header for why serialization against those
 * ports is mandatory). This file is additionally its OWN standalone unit —
 * `bunx playwright test tests/e2e/issues.spec.ts [-g 'AC-074-N']` runs it
 * (or one AC's block) alone against a FRESH throwaway corpus (a new
 * `globalSetup` invocation per Playwright process) — so every AC's `describe`
 * block below is deliberately SELF-CONTAINED: it files its own twin-corpus
 * fixture (own consumer mkdtemp, own report(s)), asserts, then cleans up
 * (approves everything it created) so a whole-file run leaves the SAME
 * "0 open reports" baseline behind for the next block, and an individual
 * `-g 'AC-074-N'` filter run needs no other block's setup to have happened.
 *
 * Reports are filed by spawning the REAL compiled `dist/lore report-issue`
 * CLI from a twin CONSUMER mkdtemp corpus, pointing `feedback.upstream` at
 * THIS suite's own throwaway corpus (the "upstream") — replicating the
 * twin-corpus fixture recipe from
 * `packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts`
 * (build `dist/lore` first; never write to the repo's own `.lore/`; every
 * fixture path asserted under `os.tmpdir()`). The dashboard's Issues page
 * reads the upstream corpus (the SAME SQLite file `lore serve` has open) —
 * this is the REAL cross-process path, not hand-inserted rows.
 *
 * ── KNOWN, OUT-OF-ANCHOR-SCOPE BACKEND GAP (AC-074-3) ──
 * `ReviewService.reject` (packages/lore/src/service/review-service.ts) never
 * transitions a doc OFF `draft`/`in-review` — by design (SPEC-005; the audit
 * trail, not `doc.status`, is the sole record of "rejected" — the SAME
 * invariant `issue-report-cross-corpus.bun.test.ts`'s AC-072-10 already pins:
 * "ReviewService.reject never transitions a doc OFF draft"). The SPEC-074
 * HTTP projection's `isOpenIssueReportTask`
 * (packages/lore/src/adapters/http/issue-reports-routes.ts) filters purely
 * on `status ∈ {draft, in-review}` — so a REJECTED report can never leave
 * the "open" set the nav badge/list/home-card all read, even though that
 * same module's own doc comment claims "once a reviewer approves OR REJECTS
 * a report it leaves this open set entirely." This is a genuine doc/code
 * drift in ALREADY-MERGED T1 code, not a frontend defect — this task's
 * write-scope is `packages/dashboard/` only (zero edits under
 * `packages/lore/`), so the fix (teaching `isOpenIssueReportTask` to also
 * consult the audit trail for a prior "reject" action on the doc, mirroring
 * how `report-issue --list`'s `UpstreamPort.getDocStatus` already derives
 * `resolution_reason` from that SAME audit trail rather than from
 * `doc.status`) is reported here, not applied. The AC-074-3 test below
 * asserts the LITERAL SPEC-074 wording ("drops the badge to 0") and will
 * currently, honestly FAIL on that specific expectation — the reason-echo
 * half of AC-074-3 (which does NOT depend on the buggy exclusion) is
 * asserted FIRST and passes independently, isolating the failure to exactly
 * the gap described above. `test.afterAll` in that block force-cleans its
 * fixture via a direct CLI `approve` (not through the buggy reject-exclusion
 * path) so this known failure doesn't leak a permanently-open report into
 * whichever block runs next in a whole-file invocation.
 *
 * AC-074-1: 2 seeded reports -> nav badge shows 2, Issues page lists 2 rows
 *   (title/reporter_project/reported_at), newest first.
 * AC-074-2: approving one report from its detail view drops the badge to 1,
 *   the approved report appears in `lore ready --adhoc`, the other is
 *   untouched (still absent — review-gated per SPEC-072).
 * AC-074-3: rejecting requires a non-empty reason (submit disabled when
 *   empty) and the reason is echoed by the consumer's `report-issue --list`;
 *   "drops the badge to 0" currently fails — see the header note above.
 * AC-074-4: home card shows the open count + up to 3 recent titles when
 *   reports are open, and an explicit empty state (badge hidden) at 0.
 *
 * Auth: no manual cookie minting — `global-setup.ts` boots Vite with
 * `VITE_LORE_BOOTSTRAP_TOKEN` set, so the real `bootstrapAuthIfNeeded()` SPA
 * path (SPEC-016 §3.8) runs on first page load.
 *
 * Source: SPEC-074 §Scope, §Design, Acceptance Criteria AC-074-1..4.
 * @spec_ref AC-074-1, AC-074-2, AC-074-3, AC-074-4
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { patchLoreConfig } from "../../../lore/tests/helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { e2eStateHome, knownPartyEnv, startHumanSession } from "./known-party.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e -> tests -> dashboard -> packages -> <repo root>
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const DIST_LORE = join(REPO_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Every fixture path used by this suite MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Synchronous `dist/lore <args>` spawn as a KNOWN PARTY (BR-1351): the e2e human session of the checkout, with the
 * agent harness marker (CLAUDECODE) STRIPPED from the child env — a process that carries it is treated as an agent,
 * and an agent never writes under a person's session.
 */
function runLore(args: string[], cwd: string, env: Record<string, string> = {}): CliResult {
  assertUnderTmp(cwd);
  try {
    const stdout = execFileSync(DIST_LORE, args, {
      cwd,
      env: knownPartyEnv(e2eStateHome(), env),
    }).toString();
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const failure = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: failure.stdout?.toString() ?? "",
      stderr: failure.stderr?.toString() ?? "",
      status: failure.status ?? 1,
    };
  }
}

/** `runLore` + `--json`, parsed. Throws with full stdio context on a non-JSON response. */
function runLoreJson<T>(args: string[], cwd: string, env?: Record<string, string>): T {
  const result = runLore([...args, "--json"], cwd, env);
  try {
    return JSON.parse(result.stdout) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from 'lore ${args.join(" ")}' (exit ${result.status}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

/** Appends a `feedback.upstream` stanza onto a consumer's config.yaml (mirrors the cross-corpus bun test fixture). */
function configureFeedbackUpstream(consumerRoot: string, upstreamRoot: string, rootPrdIdentity: string): void {
  assertUnderTmp(consumerRoot);
  patchLoreConfig(
    consumerRoot,
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${rootPrdIdentity}`, ""].join("\n"),
  );
}

/**
 * Discover (or, on a fresh/standalone corpus, create) the upstream's root
 * PRD — `IssueReportService`'s `resolveRootDoc()` picks `findMany({type:
 * "prd"})[0]`, so this mirrors that exact selection: reuse whatever PRD
 * already exists (e.g. seeded by an earlier spec file in a full-suite run)
 * rather than assuming this suite owns "the" root PRD.
 */
function ensureUpstreamRootPrd(upstreamRoot: string): { id: string; slug: string } {
  const listing = runLoreJson<{ ok: true; data: { docs: Array<{ id: string; slug: string }> } }>(
    ["list", "--type", "prd"],
    upstreamRoot,
  );
  const existing = listing.data.docs[0];
  if (existing !== undefined) return existing;

  const created = runLoreJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", "E2E Issues Upstream Root PRD", "--content", "seed root prd for SPEC-074 issues e2e"],
    upstreamRoot,
  );
  return created.data;
}

/** Fresh mkdtemp consumer corpus, `lore init`'d, `feedback.upstream` pointed at `upstreamRoot`. */
function makeConsumer(prefix: string, upstreamRoot: string, rootPrdSlug: string): string {
  const consumerRoot = mkdtempSync(join(TMP_ROOT, `lore-e2e-issues-${prefix}-`));
  assertUnderTmp(consumerRoot);
  const initResult = runLore(["init"], consumerRoot);
  if (initResult.status !== 0) {
    throw new Error(`consumer 'lore init' failed for ${prefix}: ${initResult.stderr}`);
  }
  // the consumer's `report-issue` writes as the human session of this checkout too
  startHumanSession([DIST_LORE], consumerRoot, e2eStateHome());
  configureFeedbackUpstream(consumerRoot, upstreamRoot, rootPrdSlug);
  return consumerRoot;
}

interface FiledReport {
  upstream_doc_id: string;
  possible_duplicates: string[];
}

function fileReport(
  consumerRoot: string,
  opts: { title: string; description: string; expected: string; actual: string; actor: string },
): FiledReport {
  const parsed = runLoreJson<{ ok: true; data: FiledReport }>(
    [
      "report-issue",
      "--title",
      opts.title,
      "--description",
      opts.description,
      "--expected",
      opts.expected,
      "--actual",
      opts.actual,
    ],
    consumerRoot,
    { LORE_ACTOR: opts.actor },
  );
  return parsed.data;
}

/** Best-effort CLI cleanup — approves a report so it leaves the "open" set, restoring the shared baseline. */
function cleanupApprove(upstreamRoot: string, docId: string): void {
  try {
    runLore(["approve", docId], upstreamRoot);
  } catch {
    // best-effort — a test's own assertions already reported anything meaningfully wrong
  }
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort cleanup — never fail the run over a leftover tmp dir
  }
}

test.describe("SPEC-074 dashboard Issues triage", () => {
  const runId = Date.now();
  let sharedPage: Page;
  let upstreamRoot: string;
  let rootPrdSlug: string;

  test.beforeAll(() => {
    // Build dist/lore fresh (stale-binary false-oracle vector — root
    // CLAUDE.md "Four false-oracle vectors").
    execFileSync("bun", ["run", "build"], { cwd: REPO_ROOT });
    if (!existsSync(DIST_LORE)) {
      throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
    }

    // Resolve THIS suite's own throwaway corpus (global-setup.ts publishes
    // its db path; the corpus root is two levels up: <root>/.lore/lore.db).
    const dbPath = process.env.LORE_E2E_DB_PATH;
    if (dbPath === undefined) {
      throw new Error("LORE_E2E_DB_PATH is not set — expected global-setup.ts to publish it");
    }
    upstreamRoot = dirname(dirname(dbPath));
    assertUnderTmp(upstreamRoot);

    const rootPrd = ensureUpstreamRootPrd(upstreamRoot);
    rootPrdSlug = rootPrd.slug;
  });

  test.beforeAll(async ({ browser }) => {
    // A full page load runs bootstrapAuthIfNeeded() and mints the lore_sid
    // cookie every subsequent navigation in this page reuses.
    sharedPage = await browser.newPage();
    await sharedPage.goto("/issues");
    await expect(sharedPage.getByRole("heading", { name: "Issues" })).toBeVisible();
  });

  test.afterAll(async () => {
    await sharedPage.close();
  });

  // ── AC-074-1: nav badge + Issues page list, newest first ────────────────

  test.describe("AC-074-1", () => {
    const titleAlpha = `E2E Issue A1 Alpha ${runId}`;
    const titleBeta = `E2E Issue A1 Beta ${runId}`;
    let consumerRoot: string;
    let alphaId: string;
    let betaId: string;

    test.afterAll(() => {
      cleanupApprove(upstreamRoot, alphaId);
      cleanupApprove(upstreamRoot, betaId);
      removeQuietly(consumerRoot);
    });

    test("AC-074-1: nav badge shows 2 and the Issues page lists 2 rows (title/reporter_project/reported_at), newest first", async () => {
      consumerRoot = makeConsumer("ac1", upstreamRoot, rootPrdSlug);
      const alpha = fileReport(consumerRoot, {
        title: titleAlpha,
        description: "full description of defect alpha",
        expected: "exit 0",
        actual: "exit 4 with a confusing message",
        actor: "agent:e2e-ac1-alpha",
      });
      alphaId = alpha.upstream_doc_id;
      const beta = fileReport(consumerRoot, {
        title: titleBeta,
        description: "full description of defect beta",
        expected: "exit 0",
        actual: "exit 1 unexpectedly",
        actor: "agent:e2e-ac1-beta",
      });
      betaId = beta.upstream_doc_id;
      expect(alphaId).not.toBe(betaId);

      await sharedPage.goto("/issues");

      await expect(sharedPage.getByRole("link", { name: "Issues 2" })).toBeVisible();

      const rows = sharedPage.getByTestId("issue-report-row");
      await expect(rows).toHaveCount(2);

      const titles = sharedPage.getByTestId("issue-report-title");
      // Beta was filed after Alpha — newest first means Beta's row precedes Alpha's.
      await expect(titles.nth(0)).toHaveText(titleBeta);
      await expect(titles.nth(1)).toHaveText(titleAlpha);

      const consumerBasename = basename(consumerRoot);
      await expect(rows.nth(0)).toContainText(consumerBasename);
      await expect(rows.nth(1)).toContainText(consumerBasename);
    });
  });

  // ── AC-074-2: approve drops the badge to 1, appears in `ready --adhoc` ──

  test.describe("AC-074-2", () => {
    const titleApprove = `E2E Issue A2 Approve ${runId}`;
    const titleOther = `E2E Issue A2 Other ${runId}`;
    let consumerRoot: string;
    let approveId: string;
    let otherId: string;

    test.afterAll(() => {
      cleanupApprove(upstreamRoot, otherId);
      removeQuietly(consumerRoot);
    });

    test("AC-074-2: approving from the detail view drops the badge to 1 and the report appears in `lore ready --adhoc`", async () => {
      consumerRoot = makeConsumer("ac2", upstreamRoot, rootPrdSlug);
      approveId = fileReport(consumerRoot, {
        title: titleApprove,
        description: "report to be approved",
        expected: "exit 0",
        actual: "exit 4",
        actor: "agent:e2e-ac2-approve",
      }).upstream_doc_id;
      otherId = fileReport(consumerRoot, {
        title: titleOther,
        description: "report that stays untouched",
        expected: "exit 0",
        actual: "exit 4",
        actor: "agent:e2e-ac2-other",
      }).upstream_doc_id;

      await sharedPage.goto(`/issues/${approveId}`);
      await expect(sharedPage.getByRole("heading", { name: titleApprove })).toBeVisible();

      await sharedPage.getByRole("button", { name: "Approve" }).click();
      await expect(sharedPage).toHaveURL(/\/issues$/);

      await expect(sharedPage.getByRole("link", { name: "Issues 1" })).toBeVisible();

      const ready = runLoreJson<{
        ok: true;
        data: { adhoc: { records: Array<{ task: { id: string; status: string }; ready: boolean }> } };
      }>(["ready", "--adhoc"], upstreamRoot);

      const approvedRecord = ready.data.adhoc.records.find((r) => r.task.id === approveId);
      expect(approvedRecord).toBeTruthy();
      expect(approvedRecord?.task.status).toBe("approved");
      expect(approvedRecord?.ready).toBe(true);

      // The untouched report stays absent from ready --adhoc (still draft, review-gated).
      const untouchedRecord = ready.data.adhoc.records.find((r) => r.task.id === otherId);
      expect(untouchedRecord).toBeUndefined();

      // And the Issues list itself now shows exactly the remaining open report.
      await expect(sharedPage.getByTestId("issue-report-row")).toHaveCount(1);
      await expect(sharedPage.getByTestId("issue-report-title")).toHaveText(titleOther);
    });
  });

  // ── AC-074-3: reject requires a non-empty reason; reason echoed; badge-to-0 (KNOWN GAP) ──

  test.describe("AC-074-3", () => {
    const titleReject = `E2E Issue A3 Reject ${runId}`;
    let consumerRoot: string;
    let rejectId: string;
    const rejectReasonText = `not a lore defect — e2e ${runId}`;

    test.afterAll(() => {
      // Force-clean via a direct CLI approve — NOT through the buggy
      // reject-exclusion path — so this known-failing block doesn't leak a
      // permanently-open report into whichever block runs next.
      cleanupApprove(upstreamRoot, rejectId);
      removeQuietly(consumerRoot);
    });

    test("AC-074-3: reject requires a non-empty reason, echoes the reason via `report-issue --list`, and drops the badge to 0", async () => {
      consumerRoot = makeConsumer("ac3", upstreamRoot, rootPrdSlug);
      rejectId = fileReport(consumerRoot, {
        title: titleReject,
        description: "report to be rejected",
        expected: "exit 0",
        actual: "exit 4",
        actor: "agent:e2e-ac3-reject",
      }).upstream_doc_id;

      await sharedPage.goto(`/issues/${rejectId}`);
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

      // Reason-echo half of AC-074-3 — asserted FIRST, independent of the
      // badge-exclusion gap below (see this file's header note).
      const listAfterReject = runLoreJson<{
        ok: true;
        data: { rows: Array<{ upstream_doc_id: string; status: string; resolution_reason?: string }> };
      }>(["report-issue", "--list"], consumerRoot);
      const rejectedRow = listAfterReject.data.rows.find((r) => r.upstream_doc_id === rejectId);
      expect(rejectedRow).toBeTruthy();
      expect(rejectedRow?.resolution_reason).toBe(rejectReasonText);

      // KNOWN GAP (see this file's header note): `isOpenIssueReportTask`
      // (packages/lore/src/adapters/http/issue-reports-routes.ts) filters
      // purely on doc.status, which `ReviewService.reject` never changes —
      // so a rejected report never actually leaves the "open" projection.
      // This assertion is the literal SPEC-074 AC-074-3 requirement and is
      // EXPECTED to fail until that backend gap is fixed (out of this task's
      // packages/dashboard/-only write scope).
      await expect(sharedPage.getByRole("link", { name: "Issues", exact: true })).toBeVisible();
      await expect(sharedPage.getByTestId("issue-report-row")).toHaveCount(0);
    });
  });

  // ── AC-074-4: home card open-count/recent-titles + explicit empty state ──

  test.describe("AC-074-4", () => {
    test.describe("with reports open", () => {
      const titleFirst = `E2E Issue A4 First ${runId}`;
      const titleSecond = `E2E Issue A4 Second ${runId}`;
      let consumerRoot: string;
      let firstId: string;
      let secondId: string;

      test.afterAll(() => {
        cleanupApprove(upstreamRoot, firstId);
        cleanupApprove(upstreamRoot, secondId);
        removeQuietly(consumerRoot);
      });

      test("AC-074-4: home card shows the open count and recent titles linking to the Issues page while reports are open", async () => {
        consumerRoot = makeConsumer("ac4a", upstreamRoot, rootPrdSlug);
        firstId = fileReport(consumerRoot, {
          title: titleFirst,
          description: "first open report",
          expected: "exit 0",
          actual: "exit 4",
          actor: "agent:e2e-ac4-first",
        }).upstream_doc_id;
        secondId = fileReport(consumerRoot, {
          title: titleSecond,
          description: "second open report",
          expected: "exit 0",
          actual: "exit 4",
          actor: "agent:e2e-ac4-second",
        }).upstream_doc_id;

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
        // reason: guard this test's own precondition — if some earlier block in
        // a whole-file run failed to clean up, fail loud here rather than
        // silently asserting a false "empty state" against a non-empty corpus.
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
