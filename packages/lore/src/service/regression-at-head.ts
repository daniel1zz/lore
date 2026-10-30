/**
 * Regression measured at the assessed commit by single-file bisection (BR-1496, spec D1/D2/D6).
 *
 * Purpose: decide which test files main's head has red BECAUSE of a plan. The full suite is read once, at main's head
 *   (`lookupOrRun`, stored per commit, so a second plan at the same head runs nothing); each file red there is confirmed
 *   by one single-file run, then bisected alone over main's first-parent history between the newest commit where it is
 *   known to pass and the head to find the commit where it turned red. Only a transition at one of the plan's landing
 *   commits is the plan's regression.
 * Public surface: regressionAtHead, RegressionLandingInput, RegressionAtHeadPorts, HeadSuitePort, RegressionFinding,
 *   FileRegression, RegressionAtHead, regressionBisectionBudget.
 * Invariants:
 *   - Per red file: (1) confirm at head (a fresh single-file run; green = flaky, never charged); (2) lower bound = the newest
 *     commit in range with a stored pass (a stored single-file pass, or a stored measured suite result not failing the
 *     file), else the first parent of the plan's earliest landing (run once when unstored; absent file = not red); a file
 *     red at the lower bound is red-before, never charged; (3) bisect between lower bound (green) and head (red), the upper
 *     end first narrowed to the oldest stored red above the lower bound, so a second review probes nothing new;
 *     (4) confirm both ends of the found transition once each: it must fail at the first failing commit and pass (or be
 *     absent) at its first parent, else the file is `not-measured` ("flaky during bisection"), never charged by guess;
 *     (5) charged only if the first failing commit is a main commit that brought one of the plan's landings in. A landing no
 *     main commit can be found for makes `not-measured` only a file whose transition falls after that landing's `main_before`
 *     (where it could be); a transition at or before it, or at another commit, is attributed as usual.
 *   - A file absent at a commit counts as not red there (no run), so a test the plan added is charged to the landing that added it.
 *   - A file red at a landing but green at head is never looked at: only the head suite's failing files are examined.
 *   - A step that cannot complete (suite unrunnable, history unreadable, a single-file run erroring or timing out) makes that
 *     file `not-measured` (and the gate not-measured); it is never a pass.
 *   - Every single-file run is stored keyed by (commit, file, kind) (`SuiteResultService.runSingleFile`) and read back before
 *     running; single-file runs per red file are at most {@link regressionBisectionBudget}.
 *   - Fact rows: one for the head suite, one per red file, one per unlanded task. The dimension verdict is their fold (fail > not-measured > pass).
 * Side-effect class: IO through the injected ports only (suite run, single-file runs, store writes via the suite service).
 *
 * Reference: Google TAP / Chromium culprit finder: bisect only the failing targets, confirm the culprit with a re-run.
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-1, BR-1496, D1, D2, D6)
 */

import { err, ok, type LoreError, type MilestoneFactRow, type RegressionNotMeasuredCause, type Result } from "@lore/core";
import type { SuiteFileRunRecord, SuiteResultRecord } from "../store/store-interface.js";
import { noCodeRegressionRow } from "./corpus-only-task.js";
import { loreErrorText, singleFileRunKey, type CommitSuiteRunnerPort, type SingleFileRunKind } from "./suite-result-service.js";

/** One landing of the plan, as `deriveLandingDiffForPlan` reports it. */
export interface RegressionLandingInput {
  readonly landing_commit: string;
  readonly main_before: string;
  readonly task_slugs: readonly string[];
  // reason: no `kind` here on purpose — a landing with main_before == landing_commit has nothing on main; a stored label
  // never decides (BR-1496).
}

/** The slice of `SuiteResultService` this module drives. */
export interface HeadSuitePort {
  readonly lookupOrRun: (ref: string, runner: CommitSuiteRunnerPort) => Promise<Result<SuiteResultRecord, LoreError>>;
  readonly listResults: () => Promise<Result<SuiteResultRecord[], LoreError>>;
  readonly listFileRuns: (key: string) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
  readonly runSingleFile: (commit: string, file: string, kind: SingleFileRunKind, runner: CommitSuiteRunnerPort) => Promise<Result<SuiteFileRunRecord, LoreError>>;
}

/** Everything {@link regressionAtHead} calls out to. */
export interface RegressionAtHeadPorts {
  readonly suites: HeadSuitePort;
  readonly runner: CommitSuiteRunnerPort;
  /** The ref whose suite result is the assessed commit (`main`). */
  readonly headRef: string;
  /** Main's first-parent history up to `ref`, OLDEST FIRST, full shas. */
  readonly firstParentHistory: (ref: string) => Promise<Result<readonly string[], LoreError>>;
  /** Whether `file` exists at `commit` (a file absent there is not red there). */
  readonly fileExistsAt: (commit: string, file: string) => Promise<Result<boolean, LoreError>>;
  /**
   * The OLDEST commit on `ref`'s first-parent history that contains `commit`; `undefined` when `commit` is not below `ref`.
   * A landing whose branch reached main through ANOTHER branch's merge is not itself on the chain, but this commit (that merge) is.
   */
  readonly firstParentCommitContaining: (commit: string, ref: string) => Promise<Result<string | undefined, LoreError>>;
}

/** A file charged to a landing. */
export interface RegressionFinding {
  readonly file: string;
  readonly landing: string;
}

/** What was found for one red file of the head suite. */
export type FileRegression =
  | { readonly file: string; readonly outcome: "regression"; readonly landing: string }
  | { readonly file: string; readonly outcome: "other-commit"; readonly commit: string }
  | { readonly file: string; readonly outcome: "red-before"; readonly commit: string }
  | { readonly file: string; readonly outcome: "flaky" }
  | { readonly file: string; readonly outcome: "no-landing" }
  | { readonly file: string; readonly outcome: "not-measured"; readonly reason: string; readonly cause: RegressionNotMeasuredCause };

/** The measured regression facts of a plan. */
export interface RegressionAtHead {
  /** The assessed commit and its stored suite result; `undefined` when the head suite could not be run. */
  readonly head: { readonly commit: string; readonly result_id: string } | undefined;
  readonly files: readonly FileRegression[];
  /** Files charged to the plan (these fail the gate). */
  readonly charged: readonly RegressionFinding[];
  /** Every stored single-file run read or made, keyed `<file>@<commit>:<kind>`; the review fingerprint hashes them (BR-1497). The head suite's own id is `head.result_id`. */
  readonly single_file_run_ids: readonly { readonly key: string; readonly id: string }[];
  /** Fact rows for `MilestoneFacts.regression`. */
  readonly rows: readonly MilestoneFactRow[];
  /** Distinct `cause` of the not-measured rows, sorted; empty when every row is measured. The batch retries only on `unrunnable`. */
  readonly causes: readonly RegressionNotMeasuredCause[];
}

/** The distinct causes of the not-measured rows, sorted (a structured read: never from a row's prose). */
function causesOf(rows: readonly MilestoneFactRow[]): RegressionNotMeasuredCause[] {
  const causes = new Set<RegressionNotMeasuredCause>();
  for (const row of rows) if (row.verdict === "not-measured" && row.cause !== undefined) causes.add(row.cause);
  return [...causes].sort();
}

/**
 * The most single-file runs one red file may cost: bisection steps plus head, lower bound, found commit and its parent.
 *
 * @param commitsInRange - commits between the lower bound (exclusive) and the head (inclusive)
 */
export function regressionBisectionBudget(commitsInRange: number): number {
  return Math.ceil(Math.log2(Math.max(1, commitsInRange))) + 4;
}

type FileState = "green" | "red";
type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const stop = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const reasonOf = (what: string, error: LoreError): { ok: false; reason: string } => stop(`${what}: ${loreErrorText(error)}`);
const stateOfExit = (exitCode: number): FileState => (exitCode === 0 ? "green" : "red");

/** Reads and runs the state of ONE file across commits; keeps what it consulted for the fingerprint. */
class FileProbe {
  readonly consulted: { key: string; id: string }[] = [];

  constructor(
    readonly file: string,
    private readonly ports: RegressionAtHeadPorts,
    private readonly measuredByCommit: ReadonlyMap<string, SuiteResultRecord>,
  ) {}

  private async storedRun(kind: SingleFileRunKind, commit: string): Promise<Step<SuiteFileRunRecord | undefined>> {
    const rows = await this.ports.suites.listFileRuns(singleFileRunKey(kind, commit));
    if (!rows.ok) return reasonOf(`stored single-file runs at ${commit} could not be read`, rows.error);
    const row = rows.value.filter((r) => r.file === this.file && r.commit_sha === commit).at(-1);
    if (row !== undefined) this.consulted.push({ key: `${this.file}@${commit}:${kind}`, id: `${row.measured_at}#${String(row.exit_code)}` });
    return { ok: true, value: row };
  }

  /** What is stored about the file at `commit` without running anything; `undefined` when nothing is. */
  async known(commit: string): Promise<Step<FileState | undefined>> {
    const stored = await this.storedRun("bisect", commit);
    if (!stored.ok) return stored;
    if (stored.value !== undefined) return { ok: true, value: stateOfExit(stored.value.exit_code) };
    const suite = this.measuredByCommit.get(commit);
    if (suite === undefined) return { ok: true, value: undefined };
    // reason: a measured suite result that does not list the file as failing means it passed or did not exist: not red either way.
    // (The store holds `measured` only for a run whose commands exited 0 or 1, so a run that never ran the tests is not here.)
    return { ok: true, value: suite.failing_test_files.some((f) => f.file === this.file) ? "red" : "green" };
  }

  private async exists(commit: string): Promise<Step<boolean>> {
    const there = await this.ports.fileExistsAt(commit, this.file);
    return there.ok ? { ok: true, value: there.value } : reasonOf(`could not tell whether ${this.file} exists at ${commit}`, there.error);
  }

  /** The state at `commit` for a bisection step: absent = green, else stored knowledge, else one single-file run. */
  async stateAt(commit: string): Promise<Step<FileState>> {
    const there = await this.exists(commit);
    if (!there.ok) return there;
    if (!there.value) return { ok: true, value: "green" };
    const known = await this.known(commit);
    if (!known.ok) return known;
    if (known.value !== undefined) return { ok: true, value: known.value };
    return this.run(commit, "bisect");
  }

  /** The state at `commit` from an INDEPENDENT confirmation run (absent = green; a stored confirmation is reused). */
  async confirmAt(commit: string): Promise<Step<FileState>> {
    const there = await this.exists(commit);
    if (!there.ok) return there;
    if (!there.value) return { ok: true, value: "green" };
    const stored = await this.storedRun("confirm", commit);
    if (!stored.ok) return stored;
    if (stored.value !== undefined) return { ok: true, value: stateOfExit(stored.value.exit_code) };
    return this.run(commit, "confirm");
  }

  private async run(commit: string, kind: SingleFileRunKind): Promise<Step<FileState>> {
    const ran = await this.ports.suites.runSingleFile(commit, this.file, kind, this.ports.runner);
    if (!ran.ok) return reasonOf(`${this.file} could not be run at ${commit}`, ran.error);
    this.consulted.push({ key: `${this.file}@${commit}:${kind}`, id: `${ran.value.measured_at}#${String(ran.value.exit_code)}` });
    return { ok: true, value: stateOfExit(ran.value.exit_code) };
  }
}

/** Measures one red file; never throws. */
async function measureFile(
  file: string,
  history: readonly string[],
  attribution: Attribution,
  probe: FileProbe,
): Promise<FileRegression> {
  const earliestLandingIndex = attribution.earliestIndex;
  // reason: a step that could not complete is `unrunnable` (a retry can complete it); the two other causes are named where they arise.
  const notMeasured = (reason: string, cause: RegressionNotMeasuredCause = "unrunnable"): FileRegression => ({ file, outcome: "not-measured", reason, cause });
  const headIndex = history.length - 1;
  const head = history[headIndex];
  if (head === undefined) return notMeasured("main's first-parent history is empty", "unmappable");

  const confirmedHead = await probe.confirmAt(head);
  if (!confirmedHead.ok) return notMeasured(confirmedHead.reason);
  if (confirmedHead.value === "green") return { file, outcome: "flaky" };

  // Lower bound: the newest commit below the head with a stored pass, searching down to the plan's earliest landing's parent.
  const floorIndex = earliestLandingIndex - 1;
  const knownStates = new Map<number, FileState>();
  for (let index = headIndex - 1; index > floorIndex; index -= 1) {
    const commit = history[index];
    if (commit === undefined) return notMeasured(`history has no commit at position ${String(index)}`);
    const known = await probe.known(commit);
    if (!known.ok) return notMeasured(known.reason);
    if (known.value !== undefined) knownStates.set(index, known.value);
  }
  let low = floorIndex;
  for (let index = headIndex - 1; index > floorIndex; index -= 1) {
    if (knownStates.get(index) === "green") {
      low = index;
      break;
    }
  }
  if (low === floorIndex && floorIndex >= 0) {
    const floorCommit = history[floorIndex];
    if (floorCommit === undefined) return notMeasured(`history has no commit at position ${String(floorIndex)}`);
    const floor = await probe.stateAt(floorCommit);
    if (!floor.ok) return notMeasured(floor.reason);
    if (floor.value === "red") return { file, outcome: "red-before", commit: floorCommit };
  }
  // reason: floorIndex -1 is "before main's first commit": the file cannot exist there, so it is green without a run.

  // Upper end: the oldest stored red above the lower bound (still red, still above), so earlier probes are reused (spec: a second review runs nothing).
  let high = headIndex;
  for (let index = low + 1; index < headIndex; index += 1) {
    if (knownStates.get(index) === "red") {
      high = index;
      break;
    }
  }

  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    const commit = history[middle];
    if (commit === undefined) return notMeasured(`history has no commit at position ${String(middle)}`);
    const state = await probe.stateAt(commit);
    if (!state.ok) return notMeasured(state.reason);
    if (state.value === "red") high = middle;
    else low = middle;
  }

  const first = history[high];
  if (first === undefined) return notMeasured(`history has no commit at position ${String(high)}`);
  const firstConfirm = await probe.confirmAt(first);
  if (!firstConfirm.ok) return notMeasured(firstConfirm.reason);
  const parent = low >= 0 ? history[low] : undefined;
  const parentConfirm = parent === undefined ? ({ ok: true, value: "green" } as const) : await probe.confirmAt(parent);
  if (!parentConfirm.ok) return notMeasured(parentConfirm.reason);
  if (firstConfirm.value !== "red" || parentConfirm.value !== "green") {
    return notMeasured(`flaky during bisection: the confirmation runs disagree with the bisection at ${first} (confirm there: ${firstConfirm.value}; at its parent: ${parentConfirm.value})`, "flaky-bisection");
  }
  if (attribution.chargedCommits.has(first)) return { file, outcome: "regression", landing: first };
  const unmapped = attribution.unmapped;
  if (unmapped !== undefined && high > unmapped.afterIndex) {
    return notMeasured(`red since ${first}, where landing ${unmapped.landing} could have reached main: it is not on main's first-parent history and no main commit containing it was found (${unmapped.reason}), so the transition cannot be attributed`, "unmappable");
  }
  return { file, outcome: "other-commit", commit: first };
}

/** Which main commits are the plan's, and where the plan's unmappable landings could be hiding. */
interface Attribution {
  /** Main first-parent commits that brought a landing commit in (a landing on the chain maps to itself). */
  readonly chargedCommits: ReadonlySet<string>;
  /** Index of the earliest main commit the plan can have changed; the bisection floor is the commit below it. */
  readonly earliestIndex: number;
  /** The unmappable landing that could have landed earliest; a transition after `afterIndex` may be it. */
  readonly unmapped: { readonly landing: string; readonly afterIndex: number; readonly reason: string } | undefined;
}

/** Maps every landing to the main first-parent commit that brought it in; an unmappable one only bounds where it could be. */
async function attributeLandings(real: readonly RegressionLandingInput[], history: readonly string[], ports: RegressionAtHeadPorts): Promise<Attribution> {
  const position = new Map(history.map((commit, index) => [commit, index] as const));
  const chargedCommits = new Set<string>();
  let earliestIndex = Number.MAX_SAFE_INTEGER;
  let unmapped: { landing: string; afterIndex: number; reason: string } | undefined;
  for (const landing of real) {
    const direct = position.get(landing.landing_commit);
    let mapped = direct === undefined ? undefined : landing.landing_commit;
    let reason = "not below main's head";
    if (mapped === undefined) {
      const found = await ports.firstParentCommitContaining(landing.landing_commit, ports.headRef);
      if (!found.ok) reason = loreErrorText(found.error);
      else if (found.value !== undefined && position.has(found.value)) mapped = found.value;
    }
    if (mapped !== undefined) {
      chargedCommits.add(mapped);
      earliestIndex = Math.min(earliestIndex, position.get(mapped) ?? earliestIndex);
      continue;
    }
    // reason: a landing reaches main AFTER the commit main stood at before it, so its transition cannot be at or below that commit.
    const afterIndex = position.get(landing.main_before) ?? -1;
    earliestIndex = Math.min(earliestIndex, afterIndex + 1);
    if (unmapped === undefined || afterIndex < unmapped.afterIndex) unmapped = { landing: landing.landing_commit, afterIndex, reason };
  }
  return { chargedCommits, earliestIndex, unmapped };
}

function rowOfFile(f: FileRegression): MilestoneFactRow {
  switch (f.outcome) {
    case "regression":
      return { subject: f.file, verdict: "fail", detail: `regression: ${f.file} turned red at this plan's landing ${f.landing} and is red at main's head` };
    case "other-commit":
      return { subject: f.file, verdict: "pass", detail: `red at main's head since commit ${f.commit}, which is not one of this plan's landings (not charged)` };
    case "red-before":
      return { subject: f.file, verdict: "pass", detail: `red before the plan's first landing, at ${f.commit} (not charged)` };
    case "flaky":
      return { subject: f.file, verdict: "pass", detail: `red in the head suite but green on the confirm run: flaky (not charged)` };
    case "no-landing":
      return { subject: f.file, verdict: "pass", detail: `red at main's head; the plan has no landing on main, so it is not this plan's (not charged)` };
    case "not-measured":
      return { subject: f.file, verdict: "not-measured", detail: f.reason, cause: f.cause };
  }
}

/**
 * Measures regression for a plan at main's head and decides what the gate charges.
 *
 * @param landings - the plan's landings (one per landing commit)
 * @param unlandedTasks - tasks with no usable landing record (their changes have no measured diff: not-measured)
 * @param ports - the head suite, single-file runs, history and file existence
 * @param noCodeTasks - corpus-only tasks (BR-1509): they add no row; with no landing and no unlanded task they make the dimension `na`
 * @returns the per-file outcomes, the charged files and the fact rows; `err` only when there is nothing to say (no landing, no task)
 */
export async function regressionAtHead(
  landings: readonly RegressionLandingInput[],
  unlandedTasks: readonly string[],
  ports: RegressionAtHeadPorts,
  noCodeTasks: readonly string[] = [],
): Promise<Result<RegressionAtHead, LoreError>> {
  const real = landings.filter((l) => l.main_before !== l.landing_commit);
  // reason: BR-1509 — when every task is corpus-only no task changes code: nothing to bisect and no suite to run; the
  // regression dimension is `na`, never pass. A corpus-only task beside landed or unlanded tasks contributes nothing.
  if (landings.length === 0 && unlandedTasks.length === 0 && noCodeTasks.length > 0) {
    return ok({ head: undefined, files: [], charged: [], single_file_run_ids: [], rows: [noCodeRegressionRow(noCodeTasks)], causes: [] });
  }
  if (landings.length === 0 && unlandedTasks.length === 0) {
    return err({ code: "VALIDATION_ERROR", field: "landings", message: "regression at head needs at least one landing or unlanded task", rule: "BR-1496" });
  }
  const unlandedRows: MilestoneFactRow[] = unlandedTasks.map((slug) => ({
    subject: `unlanded:${slug}`,
    verdict: "not-measured",
    detail: `task ${slug} has no landing record, so its changes have no measured diff`,
    cause: "unlanded",
  }));

  const looked = await ports.suites.lookupOrRun(ports.headRef, ports.runner);
  if (!looked.ok) {
    const row: MilestoneFactRow = { subject: ports.headRef, verdict: "not-measured", detail: `the suite could not be run at ${ports.headRef}: ${loreErrorText(looked.error)}`, cause: "unrunnable" };
    const rows = [row, ...unlandedRows];
    return ok({ head: undefined, files: [], charged: [], single_file_run_ids: [], rows, causes: causesOf(rows) });
  }
  const suite = looked.value;
  if (suite.status !== "measured") {
    // reason: an unrunnable attempt is a stored row too (new id per attempt), so its id is part of the facts fingerprint (BR-1497).
    const row: MilestoneFactRow = { subject: suite.commit_sha, verdict: "not-measured", detail: `the suite could not run at ${suite.commit_sha}: ${suite.cause ?? "unrunnable"}`, cause: "unrunnable" };
    const rows = [row, ...unlandedRows];
    return ok({ head: { commit: suite.commit_sha, result_id: suite.id }, files: [], charged: [], single_file_run_ids: [], rows, causes: causesOf(rows) });
  }
  const head = { commit: suite.commit_sha, result_id: suite.id };
  const redFiles = [...new Set(suite.failing_test_files.map((f) => f.file))].sort();
  const singleFileRunIds: { key: string; id: string }[] = [];
  const headRow: MilestoneFactRow = {
    subject: head.commit,
    verdict: "pass",
    detail: redFiles.length === 0 ? `the suite is green at main's head ${head.commit}` : `${String(redFiles.length)} red file(s) at main's head ${head.commit}, each examined below`,
  };
  if (redFiles.length === 0) {
    const rows = [headRow, ...unlandedRows];
    return ok({ head, files: [], charged: [], single_file_run_ids: singleFileRunIds, rows, causes: causesOf(rows) });
  }

  const files: FileRegression[] = [];
  if (real.length === 0) {
    // reason: a plan with no landing on main changed nothing there; nothing red at head can be its regression, and no bisection is needed.
    for (const file of redFiles) files.push({ file, outcome: "no-landing" });
  } else {
    const historyResult = await ports.firstParentHistory(head.commit);
    const stopAll = (reason: string): void => {
      for (const file of redFiles) files.push({ file, outcome: "not-measured", reason, cause: "unrunnable" });
    };
    if (!historyResult.ok) {
      stopAll(`main's first-parent history could not be read: ${loreErrorText(historyResult.error)}`);
    } else {
      const history = historyResult.value;
      const results = await ports.suites.listResults();
      if (!results.ok) {
        stopAll(`stored suite results could not be read: ${loreErrorText(results.error)}`);
      } else {
        const measuredByCommit = new Map<string, SuiteResultRecord>();
        for (const r of results.value) if (r.status === "measured") measuredByCommit.set(r.commit_sha, r);
        const attribution = await attributeLandings(real, history, ports);
        for (const file of redFiles) {
          const probe = new FileProbe(file, ports, measuredByCommit);
          files.push(await measureFile(file, history, attribution, probe));
          singleFileRunIds.push(...probe.consulted);
        }
      }
    }
  }
  const charged = files.flatMap((f): RegressionFinding[] => (f.outcome === "regression" ? [{ file: f.file, landing: f.landing }] : []));
  const rows = [headRow, ...files.map(rowOfFile), ...unlandedRows];
  return ok({ head, files, charged, single_file_run_ids: singleFileRunIds, rows, causes: causesOf(rows) });
}
