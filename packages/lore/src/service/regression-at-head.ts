/**
 * Regression measured on the selector's tests for a plan's changed paths at the commit holding its last landing, then attributed
 * by batched bisection (BR-1496, BR-1497; spec `spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach` "Selection at close",
 * "Accounting"; attribution as `spec-a-plan-s-regression-reuses-a-stored-suite-that-contains` D1-D3).
 *
 * Purpose: decide which test files main has red BECAUSE of a plan, without ever running the full suite. The selection (the
 *   selector's tests for the union of the landings' changed paths, read from L's tree) runs at L in chunks (`selection-run-at-l.ts`);
 *   files red at L are rechecked at main's head in one batched run; the files still red are bisected TOGETHER, one batched
 *   invocation per probed commit, and each charge rests on single-file runs. Only a transition at one of the plan's landing
 *   commits is the plan's regression. A test file the selection did not name is never run and never charged.
 * Public surface: regressionAtHead, RegressionLandingInput, RegressionAtHeadPorts, HeadSuitePort, TestSelection, TestSelectionPort,
 *   RegressionFinding, FileRegression, RegressionAtHead, regressionBisectionBudget.
 * Invariants:
 *   - L: the main first-parent commit that contains the plan's LATEST landing (`firstParentCommitContaining` for a landing
 *     off the chain). A landing no main commit can be found for makes regression `not-measured` (`unmappable`): L would not
 *     contain it.
 *   - Selection accounting: an unparseable test file makes regression `not-measured` and is named; an empty selection is `na`
 *     with "no test reaches this plan's changes", never `pass`; a test the plan removed, an alias import resolving to nothing and a
 *     changed path in no tree are named in the stored accounting and change no verdict. The accounting text rides the
 *     selection row ("regression measured on N selected test files of M (selector accounting stored)").
 *   - Selected files without a stored result at L run in chunks that fit the time limit (`test:file` routes Bun and Node files itself),
 *     each chunk stored per (L, file) with kind `batch` when it ends; a selection holding a declared-spawn test builds first. A later
 *     review or a retry reuses the stored rows and runs only the files without one. Regression is `not-measured` while any selected
 *     file has no result, naming how many of N remain (#568).
 *   - Head recheck (L is not head): every file red at L is run in ONE batched invocation at head; a file green there is run
 *     once alone at head before it is dropped; green alone = `green-at-head` (not looked at), red alone stays.
 *   - Per remaining file: upper bound = L (the file was red there); lower bound = the plan's earliest landing's first parent, or a
 *     newer commit with a stored SINGLE-FILE pass (or a measured suite not failing the file); the floor is decided by a single-file run (red = red-before,
 *     never charged). A stored `batch` row is only used as the result of a search step at a probed commit, never as the floor,
 *     a confirmation or an interval start.
 *   - Search: each round probes the midpoint of every unresolved file's interval; one batched invocation per distinct midpoint
 *     commit, holding every unresolved file whose interval strictly contains that commit and has no stored result there.
 *   - Confirmation: both ends of a found transition are re-run once each, each file ALONE (kind `confirm`); a disagreement
 *     (red in a batch but green alone, or red alone at the parent) is `not-measured` (`flaky-bisection`), never charged.
 *   - A file absent at a commit counts as not red there (no run), so a test the plan added is charged to the landing that added it.
 *   - A step that cannot complete (history unreadable, a run erroring or timing out) makes that file `not-measured` (and the
 *     gate not-measured); it is never a pass.
 *   - Timeouts are inconclusive (BR-1533): at each (commit, file, kind) the NEWEST CONCLUSIVE stored run decides (`decidingRun`); a run
 *     that only timed out decides nothing, is not retried within this review, and leaves the file `not-measured` with cause `timeout`
 *     (named, never charged, never a confirmation); the next review runs the point again.
 *   - Fact rows: one selection row, one per red file, one per unlanded task. The dimension verdict is their fold (fail > not-measured > pass).
 *   - The review fingerprint hashes the stored run ids the verdict used (the selection's rows at L, the head recheck's rows, the
 *     floor, bisect and confirm runs); search-step batch rows are not hashed, they decide nothing.
 * Side-effect class: IO through the injected ports only (selection, batched and single-file runs, store writes via the suite service).
 *
 * Reference: Google TAP / Chromium culprit finder: bisect the failing targets together over one build per revision, confirm the culprit alone.
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (AC-SC-3, AC-SC-4, BR-1496, BR-1497)
 */

import { err, ok, type LoreError, type MilestoneFactRow, type RegressionNotMeasuredCause, type Result } from "@lore/core";
import type { SuiteFileRunRecord, SuiteResultRecord } from "../store/store-interface.js";
import { noCodeRegressionRow } from "./corpus-only-task.js";
import { runSelectionAtL } from "./selection-run-at-l.js";
import { decidingRun, loreErrorText, singleFileRunKey, type CommitSuiteRunnerPort, type RunBatchOptions, type SingleFileRunKind } from "./suite-result-service.js";

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
  /** Stored suite results (what an earlier measurement knows about a commit); never run here. */
  readonly listResults: () => Promise<Result<SuiteResultRecord[], LoreError>>;
  readonly listFileRuns: (key: string) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
  readonly runSingleFile: (commit: string, file: string, kind: SingleFileRunKind, runner: CommitSuiteRunnerPort) => Promise<Result<SuiteFileRunRecord, LoreError>>;
  /** Runs the files together at a commit in ONE invocation, stored per (commit, file) with kind `batch`; one row per file, in the order given. */
  readonly runBatch: (commit: string, files: readonly string[], runner: CommitSuiteRunnerPort, options?: RunBatchOptions) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
}

/**
 * What the selector chose at the selection commit, as the service reads it (the adapter fills it from `scripts/changed-tests.ts`
 * `selectForCommit`; the service never imports a script).
 */
export interface TestSelection {
  /** The commit sha the selection was computed at (L). */
  readonly commit: string;
  /** The selected test files, sorted; `needsCompiledBinary` = the test declares `@spawns dist/lore`. */
  readonly selected: readonly { readonly path: string; readonly needsCompiledBinary: boolean }[];
  /** Every test file in the selector's universe at L (the M of "N selected test files of M"). */
  readonly totalTestFiles: number;
  /** Test files at L whose declaration block could not be parsed. */
  readonly unparseable: readonly { readonly path: string; readonly message: string }[];
  /** Selected through a parent tree and absent at L: the plan removed them; named, not run. */
  readonly removedTests: readonly { readonly path: string }[];
  /** The selector's own accounting text (per-runner counts, a reason per file, what it could not see); stored on the selection row. */
  readonly accounting: string;
}

/** Selects the tests the landings' changed paths reach, from L's tree (git objects, never the working tree). */
export type TestSelectionPort = (input: { readonly commit: string; readonly landingCommits: readonly string[] }) => Promise<Result<TestSelection, LoreError>>;

/** Everything {@link regressionAtHead} calls out to. */
export interface RegressionAtHeadPorts {
  readonly suites: HeadSuitePort;
  /** The selector's tests for the landings' changed paths, at a commit. */
  readonly selectTests: TestSelectionPort;
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

/** What was found for one file red at the selection commit. */
export type FileRegression =
  | { readonly file: string; readonly outcome: "regression"; readonly landing: string }
  | { readonly file: string; readonly outcome: "other-commit"; readonly commit: string }
  | { readonly file: string; readonly outcome: "red-before"; readonly commit: string }
  | { readonly file: string; readonly outcome: "green-at-head"; readonly commit: string }
  | { readonly file: string; readonly outcome: "not-measured"; readonly reason: string; readonly cause: RegressionNotMeasuredCause };

/** The measured regression facts of a plan. */
export interface RegressionAtHead {
  /** Main's head as this measurement resolved it (the head recheck's commit); `undefined` when no landing was measured. */
  readonly assessed_commit: string | undefined;
  /** The selection commit L and the counts the output states; `undefined` when no selection was made. */
  readonly selection: { readonly commit: string; readonly selected: number; readonly total: number } | undefined;
  readonly files: readonly FileRegression[];
  /** Files charged to the plan (these fail the gate). */
  readonly charged: readonly RegressionFinding[];
  /** Every stored run the verdict read or made, keyed `<file>@<commit>:<kind>`; the review fingerprint hashes them (BR-1497). */
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
 * The most single-file runs one red file may cost when bisected ALONE: bisection steps plus head, lower bound, found commit and its parent.
 * (The batched search shares the steps; the bound stays as the per-file reference the batched cost is compared with.)
 *
 * @param commitsInRange - commits between the lower bound (exclusive) and the head (inclusive)
 */
export function regressionBisectionBudget(commitsInRange: number): number {
  return Math.ceil(Math.log2(Math.max(1, commitsInRange))) + 4;
}

/** The reason of a `na` regression whose selection is empty (spec "Accounting"; AC-SC-4 asserts this text). */
const NO_TEST_REACHES = "no test reaches this plan's changes";

type FileState = "green" | "red";
/** A step that could not complete names why and, when it is not the default `unrunnable`, its cause (`timeout`: only inconclusive runs, BR-1533). */
type StepStop = { readonly ok: false; readonly reason: string; readonly cause?: RegressionNotMeasuredCause };
type Step<T> = { readonly ok: true; readonly value: T } | StepStop;

const stop = (reason: string, cause?: RegressionNotMeasuredCause): StepStop => (cause === undefined ? { ok: false, reason } : { ok: false, reason, cause });
const reasonOf = (what: string, error: LoreError): StepStop => stop(`${what}: ${loreErrorText(error)}`);
/**
 * The stop of a run that decided nothing at its point (BR-1533): it only timed out, or wrote no readable outcome report. The file is not
 * measured (cause `timeout` or `no-report`, named), never charged.
 */
const inconclusiveStop = (file: string, commit: string, kind: string, row?: { readonly inconclusive_cause: string | null }): StepStop => {
  const cause = row?.inconclusive_cause === "no-report" ? "no-report" : "timeout";
  const why = cause === "no-report" ? "its run wrote no readable outcome report" : "its run ended only in test or hook timeouts";
  return stop(`${file} has no conclusive ${kind} run at ${commit}: ${why} (inconclusive, not charged; the next review runs it again)`, cause);
};
/** The state a CONCLUSIVE stored row shows; an inconclusive row is never passed here (callers filter with `decidingRun` or check first). */
const stateOfRow = (row: SuiteFileRunRecord): FileState => (row.classification === "red" ? "red" : "green");
const runIdOf = (row: SuiteFileRunRecord): string => `${row.measured_at}#${String(row.exit_code)}`;

/** Reads and runs the state of ONE file across commits; keeps what it consulted for the fingerprint. */
class FileProbe {
  readonly consulted: { key: string; id: string }[] = [];

  constructor(
    readonly file: string,
    private readonly ports: RegressionAtHeadPorts,
    private readonly measuredByCommit: ReadonlyMap<string, SuiteResultRecord>,
  ) {}

  private async storedRun(kind: SingleFileRunKind | "batch", commit: string): Promise<Step<SuiteFileRunRecord | undefined>> {
    const rows = await this.ports.suites.listFileRuns(singleFileRunKey(kind, commit));
    if (!rows.ok) return reasonOf(`stored ${kind} runs at ${commit} could not be read`, rows.error);
    // reason: BR-1533 — the NEWEST CONCLUSIVE run at the point decides; an inconclusive run (newer or not) is no result and never overrides one.
    return { ok: true, value: decidingRun(rows.value.filter((r) => r.file === this.file && r.commit_sha === commit)) };
  }

  /**
   * What is stored about the file at `commit` as a SINGLE-FILE fact (a stored bisect run, or a measured suite) without running
   * anything; `undefined` when nothing is. A batch row is NOT read here: it never starts an interval (spec, BR-1496).
   */
  async known(commit: string): Promise<Step<FileState | undefined>> {
    const stored = await this.storedRun("bisect", commit);
    if (!stored.ok) return stored;
    if (stored.value !== undefined) {
      this.consulted.push({ key: `${this.file}@${commit}:bisect`, id: runIdOf(stored.value) });
      return { ok: true, value: stateOfRow(stored.value) };
    }
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

  /** The state at `commit` for a single-file decision: absent = green, else stored single-file knowledge, else one single-file run. */
  async stateAt(commit: string): Promise<Step<FileState>> {
    const there = await this.exists(commit);
    if (!there.ok) return there;
    if (!there.value) return { ok: true, value: "green" };
    const known = await this.known(commit);
    if (!known.ok) return known;
    if (known.value !== undefined) return { ok: true, value: known.value };
    return this.run(commit, "bisect");
  }

  /**
   * The state at `commit` for a SEARCH step without running anything: absent = green, stored single-file knowledge, else a
   * stored batch result (only a search step may use it); `undefined` when the step needs a run.
   */
  async peekStep(commit: string): Promise<Step<FileState | undefined>> {
    const there = await this.exists(commit);
    if (!there.ok) return there;
    if (!there.value) return { ok: true, value: "green" };
    const known = await this.known(commit);
    if (!known.ok) return known;
    if (known.value !== undefined) return known;
    const batch = await this.storedRun("batch", commit);
    if (!batch.ok) return batch;
    return { ok: true, value: batch.value === undefined ? undefined : stateOfRow(batch.value) };
  }

  /** Whether the file exists at `commit` (a batch leaves an absent file out). */
  existsAt(commit: string): Promise<Step<boolean>> {
    return this.exists(commit);
  }

  /** The state at `commit` from an INDEPENDENT confirmation run, ALONE (absent = green; a stored confirmation is reused). */
  async confirmAt(commit: string): Promise<Step<FileState>> {
    const there = await this.exists(commit);
    if (!there.ok) return there;
    if (!there.value) return { ok: true, value: "green" };
    const stored = await this.storedRun("confirm", commit);
    if (!stored.ok) return stored;
    if (stored.value !== undefined) {
      this.consulted.push({ key: `${this.file}@${commit}:confirm`, id: runIdOf(stored.value) });
      return { ok: true, value: stateOfRow(stored.value) };
    }
    return this.run(commit, "confirm");
  }

  private async run(commit: string, kind: SingleFileRunKind): Promise<Step<FileState>> {
    const ran = await this.ports.suites.runSingleFile(commit, this.file, kind, this.ports.runner);
    if (!ran.ok) return reasonOf(`${this.file} could not be run at ${commit}`, ran.error);
    // reason: BR-1533 — one run per point per review: an inconclusive run is not retried here; the file is not measured and the next review runs the point again.
    if (ran.value.classification === "inconclusive") return inconclusiveStop(this.file, commit, kind, ran.value);
    this.consulted.push({ key: `${this.file}@${commit}:${kind}`, id: runIdOf(ran.value) });
    return { ok: true, value: stateOfRow(ran.value) };
  }
}

/** Which main commits are the plan's, and where the plan's unmappable landings could be hiding. */
interface Attribution {
  /** Main first-parent commits that brought a landing commit in (a landing on the chain maps to itself). */
  readonly chargedCommits: ReadonlySet<string>;
  /** Index of the earliest main commit the plan can have changed; the bisection floor is the commit below it. */
  readonly earliestIndex: number;
  /** Index of the latest main commit that brought a landing in: the selection commit L sits there. */
  readonly latestIndex: number;
  /** The first landing no main commit could be found for, with why; L cannot be shown to contain it. */
  readonly unmapped: { readonly landing: string; readonly reason: string } | undefined;
}

/** Maps every landing to the main first-parent commit that brought it in; an unmappable one only bounds where it could be. */
async function attributeLandings(real: readonly RegressionLandingInput[], history: readonly string[], ports: RegressionAtHeadPorts): Promise<Attribution> {
  const position = new Map(history.map((commit, index) => [commit, index] as const));
  const chargedCommits = new Set<string>();
  let earliestIndex = Number.MAX_SAFE_INTEGER;
  let latestIndex = -1;
  let unmapped: { landing: string; reason: string } | undefined;
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
      const index = position.get(mapped) ?? earliestIndex;
      earliestIndex = Math.min(earliestIndex, index);
      latestIndex = Math.max(latestIndex, index);
      continue;
    }
    // reason: a landing no main commit contains has no selection commit: L would not hold it, so the selection cannot be made (not-measured, never a guess).
    unmapped ??= { landing: landing.landing_commit, reason };
  }
  return { chargedCommits, earliestIndex, latestIndex, unmapped };
}

/** One red file's search interval: `low` is known green, `high` is known red (history positions). */
interface Active {
  readonly file: string;
  readonly probe: FileProbe;
  low: number;
  high: number;
  failed: boolean;
}

interface AttributionInput {
  readonly redFiles: readonly string[];
  readonly history: readonly string[];
  readonly attribution: Attribution;
  readonly measuredByCommit: ReadonlyMap<string, SuiteResultRecord>;
  /** Whether M is older than main's head: the head recheck runs. */
  readonly recheck: boolean;
  readonly ports: RegressionAtHeadPorts;
}

/** Attributes the files red at M: head recheck, red-before decision, batched search, single-file confirmation. */
async function attributeRedFiles(input: AttributionInput): Promise<{ files: FileRegression[]; consulted: { key: string; id: string }[] }> {
  const { history, attribution, ports } = input;
  const headIndex = history.length - 1;
  const headCommit = history[headIndex];
  const outcomes = new Map<string, FileRegression>();
  const probes = new Map(input.redFiles.map((file) => [file, new FileProbe(file, ports, input.measuredByCommit)] as const));
  // reason: `probes` holds one probe for every name in `redFiles` and every caller passes one of them, so the lookup cannot miss.
  const probeOf = (file: string): FileProbe => probes.get(file) as FileProbe;
  // reason: a step that could not complete is `unrunnable` (a retry can complete it); the two other causes are named where they arise.
  const notMeasured = (file: string, reason: string, cause: RegressionNotMeasuredCause = "unrunnable"): void => {
    outcomes.set(file, { file, outcome: "not-measured", reason, cause });
  };
  const collect = (): { files: FileRegression[]; consulted: { key: string; id: string }[] } => ({
    files: input.redFiles.flatMap((file) => {
      const outcome = outcomes.get(file);
      return outcome === undefined ? [] : [outcome];
    }),
    consulted: [...probes.values()].flatMap((probe) => probe.consulted),
  });
  if (headCommit === undefined) {
    for (const file of input.redFiles) notMeasured(file, "main's first-parent history is empty", "unmappable");
    return collect();
  }

  let stillRed = [...input.redFiles];
  if (input.recheck) stillRed = await recheckAtHead(stillRed, headCommit, probeOf, outcomes, notMeasured, ports);

  const actives: Active[] = [];
  for (const file of stillRed) {
    // reason: the file is red at L (that is how it got here), so its first red commit is at or below L: L is the interval's known-red
    // end. Searching up to head instead would let a flip between L and head read as the transition and cost runs above L for nothing.
    const bounds = await initialBounds(probeOf(file), history, attribution.latestIndex, attribution);
    if (bounds.kind === "settled") outcomes.set(file, bounds.outcome);
    else if (bounds.kind === "stop") notMeasured(file, bounds.reason, bounds.cause);
    else actives.push({ file, probe: probeOf(file), low: bounds.low, high: bounds.high, failed: false });
  }

  await searchTogether(actives, history, ports, notMeasured);

  for (const active of actives) {
    if (active.failed) continue;
    outcomes.set(active.file, await decideFile(active, history, attribution));
  }
  return collect();
}

/**
 * The head recheck: one batched run of every file red at M at main's head; a file green there is run once alone before it is dropped.
 * Returns the files still red at head; the others have their outcome set.
 */
async function recheckAtHead(
  files: readonly string[],
  headCommit: string,
  probeOf: (file: string) => FileProbe,
  outcomes: Map<string, FileRegression>,
  notMeasured: (file: string, reason: string, cause?: RegressionNotMeasuredCause) => void,
  ports: RegressionAtHeadPorts,
): Promise<string[]> {
  const present: string[] = [];
  for (const file of files) {
    const there = await probeOf(file).existsAt(headCommit);
    if (!there.ok) notMeasured(file, there.reason, there.cause);
    else if (!there.value) outcomes.set(file, { file, outcome: "green-at-head", commit: headCommit });
    else present.push(file);
  }
  if (present.length === 0) return [];
  const batch = await ports.suites.runBatch(headCommit, present, ports.runner);
  if (!batch.ok) {
    for (const file of present) notMeasured(file, `the head recheck of the files red at the suite could not run at ${headCommit}: ${loreErrorText(batch.error)}`);
    return [];
  }
  const red: string[] = [];
  for (const [index, file] of present.entries()) {
    const row = batch.value[index];
    if (row === undefined) {
      notMeasured(file, `the head recheck returned no row for ${file} at ${headCommit}`);
      continue;
    }
    // reason: BR-1533 — a file whose recheck run only timed out has no state at head: not measured, never dropped as green and never kept as red.
    if (row.classification === "inconclusive") {
      const stopped = inconclusiveStop(file, headCommit, "head recheck", row);
      notMeasured(file, stopped.reason, stopped.cause);
      continue;
    }
    const probe = probeOf(file);
    probe.consulted.push({ key: `${file}@${headCommit}:batch`, id: runIdOf(row) });
    if (stateOfRow(row) === "red") {
      red.push(file);
      continue;
    }
    // reason: green beside other files does not prove green alone: interference can hide a failure as well as cause one, so the file is
    // run once alone before it is dropped (spec: Final state still decides).
    const alone = await probe.stateAt(headCommit);
    if (!alone.ok) notMeasured(file, alone.reason, alone.cause);
    else if (alone.value === "red") red.push(file);
    else outcomes.set(file, { file, outcome: "green-at-head", commit: headCommit });
  }
  return red;
}

type Bounds =
  | { readonly kind: "active"; readonly low: number; readonly high: number }
  | { readonly kind: "settled"; readonly outcome: FileRegression }
  | { readonly kind: "stop"; readonly reason: string; readonly cause?: RegressionNotMeasuredCause };

/**
 * The interval of one file: known-green start (newest stored single-file pass, else the floor decided by a single-file run) to the
 * oldest known red, which is at most `redIndex` (the selection commit L: the file was red there).
 */
async function initialBounds(probe: FileProbe, history: readonly string[], redIndex: number, attribution: Attribution): Promise<Bounds> {
  const floorIndex = attribution.earliestIndex - 1;
  const knownStates = new Map<number, FileState>();
  for (let index = redIndex - 1; index > floorIndex; index -= 1) {
    const commit = history[index];
    if (commit === undefined) return { kind: "stop", reason: `history has no commit at position ${String(index)}` };
    const known = await probe.known(commit);
    if (!known.ok) return { kind: "stop", reason: known.reason };
    if (known.value !== undefined) knownStates.set(index, known.value);
  }
  let low = floorIndex;
  for (let index = redIndex - 1; index > floorIndex; index -= 1) {
    if (knownStates.get(index) === "green") {
      low = index;
      break;
    }
  }
  if (low === floorIndex && floorIndex >= 0) {
    const floorCommit = history[floorIndex];
    if (floorCommit === undefined) return { kind: "stop", reason: `history has no commit at position ${String(floorIndex)}` };
    const floor = await probe.stateAt(floorCommit);
    if (!floor.ok) return floor.cause === undefined ? { kind: "stop", reason: floor.reason } : { kind: "stop", reason: floor.reason, cause: floor.cause };
    if (floor.value === "red") return { kind: "settled", outcome: { file: probe.file, outcome: "red-before", commit: floorCommit } };
  }
  // reason: floorIndex -1 is "before main's first commit": the file cannot exist there, so it is green without a run.
  let high = redIndex;
  for (let index = low + 1; index < redIndex; index += 1) {
    if (knownStates.get(index) === "red") {
      high = index;
      break;
    }
  }
  return { kind: "active", low, high };
}

/**
 * The batched search: each round probes the midpoint of every unresolved file's interval, one batched invocation per distinct
 * midpoint commit holding every unresolved file whose interval strictly contains it and has no stored result there. A file's
 * step that is already stored (single-file or batch) is used without a run.
 */
async function searchTogether(
  actives: readonly Active[],
  history: readonly string[],
  ports: RegressionAtHeadPorts,
  notMeasured: (file: string, reason: string, cause?: RegressionNotMeasuredCause) => void,
): Promise<void> {
  const fail = (active: Active, reason: string, cause?: RegressionNotMeasuredCause): void => {
    active.failed = true;
    notMeasured(active.file, reason, cause);
  };
  const apply = (active: Active, index: number, state: FileState): void => {
    if (state === "red") active.high = index;
    else active.low = index;
  };
  const searching = (): Active[] => actives.filter((a) => !a.failed && a.high - a.low > 1);
  for (;;) {
    const needing = new Set<number>();
    for (const active of searching()) {
      while (!active.failed && active.high - active.low > 1) {
        const middle = active.low + Math.floor((active.high - active.low) / 2);
        const commit = history[middle];
        if (commit === undefined) {
          fail(active, `history has no commit at position ${String(middle)}`);
          break;
        }
        const step = await active.probe.peekStep(commit);
        if (!step.ok) {
          fail(active, step.reason, step.cause);
          break;
        }
        if (step.value === undefined) {
          needing.add(middle);
          break;
        }
        apply(active, middle, step.value);
      }
    }
    if (needing.size === 0) return;
    for (const index of [...needing].sort((a, b) => a - b)) {
      const commit = history[index];
      if (commit === undefined) continue;
      const members: Active[] = [];
      for (const active of searching()) {
        if (!(active.low < index && index < active.high)) continue;
        const step = await active.probe.peekStep(commit);
        if (!step.ok) fail(active, step.reason, step.cause);
        else if (step.value === undefined) members.push(active);
        else apply(active, index, step.value);
      }
      if (members.length === 0) continue;
      const ran = await ports.suites.runBatch(commit, members.map((m) => m.file), ports.runner);
      if (!ran.ok) {
        for (const member of members) fail(member, `the batched run at ${commit} could not complete: ${loreErrorText(ran.error)}`);
        continue;
      }
      for (const [position, member] of members.entries()) {
        const row = ran.value[position];
        if (row === undefined) fail(member, `the batched run at ${commit} returned no row for ${member.file}`);
        // reason: BR-1533 — a step that only timed out is no step: the file is not measured (cause timeout) and is not retried within this review.
        else if (row.classification === "inconclusive") {
          const stopped = inconclusiveStop(member.file, commit, "batched", row);
          fail(member, stopped.reason, stopped.cause);
        } else apply(member, index, stateOfRow(row));
      }
    }
  }
}

/** Confirms both ends of one file's found transition ALONE and decides the charge. */
async function decideFile(active: Active, history: readonly string[], attribution: Attribution): Promise<FileRegression> {
  const { file, probe, low, high } = active;
  const notMeasured = (reason: string, cause: RegressionNotMeasuredCause = "unrunnable"): FileRegression => ({ file, outcome: "not-measured", reason, cause });
  const first = history[high];
  if (first === undefined) return notMeasured(`history has no commit at position ${String(high)}`);
  const firstConfirm = await probe.confirmAt(first);
  if (!firstConfirm.ok) return notMeasured(firstConfirm.reason, firstConfirm.cause);
  const parent = low >= 0 ? history[low] : undefined;
  const parentConfirm = parent === undefined ? ({ ok: true, value: "green" } as const) : await probe.confirmAt(parent);
  if (!parentConfirm.ok) return notMeasured(parentConfirm.reason, parentConfirm.cause);
  if (firstConfirm.value !== "red" || parentConfirm.value !== "green") {
    return notMeasured(`flaky during bisection: the confirmation runs disagree with the bisection at ${first} (confirm there alone: ${firstConfirm.value}; at its parent alone: ${parentConfirm.value})`, "flaky-bisection");
  }
  if (attribution.chargedCommits.has(first)) return { file, outcome: "regression", landing: first };
  // reason: every landing is mapped here (an unmapped one stops the measurement before any run), so a transition at a commit that is not a landing's is another commit's.
  return { file, outcome: "other-commit", commit: first };
}

function rowOfFile(f: FileRegression): MilestoneFactRow {
  switch (f.outcome) {
    case "regression":
      return { subject: f.file, verdict: "fail", detail: `regression: ${f.file} turned red at this plan's landing ${f.landing} and is red at main's head` };
    case "other-commit":
      return { subject: f.file, verdict: "pass", detail: `red at main's head since commit ${f.commit}, which is not one of this plan's landings (not charged)` };
    case "red-before":
      return { subject: f.file, verdict: "pass", detail: `red before the plan's first landing, at ${f.commit} (not charged)` };
    case "green-at-head":
      return { subject: f.file, verdict: "pass", detail: `red at the selection commit but green at main's head ${f.commit} (alone as well): the final state is green (not charged)` };
    case "not-measured":
      return { subject: f.file, verdict: "not-measured", detail: f.reason, cause: f.cause };
  }
}

/**
 * Measures regression for a plan on the selector's tests at the commit holding its last landing and decides what the gate charges.
 * Runs no full suite on any path.
 *
 * @param landings - the plan's landings (one per landing commit)
 * @param unlandedTasks - tasks with no usable landing record (their changes have no measured diff: not-measured)
 * @param ports - the suite store, runs, history and file existence
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
    return ok({ assessed_commit: undefined, selection: undefined, files: [], charged: [], single_file_run_ids: [], rows: [noCodeRegressionRow(noCodeTasks)], causes: [] });
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
  const unmeasured = (subject: string, detail: string, cause: RegressionNotMeasuredCause = "unrunnable"): Result<RegressionAtHead, LoreError> => {
    const rows: MilestoneFactRow[] = [{ subject, verdict: "not-measured", detail, cause }, ...unlandedRows];
    return ok({ assessed_commit: undefined, selection: undefined, files: [], charged: [], single_file_run_ids: [], rows, causes: causesOf(rows) });
  };
  /** A verdict with no selection to run: `na`, with the reason (never `pass`). */
  const nothingToRun = (subject: string, detail: string, selection: RegressionAtHead["selection"], assessed: string | undefined): Result<RegressionAtHead, LoreError> => {
    const rows: MilestoneFactRow[] = [{ subject, verdict: "na", detail }, ...unlandedRows];
    return ok({ assessed_commit: assessed, selection, files: [], charged: [], single_file_run_ids: [], rows, causes: causesOf(rows) });
  };

  // reason: a plan with no landing on main changed nothing there, so no test reaches its changes (spec "Accounting": empty selection = na).
  if (real.length === 0) {
    if (unlandedTasks.length > 0) return ok({ assessed_commit: undefined, selection: undefined, files: [], charged: [], single_file_run_ids: [], rows: unlandedRows, causes: causesOf(unlandedRows) });
    return nothingToRun("selection", `${NO_TEST_REACHES}: the plan has no landing on main`, undefined, undefined);
  }

  const resolvedHead = await ports.runner.resolveCommit(ports.headRef);
  if (!resolvedHead.ok) return unmeasured(ports.headRef, `main's head could not be resolved: ${loreErrorText(resolvedHead.error)}`);
  const headCommit = resolvedHead.value.commit;
  const historyResult = await ports.firstParentHistory(headCommit);
  if (!historyResult.ok) return unmeasured(headCommit, `main's first-parent history could not be read: ${loreErrorText(historyResult.error)}`, "unmappable");
  const history = historyResult.value;
  const attribution = await attributeLandings(real, history, ports);
  if (attribution.unmapped !== undefined) {
    return unmeasured(
      attribution.unmapped.landing,
      `landing ${attribution.unmapped.landing} is not on main's first-parent history and no main commit containing it was found (${attribution.unmapped.reason}), so the selection commit cannot be fixed`,
      "unmappable",
    );
  }
  const selectionCommit = history[attribution.latestIndex];
  if (selectionCommit === undefined) return unmeasured(headCommit, `history has no commit at position ${String(attribution.latestIndex)}`, "unmappable");

  const selectionResult = await ports.selectTests({ commit: selectionCommit, landingCommits: real.map((l) => l.landing_commit) });
  if (!selectionResult.ok) return unmeasured(selectionCommit, `the tests the plan's changes reach could not be selected at ${selectionCommit}: ${loreErrorText(selectionResult.error)}`, "unmappable");
  const selection = selectionResult.value;
  // reason: a test file the selector cannot parse might be one the plan broke; dropping it silently would read as green (spec "Accounting").
  if (selection.unparseable.length > 0) {
    const named = selection.unparseable.map((f) => `${f.path} (${f.message})`).join("; ");
    return unmeasured(selectionCommit, `${String(selection.unparseable.length)} test file(s) at ${selectionCommit} could not be parsed by the selector, so the selection is incomplete: ${named}\n${selection.accounting}`, "unmappable");
  }
  if (selection.selected.length === 0) {
    return nothingToRun(`selection@${selectionCommit}`, `${NO_TEST_REACHES} (0 of ${String(selection.totalTestFiles)} test files; selector accounting stored)\n${selection.accounting}`, { commit: selectionCommit, selected: 0, total: selection.totalTestFiles }, headCommit);
  }
  const selected = selection.selected.map((f) => f.path);
  const summary = `regression measured on ${String(selected.length)} selected test files of ${String(selection.totalTestFiles)} (selector accounting stored)`;
  const chunked = await runSelectionAtL(selectionCommit, selection.selected, history, {
    listFileRuns: (key) => ports.suites.listFileRuns(key),
    runBatch: (commit, files, runner, options) => ports.suites.runBatch(commit, files, runner, options),
    runner: ports.runner,
  });
  if (!chunked.ok) return unmeasured(selectionCommit, `the selected tests could not be run at ${selectionCommit}: ${loreErrorText(chunked.error)}`);
  // reason: #568 — regression is not measured only while some selected file has no result; the text names how many remain and why, so a retry (which runs only those) is the next step.
  if (chunked.value.remaining.length > 0) {
    const why = chunked.value.failures.length === 0 ? "" : `: ${chunked.value.failures.join("; ")}`;
    return unmeasured(selectionCommit, `the selected tests could not be run at ${selectionCommit}: ${String(chunked.value.remaining.length)} of ${String(selected.length)} selected test files have no result yet${why}`);
  }
  const singleFileRunIds: { key: string; id: string }[] = chunked.value.rows.map((stored) => ({ key: `${stored.row.file}@${selectionCommit}:${stored.kind}`, id: runIdOf(stored.row) }));
  const redFiles = chunked.value.rows.filter((stored) => stateOfRow(stored.row) === "red").map((stored) => stored.row.file).sort();
  // reason: BR-1533 — a selected file whose run at L only timed out has no state there: named, not measured (cause timeout), never charged; the others are still measured.
  const timedOutAtSelection = chunked.value.inconclusive.map(({ file, cause }): FileRegression => {
    const stopped = inconclusiveStop(file, selectionCommit, "batched", { inconclusive_cause: cause });
    return { file, outcome: "not-measured", reason: stopped.reason, cause };
  });
  const selectionRow: MilestoneFactRow = {
    subject: `selection@${selectionCommit}`,
    verdict: "pass",
    detail: `${summary}${redFiles.length === 0 ? "; all green at the selection commit" : `; ${String(redFiles.length)} red at the selection commit, each examined below`}\n${selection.accounting}`,
  };
  const selectionFacts = { commit: selectionCommit, selected: selected.length, total: selection.totalTestFiles };
  const finish = (attributed: readonly FileRegression[], consulted: readonly { key: string; id: string }[]): Result<RegressionAtHead, LoreError> => {
    const files = [...timedOutAtSelection, ...attributed];
    const charged = files.flatMap((f): RegressionFinding[] => (f.outcome === "regression" ? [{ file: f.file, landing: f.landing }] : []));
    const rows = [selectionRow, ...files.map(rowOfFile), ...unlandedRows];
    return ok({ assessed_commit: headCommit, selection: selectionFacts, files, charged, single_file_run_ids: [...singleFileRunIds, ...consulted], rows, causes: causesOf(rows) });
  };
  if (redFiles.length === 0) return finish([], []);

  const results = await ports.suites.listResults();
  if (!results.ok) {
    return finish(redFiles.map((file): FileRegression => ({ file, outcome: "not-measured", reason: `stored suite results could not be read: ${loreErrorText(results.error)}`, cause: "unrunnable" })), []);
  }
  const measuredByCommit = new Map<string, SuiteResultRecord>();
  for (const r of results.value) if (r.status === "measured") measuredByCommit.set(r.commit_sha, r);
  const attributed = await attributeRedFiles({ redFiles, history, attribution, measuredByCommit, recheck: selectionCommit !== headCommit, ports });
  return finish(attributed.files, attributed.consulted);
}
