/**
 * Milestone review inputs measured once per batch (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-
 * milestones Part D "Review inputs, measured once per batch").
 *
 * Purpose: the pure half of the two measured inputs of a review. (1) The plan-close chain plus the full test suite run
 *   ONCE for a whole `lore assess` batch on main's HEAD (`SuiteRun`), recorded as main's red/green state and shown to the judge as
 *   context only (regression itself is measured at main's head by single-file bisection). (2) The snapshot-accuracy dimension fails only on a cited rule whose state is `contradicted`; `stale`,
 *   `unknown` and `unverified` are n/a with the reason, and stale evidence is re-verified once per batch beforehand.
 * Public surface: SuiteRun, SuiteCommandResult, FailingTestFile, parseFailingTestFiles, touchedFilesOfDiff,
 *   renderSuiteSection, applySnapshotRule, staleCitingAcIds, StaleAcRefresherPort, StaleRefreshReport.
 * Invariants:
 *   - A suite that was not measured is `status: "not_measured"` with a reason; it is never read as a pass.
 *   - Regression is NOT decided here: `regression-at-head.ts` measures it at the assessed commit (BR-1496); a red file on main's
 *     HEAD is never charged to a plan by itself.
 *   - The snapshot rule turns a verdict into fail only for a contradicted rule, and into na when none is contradicted.
 * Side-effect class: pure (no IO, no clock).
 *
 * Reference: Kayenta automated canary analysis (one shared baseline run judged against every candidate).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { z } from "zod";
import type { LlmMilestoneOutput, LoreError, Result } from "@lore/core";
import type { CitedRuleStateRow } from "./milestone-review.js";

/** One command the batch ran on main's HEAD. */
export const suiteCommandResultSchema = z.object({
  command: z.string().min(1),
  exit_code: z.number().int(),
  /** Last part of the combined output (the runner's summary lines). */
  output_tail: z.string(),
});
export type SuiteCommandResult = z.infer<typeof suiteCommandResultSchema>;

/** A failing test file and the repo-relative files it imports directly (read at the measured commit). */
export const failingTestFileSchema = z.object({
  file: z.string().min(1),
  imports: z.array(z.string()),
});
export type FailingTestFile = z.infer<typeof failingTestFileSchema>;

/** The result of the one per-batch run. */
export const suiteRunSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("measured"),
    /** The main commit the commands ran at. */
    commit: z.string().min(1),
    commands: z.array(suiteCommandResultSchema),
    /** Commands the project does not define (a missing package.json script); named, never silently skipped. */
    skipped: z.array(z.object({ command: z.string().min(1), reason: z.string().min(1) })),
    failing_test_files: z.array(failingTestFileSchema),
  }),
  z.object({ status: z.literal("not_measured"), reason: z.string().min(1) }),
]);
export type SuiteRun = z.infer<typeof suiteRunSchema>;

/**
 * The test files a runner's output names as failing.
 *
 * @param output - combined stdout/stderr of the test command
 * @returns unique repo-relative paths, in first-seen order (a vitest `FAIL  <file> > <test>` line names one)
 * @example
 * parseFailingTestFiles(" FAIL  packages/x/tests/a.test.ts > a > b\n"); // => ["packages/x/tests/a.test.ts"]
 */
export function parseFailingTestFiles(output: string): string[] {
  const found = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(?:FAIL|✗|×)\s+(?:\[[^\]]*\]\s+)?(\S+\.(?:test|spec)\.[cm]?[tj]sx?)\b/.exec(line);
    if (match?.[1] !== undefined) found.add(match[1]);
  }
  return [...found];
}

/** The files a unified diff touches (`diff --git a/<p> b/<p>`), unique, new path for a rename. */
export function touchedFilesOfDiff(diffText: string): Set<string> {
  const files = new Set<string>();
  for (const line of diffText.split("\n")) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2] !== undefined) files.add(match[2]);
  }
  return files;
}

/**
 * The prompt section carrying the batch's one suite run on main's HEAD. It is context for the judge only: regression
 * is measured by `regression-at-head.ts` (the facts table), and a failing file here is never charged to
 * a plan by itself.
 */
export function renderSuiteSection(suite: SuiteRun | undefined): string {
  if (suite === undefined) {
    return "No full-suite run on main was supplied for this review (not measured).";
  }
  if (suite.status === "not_measured") {
    return `The full-suite run on main was NOT measured: ${suite.reason}.`;
  }
  const lines = [`One run for the whole batch, on main at ${suite.commit} (context only; regression is measured in the facts table):`];
  for (const c of suite.commands) lines.push(`- \`${c.command}\` exit ${String(c.exit_code)}`);
  for (const s of suite.skipped) lines.push(`- \`${s.command}\` not run: ${s.reason}`);
  lines.push(
    suite.failing_test_files.length === 0
      ? "Failing test files on main: none."
      : `Failing test files on main (not charged to this plan by being red now): ${suite.failing_test_files.map((f) => f.file).join(", ")}.`,
  );
  return lines.join("\n");
}

/** Why a non-contradicted state is not a disagreement between document and code (BR-984 state definitions). */
function nonDisagreementNote(row: CitedRuleStateRow): string {
  switch (row.state) {
    case "stale":
      return `${row.rule_id} (stale: a code anchor changed after its last attested pass; the document and code are not shown to disagree)`;
    case "unknown":
      return `${row.rule_id} (unknown: ${row.unknown_reason ?? "unknown"})`;
    case "unverified":
      return `${row.rule_id} (unverified: no attested run of its citing criterion)`;
    default:
      return `${row.rule_id} (${row.state})`;
  }
}

/**
 * snapshot_accuracy fails ONLY on a `contradicted` cited rule (a failing run of the citing AC). Any contradicted rule
 * makes the dimension a fail whatever the judge said; otherwise a judged `fail`, or a rule set with no `verified` rule
 * (all stale / unknown / unverified), is `na` with each rule's reason. Stale is "not re-run since the code changed",
 * never "disagrees" (Bazel action cache: a changed-input entry is re-executed, not treated as a wrong result).
 *
 * @param dimensions - the judge's judgments
 * @param cited - the cited rules' states as measured (after the batch's stale re-verification)
 */
export function applySnapshotRule(
  dimensions: LlmMilestoneOutput["dimensions"],
  cited: readonly CitedRuleStateRow[],
): LlmMilestoneOutput["dimensions"] {
  const judged = dimensions.snapshot_accuracy;
  const contradicted = cited.filter((r) => r.state === "contradicted");
  if (contradicted.length > 0) {
    const ids = contradicted.map((r) => r.rule_id).join(", ");
    return {
      ...dimensions,
      snapshot_accuracy: {
        verdict: "fail",
        reason:
          judged.verdict === "fail"
            ? `contradicted cited rule(s): ${ids} (${judged.reason})`
            : `contradicted cited rule(s): ${ids}; the citing criterion fails now (judge said: ${judged.reason})`,
        reference: judged.reference.length > 0 ? judged.reference : "Bazel action cache",
      },
    };
  }
  const notVerified = cited.filter((r) => r.state !== "verified");
  const noneVerified = cited.length > 0 && notVerified.length === cited.length;
  if (judged.verdict !== "fail" && !noneVerified) return dimensions;
  const note =
    notVerified.length === 0
      ? "no cited rule is contradicted"
      : `no cited rule is contradicted; not verified: ${notVerified.map(nonDisagreementNote).join(", ")}`;
  return {
    ...dimensions,
    snapshot_accuracy: {
      verdict: "na",
      reason: judged.verdict === "fail" ? `${note} (judge said: ${judged.reason})` : `${note} (${judged.reason})`,
      reference: judged.reference,
    },
  };
}

/**
 * The citing acceptance criteria of every stale cited rule, deduplicated and sorted.
 *
 * @param cited - the cited rules' states
 * @returns AC ids to re-verify; a stale rule with no known citing AC contributes none
 */
export function staleCitingAcIds(cited: readonly CitedRuleStateRow[]): string[] {
  const ids = new Set<string>();
  for (const row of cited) {
    if (row.state !== "stale") continue;
    for (const acId of row.citing_acs ?? []) ids.add(acId);
  }
  return [...ids].sort();
}

/**
 * The port that re-runs acceptance criteria through the trusted `lore verify` runner (attested evidence) in the
 * batch's throwaway main worktree; `adapters/cli/assess-stale-refresh.ts` is the real one.
 */
export interface StaleAcRefresherPort {
  /** Runs `acIds` of `planRef`'s spec once and records attested evidence; an `err` leaves those rules stale. */
  readonly runAcs: (planRef: string, acIds: readonly string[]) => Promise<Result<void, LoreError>>;
}

/** What one batch refresh did. */
export interface StaleRefreshReport {
  readonly ran: readonly { readonly plan: string; readonly acIds: readonly string[] }[];
  /** Plans whose refresh failed; their stale rules stay stale (n/a), named here so the caller can say so. */
  readonly failures: readonly { readonly plan: string; readonly acIds: readonly string[]; readonly message: string }[];
}

/** One GitHub issue as the plan-close coverage check sees it. */
export interface OpenIssueRef {
  readonly number: number;
  readonly title: string;
}

/** The live open issues of the configured repository, as the plan-close port returns them. */
export interface OpenIssueListing {
  readonly repoId: number;
  readonly open: readonly OpenIssueRef[];
}

/** One issue read by its own number: the repository it belongs to and whether it is open right now. */
export interface IssueRead {
  readonly repoId: number;
  readonly state: "open" | "closed";
}

/** The port plan close and the filer use to read GitHub: the open listing (fingerprint search) and one issue by number (coverage). */
export interface PlanCloseIssuePort {
  readonly listOpenIssues: () => Promise<Result<OpenIssueListing, LoreError>>;
  /** Single-issue read (never the paginated listing: a just-filed issue may be missing from it, #402). */
  readonly readIssue: (number: number) => Promise<Result<IssueRead, LoreError>>;
}

/** One current root cause of a failed dimension, as coverage reads it (BR-1513, BR-1421). */
export interface FailingCause {
  readonly dimension: string;
  /** The full root-cause fingerprint; an entry covers this cause only when it carries the same one. */
  readonly fingerprint: string;
  /** The issue title this cause is filed under (`regression: main red: <path> [fp:<12 hex>]`), to name it in a refusal. */
  readonly title: string;
}

/** Result of {@link coverFailedDimensions}. */
export interface DimensionCoverage {
  /** True when every current root cause of every failed dimension has an entry whose issue is open. */
  readonly accepted: boolean;
  /** Per failed dimension: the open issue numbers recorded for its current causes. */
  readonly byDimension: Readonly<Record<string, readonly number[]>>;
  /** The failed dimensions with at least one current cause that no open issue covers. */
  readonly uncovered: readonly string[];
  /** The current causes no open entry covers, in cause order; absent when the caller named no causes (dimension-level reading). */
  readonly uncoveredCauses?: readonly FailingCause[];
  /**
   * The uncovered dimensions that have an entry whose issue is no longer open (closed: the defect was fixed). That is
   * new input: the plan needs review again (#394).
   */
  readonly fixed: readonly string[];
  /** Every closed issue number recorded for an uncovered cause (or uncovered dimension), ascending. */
  readonly closed: readonly number[];
  /** Every issue number that covers some cause, ascending. */
  readonly issues: readonly number[];
}

/** A recorded known defect with its live state, as {@link coverFailedDimensions} reads it. */
export interface KnownDefectLive {
  readonly number: number;
  readonly dimension: string;
  /** The root-cause fingerprint the entry is recorded for; read only when the dimension's current causes are named. */
  readonly fingerprint?: string;
  readonly state: "open" | "closed";
}

/**
 * Accepted with known defects (Part D, BR-1379, BR-1421, BR-1513): a failed dimension is covered when EVERY current root cause
 * of it has a recorded known-defect entry for THAT cause whose issue is open. The issue title is never read, an entry covers
 * only its own dimension, and (when the causes are named) only its own fingerprint, so an open issue of one red file never
 * covers a newly red one. A dimension whose causes are not named is read per dimension, as before.
 *
 * @param failed - the failed dimension ids of the current review
 * @param entries - the plan's recorded known defects, each with the issue's live state (read by number)
 * @param causes - the current root causes of the failed dimensions (`failingCausesOf`); absent = dimension-level reading
 * @returns accepted only when `failed` is non-empty and every cause is covered
 */
export function coverFailedDimensions(failed: readonly string[], entries: readonly KnownDefectLive[], causes?: readonly FailingCause[]): DimensionCoverage {
  const byDimension: Record<string, number[]> = {};
  const uncovered: string[] = [];
  const uncoveredCauses: FailingCause[] = [];
  const fixed: string[] = [];
  const closed = new Set<number>();
  for (const dimension of failed) {
    const mine = entries.filter((e) => e.dimension === dimension);
    const named = (causes ?? []).filter((c) => c.dimension === dimension);
    if (named.length === 0) {
      const numbers = [...new Set(mine.filter((e) => e.state === "open").map((e) => e.number))];
      byDimension[dimension] = numbers;
      if (numbers.length > 0) continue;
      uncovered.push(dimension);
      const closedHere = mine.filter((e) => e.state === "closed");
      if (closedHere.length > 0) fixed.push(dimension);
      for (const e of closedHere) closed.add(e.number);
      continue;
    }
    const covering = new Set<number>();
    let dimensionUncovered = false;
    let dimensionFixed = false;
    for (const cause of named) {
      const forCause = mine.filter((e) => e.fingerprint === cause.fingerprint);
      const open = forCause.filter((e) => e.state === "open");
      for (const e of open) covering.add(e.number);
      if (open.length > 0) continue;
      dimensionUncovered = true;
      uncoveredCauses.push(cause);
      const closedHere = forCause.filter((e) => e.state === "closed");
      if (closedHere.length > 0) dimensionFixed = true;
      for (const e of closedHere) closed.add(e.number);
    }
    byDimension[dimension] = [...covering].sort((x, y) => x - y);
    if (dimensionUncovered) uncovered.push(dimension);
    if (dimensionFixed) fixed.push(dimension);
  }
  const issues = [...new Set(Object.values(byDimension).flat())].sort((a, b) => a - b);
  return {
    accepted: failed.length > 0 && uncovered.length === 0,
    byDimension,
    uncovered,
    ...(causes !== undefined ? { uncoveredCauses } : {}),
    fixed,
    closed: [...closed].sort((a, b) => a - b),
    issues,
  };
}
