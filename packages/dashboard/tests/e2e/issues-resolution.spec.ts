/**
 * AC-ICL-9 (spec-issue-closure-loop-computed-resolution-agent-reachable, §D7/D8) —
 * the dashboard Issues page renders each report's COMPUTED resolution
 * (open/resolving/fixed), and the nav badge counts computed-`"open"` reports
 * rather than raw `draft` docs.
 *
 * Runs against the SAME throwaway corpus + real HTTP/Vite servers
 * `global-setup.ts` boots for the rest of this Playwright suite (fixed ports
 * 8787/5173 — SERIALIZED per that file's header; `playwright.config.ts` pins
 * `workers: 1` / `fullyParallel: false` for exactly this reason — concurrent
 * runs against the same corpus/ports produce phantom "browser has been
 * closed" failures). This file's own oracle command
 * (`bunx playwright test tests/e2e/issues-resolution.spec.ts`) runs it
 * standalone against a FRESH throwaway corpus (its own `globalSetup`
 * invocation), so every assertion below reasons about counts relative to
 * ONLY the reports this file creates (unique `runId`-suffixed titles), never
 * an assumed total corpus count — this file is safe to also run as part of
 * the full suite.
 *
 * Fixture recipe (three ingredients per scenario):
 *   1. A genuine issue-report task, filed via the REAL `report-issue` CLI
 *      from a twin CONSUMER mkdtemp corpus pointed at this suite's own
 *      throwaway corpus (`feedback.upstream`) — the EXACT recipe
 *      `tests/e2e/issues.spec.ts` already established (see that file's own
 *      header for why: real cross-process path, not hand-inserted rows).
 *   2. A "fixing" doc — a planless `--adhoc` task (SPEC-069 D2; no plan
 *      needed), walked through `draft -> approved[-> active -> archived]`
 *      via `lore approve` / `lore set --status` (all valid direct
 *      VALID_TRANSITIONS steps, packages/core/src/CLAUDE.md).
 *   3. A `resolves` link from the fixing doc to the issue task.
 *
 * KNOWN, OUT-OF-ANCHOR-SCOPE CLI GAP (not this task's fix — reported here for
 * visibility): `lore link --type resolves` currently EXITS 2 ("Invalid link
 * type 'resolves'") — `commands/link.ts`'s own `VALID_LINK_TYPES` array is a
 * hardcoded list that was never updated when P1 added `"resolves"` to
 * `linkTypeSchema` (the SAME class of drift this task's other fix,
 * `LinksPanel.test.tsx`'s hardcoded array, just corrected — this is a
 * SIBLING instance of it, in a file outside this task's anchors
 * `packages/lore/src/adapters/cli/commands/link.ts`). Verified empirically
 * (2026-07-29): `dist/lore link <a> <b> --type resolves` exits 2 against a
 * throwaway corpus. Ingredient 3 above therefore goes through the EXISTING
 * SPEC-022 cookie-gated dashboard write route instead
 * (`POST /api/dashboard/docs/:id/links`, `dashboard-routes.ts::handleDashboardCreateLink`)
 * — that route passes `type` straight to `CorpusService.link` with NO
 * intermediate allow-list, so it already accepts `"resolves"` correctly; it
 * is also the SAME write path the dashboard's own `LinksPanel` component
 * uses, so this is a real production path, not a backdoor. Authenticated via
 * `sharedPage.request`, which shares the SAME `lore_sid` cookie jar
 * `sharedPage`'s bootstrap navigation already minted.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — a report with no `resolves` in-edge renders `resolution: "open"`
 *     and IS counted by the nav badge.
 *   STATE — a report with a `resolves` in-edge from a non-terminal (approved)
 *     fixing doc renders `resolution: "resolving"`.
 *   STATE — a report with a `resolves` in-edge from a terminal (archived)
 *     fixing doc renders `resolution: "fixed"` while its OWN `status` stays
 *     `draft` (D5(a) — archiving the issue task itself is manual) — the
 *     "unclosed escalation" shape spec's Overview names as the exact failure
 *     D7/D8 makes visible rather than hides.
 *   NEGATIVE — the nav badge / list-header "N open" count EXCLUDES the
 *     resolving/fixed rows even though both STILL APPEAR as rows (D8 —
 *     hiding them would reproduce the same proxy-status failure D2 removes).
 *   BOUNDARY — the detail view (`IssueDetail`) renders the SAME computed
 *     resolution for the "fixed" report, distinct from its raw `status`
 *     badge (which still reads "draft").
 *   REGRESSION — `IssuesList` row order (newest first) is unaffected by the
 *     added resolution badge; the pre-existing `issue-report-row`/
 *     `issue-report-title` testids are still exactly as `issues.spec.ts`
 *     (AC-074-1..4) expects.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D7, §D8, AC-ICL-9.
 * @spec_ref AC-ICL-9
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { patchLoreConfig } from "../../../lore/tests/helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
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

/** `runLore` + `--json`, parsed. Throws with full stdio context on a non-JSON response OR a non-zero exit. */
function runLoreJson<T>(args: string[], cwd: string, env?: Record<string, string>): T {
  const result = runLore([...args, "--json"], cwd, env);
  if (result.status !== 0) {
    throw new Error(`'lore ${args.join(" ")}' exited ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from 'lore ${args.join(" ")}' (exit ${result.status}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

/** Appends a `feedback.upstream` stanza onto a consumer's config.yaml (mirrors issues.spec.ts's identical fixture). */
function configureFeedbackUpstream(consumerRoot: string, upstreamRoot: string, rootPrdIdentity: string): void {
  assertUnderTmp(consumerRoot);
  patchLoreConfig(
    consumerRoot,
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${rootPrdIdentity}`, ""].join("\n"),
  );
}

/** Discover (or create) the upstream's root PRD — same selection `IssueReportService.resolveRootDoc()` uses. */
function ensureUpstreamRootPrd(upstreamRoot: string): { id: string; slug: string } {
  const listing = runLoreJson<{ ok: true; data: { docs: Array<{ id: string; slug: string }> } }>(
    ["list", "--type", "prd"],
    upstreamRoot,
  );
  const existing = listing.data.docs[0];
  if (existing !== undefined) return existing;

  const created = runLoreJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", "E2E Issues-Resolution Upstream Root PRD", "--content", "seed root prd for AC-ICL-9 e2e"],
    upstreamRoot,
  );
  return created.data;
}

/** Fresh mkdtemp consumer corpus, `lore init`'d, `feedback.upstream` pointed at `upstreamRoot`. */
function makeConsumer(prefix: string, upstreamRoot: string, rootPrdSlug: string): string {
  const consumerRoot = mkdtempSync(join(TMP_ROOT, `lore-e2e-icl9-${prefix}-`));
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
}

/** Files a genuine `extra.issue_report`-bearing task via the real consumer `report-issue` CLI flow. */
function fileReport(consumerRoot: string, title: string, actor: string): FiledReport {
  const parsed = runLoreJson<{ ok: true; data: FiledReport }>(
    [
      "report-issue",
      "--title",
      title,
      "--description",
      "full description of defect for AC-ICL-9 e2e",
      "--expected",
      "exit 0",
      "--actual",
      "exit 4 unexpectedly",
    ],
    consumerRoot,
    { LORE_ACTOR: actor },
  );
  return parsed.data;
}

/**
 * Creates a planless `--adhoc` "fixing" doc and walks it through
 * `draft -> approved[-> active -> archived]` (all valid direct transitions).
 * `finalStatus: "approved"` stops before `active` (computeIssueResolution's
 * "resolving" case — an in-edge exists, no source doc is terminal yet);
 * `"archived"` reaches a terminal status (the "fixed" case).
 */
function createFixingDoc(upstreamRoot: string, title: string, finalStatus: "approved" | "archived"): string {
  const created = runLoreJson<{ ok: true; data: { id: string } }>(
    ["create", "task", "--title", title, "--content", "fixes the defect", "--adhoc"],
    upstreamRoot,
  );
  const fixId = created.data.id;

  const approveResult = runLore(["approve", fixId], upstreamRoot);
  if (approveResult.status !== 0) {
    throw new Error(`Failed to approve fixing doc ${fixId}: ${approveResult.stderr}`);
  }

  if (finalStatus === "archived") {
    const activeResult = runLore(["set", fixId, "--status", "active"], upstreamRoot);
    if (activeResult.status !== 0) {
      throw new Error(`Failed to activate fixing doc ${fixId}: ${activeResult.stderr}`);
    }
    const archivedResult = runLore(["set", fixId, "--status", "archived"], upstreamRoot);
    if (archivedResult.status !== 0) {
      throw new Error(`Failed to archive fixing doc ${fixId}: ${archivedResult.stderr}`);
    }
  }

  return fixId;
}

/**
 * Creates the `resolves` edge via the EXISTING cookie-gated dashboard write
 * route (`POST /api/dashboard/docs/:id/links`) — see this file's header for
 * why `lore link --type resolves` (the CLI path) cannot be used instead.
 * `page.request` shares the SAME `lore_sid` cookie jar the page's own
 * bootstrap navigation already minted.
 */
async function createResolvesLink(page: Page, fixId: string, issueId: string): Promise<void> {
  const res = await page.request.post(`/api/dashboard/docs/${encodeURIComponent(fixId)}/links`, {
    data: { to: issueId, type: "resolves" },
  });
  if (!res.ok()) {
    throw new Error(`Failed to create resolves link ${fixId} -> ${issueId}: ${res.status()} ${await res.text()}`);
  }
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

test.describe("AC-ICL-9 dashboard Issues page renders computed resolution", () => {
  const runId = Date.now();
  let sharedPage: Page;
  let upstreamRoot: string;
  let rootPrdSlug: string;
  let consumerRoot: string;

  const titleOpen = `E2E ICL9 Open ${runId}`;
  const titleResolving = `E2E ICL9 Resolving ${runId}`;
  const titleFixed = `E2E ICL9 Fixed ${runId}`;
  let openId: string;
  let resolvingId: string;
  let fixedId: string;

  test.beforeAll(() => {
    // Build dist/lore fresh (stale-binary false-oracle vector — root CLAUDE.md).
    execFileSync("bun", ["run", "build"], { cwd: REPO_ROOT });
    if (!existsSync(DIST_LORE)) {
      throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
    }

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
    // cookie every subsequent navigation/request this page(.request) makes
    // reuses.
    sharedPage = await browser.newPage();
    await sharedPage.goto("/issues");
    await expect(sharedPage.getByRole("heading", { name: "Issues" })).toBeVisible();
  });

  test.afterAll(async () => {
    // Restore the shared "0 open" baseline for whichever suite runs next
    // (same discipline as issues.spec.ts).
    if (openId !== undefined) cleanupApprove(upstreamRoot, openId);
    if (resolvingId !== undefined) cleanupApprove(upstreamRoot, resolvingId);
    if (fixedId !== undefined) cleanupApprove(upstreamRoot, fixedId);
    removeQuietly(consumerRoot);
    await sharedPage.close();
  });

  test("AC-ICL-9: Issues list renders each row's computed resolution and the nav badge counts computed-open reports only", async () => {
    consumerRoot = makeConsumer("main", upstreamRoot, rootPrdSlug);

    // ── Ingredient 1: three genuine issue reports ──────────────────────────
    openId = fileReport(consumerRoot, titleOpen, "agent:e2e-icl9-open").upstream_doc_id;
    resolvingId = fileReport(consumerRoot, titleResolving, "agent:e2e-icl9-resolving").upstream_doc_id;
    fixedId = fileReport(consumerRoot, titleFixed, "agent:e2e-icl9-fixed").upstream_doc_id;
    expect(new Set([openId, resolvingId, fixedId]).size).toBe(3);

    // ── Ingredients 2+3: fixing docs + resolves edges ──────────────────────
    const resolvingFixId = createFixingDoc(upstreamRoot, `Fixing doc (resolving) ${runId}`, "approved");
    await createResolvesLink(sharedPage, resolvingFixId, resolvingId);

    const fixedFixId = createFixingDoc(upstreamRoot, `Fixing doc (fixed) ${runId}`, "archived");
    await createResolvesLink(sharedPage, fixedFixId, fixedId);

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
    // Exactly ONE of our three fixtures ("open") should be counted — the
    // other two are STILL VISIBLE (asserted above) but not "open".
    // reason: scoped to a fresh standalone corpus (this file's own oracle
    // command boots its own globalSetup) — the badge's total is exactly the
    // 1 open report this test filed, not a corpus-wide assumption.
    await expect(sharedPage.getByRole("link", { name: "Issues 1" })).toBeVisible();
    await expect(sharedPage.getByText("1 open", { exact: true })).toBeVisible();

    // ── REGRESSION: pre-existing row/title testids still work as before ──
    const titles = sharedPage.getByTestId("issue-report-title");
    await expect(titles).toHaveCount(3);

    // ── BOUNDARY: detail view renders the SAME resolution, distinct from
    //    the raw status badge (still "draft" — never auto-archived, D5(a)) ─
    await sharedPage.goto(`/issues/${fixedId}`);
    await expect(sharedPage.getByRole("heading", { name: titleFixed })).toBeVisible();
    await expect(sharedPage.getByTestId("issue-report-resolution")).toHaveText("fixed");
    // The raw status badge is a SEPARATE element still reading "draft" —
    // resolution and status are intentionally independent (D7/D8).
    await expect(sharedPage.getByText("draft", { exact: true })).toBeVisible();
  });
});
