/**
 * Runs the selector's test files at the selection commit L in chunks that fit the time limit, storing each chunk's results as it
 * ends, and reusing every result already stored at L (BR-1496, BR-1497; issue #568).
 *
 * Purpose: a CLI-core plan selects ~90% of the test tree; one invocation for all of it timed out under load, stored nothing and
 *   restarted from zero on every retry. Here the files WITHOUT a stored result at L are split into chunks, run one chunk after
 *   the other in the one prepared worktree, and each chunk's per-file results are stored before the next chunk starts.
 * Public surface: runSelectionAtL, planSelectionChunks, SelectionRun, StoredSelectionRow, SelectionRunPorts,
 *   MAX_CHUNK_FILES, CHUNK_BUDGET_MS, DEFAULT_FILE_ESTIMATE_MS, DURATION_HISTORY_COMMITS, MAX_CONSECUTIVE_FAILED_CHUNKS.
 * Invariants:
 *   - A file has a result at L when a `batch` row (else a `bisect` / `confirm` single-file row) is stored for (L, file); only files
 *     without one are run. A retry after a timeout therefore runs only what is missing.
 *   - Chunk sizing: files keep the selector's order; a chunk closes when it holds MAX_CHUNK_FILES files or its expected time would
 *     pass CHUNK_BUDGET_MS. A file's expected time is its latest stored SINGLE-FILE duration (`bisect` / `confirm` rows at L and on the
 *     last DURATION_HISTORY_COMMITS commits of the history; a batch row's duration is the whole batch's, so it says nothing about one file),
 *     else DEFAULT_FILE_ESTIMATE_MS. One file always fits a chunk of its own.
 *   - A chunk's rows are stored when it ends (`runBatch` stores the files the runner finished, even when the chunk timed out); a chunk that
 *     could not complete costs only the files it did not finish, which stay without a result. After MAX_CONSECUTIVE_FAILED_CHUNKS failed
 *     chunks in a row the rest is not tried (the machine or the worktree is not usable now); those files are named as remaining.
 *   - `bun run build` runs (`buildFirst`) only for a chunk holding a file that declares `@spawns dist/lore`, until one build completed.
 *   - Nothing here decides a verdict: the caller reads `remaining` (not measured while it is non-empty) and the rows.
 * Side-effect class: IO through the injected ports only (stored-row reads, batched runs which store).
 *
 * Reference: Google TAP / Bazel test sharding (bounded shards, results cached per target so a retry runs only the missing ones).
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (AC-SC-3, BR-1496, BR-1497)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { SuiteFileRunRecord } from "../store/store-interface.js";
import { decidingRun, loreErrorText, singleFileRunKey, type CommitSuiteRunnerPort, type RunBatchOptions, type SingleFileRunKind } from "./suite-result-service.js";

/** Most files in one chunk. */
export const MAX_CHUNK_FILES = 100;
/** Expected wall time of one chunk (a tenth of the 60-minute invocation limit leaves room for a loaded machine). */
export const CHUNK_BUDGET_MS = 10 * 60 * 1000;
/** Expected time of a file with no stored single-file duration. */
export const DEFAULT_FILE_ESTIMATE_MS = 4000;
/** How many of the newest history commits are searched for stored single-file durations. */
export const DURATION_HISTORY_COMMITS = 64;
/** Failed chunks in a row after which the remaining chunks are not tried. */
export const MAX_CONSECUTIVE_FAILED_CHUNKS = 2;

const DURATION_KINDS: readonly SingleFileRunKind[] = ["bisect", "confirm"];

/** The slice of the suite service and runner this module drives. */
export interface SelectionRunPorts {
  readonly listFileRuns: (key: string) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
  /** Runs the files together in ONE invocation; stores the files the runner finished; `err` when any file did not complete. */
  readonly runBatch: (commit: string, files: readonly string[], runner: CommitSuiteRunnerPort, options?: RunBatchOptions) => Promise<Result<SuiteFileRunRecord[], LoreError>>;
  readonly runner: CommitSuiteRunnerPort;
}

/** A stored result of one selected file at L and the kind it was stored under. */
export interface StoredSelectionRow {
  readonly kind: "batch" | SingleFileRunKind;
  readonly row: SuiteFileRunRecord;
}

/** What the selection run at L produced. */
export interface SelectionRun {
  /** The stored result of every selected file that has one, in the selector's order. */
  readonly rows: readonly StoredSelectionRow[];
  /** Selected files still without a result, in the selector's order. */
  readonly remaining: readonly string[];
  /** One text per chunk that did not complete (what the runner or the store said). */
  readonly failures: readonly string[];
  /**
   * Files this call ran whose run was inconclusive (only timeouts, BR-1533): stored, not a result, never retried inside this call.
   * They are not in `rows` and not in `remaining`; the caller reports each as not measured (cause timeout).
   */
  readonly inconclusive: readonly { readonly file: string; readonly cause: "timeout" | "no-report" }[];
  /** Files that already had a result when the run started (not run again). */
  readonly reused: number;
}

/**
 * Splits `files` (order kept) into chunks by count and by expected time.
 *
 * @param files - repo-relative test files
 * @param expectedMs - a file's expected time in ms (a positive number)
 * @returns the chunks; empty for no files
 */
export function planSelectionChunks<T extends { readonly path: string }>(files: readonly T[], expectedMs: (path: string) => number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentMs = 0;
  for (const file of files) {
    const cost = expectedMs(file.path);
    if (current.length > 0 && (current.length >= MAX_CHUNK_FILES || currentMs + cost > CHUNK_BUDGET_MS)) {
      chunks.push(current);
      current = [];
      currentMs = 0;
    }
    current.push(file);
    currentMs += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The stored results at `commit` for `files`, preferring a batch row over a single-file one. */
async function storedResultsAt(commit: string, files: readonly string[], listFileRuns: SelectionRunPorts["listFileRuns"]): Promise<Result<Map<string, StoredSelectionRow>, LoreError>> {
  const found = new Map<string, StoredSelectionRow>();
  const wanted = new Set(files);
  for (const kind of ["batch", ...DURATION_KINDS] as const) {
    const rows = await listFileRuns(singleFileRunKey(kind, commit));
    if (!rows.ok) return rows;
    // reason: BR-1533 — only a conclusive run is a result at L; an inconclusive one leaves the file without a result, so a retry runs it.
    for (const file of wanted) {
      if (found.has(file)) continue;
      const row = decidingRun(rows.value.filter((r) => r.file === file && r.commit_sha === commit));
      if (row !== undefined) found.set(file, { kind, row });
    }
  }
  return ok(found);
}

/** The latest stored single-file duration of each file, searched at L and on the newest history commits. */
async function storedDurations(files: readonly string[], commits: readonly string[], listFileRuns: SelectionRunPorts["listFileRuns"]): Promise<Result<Map<string, number>, LoreError>> {
  const wanted = new Set(files);
  const durations = new Map<string, number>();
  // reason: newest commit last, so a later row overwrites an older one: the latest measurement wins.
  for (const commit of commits) {
    for (const kind of DURATION_KINDS) {
      const rows = await listFileRuns(singleFileRunKey(kind, commit));
      if (!rows.ok) return rows;
      for (const row of rows.value) if (wanted.has(row.file) && row.duration_ms > 0) durations.set(row.file, row.duration_ms);
    }
  }
  return ok(durations);
}

/**
 * Runs the selected files at `commit` that have no stored result, in chunks, and reads back what is stored.
 *
 * @param commit - the selection commit L (a full sha)
 * @param selected - the selector's files, in its order
 * @param history - main's first-parent history, oldest first (the newest commits are searched for durations)
 * @param ports - stored-row reads, the batched run, the runner
 * @returns the stored results and what remains; `err` only when a stored row cannot be read
 */
export async function runSelectionAtL(
  commit: string,
  selected: readonly { readonly path: string; readonly needsCompiledBinary: boolean }[],
  history: readonly string[],
  ports: SelectionRunPorts,
): Promise<Result<SelectionRun, LoreError>> {
  const paths = selected.map((f) => f.path);
  const before = await storedResultsAt(commit, paths, ports.listFileRuns);
  if (!before.ok) return err({ code: "STORE_ERROR", message: `stored results at ${commit} could not be read: ${loreErrorText(before.error)}` });
  const missing = selected.filter((f) => !before.value.has(f.path));
  const failures: string[] = [];
  const inconclusive = new Map<string, "timeout" | "no-report">();
  if (missing.length > 0) {
    const durationCommits = [...history.slice(-DURATION_HISTORY_COMMITS).filter((c) => c !== commit), commit];
    const durations = await storedDurations(missing.map((f) => f.path), durationCommits, ports.listFileRuns);
    if (!durations.ok) return err({ code: "STORE_ERROR", message: `stored durations could not be read: ${loreErrorText(durations.error)}` });
    const chunks = planSelectionChunks(missing, (path) => durations.value.get(path) ?? DEFAULT_FILE_ESTIMATE_MS);
    let built = false;
    let failedInARow = 0;
    for (const [index, chunk] of chunks.entries()) {
      const buildFirst = !built && chunk.some((f) => f.needsCompiledBinary);
      const ran = await ports.runBatch(commit, chunk.map((f) => f.path), ports.runner, { buildFirst });
      if (ran.ok) {
        const timedOut = ran.value.filter((row) => row.classification === "inconclusive");
        for (const row of timedOut) inconclusive.set(row.file, row.inconclusive_cause === "no-report" ? "no-report" : "timeout");
        // reason: a chunk in which EVERY file timed out is a failed chunk for the stop rule (a machine that times out every chunk would
        // otherwise spend the full limit on each remaining chunk); a chunk with some conclusive file made progress.
        if (timedOut.length < ran.value.length) {
          failedInARow = 0;
          if (buildFirst) built = true;
          continue;
        }
        failures.push(`chunk ${String(index + 1)} of ${String(chunks.length)} (${String(chunk.length)} files): no file concluded (timeouts or no outcome report)`);
        failedInARow += 1;
        if (failedInARow >= MAX_CONSECUTIVE_FAILED_CHUNKS && index + 1 < chunks.length) {
          failures.push(`${String(chunks.length - index - 1)} later chunk(s) not tried after ${String(failedInARow)} failed chunks in a row`);
          break;
        }
        continue;
      }
      failures.push(`chunk ${String(index + 1)} of ${String(chunks.length)} (${String(chunk.length)} files): ${loreErrorText(ran.error)}`);
      failedInARow += 1;
      if (failedInARow >= MAX_CONSECUTIVE_FAILED_CHUNKS && index + 1 < chunks.length) {
        failures.push(`${String(chunks.length - index - 1)} later chunk(s) not tried after ${String(failedInARow)} failed chunks in a row`);
        break;
      }
    }
  }
  const after = await storedResultsAt(commit, paths, ports.listFileRuns);
  if (!after.ok) return err({ code: "STORE_ERROR", message: `stored results at ${commit} could not be read: ${loreErrorText(after.error)}` });
  const rows = paths.flatMap((path) => {
    const stored = after.value.get(path);
    return stored === undefined ? [] : [stored];
  });
  return ok({
    rows,
    remaining: paths.filter((path) => !after.value.has(path) && !inconclusive.has(path)),
    failures,
    inconclusive: paths.flatMap((path) => {
      const cause = inconclusive.get(path);
      return after.value.has(path) || cause === undefined ? [] : [{ file: path, cause }];
    }),
    reused: before.value.size,
  });
}
