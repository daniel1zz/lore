/**
 * The suite-result store's service: per-(commit, file) test runs stored once and reused (BR-1497). No review runs the full
 * suite (spec `spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach`); the stored full-suite results older
 * measurements left behind are only READ (`listResults`).
 *
 * Purpose: make "what did this test file say at commit X" a stored fact: the first run of a (commit, file) stores it, every
 *   later review reads the store and runs nothing.
 * Public surface: SuiteResultService (runSingleFile, runBatch, listFileRuns, listResults),
 *   CommitSuiteRunnerPort, RunBatchOptions, FileRunOutcome, SingleFileRunKind, FileRunKind, singleFileRunKey.
 * Invariants:
 *   - Stored rows are never edited.
 *   - A file run (`runSingleFile`, `runBatch`) is stored keyed by (commit, file): its `suite_result_id` column holds
 *     {@link singleFileRunKey} (`file-<kind>@<commit>`), not a suite result id, so a commit that never had a full suite
 *     carries file runs and a later review reads them back (BR-1496).
 *   - A single-file run under lease `suite:C:F` (BR-1511): a caller that finds the key held waits, then reads the store and
 *     runs only when no row is stored after the wait.
 *   - Nothing here reads or writes the audit chain.
 * Side-effect class: stateful (store writes, runner IO through the injected port).
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-2, BR-1497, BR-1412)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { FileRunClassification, InconclusiveCause, StoreInterface, SuiteFileRunRecord, SuiteResultRecord } from "../store/store-interface.js";
import { suiteFileLeaseKey, type ReviewLeases } from "./review-batch-lease.js";

/** One test file re-run at a commit. */
export interface FileRunOutcome {
  readonly file: string;
  readonly exit_code: number;
  readonly output_tail: string;
  readonly duration_ms: number;
  /** Set when the run did not complete (timeout, process tree not ended): `exit_code` is then a failure, not a test result. */
  readonly incomplete?: string;
  /**
   * What the run says about the file (BR-1533), read from the runner's own per-test errors. Absent: derived from `exit_code`
   * (0 = green, 1 = red), which a stub runner without a report relies on. `inconclusive` wins over `incomplete`: the run is stored.
   */
  readonly classification?: FileRunClassification;
  /** Set with `classification: "inconclusive"`: always `timeout` from a runner (the other cause is written only by the store migration). */
  readonly inconclusive_cause?: "timeout";
}

/** The classification a stored row gets for an outcome: the runner's, else the exit code's. */
function classificationOfOutcome(outcome: FileRunOutcome): { readonly classification: FileRunClassification; readonly inconclusive_cause: InconclusiveCause | null } {
  if (outcome.classification === "inconclusive") return { classification: "inconclusive", inconclusive_cause: outcome.inconclusive_cause ?? "timeout" };
  if (outcome.classification !== undefined) return { classification: outcome.classification, inconclusive_cause: null };
  return { classification: outcome.exit_code === 0 ? "green" : "red", inconclusive_cause: null };
}

/**
 * Whether a stored run decides anything: a `red` or `green` run does, an `inconclusive` one never does (BR-1533).
 * @param row - a stored file run
 */
export function isConclusiveRun(row: SuiteFileRunRecord): boolean {
  return row.classification !== "inconclusive";
}

/**
 * The run that decides a (commit, file) point among the rows stored for it, oldest first: the NEWEST conclusive one; an inconclusive
 * run newer than a conclusive one changes nothing.
 * @param rows - the rows of one file under one key, in storage order
 * @returns the deciding row, or `undefined` when no run there is conclusive
 */
export function decidingRun(rows: readonly SuiteFileRunRecord[]): SuiteFileRunRecord | undefined {
  return rows.filter(isConclusiveRun).at(-1);
}

/** How one batched invocation is prepared. */
export interface RunBatchOptions {
  /** Build the compiled binary (`bun run build`) in the worktree before the tests run: some file declares `@spawns dist/lore`. */
  readonly buildFirst?: boolean;
}

/** What the service needs from a git-backed runner: resolve a ref, re-run named files at a commit (alone or together). */
export interface CommitSuiteRunnerPort {
  /** The commit and tree sha a ref (`main`, a sha) names. */
  readonly resolveCommit: (ref: string) => Promise<Result<{ readonly commit: string; readonly tree: string }, LoreError>>;
  /** Re-runs the named test files at `commit`, one outcome per file, in the order given. */
  readonly runFiles: (commit: string, files: readonly string[]) => Promise<Result<readonly FileRunOutcome[], LoreError>>;
  /**
   * Runs `work` in a throwaway worktree of `commit` with dependencies prepared (the same mechanic the suite uses). Used for
   * work that must happen at a commit whose suite result is already stored. Optional: a runner without it cannot do such work.
   */
  readonly withWorktree?: (commit: string, work: (root: string) => Promise<void>) => Promise<Result<void, LoreError>>;
  /**
   * Runs ALL the named test files at `commit` in ONE test-runner invocation (the files run beside each other) and reports
   * one outcome per file, in the order given. Optional: a runner without it cannot run a batch (BR-1496).
   */
  readonly runFilesTogether?: (commit: string, files: readonly string[], options?: RunBatchOptions) => Promise<Result<readonly FileRunOutcome[], LoreError>>;
  /**
   * Ends the review's reuse of prepared worktrees: removes every worktree `runFiles` / `runFilesTogether` prepared (one per
   * commit per review). Optional: a runner that keeps no worktree has nothing to end.
   */
  readonly disposeWorktrees?: () => Promise<Result<void, LoreError>>;
}

/** The slice of the store this service uses. */
export type SuiteResultStorePort = Pick<StoreInterface, "listSuiteResults" | "getSuiteResult" | "insertSuiteFileRuns" | "listSuiteFileRuns">;

/** Injected collaborators (clock and id source are injected so tests are deterministic). */
export interface SuiteResultServiceDeps {
  readonly store: SuiteResultStorePort;
  /** ISO 8601 "now". */
  readonly now: () => string;
  /** A fresh unique result id. */
  readonly newId: () => string;
  /** Monotonic milliseconds, for run durations. */
  readonly clockMs: () => number;
  /**
   * The keyed leases that single-flight a commit's suite run and a (commit, file) run (BR-1511). Absent only in bare
   * constructions; the app always wires it.
   */
  readonly leases?: ReviewLeases;
}

/** Why a single file was run at a commit: a bisection probe, or the confirmation of one end of a transition (spec D6). */
export type SingleFileRunKind = "bisect" | "confirm";

/** A stored per-(commit, file) run: a single-file run, or one file's outcome of a batched invocation (`batch`, a search step only). */
export type FileRunKind = SingleFileRunKind | "batch";

/**
 * The value stored in `suite_file_runs.suite_result_id` for a single-file run at `commit`.
 * reason: the table has no foreign key and no (commit, file) column pair of its own; keying by this string avoids a
 * migration and makes "what did this file do at this commit" one indexed read (`listFileRuns`). `file-batch@<commit>`
 * matches the same `file-%@%` predicate, so a batch outcome is stored once per (commit, file) with no schema change.
 */
export function singleFileRunKey(kind: FileRunKind, commit: string): string {
  return `file-${kind}@${commit}`;
}

/**
 * Whether a command's exit code is a TEST RESULT: 0 = everything passed, 1 = some test failed. Any other code (5 = the
 * oracle lock of the checkout was held by another run, 2/4 = usage or environment errors, 127 = not found) means the tests
 * did not run, so the run says nothing about any file and is never stored as a measurement (BR-1497).
 */
export function isTestResultExit(exitCode: number): boolean {
  return exitCode === 0 || exitCode === 1;
}

/** Why a command that exited outside {0, 1} produced no measurement; names the oracle lock when its output says so. */
export function nonRunCause(command: string, exitCode: number, outputTail: string): string {
  const contended = /oracle-lock: contended/.test(outputTail) ? " (the oracle lock of the checkout was held by another run)" : "";
  return `\`${command}\` exited with code ${String(exitCode)}${contended}, which is not a test result (0 = pass, 1 = failures): the tests did not run`;
}

/** Readable text of any LoreError (not every member carries a `message`). */
export function loreErrorText(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? error.message : error.code;
}

/** Stores and serves one suite result per commit. */
export class SuiteResultService {
  constructor(private readonly deps: SuiteResultServiceDeps) {}

  /**
   * Runs ONE test file at `commit` and stores the outcome keyed by (commit, file, kind), once: when a row for that key and
   * file is already stored it is returned and nothing runs; when a concurrent review stored one while this run was in
   * flight, the store keeps the first row (migration-045) and that row is returned, not this run's result (#528, BR-1497).
   *
   * @param commit - the commit to run at (a full sha)
   * @param file - repo-relative test file
   * @param kind - `bisect` probe or `confirm` run; they are stored apart so a confirmation is always an independent run
   * @param runner - runs the file at the commit
   * @returns the first stored row; `err` when the runner fails, reports no outcome or an incomplete one (not stored), or the store fails
   */
  async runSingleFile(commit: string, file: string, kind: SingleFileRunKind, runner: CommitSuiteRunnerPort): Promise<Result<SuiteFileRunRecord, LoreError>> {
    const key = singleFileRunKey(kind, commit);
    const existing = await this.firstStoredFileRun(key, file);
    if (!existing.ok || existing.value !== null) return existing.ok ? ok(existing.value as SuiteFileRunRecord) : existing;
    const leases = this.deps.leases;
    if (leases === undefined) return this.runFileAndStore(commit, file, key, runner);
    // reason: BR-1511 — `suite:<commit>:<file>` single-flights the file run; the re-read after acquiring is what makes a waiter reuse the holder's row.
    return leases.withWaiting(suiteFileLeaseKey(commit, file), async () => {
      const again = await this.firstStoredFileRun(key, file);
      if (!again.ok) return again;
      if (again.value !== null) return ok(again.value);
      return this.runFileAndStore(commit, file, key, runner);
    });
  }

  private async runFileAndStore(commit: string, file: string, key: string, runner: CommitSuiteRunnerPort): Promise<Result<SuiteFileRunRecord, LoreError>> {
    const ran = await runner.runFiles(commit, [file]);
    if (!ran.ok) return ran;
    const outcome = ran.value.find((o) => o.file === file);
    if (outcome === undefined) {
      return err({ code: "STORE_ERROR", message: `the runner reported no outcome for ${file} at ${commit}` });
    }
    // reason: a run that did not complete for another reason than a timeout (process tree not ended, build failed) says nothing and is not stored.
    // A timed-out run IS stored, as inconclusive (BR-1533): it keeps the evidence that the point was tried and decides nothing.
    if (outcome.incomplete !== undefined && outcome.classification !== "inconclusive") {
      return err({ code: "STORE_ERROR", message: `${file} did not complete at ${commit}: ${outcome.incomplete}` });
    }
    // reason: an exit outside {0, 1} (usage error, lock contention) is no test result; stored, it would read as red.
    if (!isTestResultExit(outcome.exit_code)) {
      return err({ code: "STORE_ERROR", message: `${file} did not run at ${commit}: ${nonRunCause("bun run test:file", outcome.exit_code, outcome.output_tail)}` });
    }
    const row: SuiteFileRunRecord = {
      suite_result_id: key,
      commit_sha: commit,
      file,
      exit_code: outcome.exit_code,
      output_tail: outcome.output_tail,
      duration_ms: outcome.duration_ms,
      measured_at: this.deps.now(),
      ...classificationOfOutcome(outcome),
    };
    const inserted = await this.deps.store.insertSuiteFileRuns([row]);
    if (!inserted.ok) return inserted;
    // reason: an inconclusive run is never a deciding row, so there is nothing to read back: the caller gets the row just stored.
    if (row.classification === "inconclusive") return ok(row);
    // reason: the insert is ignored when a concurrent review stored this (key, file) first; read back the winner so every review sees one outcome.
    const stored = await this.firstStoredFileRun(key, file);
    if (!stored.ok) return stored;
    if (stored.value === null) return err({ code: "STORE_ERROR", message: `the single-file run of ${file} at ${commit} was not found after it was stored` });
    return ok(stored.value);
  }

  /**
   * Runs the named files together at `commit` in ONE invocation and stores each file's outcome with kind `batch`, once per
   * (commit, file): a file that already has a stored batch row is not run again, and when every file has one nothing runs. A
   * batch outcome is only a search step (never red-before, a confirmation or an interval start) because a file can fail only
   * beside another file (BR-1496).
   *
   * @param commit - the commit to run at (a full sha)
   * @param files - repo-relative test files (at least one)
   * @param runner - must implement `runFilesTogether`
   * @param options - `buildFirst`: the runner builds the compiled binary in the worktree before the tests run (a selected file declares `@spawns dist/lore`)
   * @returns the first stored row of each file, in the order given; `err` when the runner cannot batch, fails, or leaves a file without a complete outcome (the files it did finish are stored, the others never) or the store fails
   */
  async runBatch(commit: string, files: readonly string[], runner: CommitSuiteRunnerPort, options: RunBatchOptions = {}): Promise<Result<SuiteFileRunRecord[], LoreError>> {
    if (files.length === 0) return err({ code: "VALIDATION_ERROR", field: "files", message: "runBatch needs at least one test file", rule: "BR-1496" });
    const key = singleFileRunKey("batch", commit);
    const stored = await this.storedRowsOf(key, files);
    if (!stored.ok) return stored;
    if (stored.value.every((row) => row !== null)) return ok(stored.value as SuiteFileRunRecord[]);
    const leases = this.deps.leases;
    if (leases === undefined) return this.runBatchAndStore(commit, files, key, runner, options);
    // reason: BR-1511 — one lease per (commit, file set) single-flights the invocation; the re-read after acquiring lets a waiter reuse the holder's rows.
    return leases.withWaiting(suiteFileLeaseKey(commit, `batch:${[...files].sort().join(",")}`), async () => {
      const again = await this.storedRowsOf(key, files);
      if (!again.ok) return again;
      if (again.value.every((row) => row !== null)) return ok(again.value as SuiteFileRunRecord[]);
      return this.runBatchAndStore(commit, files, key, runner, options);
    });
  }

  /** The deciding (newest conclusive) stored row of each file under `key`, `null` for a file with none: an inconclusive run is no result. */
  private async storedRowsOf(key: string, files: readonly string[]): Promise<Result<(SuiteFileRunRecord | null)[], LoreError>> {
    const rows = await this.deps.store.listSuiteFileRuns(key);
    if (!rows.ok) return rows;
    return ok(files.map((file) => decidingRun(rows.value.filter((r) => r.file === file)) ?? null));
  }

  private async runBatchAndStore(commit: string, files: readonly string[], key: string, runner: CommitSuiteRunnerPort, options: RunBatchOptions): Promise<Result<SuiteFileRunRecord[], LoreError>> {
    if (runner.runFilesTogether === undefined) {
      return err({ code: "VALIDATION_ERROR", field: "runner.runFilesTogether", message: "the runner cannot run several test files in one invocation", rule: "BR-1496" });
    }
    // reason: files that already have a stored batch row are left out of the invocation (the store keeps the first row anyway).
    const have = await this.storedRowsOf(key, files);
    if (!have.ok) return have;
    const missing = files.filter((_, index) => have.value[index] === null);
    if (missing.length === 0) return ok(have.value as SuiteFileRunRecord[]);
    const ran = await runner.runFilesTogether(commit, missing, options);
    if (!ran.ok) return ran;
    const measuredAt = this.deps.now();
    const rows: SuiteFileRunRecord[] = [];
    let unfinished: LoreError | undefined;
    for (const file of missing) {
      const outcome = ran.value.find((o) => o.file === file);
      if (outcome === undefined) {
        unfinished ??= { code: "STORE_ERROR", message: `the runner reported no outcome for ${file} in the batch at ${commit}` };
        continue;
      }
      // reason: a timed-out file is stored as inconclusive (BR-1533); only a file that did not complete for another reason stays unstored.
      if (outcome.incomplete !== undefined && outcome.classification !== "inconclusive") {
        unfinished ??= { code: "STORE_ERROR", message: `${file} did not complete in the batch at ${commit}: ${outcome.incomplete}` };
        continue;
      }
      if (!isTestResultExit(outcome.exit_code)) {
        unfinished ??= { code: "STORE_ERROR", message: `${file} did not run in the batch at ${commit}: ${nonRunCause("bun run test:file", outcome.exit_code, outcome.output_tail)}` };
        continue;
      }
      rows.push({
        suite_result_id: key,
        commit_sha: commit,
        file,
        exit_code: outcome.exit_code,
        output_tail: outcome.output_tail,
        duration_ms: outcome.duration_ms,
        measured_at: measuredAt,
        ...classificationOfOutcome(outcome),
      });
    }
    // reason: #568 — the files the runner FINISHED are stored even when others in the batch did not (a timed-out chunk keeps what it completed);
    // the unfinished ones are stored never, so a retry runs exactly them. The call still fails while any file is unfinished.
    if (rows.length > 0) {
      const partial = await this.deps.store.insertSuiteFileRuns(rows);
      if (!partial.ok) return partial;
    }
    if (unfinished !== undefined) return err(unfinished);
    // reason: the insert is ignored for a (key, file) a concurrent review stored first; read the winners back so every review sees one outcome.
    // A file whose run here was inconclusive has no deciding row: it is returned as the inconclusive row just stored.
    const after = await this.storedRowsOf(key, files);
    if (!after.ok) return after;
    const winners: SuiteFileRunRecord[] = [];
    for (const [index, file] of files.entries()) {
      const row = after.value[index] ?? rows.find((r) => r.file === file);
      if (row === undefined) return err({ code: "STORE_ERROR", message: `the batch run at ${commit} was not found after it was stored` });
      winners.push(row);
    }
    return ok(winners);
  }

  /** The deciding (newest conclusive) stored row of `file` under `key`, or null when none is stored: an inconclusive run is not a result. */
  private async firstStoredFileRun(key: string, file: string): Promise<Result<SuiteFileRunRecord | null, LoreError>> {
    const rows = await this.deps.store.listSuiteFileRuns(key);
    if (!rows.ok) return rows;
    return ok(decidingRun(rows.value.filter((r) => r.file === file)) ?? null);
  }

  /** The per-file re-runs stored for a result, in the order they ran. */
  listFileRuns(suiteResultId: string): Promise<Result<SuiteFileRunRecord[], LoreError>> {
    return this.deps.store.listSuiteFileRuns(suiteResultId);
  }

  /** Every stored suite result, oldest first (regression at the assessed commit reads the known state of each commit from it). */
  listResults(): Promise<Result<SuiteResultRecord[], LoreError>> {
    return this.deps.store.listSuiteResults();
  }
}
