/**
 * The suite-result store's service: one full-suite result per commit, looked up before it is ever run (BR-1497).
 *
 * Purpose: make "what did the suite say at commit X" a stored fact: the first lookup of a commit runs the suite once and
 *   stores it, every later lookup reads the store and runs nothing; the main red/green state the review records is
 *   derived from the same rows, so there is no second record of one run.
 * Public surface: SuiteResultService, CommitSuiteRunnerPort, FileRunOutcome, SingleFileRunKind, singleFileRunKey, suiteRunOfResult,
 *   deriveMainCheckedRows.
 * Invariants:
 *   - A commit has at most one `measured` result. A run that could not complete (the runner reports not-measured or
 *     fails) is stored as `unrunnable` with its cause and attempt number, and the NEXT lookup runs again as a new
 *     result (new id, `attempt + 1`); an `unrunnable` result is never returned as a cached answer.
 *   - Stored rows are never edited. Per-file re-runs (`rerunFiles`) are separate rows attached to a result id.
 *   - A single-file run (`runSingleFile`, regression at the assessed commit) is stored keyed by (commit, file): its
 *     `suite_result_id` column holds {@link singleFileRunKey} (`file-<kind>@<commit>`), not a suite result id, so a commit
 *     that never had a full suite can still carry file runs and a later review reads them back (BR-1496).
 *   - A full-suite run at commit C runs under lease `suite:C`, a single-file run under `suite:C:F` (BR-1511): a caller that
 *     finds the key held waits, then reads the store and runs only when no measured result is stored after the wait.
 *   - Nothing here reads or writes the audit chain: main-red / main-red-green records stay audit rows (BR-1412), the
 *     "main was checked at <commit>" fact is {@link deriveMainCheckedRows} over the stored results.
 * Side-effect class: stateful (store writes, runner IO through the injected port).
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-2, BR-1497, BR-1412)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { StoreInterface, SuiteFileRunRecord, SuiteResultRecord } from "../store/store-interface.js";
import { MAIN_CHECKED_ACTION, classifySuiteForMainRed, type MainRedRow } from "./milestone-review.js";
import type { SuiteRun } from "./milestone-review-inputs.js";
import { suiteFileLeaseKey, suiteLeaseKey, type ReviewLeases } from "./review-batch-lease.js";

/** One test file re-run at a commit. */
export interface FileRunOutcome {
  readonly file: string;
  readonly exit_code: number;
  readonly output_tail: string;
  readonly duration_ms: number;
  /** Set when the run did not complete (timeout, process tree not ended): `exit_code` is then a failure, not a test result. */
  readonly incomplete?: string;
}

/** What the service needs from a git-backed runner: resolve a ref, run the suite at a commit, re-run named files at a commit. */
export interface CommitSuiteRunnerPort {
  /** The commit and tree sha a ref (`main`, a sha) names. */
  readonly resolveCommit: (ref: string) => Promise<Result<{ readonly commit: string; readonly tree: string }, LoreError>>;
  /**
   * Runs the project's plan-close chain and full suite at `commit` in a throwaway worktree.
   * `inWorktree` is awaited after the measurement while the worktree still exists.
   */
  readonly runSuite: (commit: string, inWorktree?: (root: string, commit: string) => Promise<void>) => Promise<Result<SuiteRun, LoreError>>;
  /** Re-runs the named test files at `commit`, one outcome per file, in the order given. */
  readonly runFiles: (commit: string, files: readonly string[]) => Promise<Result<readonly FileRunOutcome[], LoreError>>;
  /**
   * Runs `work` in a throwaway worktree of `commit` with dependencies prepared (the same mechanic the suite uses). Used for
   * work that must happen at a commit whose suite result is already stored. Optional: a runner without it cannot do such work.
   */
  readonly withWorktree?: (commit: string, work: (root: string) => Promise<void>) => Promise<Result<void, LoreError>>;
}

/** What {@link SuiteResultService.lookupOrRunWith} did: the commit's result and what happened to the extra work. */
export interface LookupWithWorkOutcome {
  readonly result: SuiteResultRecord;
  /** Set when the work could not be run at all (no worktree); absent when it ran, whatever the work itself reported. */
  readonly workError?: LoreError;
  /** Where the work ran: the suite's own worktree (`suite`, a fresh run) or a worktree made for it alone (`own`, a stored hit). Absent when it did not run. */
  readonly workIn?: "suite" | "own";
}

/** The slice of the store this service uses. */
export type SuiteResultStorePort = Pick<
  StoreInterface,
  "insertSuiteResult" | "listSuiteResultsForCommit" | "listSuiteResults" | "getSuiteResult" | "insertSuiteFileRuns" | "listSuiteFileRuns"
>;

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

/**
 * A stored result as the review's existing suite shape: `measured` carries the commands and failing files,
 * `unrunnable` is `not_measured` with its cause (never a pass).
 */
export function suiteRunOfResult(result: SuiteResultRecord): SuiteRun {
  if (result.status === "unrunnable") return { status: "not_measured", reason: result.cause ?? "the suite run did not complete" };
  return {
    status: "measured",
    commit: result.commit_sha,
    commands: result.commands.map((c) => ({ ...c })),
    skipped: result.skipped.map((s) => ({ ...s })),
    failing_test_files: result.failing_test_files.map((f) => ({ file: f.file, imports: [...f.imports] })),
  };
}

/**
 * The "main was checked at <commit>: red|green" rows the main-red ledger folds, derived from stored results (oldest
 * first). An `unrunnable` result, and a measured run that proves neither red nor green, checked nothing and yields no row.
 *
 * @param results - stored suite results, oldest first
 */
export function deriveMainCheckedRows(results: readonly SuiteResultRecord[]): MainRedRow[] {
  const rows: MainRedRow[] = [];
  for (const result of results) {
    if (result.status !== "measured") continue;
    const state = classifySuiteForMainRed(suiteRunOfResult(result));
    if (state.state === "unmeasured") continue;
    rows.push({
      action: MAIN_CHECKED_ACTION,
      timestamp: result.measured_at,
      details: { commit: result.commit_sha, status: state.state, at: result.measured_at },
    });
  }
  return rows;
}

/** Why a single file was run at a commit: a bisection probe, or the confirmation of one end of a transition (spec D6). */
export type SingleFileRunKind = "bisect" | "confirm";

/**
 * The value stored in `suite_file_runs.suite_result_id` for a single-file run at `commit`.
 * reason: the table has no foreign key and no (commit, file) column pair of its own; keying by this string avoids a
 * migration and makes "what did this file do at this commit" one indexed read (`listFileRuns`).
 */
export function singleFileRunKey(kind: SingleFileRunKind, commit: string): string {
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
   * The same service with `leases` wired: a caller that has the store's lease verbs binds them for the runs it starts
   * (BR-1511). Pure: the receiver is unchanged.
   */
  withLeases(leases: ReviewLeases): SuiteResultService {
    return new SuiteResultService({ ...this.deps, leases });
  }

  /**
   * The stored suite result of the commit `ref` names; runs the suite only when no `measured` result exists.
   *
   * @param ref - `main` or a commit sha
   * @param runner - runs the suite when the store has no measured result
   * @param inWorktree - optional work in the throwaway worktree after a FRESH run (never called on a stored hit)
   * @returns the measured result, or the `unrunnable` one this call just stored; `err` when the ref does not resolve or the store fails
   */
  async lookupOrRun(
    ref: string,
    runner: CommitSuiteRunnerPort,
    inWorktree?: (root: string, commit: string) => Promise<void>,
  ): Promise<Result<SuiteResultRecord, LoreError>> {
    const resolved = await runner.resolveCommit(ref);
    if (!resolved.ok) return resolved;
    const { commit, tree } = resolved.value;
    const stored = await this.deps.store.listSuiteResultsForCommit(commit);
    if (!stored.ok) return stored;
    const measured = stored.value.find((r) => r.status === "measured");
    if (measured !== undefined) return ok(measured);
    const leases = this.deps.leases;
    if (leases === undefined) return this.runAndStore(commit, tree, runner, inWorktree);
    // reason: BR-1511 — `suite:<commit>` single-flights the run. The holder (and each waiter, once the key is free)
    // re-reads the store before running: a waiter that skipped the re-read would run the suite a second time.
    return leases.withWaiting(suiteLeaseKey(commit), async () => {
      const again = await this.deps.store.listSuiteResultsForCommit(commit);
      if (!again.ok) return again;
      const done = again.value.find((r) => r.status === "measured");
      if (done !== undefined) return ok(done);
      return this.runAndStore(commit, tree, runner, inWorktree);
    });
  }

  /** Runs the suite at `commit` and stores the result as the next attempt of that commit (never returns a cached row). */
  private async runAndStore(
    commit: string,
    tree: string,
    runner: CommitSuiteRunnerPort,
    inWorktree?: (root: string, commit: string) => Promise<void>,
  ): Promise<Result<SuiteResultRecord, LoreError>> {
    const stored = await this.deps.store.listSuiteResultsForCommit(commit);
    if (!stored.ok) return stored;
    const attempt = (stored.value.at(-1)?.attempt ?? 0) + 1;

    const startedMs = this.deps.clockMs();
    const ran = await runner.runSuite(commit, inWorktree);
    const durationMs = Math.max(0, Math.round(this.deps.clockMs() - startedMs));
    const base = { id: this.deps.newId(), commit_sha: commit, tree_sha: tree, attempt, duration_ms: durationMs, measured_at: this.deps.now() };
    let record: SuiteResultRecord;
    const nonRun = ran.ok && ran.value.status === "measured" ? ran.value.commands.find((c) => !isTestResultExit(c.exit_code)) : undefined;
    if (ran.ok && ran.value.status === "measured" && nonRun === undefined) {
      record = {
        ...base,
        status: "measured",
        cause: null,
        commands: ran.value.commands.map((c) => ({ ...c })),
        skipped: ran.value.skipped.map((s) => ({ ...s })),
        failing_test_files: ran.value.failing_test_files.map((f) => ({ file: f.file, imports: [...f.imports] })),
      };
    } else {
      // reason: an incomplete run is a stored fact with its cause, not a missing row, so the attempt count survives and
      // the review can say "unrunnable (attempt 2): <cause>" instead of silently treating it as green (BR-1497).
      // reason: a command that exited outside {0, 1} never ran the tests; stored `measured` it read as "every file passed" (exit 5 = oracle lock contended).
      const cause = nonRun !== undefined ? nonRunCause(nonRun.command, nonRun.exit_code, nonRun.output_tail) : ran.ok ? (ran.value.status === "not_measured" ? ran.value.reason : "the suite run did not complete") : loreErrorText(ran.error);
      record = { ...base, status: "unrunnable", cause, commands: [], skipped: [], failing_test_files: [] };
    }
    const inserted = await this.deps.store.insertSuiteResult(record);
    if (!inserted.ok) return inserted;
    return ok(record);
  }

  /**
   * {@link lookupOrRun} plus work that must run at the commit in a throwaway worktree EXACTLY once per call, whether the
   * suite result was cached or not: on a fresh run it rides the suite's own worktree (no second checkout or install); on a
   * stored hit it gets a worktree of its own. The post-landing batch uses it for landed-criteria attestation, and `assess`
   * for the stale cited-rule refresh (A1 noted the refresh was skipped on a stored hit).
   *
   * @param ref - `main` or a commit sha
   * @param runner - runs the suite on a miss; must implement `withWorktree` for the stored-hit case
   * @param work - awaited with the worktree root and the commit
   * @returns the commit's result; `workError` set when the work could not be run (the worktree could not be made, or an
   *   unrunnable fresh run left none); `err` when the lookup itself fails
   */
  async lookupOrRunWith(
    ref: string,
    runner: CommitSuiteRunnerPort,
    work: (root: string, commit: string) => Promise<void>,
  ): Promise<Result<LookupWithWorkOutcome, LoreError>> {
    let workRan = false;
    const looked = await this.lookupOrRun(ref, runner, async (root, commit) => {
      workRan = true;
      await work(root, commit);
    });
    if (!looked.ok) return looked;
    const result = looked.value;
    if (workRan) return ok({ result, workIn: "suite" });
    if (result.status !== "measured") {
      return ok({ result, workError: { code: "STORE_ERROR", message: `the suite could not run at ${result.commit_sha}, so there is no worktree to work in: ${result.cause ?? "unrunnable"}` } });
    }
    if (runner.withWorktree === undefined) {
      return err({ code: "VALIDATION_ERROR", field: "runner.withWorktree", message: "the suite result of this commit is stored and the runner cannot open a worktree for the extra work", rule: "BR-1497" });
    }
    const ran = await runner.withWorktree(result.commit_sha, (root) => work(root, result.commit_sha));
    return ran.ok ? ok({ result, workIn: "own" }) : ok({ result, workError: ran.error });
  }

  /**
   * Re-runs the named test files at the commit of a stored result and stores one row per file attached to it.
   *
   * @param suiteResultId - id of the stored result the re-run belongs to
   * @param files - repo-relative test files (at least one)
   * @param runner - runs the files at the result's commit (or at `atCommit`)
   * @param atCommit - re-run at this commit instead (the landing's `main_before`); the rows are still attached to `suiteResultId` and carry this commit
   * @returns the stored per-file rows; `err` for an unknown result id, no files, a runner failure or a store failure
   */
  async rerunFiles(
    suiteResultId: string,
    files: readonly string[],
    runner: CommitSuiteRunnerPort,
    atCommit?: string,
  ): Promise<Result<SuiteFileRunRecord[], LoreError>> {
    if (files.length === 0) return err({ code: "VALIDATION_ERROR", field: "files", message: "rerunFiles needs at least one test file", rule: "BR-1497" });
    const found = await this.deps.store.getSuiteResult(suiteResultId);
    if (!found.ok) return found;
    if (found.value === null) {
      return err({ code: "VALIDATION_ERROR", field: "suite_result_id", message: `no stored suite result "${suiteResultId}"`, rule: "BR-1497" });
    }
    const commit = atCommit ?? found.value.commit_sha;
    const ran = await runner.runFiles(commit, files);
    if (!ran.ok) return ran;
    const measuredAt = this.deps.now();
    const rows: SuiteFileRunRecord[] = ran.value.map((o) => ({
      suite_result_id: suiteResultId,
      commit_sha: commit,
      file: o.file,
      exit_code: o.exit_code,
      output_tail: o.output_tail,
      duration_ms: o.duration_ms,
      measured_at: measuredAt,
    }));
    const inserted = await this.deps.store.insertSuiteFileRuns(rows);
    if (!inserted.ok) return inserted;
    return ok(rows);
  }

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
    // reason: a timed-out run says nothing about the file; storing it as a red row would charge a plan for a hang (BR-1496).
    if (outcome.incomplete !== undefined) {
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
    };
    const inserted = await this.deps.store.insertSuiteFileRuns([row]);
    if (!inserted.ok) return inserted;
    // reason: the insert is ignored when a concurrent review stored this (key, file) first; read back the winner so every review sees one outcome.
    const stored = await this.firstStoredFileRun(key, file);
    if (!stored.ok) return stored;
    if (stored.value === null) return err({ code: "STORE_ERROR", message: `the single-file run of ${file} at ${commit} was not found after it was stored` });
    return ok(stored.value);
  }

  /** The earliest stored row of `file` under `key`, or null when none is stored. */
  private async firstStoredFileRun(key: string, file: string): Promise<Result<SuiteFileRunRecord | null, LoreError>> {
    const rows = await this.deps.store.listSuiteFileRuns(key);
    if (!rows.ok) return rows;
    return ok(rows.value.find((r) => r.file === file) ?? null);
  }

  /** The per-file re-runs stored for a result, in the order they ran. */
  listFileRuns(suiteResultId: string): Promise<Result<SuiteFileRunRecord[], LoreError>> {
    return this.deps.store.listSuiteFileRuns(suiteResultId);
  }

  /** Every stored suite result, oldest first (regression at the assessed commit reads the known state of each commit from it). */
  listResults(): Promise<Result<SuiteResultRecord[], LoreError>> {
    return this.deps.store.listSuiteResults();
  }

  /** The main-checked rows (red or green per measured commit) derived from every stored result, oldest first. */
  async listMainCheckedRows(): Promise<Result<MainRedRow[], LoreError>> {
    const all = await this.deps.store.listSuiteResults();
    if (!all.ok) return all;
    return ok(deriveMainCheckedRows(all.value));
  }
}
