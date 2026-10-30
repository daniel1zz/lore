/**
 * Regression measured from a stored suite that contains the plan's landings, then attributed by batched bisection
 * (BR-1496, BR-1497; spec D1/D2/D6 of the earlier spec and D1-D3 of `spec-a-plan-s-regression-reuses-a-stored-suite-that-contains`).
 *
 * Purpose: decide which test files main has red BECAUSE of a plan. The full suite is read at M, the newest stored measured
 *   suite at a main first-parent commit that contains every landing of the plan (a suite in flight that contains them is
 *   joined; a full suite runs at main's head only when neither exists, and is stored for the next plan). Files red at M are
 *   rechecked at head in one batched run; the files still red are bisected TOGETHER, one batched invocation per probed
 *   commit, and each charge rests on single-file runs. Only a transition at one of the plan's landing commits is the plan's regression.
 * Public surface: regressionAtHead, RegressionLandingInput, RegressionAtHeadPorts, HeadSuitePort, RegressionFinding,
 *   FileRegression, RegressionAtHead, regressionBisectionBudget.
 * Invariants:
 *   - M: the newest stored `measured` suite whose commit is on main's first-parent history at or above the position of the
 *     plan's LATEST landing (so it contains every landing); else the newest containing suite in flight (a live `suite:<sha>`
 *     lease), waited for and read from the store (never an unrunnable result; then look again, else run); else the full
 *     suite at head. A landing no main commit can be found for disables reuse (containment cannot be shown): the suite runs at head.
 *   - Head recheck (M is not head): every file red at M is run in ONE batched invocation at head; a file green there is run
 *     once alone at head before it is dropped; green alone = `green-at-head` (not looked at), red alone stays. A file green
 *     at M and red at head is never looked at.
 *   - Per remaining file: lower bound = the plan's earliest landing's first parent, or a newer commit with a stored
 *     SINGLE-FILE pass (or a measured suite not failing the file); the floor is decided by a single-file run (red = red-before,
 *     never charged). A stored `batch` row is only used as the result of a search step at a probed commit, never as the floor,
 *     a confirmation or an interval start.
 *   - Search: each round probes the midpoint of every unresolved file's interval; one batched invocation per distinct midpoint
 *     commit, holding every unresolved file whose interval strictly contains that commit and has no stored result there.
 *   - Confirmation: both ends of a found transition are re-run once each, each file ALONE (kind `confirm`); a disagreement
 *     (red in a batch but green alone, or red alone at the parent) is `not-measured` (`flaky-bisection`), never charged.
 *   - A file absent at a commit counts as not red there (no run), so a test the plan added is charged to the landing that added it.
 *   - A step that cannot complete (suite unrunnable, history unreadable, a run erroring or timing out) makes that file
 *     `not-measured` (and the gate not-measured); it is never a pass.
 *   - Fact rows: one for the suite read, one per red file, one per unlanded task. The dimension verdict is their fold (fail > not-measured > pass).
 *   - The review fingerprint hashes M's suite id and the stored run ids the verdict used (the head recheck's rows, the
 *     floor, bisect and confirm runs); search-step batch rows are not hashed, they decide nothing.
 * Side-effect class: IO through the injected ports only (suite runs and joins, single-file and batched runs, store writes via the suite service).
 *
 * Reference: Google TAP / Chromium culprit finder: bisect the failing targets together over one build per revision, confirm the culprit alone.
 * @spec_ref spec-a-plan-s-regression-reuses-a-stored-suite-that-contains (AC-AC-1, AC-AC-2, AC-AC-3, BR-1496, BR-1497)
 */

import { err, ok, type LoreError, type MilestoneFactRow, type RegressionNotMeasuredCause, type Result } from "@lore/core";
import type { SuiteFileRunRecord, SuiteResultRecord } from "../store/store-interface.js";
import { noCodeRegressionRow } from "./corpus-only-task.js";
import type { SuiteRun } from "./milestone-review-inputs.js";
import {
  loreErrorText,
  newestMeasuredAtOrAbove,
  singleFileRunKey,
  suiteRunOfResult,
  type CommitSuiteRunnerPort,
  type SingleFileRunKind,
} from "./suite-result-service.js";

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
  /** Runs the files together at a commit in ONE invocation, stored per (commit, file) with kind `batch`; one row per file, in the order given. */
  readonly runBatch: (commit: string, files: readonly string[], runner: CommitSuiteRunnerPort) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
  /** The commits whose full suite is running now (live `suite:<sha>` leases). */
  readonly listLiveSuiteCommits: () => Promise<Result<string[], LoreError>>;
  /** Waits for the suite in flight at a commit and returns what is stored for it afterwards (measured, else the latest attempt, else null); runs nothing. */
  readonly awaitSuiteResult: (commit: string) => Promise<Result<SuiteResultRecord | null, LoreError>>;
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

/** What was found for one red file of the suite read. */
export type FileRegression =
  | { readonly file: string; readonly outcome: "regression"; readonly landing: string }
  | { readonly file: string; readonly outcome: "other-commit"; readonly commit: string }
  | { readonly file: string; readonly outcome: "red-before"; readonly commit: string }
  | { readonly file: string; readonly outcome: "green-at-head"; readonly commit: string }
  | { readonly file: string; readonly outcome: "no-landing" }
  | { readonly file: string; readonly outcome: "not-measured"; readonly reason: string; readonly cause: RegressionNotMeasuredCause };

/** The measured regression facts of a plan. */
export interface RegressionAtHead {
  /** The suite the review read (M) and its stored result; `undefined` when no suite could be run. */
  readonly head: { readonly commit: string; readonly result_id: string } | undefined;
  /** The suite run of M as the judge reads it; `undefined` when `head` is. */
  readonly suite: SuiteRun | undefined;
  readonly files: readonly FileRegression[];
  /** Files charged to the plan (these fail the gate). */
  readonly charged: readonly RegressionFinding[];
  /** Every stored run the verdict read or made, keyed `<file>@<commit>:<kind>`; the review fingerprint hashes them (BR-1497). M's own id is `head.result_id`. */
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

type FileState = "green" | "red";
type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const stop = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const reasonOf = (what: string, error: LoreError): { ok: false; reason: string } => stop(`${what}: ${loreErrorText(error)}`);
const stateOfExit = (exitCode: number): FileState => (exitCode === 0 ? "green" : "red");
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
    return { ok: true, value: rows.value.filter((r) => r.file === this.file && r.commit_sha === commit).at(-1) };
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
      return { ok: true, value: stateOfExit(stored.value.exit_code) };
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
    return { ok: true, value: batch.value === undefined ? undefined : stateOfExit(batch.value.exit_code) };
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
      return { ok: true, value: stateOfExit(stored.value.exit_code) };
    }
    return this.run(commit, "confirm");
  }

  private async run(commit: string, kind: SingleFileRunKind): Promise<Step<FileState>> {
    const ran = await this.ports.suites.runSingleFile(commit, this.file, kind, this.ports.runner);
    if (!ran.ok) return reasonOf(`${this.file} could not be run at ${commit}`, ran.error);
    this.consulted.push({ key: `${this.file}@${commit}:${kind}`, id: runIdOf(ran.value) });
    return { ok: true, value: stateOfExit(ran.value.exit_code) };
  }
}

/** Which main commits are the plan's, and where the plan's unmappable landings could be hiding. */
interface Attribution {
  /** Main first-parent commits that brought a landing commit in (a landing on the chain maps to itself). */
  readonly chargedCommits: ReadonlySet<string>;
  /** Index of the earliest main commit the plan can have changed; the bisection floor is the commit below it. */
  readonly earliestIndex: number;
  /** Index of the latest main commit that brought a landing in: a suite at or above it contains every (mapped) landing. */
  readonly latestIndex: number;
  /** The unmappable landing that could have landed earliest; a transition after `afterIndex` may be it. */
  readonly unmapped: { readonly landing: string; readonly afterIndex: number; readonly reason: string } | undefined;
}

/** Maps every landing to the main first-parent commit that brought it in; an unmappable one only bounds where it could be. */
async function attributeLandings(real: readonly RegressionLandingInput[], history: readonly string[], ports: RegressionAtHeadPorts): Promise<Attribution> {
  const position = new Map(history.map((commit, index) => [commit, index] as const));
  const chargedCommits = new Set<string>();
  let earliestIndex = Number.MAX_SAFE_INTEGER;
  let latestIndex = -1;
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
      const index = position.get(mapped) ?? earliestIndex;
      earliestIndex = Math.min(earliestIndex, index);
      latestIndex = Math.max(latestIndex, index);
      continue;
    }
    // reason: a landing reaches main AFTER the commit main stood at before it, so its transition cannot be at or below that commit.
    const afterIndex = position.get(landing.main_before) ?? -1;
    earliestIndex = Math.min(earliestIndex, afterIndex + 1);
    if (unmapped === undefined || afterIndex < unmapped.afterIndex) unmapped = { landing: landing.landing_commit, afterIndex, reason };
  }
  return { chargedCommits, earliestIndex, latestIndex, unmapped };
}

/**
 * M: the newest stored measured suite containing every landing, else the newest containing suite in flight (joined), else `undefined`.
 * An unrunnable joined run is never M: the search then looks again (stored, then in flight), and `undefined` means "run at head".
 */
async function findContainingSuite(ports: RegressionAtHeadPorts, history: readonly string[], minIndex: number): Promise<Result<SuiteResultRecord | undefined, LoreError>> {
  const position = new Map(history.map((commit, index) => [commit, index] as const));
  const tried = new Set<string>();
  for (;;) {
    const results = await ports.suites.listResults();
    if (!results.ok) return results;
    const stored = newestMeasuredAtOrAbove(results.value, history, minIndex, tried);
    if (stored !== undefined) return ok(stored);
    const live = await ports.suites.listLiveSuiteCommits();
    if (!live.ok) return live;
    // reason: only a run whose commit is on the chain at or above the latest landing contains every landing; one that misses a
    // landing would read M without it (a file that landing turned red would be green there and never rechecked).
    const joinable = live.value.filter((commit) => !tried.has(commit) && (position.get(commit) ?? -1) >= minIndex).sort((a, b) => (position.get(b) ?? -1) - (position.get(a) ?? -1));
    const target = joinable[0];
    if (target === undefined) return ok(undefined);
    tried.add(target);
    const awaited = await ports.suites.awaitSuiteResult(target);
    if (!awaited.ok) return awaited;
    if (awaited.value !== null && awaited.value.status === "measured") return ok(awaited.value);
  }
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
    const bounds = await initialBounds(probeOf(file), history, headIndex, attribution);
    if (bounds.kind === "settled") outcomes.set(file, bounds.outcome);
    else if (bounds.kind === "stop") notMeasured(file, bounds.reason);
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
    if (!there.ok) notMeasured(file, there.reason);
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
    const probe = probeOf(file);
    probe.consulted.push({ key: `${file}@${headCommit}:batch`, id: runIdOf(row) });
    if (stateOfExit(row.exit_code) === "red") {
      red.push(file);
      continue;
    }
    // reason: green beside other files does not prove green alone: interference can hide a failure as well as cause one, so the file is
    // run once alone before it is dropped (spec: Final state still decides).
    const alone = await probe.stateAt(headCommit);
    if (!alone.ok) notMeasured(file, alone.reason);
    else if (alone.value === "red") red.push(file);
    else outcomes.set(file, { file, outcome: "green-at-head", commit: headCommit });
  }
  return red;
}

type Bounds =
  | { readonly kind: "active"; readonly low: number; readonly high: number }
  | { readonly kind: "settled"; readonly outcome: FileRegression }
  | { readonly kind: "stop"; readonly reason: string };

/** The interval of one file: known-green start (newest stored single-file pass, else the floor decided by a single-file run) to the oldest known red. */
async function initialBounds(probe: FileProbe, history: readonly string[], headIndex: number, attribution: Attribution): Promise<Bounds> {
  const floorIndex = attribution.earliestIndex - 1;
  const knownStates = new Map<number, FileState>();
  for (let index = headIndex - 1; index > floorIndex; index -= 1) {
    const commit = history[index];
    if (commit === undefined) return { kind: "stop", reason: `history has no commit at position ${String(index)}` };
    const known = await probe.known(commit);
    if (!known.ok) return { kind: "stop", reason: known.reason };
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
    if (floorCommit === undefined) return { kind: "stop", reason: `history has no commit at position ${String(floorIndex)}` };
    const floor = await probe.stateAt(floorCommit);
    if (!floor.ok) return { kind: "stop", reason: floor.reason };
    if (floor.value === "red") return { kind: "settled", outcome: { file: probe.file, outcome: "red-before", commit: floorCommit } };
  }
  // reason: floorIndex -1 is "before main's first commit": the file cannot exist there, so it is green without a run.
  let high = headIndex;
  for (let index = low + 1; index < headIndex; index += 1) {
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
  const fail = (active: Active, reason: string): void => {
    active.failed = true;
    notMeasured(active.file, reason);
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
          fail(active, step.reason);
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
        if (!step.ok) fail(active, step.reason);
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
        else apply(member, index, stateOfExit(row.exit_code));
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
  if (!firstConfirm.ok) return notMeasured(firstConfirm.reason);
  const parent = low >= 0 ? history[low] : undefined;
  const parentConfirm = parent === undefined ? ({ ok: true, value: "green" } as const) : await probe.confirmAt(parent);
  if (!parentConfirm.ok) return notMeasured(parentConfirm.reason);
  if (firstConfirm.value !== "red" || parentConfirm.value !== "green") {
    return notMeasured(`flaky during bisection: the confirmation runs disagree with the bisection at ${first} (confirm there alone: ${firstConfirm.value}; at its parent alone: ${parentConfirm.value})`, "flaky-bisection");
  }
  if (attribution.chargedCommits.has(first)) return { file, outcome: "regression", landing: first };
  const unmapped = attribution.unmapped;
  if (unmapped !== undefined && high > unmapped.afterIndex) {
    return notMeasured(`red since ${first}, where landing ${unmapped.landing} could have reached main: it is not on main's first-parent history and no main commit containing it was found (${unmapped.reason}), so the transition cannot be attributed`, "unmappable");
  }
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
      return { subject: f.file, verdict: "pass", detail: `red in the suite read but green at main's head ${f.commit} (alone as well): the final state is green (not charged)` };
    case "no-landing":
      return { subject: f.file, verdict: "pass", detail: `red at main's head; the plan has no landing on main, so it is not this plan's (not charged)` };
    case "not-measured":
      return { subject: f.file, verdict: "not-measured", detail: f.reason, cause: f.cause };
  }
}

/**
 * Measures regression for a plan from a stored suite that contains its landings and decides what the gate charges.
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
    return ok({ head: undefined, suite: undefined, files: [], charged: [], single_file_run_ids: [], rows: [noCodeRegressionRow(noCodeTasks)], causes: [] });
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
  const unmeasured = (subject: string, detail: string): Result<RegressionAtHead, LoreError> => {
    const rows: MilestoneFactRow[] = [{ subject, verdict: "not-measured", detail, cause: "unrunnable" }, ...unlandedRows];
    return ok({ head: undefined, suite: undefined, files: [], charged: [], single_file_run_ids: [], rows, causes: causesOf(rows) });
  };

  const resolvedHead = await ports.runner.resolveCommit(ports.headRef);
  if (!resolvedHead.ok) return unmeasured(ports.headRef, `the suite could not be run at ${ports.headRef}: ${loreErrorText(resolvedHead.error)}`);
  const headCommit = resolvedHead.value.commit;

  const historyResult = real.length > 0 ? await ports.firstParentHistory(headCommit) : undefined;
  let attribution: Attribution | undefined;
  let suite: SuiteResultRecord | undefined;
  if (historyResult?.ok === true) {
    attribution = await attributeLandings(real, historyResult.value, ports);
    // reason: a landing no main commit can be found for cannot be shown contained in any stored suite: reuse is off, the suite runs at head.
    if (attribution.unmapped === undefined) {
      const containing = await findContainingSuite(ports, historyResult.value, attribution.latestIndex);
      if (!containing.ok) return unmeasured(headCommit, `the stored suites could not be searched: ${loreErrorText(containing.error)}`);
      suite = containing.value;
    }
  }
  if (suite === undefined) {
    const looked = await ports.suites.lookupOrRun(ports.headRef, ports.runner);
    if (!looked.ok) return unmeasured(ports.headRef, `the suite could not be run at ${ports.headRef}: ${loreErrorText(looked.error)}`);
    suite = looked.value;
  }
  if (suite.status !== "measured") {
    // reason: an unrunnable attempt is a stored row too (new id per attempt), so its id is part of the facts fingerprint (BR-1497).
    const row: MilestoneFactRow = { subject: suite.commit_sha, verdict: "not-measured", detail: `the suite could not run at ${suite.commit_sha}: ${suite.cause ?? "unrunnable"}`, cause: "unrunnable" };
    const rows = [row, ...unlandedRows];
    return ok({ head: { commit: suite.commit_sha, result_id: suite.id }, suite: suiteRunOfResult(suite), files: [], charged: [], single_file_run_ids: [], rows, causes: causesOf(rows) });
  }
  const head = { commit: suite.commit_sha, result_id: suite.id };
  const suiteRun = suiteRunOfResult(suite);
  const redFiles = [...new Set(suite.failing_test_files.map((f) => f.file))].sort();
  const singleFileRunIds: { key: string; id: string }[] = [];
  const atHead = suite.commit_sha === headCommit;
  const headRow: MilestoneFactRow = {
    subject: head.commit,
    verdict: "pass",
    detail:
      redFiles.length === 0
        ? `the suite is green at ${atHead ? "main's head" : "the stored suite commit"} ${head.commit}`
        : `${String(redFiles.length)} red file(s) in the suite at ${atHead ? "main's head" : "the stored suite commit"} ${head.commit}, each examined below`,
  };
  if (redFiles.length === 0) {
    const rows = [headRow, ...unlandedRows];
    return ok({ head, suite: suiteRun, files: [], charged: [], single_file_run_ids: singleFileRunIds, rows, causes: causesOf(rows) });
  }

  const files: FileRegression[] = [];
  const stopAll = (reason: string): void => {
    for (const file of redFiles) files.push({ file, outcome: "not-measured", reason, cause: "unrunnable" });
  };
  if (real.length === 0) {
    // reason: a plan with no landing on main changed nothing there; nothing red at head can be its regression, and no bisection is needed.
    for (const file of redFiles) files.push({ file, outcome: "no-landing" });
  } else if (historyResult === undefined || !historyResult.ok || attribution === undefined) {
    stopAll(`main's first-parent history could not be read: ${historyResult !== undefined && !historyResult.ok ? loreErrorText(historyResult.error) : "no history"}`);
  } else {
    const results = await ports.suites.listResults();
    if (!results.ok) {
      stopAll(`stored suite results could not be read: ${loreErrorText(results.error)}`);
    } else {
      const measuredByCommit = new Map<string, SuiteResultRecord>();
      for (const r of results.value) if (r.status === "measured") measuredByCommit.set(r.commit_sha, r);
      const attributed = await attributeRedFiles({ redFiles, history: historyResult.value, attribution, measuredByCommit, recheck: !atHead, ports });
      files.push(...attributed.files);
      singleFileRunIds.push(...attributed.consulted);
    }
  }
  const charged = files.flatMap((f): RegressionFinding[] => (f.outcome === "regression" ? [{ file: f.file, landing: f.landing }] : []));
  const rows = [headRow, ...files.map(rowOfFile), ...unlandedRows];
  return ok({ head, suite: suiteRun, files, charged, single_file_run_ids: singleFileRunIds, rows, causes: causesOf(rows) });
}
