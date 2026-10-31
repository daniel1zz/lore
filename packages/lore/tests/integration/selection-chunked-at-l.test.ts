// @spawns-external bun imports assess-suite-runner for its pure outcome functions only; this file starts no process (the runner here is a fake)
/**
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (BR-1496, BR-1497)
 *
 * #568: the selection at L runs in chunks that fit the time limit; each chunk's per-file results are stored as it ends; a chunk
 * that times out loses only its own unfinished files; a second assess runs only the files without a result; the final measured
 * result equals an unchunked run. The real SuiteResultService over the in-memory store, a FAKE runner whose per-invocation behaviour
 * (finish, or time out after N files) is scripted, and stored single-file durations standing in for the clock.
 *
 * Dimensions: HAPPY (chunking by count and by duration, equal to an unchunked run), NEGATIVE (a timed-out chunk is not stored,
 * not-measured names how many remain), STATE (per-chunk storage visible between chunks; a retry runs only the missing files),
 * ERROR (consecutive failed chunks stop the run), BOUNDARY (finished-file lines of a timed-out run), REGRESSION (head recheck and
 * attribution unchanged for a red file).
 */

import { describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import { finishedTestFiles, outcomesOfTogetherRun } from "../../src/adapters/cli/assess-suite-runner.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { regressionAtHead, type RegressionAtHead, type RegressionAtHeadPorts } from "../../src/service/regression-at-head.js";
import { CHUNK_BUDGET_MS, DEFAULT_FILE_ESTIMATE_MS, MAX_CHUNK_FILES, MAX_CONSECUTIVE_FAILED_CHUNKS, planSelectionChunks } from "../../src/service/selection-run-at-l.js";
import { SuiteResultService, singleFileRunKey, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../src/service/suite-result-service.js";

const sha = (index: number): string => index.toString(16).padStart(40, "0");
const fileName = (index: number): string => `packages/x/tests/f${String(index).padStart(4, "0")}.test.ts`;
const filesOf = (count: number): string[] => Array.from({ length: count }, (_, i) => fileName(i));
/** The plan lands at history position 5, which is also main's head: L = head, no head recheck. */
const LANDING = 5;
const TIMEOUT_CAUSE = "timed out after 3600000 ms";

/** What one invocation does: finish every file, or time out after `finished` files (the rest incomplete). */
type Behaviour = { readonly timeoutAfter?: number };

function build(files: readonly string[], redFiles: ReadonlySet<string> = new Set(), behaviourOf: (invocation: number) => Behaviour = () => ({})) {
  const store = new InMemoryStore();
  let tick = 0;
  const service = new SuiteResultService({
    store,
    now: () => `2026-10-31T10:00:00.${String(++tick).padStart(3, "0")}Z`,
    newId: () => `suite-chunk-${String(++tick)}`,
    clockMs: () => tick * 10,
  });
  const together: { commit: string; files: string[]; storedBefore: number }[] = [];
  const alone: { commit: string; file: string }[] = [];
  const outcomeOf = (commit: string, file: string): FileRunOutcome => ({
    file,
    exit_code: redFiles.has(file) && Number.parseInt(commit, 16) >= LANDING ? 1 : 0,
    output_tail: "",
    duration_ms: 7,
  });
  const storedCount = async (): Promise<number> => {
    const rows = await store.listSuiteFileRuns(singleFileRunKey("batch", sha(LANDING)));
    return rows.ok ? rows.value.length : -1;
  };
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: ref === "main" ? sha(LANDING) : ref, tree: sha(0) }),
    runFiles: async (commit, list) => {
      for (const file of list) alone.push({ commit, file });
      return ok(list.map((file) => outcomeOf(commit, file)));
    },
    runFilesTogether: async (commit, list) => {
      const invocation = together.length;
      together.push({ commit, files: [...list], storedBefore: await storedCount() });
      const behaviour = behaviourOf(invocation);
      return ok(list.map((file, index): FileRunOutcome => (behaviour.timeoutAfter !== undefined && index >= behaviour.timeoutAfter ? { file, exit_code: 1, output_tail: "", duration_ms: 3_600_000, incomplete: TIMEOUT_CAUSE } : outcomeOf(commit, file))));
    },
    disposeWorktrees: async () => ok(undefined),
  };
  const ports: RegressionAtHeadPorts = {
    suites: service,
    runner,
    selectTests: async ({ commit }) => ok({ commit, selected: files.map((path) => ({ path, needsCompiledBinary: false })), totalTestFiles: files.length, unparseable: [], removedTests: [], accounting: `commit: ${commit}` }),
    headRef: "main",
    firstParentHistory: async () => ok(Array.from({ length: LANDING + 1 }, (_, i) => sha(i))),
    fileExistsAt: async () => ok(true),
    firstParentCommitContaining: async () => ok(undefined),
  };
  const measure = async (): Promise<RegressionAtHead> => {
    const r = await regressionAtHead([{ landing_commit: sha(LANDING), main_before: sha(LANDING - 1), task_slugs: ["task-1"] }], [], ports);
    if (!r.ok) throw new Error(`regressionAtHead failed: ${r.error.code}`);
    return r.value;
  };
  const storeSingle = async (kind: "bisect" | "confirm", commitIndex: number, file: string, durationMs: number): Promise<void> => {
    const inserted = await store.insertSuiteFileRuns([
      { suite_result_id: singleFileRunKey(kind, sha(commitIndex)), commit_sha: sha(commitIndex), file, exit_code: 0, output_tail: "", duration_ms: durationMs, measured_at: "2026-10-30T09:00:00.000Z", classification: "green", inconclusive_cause: null },
    ]);
    if (!inserted.ok) throw new Error(`fixture row not stored: ${inserted.error.code}`);
  };
  return { store, together, alone, measure, storeSingle, storedCount };
}

describe("chunking the selection at L", () => {
  it("BR-1497 a selection larger than one chunk runs as sequential chunks of at most the file cap, in the selector's order, each stored as it ends", async () => {
    const files = filesOf(MAX_CHUNK_FILES * 2 + 50);
    const f = build(files);
    const r = await f.measure();
    expect(f.together.map((i) => i.files.length)).toEqual([MAX_CHUNK_FILES, MAX_CHUNK_FILES, 50]);
    expect(f.together.flatMap((i) => i.files)).toEqual(files);
    // per-chunk storage: when chunk k starts, the chunks before it are already stored
    expect(f.together.map((i) => i.storedBefore)).toEqual([0, MAX_CHUNK_FILES, MAX_CHUNK_FILES * 2]);
    expect(await f.storedCount()).toBe(files.length);
    expect(r.rows[0]).toMatchObject({ verdict: "pass" });
    expect(r.rows[0]?.detail).toContain(`${String(files.length)} selected test files`);
  });

  it("BR-1497 stored single-file durations close a chunk by expected time: 4-minute files fit two to a 10-minute chunk, files without a duration count the default", async () => {
    const files = filesOf(5);
    const f = build(files);
    // f0..f2 took 4 minutes alone at an earlier commit (any commit on the history); f3, f4 have no stored duration
    for (const file of files.slice(0, 3)) await f.storeSingle("bisect", 2, file, 4 * 60 * 1000);
    await f.measure();
    expect(f.together.map((i) => i.files)).toEqual([[files[0], files[1]], [files[2], files[3], files[4]]]);
    expect(DEFAULT_FILE_ESTIMATE_MS * 3 + 4 * 60 * 1000).toBeLessThan(CHUNK_BUDGET_MS);
  });

  it("BR-1497 planSelectionChunks: one file longer than the budget still gets a chunk of its own, no files are lost or reordered", () => {
    const items = filesOf(4).map((path) => ({ path }));
    const chunks = planSelectionChunks(items, (path) => (path === fileName(1) ? CHUNK_BUDGET_MS * 3 : 1000));
    expect(chunks.map((c) => c.map((x) => x.path))).toEqual([[fileName(0)], [fileName(1)], [fileName(2), fileName(3)]]);
    expect(planSelectionChunks([], () => 1)).toEqual([]);
  });
});

describe("a chunk that times out", () => {
  it("BR-1497 loses only its own files: the other chunks are stored, not-measured names how many of N remain, cause unrunnable", async () => {
    const files = filesOf(MAX_CHUNK_FILES * 3);
    // the second chunk times out before finishing any file; the first and third finish
    const f = build(files, new Set(), (invocation) => (invocation === 1 ? { timeoutAfter: 0 } : {}));
    const r = await f.measure();
    expect(f.together).toHaveLength(3);
    expect(await f.storedCount()).toBe(MAX_CHUNK_FILES * 2);
    const row = r.rows[0];
    expect(row).toMatchObject({ verdict: "not-measured", cause: "unrunnable" });
    expect(row?.detail).toContain(`${String(MAX_CHUNK_FILES)} of ${String(files.length)} selected test files have no result yet`);
    expect(row?.detail).toContain(TIMEOUT_CAUSE);
    expect(r.causes).toEqual(["unrunnable"]);
  });

  it("BR-1497 a chunk that timed out after finishing some files keeps those; a second assess runs only the files still without a result, and the final result equals an unchunked run", async () => {
    const files = filesOf(MAX_CHUNK_FILES + 20);
    const red = new Set([files[3] as string]);
    const f = build(files, red, (invocation) => (invocation === 0 ? { timeoutAfter: 30 } : {}));
    const first = await f.measure();
    expect(first.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(first.rows[0]?.detail).toContain(`${String(MAX_CHUNK_FILES - 30)} of ${String(files.length)}`);
    expect(await f.storedCount()).toBe(30 + 20); // 30 of chunk 1 and all 20 of chunk 2
    // chunk 2 finished and is stored; the retry runs only the unfinished files of chunk 1, in the selector's order
    const invocationsBefore = f.together.length;
    const second = await f.measure();
    const retried = f.together.slice(invocationsBefore).flatMap((i) => i.files);
    expect(retried).toEqual(files.slice(30, MAX_CHUNK_FILES));
    expect(await f.storedCount()).toBe(files.length);
    // the same fixture unchunked (every file fits one chunk): the measured result is the same
    const unchunkedFiles = files.slice(0, 40);
    const smallRed = new Set([unchunkedFiles[3] as string]);
    const whole = build(unchunkedFiles, smallRed);
    const wholeResult = await whole.measure();
    expect(whole.together).toHaveLength(1);
    const chunkedSmall = build(unchunkedFiles, smallRed, (invocation) => (invocation === 0 ? { timeoutAfter: 10 } : {}));
    await chunkedSmall.measure();
    const chunkedResult = await chunkedSmall.measure();
    const shape = (x: RegressionAtHead): unknown => ({ files: x.files, charged: x.charged, causes: x.causes, rows: x.rows.map((row) => ({ subject: row.subject, verdict: row.verdict })) });
    expect(shape(chunkedResult)).toEqual(shape(wholeResult));
    // the retried selection of the first fixture is measured too
    expect(second.rows[0]?.verdict).toBe("pass");
    expect(second.files.map((x) => x.file)).toEqual([files[3]]);
  });

  it("BR-1497 MAX_CONSECUTIVE_FAILED_CHUNKS failed chunks in a row stop the run: later chunks are not tried and are counted as remaining", async () => {
    const files = filesOf(MAX_CHUNK_FILES * 4);
    const f = build(files, new Set(), () => ({ timeoutAfter: 0 }));
    const r = await f.measure();
    expect(f.together).toHaveLength(MAX_CONSECUTIVE_FAILED_CHUNKS);
    expect(r.rows[0]?.detail).toContain(`${String(files.length)} of ${String(files.length)} selected test files have no result yet`);
    expect(r.rows[0]?.detail).toContain("not tried");
  });
});

describe("the head recheck and attribution on a chunked selection", () => {
  it("BR-1497 a file red at L is attributed exactly as before: red at the landing and below it green is charged to the landing", async () => {
    const files = filesOf(MAX_CHUNK_FILES + 5);
    const red = fileName(MAX_CHUNK_FILES + 2);
    const f = build(files, new Set([red]));
    const r = await f.measure();
    expect(f.together).toHaveLength(2);
    expect(r.charged).toEqual([{ file: red, landing: sha(LANDING) }]);
    // only the red file was run alone (floor and confirmations); no green file was
    expect([...new Set(f.alone.map((x) => x.file))]).toEqual([red]);
  });
});

describe("what a timed-out run shows as finished", () => {
  it("BR-1497 a run the limit ended keeps the files whose result line was printed; a file with no line is incomplete, never green", () => {
    const output = ["✓ packages/x/tests/a.test.ts (3 tests) 12ms", "❯ packages/x/tests/b.test.ts (2 tests | 1 failed) 40ms", "❯ packages/x/tests/c.test.ts (4 tests) 9ms"].join("\n");
    expect([...finishedTestFiles(output)]).toEqual([
      ["packages/x/tests/a.test.ts", 0],
      ["packages/x/tests/b.test.ts", 1],
    ]);
    const files = ["packages/x/tests/a.test.ts", "packages/x/tests/b.test.ts", "packages/x/tests/c.test.ts", "packages/x/tests/d.test.ts"];
    const outcomes = outcomesOfTogetherRun(files, { status: 1, output, durationMs: 5, incomplete: TIMEOUT_CAUSE });
    expect(outcomes.map((o) => [o.file, o.exit_code, o.incomplete])).toEqual([
      [files[0], 0, undefined],
      [files[1], 1, undefined],
      [files[2], 1, TIMEOUT_CAUSE],
      [files[3], 1, TIMEOUT_CAUSE],
    ]);
  });

  it("BR-1497 a timed-out run whose output names no file marks every file incomplete (the dot reporter case)", () => {
    const outcomes = outcomesOfTogetherRun(["packages/x/tests/a.test.ts"], { status: 1, output: "....", durationMs: 5, incomplete: TIMEOUT_CAUSE });
    expect(outcomes[0]).toMatchObject({ exit_code: 1, incomplete: TIMEOUT_CAUSE });
  });
});
