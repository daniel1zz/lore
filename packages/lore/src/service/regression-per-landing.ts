/**
 * Regression measured per landing of a plan (BR-1496, spec D1): what each landing broke, not what is red on main now.
 *
 * Purpose: for every landing L of a plan's tasks, take the files failing in L's stored suite result, re-run them at
 *   `main_before`, and confirm the ones that passed there with one more run at L. Only a file that fails at L, passes at
 *   `main_before` and fails the confirm run is that landing's regression; the gate then charges only the regressions
 *   still red in the newest stored main suite result at or after the plan's last landing.
 * Public surface: regressionPerLanding, RegressionLandingInput, RegressionPorts, RegressionClearingSource,
 *   RegressionPerLanding, LandingRegression, RegressionFinding, ClearedRegression.
 * Invariants:
 *   - Classification per failing file at L: red at `main_before` -> red-before (reported, never charged); green there and
 *     red on the confirm run -> regression; green on the confirm run -> flaky (reported, never charged).
 *   - A landing whose suite cannot run, whose re-runs cannot run, or whose `main_before` does not resolve is
 *     `not-measured` naming the landing; it is never a pass. An unlanded task is `not-measured` too (no measured diff).
 *   - The re-run at `main_before` and the confirm run are stored with L's suite result (`SuiteResultService.rerunFiles`)
 *     and read back before running anything, so a later review of the same landing runs nothing.
 *   - A failure introduced by a commit that is not one of the plan's landings never appears here: only the failing files
 *     of a landing's own suite result are looked at.
 *   - Fact rows: one per landing (fail only for UNCLEARED regressions), one per unlanded task, one for a clearing
 *     lookup that failed. The dimension verdict is the fold of those rows (fail > not-measured > pass).
 * Side-effect class: IO through the injected ports only (suite runs, file re-runs, store writes via the suite service).
 *
 * Reference: post-submit culprit finders re-run only the failing tests at the parent commit.
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-1, BR-1496, D1)
 */

import { err, ok, type LoreError, type MilestoneFactRow, type Result } from "@lore/core";
import type { SuiteFileRunRecord, SuiteResultRecord } from "../store/store-interface.js";
import { loreErrorText, type CommitSuiteRunnerPort } from "./suite-result-service.js";

/** One landing of the plan, as `deriveLandingDiffForPlan` reports it. */
export interface RegressionLandingInput {
  readonly landing_commit: string;
  readonly main_before: string;
  readonly task_slugs: readonly string[];
  /** `no-change` landings put nothing on main: nothing to measure. */
  readonly kind: "no-change" | "commits";
}

/** The newest stored main suite result at or after the plan's last landing (a measured one), or none. */
export interface RegressionClearingSource {
  readonly commit: string;
  readonly result: SuiteResultRecord;
}

/** The slice of `SuiteResultService` this module drives. */
export interface LandingSuitePort {
  readonly lookupOrRun: (ref: string, runner: CommitSuiteRunnerPort) => Promise<Result<SuiteResultRecord, LoreError>>;
  readonly rerunFiles: (
    suiteResultId: string,
    files: readonly string[],
    runner: CommitSuiteRunnerPort,
    atCommit?: string,
  ) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
  readonly listFileRuns: (suiteResultId: string) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
}

/** Everything `regressionPerLanding` calls out to. */
export interface RegressionPorts {
  readonly suites: LandingSuitePort;
  readonly runner: CommitSuiteRunnerPort;
  /**
   * The newest stored measured main suite result at or after the LAST of `landingCommits`; `ok(null)` when none exists
   * yet (nothing is cleared). `err` when it cannot be determined.
   */
  readonly findClearingSource: (landingCommits: readonly string[]) => Promise<Result<RegressionClearingSource | null, LoreError>>;
}

/** A file charged to a landing. */
export interface RegressionFinding {
  readonly file: string;
  readonly landing: string;
}

/** A landing regression that passes in the newest main suite result at or after the last landing. */
export interface ClearedRegression extends RegressionFinding {
  /** The main commit whose stored suite result shows the file passing. */
  readonly cleared_by: string;
}

/** What one landing measured. */
export type LandingRegression =
  | {
      readonly status: "measured";
      readonly landing: string;
      readonly main_before: string;
      readonly regressions: readonly string[];
      readonly red_before: readonly string[];
      readonly flaky: readonly string[];
      /** The failing files of the landing's suite result (everything classified above). */
      readonly failing: readonly string[];
    }
  | { readonly status: "no-change"; readonly landing: string }
  | { readonly status: "not-measured"; readonly landing: string; readonly reason: string };

/** The measured regression facts of a plan. */
export interface RegressionPerLanding {
  readonly landings: readonly LandingRegression[];
  /** Regressions still red in the clearing source (these fail the gate). */
  readonly uncleared: readonly RegressionFinding[];
  readonly cleared: readonly ClearedRegression[];
  /** Id of the stored main suite result consulted for clearing; set only while a regression existed to clear. */
  readonly clearing_result_id: string | undefined;
  /** Fact rows for `MilestoneFacts.regression`. */
  readonly rows: readonly MilestoneFactRow[];
}

const notMeasured = (landing: string, reason: string): LandingRegression => ({ status: "not-measured", landing, reason });

/** The last stored row for `file` at `commit`, or undefined. */
function storedRunAt(rows: readonly SuiteFileRunRecord[], commit: string, file: string): SuiteFileRunRecord | undefined {
  return rows.filter((r) => r.commit_sha === commit && r.file === file).at(-1);
}

/** Re-runs (or reads back) one landing's failing files and classifies each. */
async function measureLanding(landing: RegressionLandingInput, ports: RegressionPorts): Promise<LandingRegression> {
  const id = landing.landing_commit;
  const looked = await ports.suites.lookupOrRun(id, ports.runner);
  if (!looked.ok) return notMeasured(id, `the suite could not be run at the landing: ${loreErrorText(looked.error)}`);
  const result = looked.value;
  if (result.status !== "measured") return notMeasured(id, `the suite could not run at the landing: ${result.cause ?? "unrunnable"}`);
  const failing = [...new Set(result.failing_test_files.map((f) => f.file))];
  const base = { status: "measured" as const, landing: id, main_before: landing.main_before, failing };
  if (failing.length === 0) return { ...base, regressions: [], red_before: [], flaky: [] };

  const before = await ports.runner.resolveCommit(landing.main_before);
  if (!before.ok) return notMeasured(id, `main_before ${landing.main_before} does not resolve: ${loreErrorText(before.error)}`);
  const beforeSha = before.value.commit;

  const stored = await ports.suites.listFileRuns(result.id);
  if (!stored.ok) return notMeasured(id, `stored re-runs could not be read: ${loreErrorText(stored.error)}`);
  let rows = stored.value;

  const missingBefore = failing.filter((f) => storedRunAt(rows, beforeSha, f) === undefined);
  if (missingBefore.length > 0) {
    const ran = await ports.suites.rerunFiles(result.id, missingBefore, ports.runner, beforeSha);
    if (!ran.ok) return notMeasured(id, `the failing files could not be re-run at main_before ${beforeSha}: ${loreErrorText(ran.error)}`);
    rows = [...rows, ...ran.value];
  }
  const greenBefore = failing.filter((f) => storedRunAt(rows, beforeSha, f)?.exit_code === 0);

  const missingConfirm = greenBefore.filter((f) => storedRunAt(rows, result.commit_sha, f) === undefined);
  if (missingConfirm.length > 0) {
    const ran = await ports.suites.rerunFiles(result.id, missingConfirm, ports.runner);
    if (!ran.ok) return notMeasured(id, `the confirm run at the landing failed: ${loreErrorText(ran.error)}`);
    rows = [...rows, ...ran.value];
  }

  const regressions: string[] = [];
  const redBefore: string[] = [];
  const flaky: string[] = [];
  for (const file of failing) {
    if (storedRunAt(rows, beforeSha, file)?.exit_code !== 0) redBefore.push(file);
    else if (storedRunAt(rows, result.commit_sha, file)?.exit_code === 0) flaky.push(file);
    else regressions.push(file);
  }
  return { ...base, regressions, red_before: redBefore, flaky };
}

function listOf(label: string, items: readonly string[]): string | undefined {
  return items.length === 0 ? undefined : `${label}: ${items.join(", ")}`;
}

/**
 * Measures regression for each landing of a plan and decides what the gate still charges.
 *
 * @param landings - the plan's landings (one per landing commit)
 * @param unlandedTasks - tasks with no usable landing record (no measured diff: regression is not-measured)
 * @param ports - suite results, file re-runs and the clearing lookup
 * @returns the per-landing outcomes, uncleared and cleared regressions and the fact rows; never throws
 */
export async function regressionPerLanding(
  landings: readonly RegressionLandingInput[],
  unlandedTasks: readonly string[],
  ports: RegressionPorts,
): Promise<Result<RegressionPerLanding, LoreError>> {
  const outcomes: LandingRegression[] = [];
  for (const landing of landings) {
    outcomes.push(landing.kind === "no-change" ? { status: "no-change", landing: landing.landing_commit } : await measureLanding(landing, ports));
  }
  const charged: RegressionFinding[] = outcomes.flatMap((o) =>
    o.status === "measured" ? o.regressions.map((file) => ({ file, landing: o.landing })) : [],
  );

  let cleared: ClearedRegression[] = [];
  let uncleared: RegressionFinding[] = charged;
  let clearingResultId: string | undefined;
  let clearingError: string | undefined;
  if (charged.length > 0) {
    const source = await ports.findClearingSource(landings.filter((l) => l.kind === "commits").map((l) => l.landing_commit));
    if (!source.ok) {
      clearingError = loreErrorText(source.error);
    } else if (source.value !== null) {
      const clearing = source.value;
      const stillFailing = new Set(clearing.result.failing_test_files.map((f) => f.file));
      clearingResultId = clearing.result.id;
      cleared = charged.filter((c) => !stillFailing.has(c.file)).map((c) => ({ ...c, cleared_by: clearing.commit }));
      uncleared = charged.filter((c) => stillFailing.has(c.file));
    }
  }

  const rows: MilestoneFactRow[] = outcomes.map((o): MilestoneFactRow => {
    if (o.status === "no-change") return { subject: o.landing, verdict: "pass", detail: "no-change landing: nothing landed on main" };
    if (o.status === "not-measured") return { subject: o.landing, verdict: "not-measured", detail: o.reason };
    const mineUncleared = uncleared.filter((u) => u.landing === o.landing).map((u) => u.file);
    const mineCleared = cleared.filter((c) => c.landing === o.landing);
    const notes = [
      listOf("regression still red", mineUncleared),
      mineCleared.length === 0 ? undefined : `regression cleared: ${mineCleared.map((c) => `${c.file} (cleared by ${c.cleared_by})`).join(", ")}`,
      listOf("red before the landing (not charged)", o.red_before),
      listOf("flaky at the landing (not charged)", o.flaky),
    ].filter((n): n is string => n !== undefined);
    const detail = notes.length > 0 ? notes.join("; ") : `no regression in ${String(o.failing.length)} failing file(s)`;
    return { subject: o.landing, verdict: mineUncleared.length > 0 ? "fail" : "pass", detail };
  });
  for (const slug of unlandedTasks) {
    rows.push({ subject: `unlanded:${slug}`, verdict: "not-measured", detail: `task ${slug} has no landing record, so its changes have no measured diff` });
  }
  if (clearingError !== undefined) {
    rows.push({ subject: "clearing", verdict: "not-measured", detail: `whether the regressions are cleared on main could not be determined: ${clearingError}` });
  }
  if (rows.length === 0) {
    return err({ code: "VALIDATION_ERROR", field: "landings", message: "regression per landing needs at least one landing or unlanded task", rule: "BR-1496" });
  }
  return ok({ landings: outcomes, uncleared, cleared, clearing_result_id: clearingResultId, rows });
}
