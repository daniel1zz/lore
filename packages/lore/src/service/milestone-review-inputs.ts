/**
 * Milestone review inputs measured once per batch (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-
 * milestones Part D "Review inputs, measured once per batch").
 *
 * Purpose: the pure half of the two measured inputs of a review. (1) The plan-close chain plus the full test suite run
 *   ONCE for a whole `lore assess` batch on main's HEAD (`SuiteRun`); each plan's regression dimension reads it, and a
 *   failing test file counts against a plan only when the plan's landed diff touched that file or a file it imports
 *   directly. (2) The snapshot-accuracy dimension fails only on a cited rule whose state is `contradicted`; `stale`,
 *   `unknown` and `unverified` are n/a with the reason, and stale evidence is re-verified once per batch beforehand.
 * Public surface: SuiteRun, SuiteCommandResult, FailingTestFile, parseFailingTestFiles, touchedFilesOfDiff,
 *   attributeSuiteFailures, renderSuiteSection, applyRegressionFloor, applySnapshotRule, staleCitingAcIds, StaleAcRefresherPort, StaleRefreshReport,
 *   SuiteRunnerPort.
 * Invariants:
 *   - A suite that was not measured is `status: "not_measured"` with a reason; it is never read as a pass.
 *   - Attribution never guesses: with no landed diff nothing is attributed to the plan (and the section says why).
 *   - The regression floor only ever TURNS a verdict into fail (attributed failing file); it never promotes a fail.
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

/** The port `lore assess` calls once per batch; `adapters/cli/assess-suite-runner.ts` is the real one. */
export interface SuiteRunnerPort {
  /** Runs the plan-close chain and the full test suite on main's HEAD in a throwaway worktree, once. */
  readonly run: () => Promise<Result<SuiteRun, LoreError>>;
}

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

/** How the batch's failing test files split for ONE plan. */
export interface SuiteAttribution {
  /** Failing files the plan's diff touched or whose direct import it touched: they count against this plan. */
  readonly attributed: readonly string[];
  /** Failing files with no such tie to the plan: shown to the judge, never counted. */
  readonly unattributed: readonly string[];
}

/**
 * Splits a measured suite's failing files for one plan.
 *
 * @param suite - the batch run
 * @param touched - the files the plan's landed diff touched; `undefined` when the plan has no derivable diff
 * @returns everything unattributed when the suite was not measured or the plan has no diff
 */
export function attributeSuiteFailures(suite: SuiteRun, touched: ReadonlySet<string> | undefined): SuiteAttribution {
  if (suite.status !== "measured") return { attributed: [], unattributed: [] };
  if (touched === undefined) return { attributed: [], unattributed: suite.failing_test_files.map((f) => f.file) };
  const attributed: string[] = [];
  const unattributed: string[] = [];
  for (const failing of suite.failing_test_files) {
    const tied = touched.has(failing.file) || failing.imports.some((imported) => touched.has(imported));
    (tied ? attributed : unattributed).push(failing.file);
  }
  return { attributed, unattributed };
}

/** The prompt section carrying the batch's suite run for one plan's regression dimension. */
export function renderSuiteSection(
  suite: SuiteRun | undefined,
  attribution: SuiteAttribution,
  hasPlanDiff: boolean,
): string {
  if (suite === undefined) {
    return "No full-suite run was supplied for this review (not measured); do not fail regression for a missing run.";
  }
  if (suite.status === "not_measured") {
    return `The full-suite run on main was NOT measured: ${suite.reason}. Do not fail regression for a missing run; judge from the diff and evidence.`;
  }
  const lines = [`One run for the whole batch, on main at ${suite.commit}:`];
  for (const c of suite.commands) lines.push(`- \`${c.command}\` exit ${String(c.exit_code)}`);
  for (const s of suite.skipped) lines.push(`- \`${s.command}\` not run: ${s.reason}`);
  lines.push(
    attribution.attributed.length === 0
      ? "Failing test files attributed to THIS plan (its diff touched the file or a file it imports directly): none."
      : `Failing test files attributed to THIS plan: ${attribution.attributed.join(", ")}.`,
  );
  if (attribution.unattributed.length > 0) {
    lines.push(
      hasPlanDiff
        ? `Failing test files NOT tied to this plan (other work; do not count them against it): ${attribution.unattributed.join(", ")}.`
        : `This plan has no derivable diff, so these failing files cannot be tied to it and do not count: ${attribution.unattributed.join(", ")}.`,
    );
  }
  return lines.join("\n");
}

/**
 * Turns `regression` into a fail when a failing test file is attributed to the plan.
 *
 * @param dimensions - the judge's judgments
 * @param attribution - the plan's attribution
 * @returns the judgments; `regression` is replaced only when `attribution.attributed` is non-empty
 */
export function applyRegressionFloor(
  dimensions: LlmMilestoneOutput["dimensions"],
  attribution: SuiteAttribution,
  commit: string | undefined,
): LlmMilestoneOutput["dimensions"] {
  if (attribution.attributed.length === 0) return dimensions;
  return {
    ...dimensions,
    regression: {
      verdict: "fail",
      reason:
        `Full suite on main${commit !== undefined ? ` at ${commit}` : ""} fails in ${attribution.attributed.join(", ")}, ` +
        `which this plan's diff touched or imports directly (judge said: ${dimensions.regression.reason})`,
      reference: dimensions.regression.reference.length > 0 ? dimensions.regression.reference : "Kayenta canary analysis",
    },
  };
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

/** The port plan close uses to learn which GitHub issues are OPEN right now. */
export interface PlanCloseIssuePort {
  readonly listOpenIssues: () => Promise<Result<OpenIssueListing, LoreError>>;
}

/** Result of {@link coverFailedDimensions}. */
export interface DimensionCoverage {
  /** True when every failed dimension has at least one open linked issue. */
  readonly accepted: boolean;
  /** Per failed dimension: the open linked issue numbers that name it. */
  readonly byDimension: Readonly<Record<string, readonly number[]>>;
  readonly uncovered: readonly string[];
  /** Every issue number that covers some dimension, ascending. */
  readonly issues: readonly number[];
}

/** The issue carrier's `extra` field that records which milestone findings (dimension + fingerprint) the issue files. */
export const MILESTONE_FINDINGS_FIELD = "milestone_findings";

/** One finding an issue covers: written when the batch files or links the issue, read by plan close. */
export const milestoneFindingSchema = z.object({
  dimension: z.string().min(1),
  fingerprint: z.string().min(1),
});
export type MilestoneFinding = z.infer<typeof milestoneFindingSchema>;

/**
 * The findings recorded on an issue carrier's `extra`.
 *
 * @param extra - an issue task's `extra`
 * @returns the valid recorded findings; `[]` when none are recorded (an issue linked by hand covers nothing)
 */
export function readMilestoneFindings(extra: unknown): MilestoneFinding[] {
  if (extra === null || typeof extra !== "object") return [];
  const raw = (extra as Record<string, unknown>)[MILESTONE_FINDINGS_FIELD];
  const parsed = z.array(milestoneFindingSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Accepted with known defects (Part D, BR-1379): a failed dimension is covered by an OPEN issue that is linked to the
 * plan and whose carrier records that dimension (`milestone_findings`, written when the batch files or links the
 * issue). The issue title is never read.
 *
 * @param failed - the failed dimension ids of the current review
 * @param linked - the issues linked to the plan: `{number, repoId?, dimensions}` read from the linked issue tasks
 * @param listing - the live open issues
 * @returns accepted only when `failed` is non-empty and every entry is covered
 */
export function coverFailedDimensions(
  failed: readonly string[],
  linked: readonly { readonly number: number; readonly repoId?: number; readonly dimensions: readonly string[] }[],
  listing: OpenIssueListing,
): DimensionCoverage {
  const linkedOpen = listing.open.flatMap((issue) => {
    const carrier = linked.find((l) => l.number === issue.number && (l.repoId === undefined || l.repoId === listing.repoId));
    return carrier === undefined ? [] : [{ number: issue.number, dimensions: carrier.dimensions }];
  });
  const byDimension: Record<string, number[]> = {};
  const uncovered: string[] = [];
  for (const dimension of failed) {
    const numbers = linkedOpen.filter((i) => i.dimensions.includes(dimension)).map((i) => i.number);
    byDimension[dimension] = numbers;
    if (numbers.length === 0) uncovered.push(dimension);
  }
  const issues = [...new Set(Object.values(byDimension).flat())].sort((a, b) => a - b);
  return { accepted: failed.length > 0 && uncovered.length === 0, byDimension, uncovered, issues };
}
