/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-1, BR-1496)
 *
 * Regression at the assessed commit with a fake single-file runner over a fake first-parent history and the real
 * SuiteResultService over the in-memory store.
 *
 * Dimensions: HAPPY (a transition at a plan landing is charged), NEGATIVE (another commit, red-before, flaky and a
 * disagreeing confirmation are not charged), BOUNDARY (absent file, transition at the first/last commit, no landing),
 * ERROR (a run that cannot complete, an unrunnable head suite: not-measured, never pass), STATE (a stored pass is the
 * lower bound; a second review of the same head runs nothing), REGRESSION (per-landing measurement, touched-or-imports
 * attribution and trusting every bisection step are the false greens this guards).
 */

import { describe, expect, it } from "vitest";
import { err, ok, type LoreError, type MilestoneFacts, type Result } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SuiteResultService, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../../src/service/suite-result-service.js";
import type { SuiteRun } from "../../../src/service/milestone-review-inputs.js";
import { factsDimensions } from "../../../src/service/milestone-review-judgment.js";
import {
  regressionAtHead,
  regressionBisectionBudget,
  type RegressionAtHeadPorts,
  type RegressionLandingInput,
} from "../../../src/service/regression-at-head.js";

const FILE = "packages/x/tests/x.test.ts";
const OTHER = "packages/x/tests/other.test.ts";
const sha = (index: number): string => index.toString(16).padStart(40, "0");

const landingAt = (index: number): RegressionLandingInput => ({ landing_commit: sha(index), main_before: sha(index - 1), task_slugs: [`task-${String(index)}`] });

/** How one file behaves along the history. */
interface FileModel {
  /** First commit index at which the file exists (default 0). */
  readonly existsFrom?: number;
  /** First commit index at which it is red (every later commit too), unless `redWhen` decides. */
  readonly redFrom?: number;
  /** Overrides `redFrom` per commit index. */
  readonly redWhen?: (index: number) => boolean;
  /** Exit codes of successive single-file runs at an index (the last repeats); overrides the model for those runs. */
  readonly sequence?: Readonly<Record<number, readonly number[]>>;
}

interface Script {
  /** Number of commits on main (head is the last). */
  readonly commits: number;
  readonly files: Readonly<Record<string, FileModel>>;
  readonly failRunFiles?: boolean;
  readonly unrunnableHead?: boolean;
  /** Landing commits OFF the first-parent chain (by sha index) and the chain commit index that brought each in. */
  readonly containing?: Readonly<Record<number, number>>;
}

interface Fixture {
  readonly ports: RegressionAtHeadPorts;
  readonly service: SuiteResultService;
  readonly suiteRuns: string[];
  readonly fileRuns: { commit: string; file: string }[];
  readonly head: string;
}

function build(script: Script, shared?: { store: InMemoryStore }): Fixture {
  const store = shared?.store ?? new InMemoryStore();
  let n = 0;
  const service = new SuiteResultService({ store, now: () => `2026-10-29T10:00:00.${String(++n).padStart(3, "0")}Z`, newId: () => `suite-rah-${String(++n)}`, clockMs: () => n * 10 });
  const headIndex = script.commits - 1;
  const indexOf = (commit: string): number => Number.parseInt(commit, 16);
  const exists = (file: string, index: number): boolean => index >= (script.files[file]?.existsFrom ?? 0);
  const redAt = (file: string, index: number): boolean => {
    const model = script.files[file];
    if (model === undefined || !exists(file, index)) return false;
    if (model.redWhen !== undefined) return model.redWhen(index);
    return model.redFrom !== undefined && index >= model.redFrom;
  };
  const suiteRuns: string[] = [];
  const fileRuns: { commit: string; file: string }[] = [];
  const seen = new Map<string, number>();
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: ref === "main" ? sha(headIndex) : ref, tree: sha(0) }),
    runSuite: async (commit): Promise<Result<SuiteRun, LoreError>> => {
      suiteRuns.push(commit);
      if (script.unrunnableHead === true) return ok({ status: "not_measured", reason: "checkout failed" });
      const failing = Object.keys(script.files).filter((file) => redAt(file, indexOf(commit)));
      return ok({
        status: "measured",
        commit,
        commands: [{ command: "bun run test", exit_code: failing.length > 0 ? 1 : 0, output_tail: "" }],
        skipped: [],
        failing_test_files: failing.map((file) => ({ file, imports: [] })),
      });
    },
    runFiles: async (commit, files) => runFilesAt(commit, files),
    // reason: the search runs files together (spec: one batched invocation per probed commit); the model has no interference, so a batch is the per-file runs.
    runFilesTogether: async (commit, files) => runFilesAt(commit, files),
  };
  async function runFilesAt(commit: string, files: readonly string[]): Promise<Result<readonly FileRunOutcome[], LoreError>> {
    for (const file of files) fileRuns.push({ commit, file });
    if (script.failRunFiles === true) return err({ code: "STORE_ERROR", message: "no test:file script" });
    return ok(
      files.map((file): FileRunOutcome => {
        const index = indexOf(commit);
        const key = `${String(index)}:${file}`;
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        const seq = script.files[file]?.sequence?.[index];
        const exit = seq !== undefined ? (seq[Math.min(count, seq.length - 1)] ?? 0) : redAt(file, index) ? 1 : 0;
        return { file, exit_code: exit, output_tail: `out ${key}`, duration_ms: 1 };
      }),
    );
  }
  const ports: RegressionAtHeadPorts = {
    suites: service,
    runner,
    headRef: "main",
    firstParentHistory: async (ref) => ok(Array.from({ length: indexOf(ref === "main" ? sha(headIndex) : ref) + 1 }, (_, i) => sha(i))),
    fileExistsAt: async (commit, file) => ok(exists(file, indexOf(commit))),
    firstParentCommitContaining: async (commit) => {
      const via = script.containing?.[indexOf(commit)];
      return ok(via === undefined ? undefined : sha(via));
    },
  };
  return { ports, service, suiteRuns, fileRuns, head: sha(headIndex) };
}

const dimensionOf = (rows: NonNullable<MilestoneFacts["regression"]>) => factsDimensions({ regression: rows }, []).regression;

async function measure(f: Fixture, landings: RegressionLandingInput[], unlanded: string[] = []) {
  const r = await regressionAtHead(landings, unlanded, f.ports);
  if (!r.ok) throw new Error(`regressionAtHead failed: ${r.error.code}`);
  return r.value;
}

describe("regression at the assessed commit", () => {
  it("AC-AO-1 a file red at head whose red transition is one of the plan's landing commits is the plan's regression and fails the gate", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } } });
    const r = await measure(f, [landingAt(3), landingAt(6)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(6) }]);
    expect(r.files[0]).toEqual({ file: FILE, outcome: "regression", landing: sha(6) });
    expect(dimensionOf(r.rows).verdict).toBe("fail");
    // false green guarded: per-landing measurement would run the suite at the landings; only the head is ever run
    expect(f.suiteRuns).toEqual([f.head]);
  });

  it("AC-AO-1 a file whose red transition is a commit that is not one of the plan's landings is listed with that commit and not charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 5 } } });
    const r = await measure(f, [landingAt(3), landingAt(7)]);
    expect(r.charged).toEqual([]);
    expect(r.files[0]).toEqual({ file: FILE, outcome: "other-commit", commit: sha(5) });
    expect(r.rows.find((row) => row.subject === FILE)?.detail).toContain(sha(5));
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AO-1 a file red at the lower bound (before the plan's first landing) is red-before: listed, never charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 1 } } });
    const r = await measure(f, [landingAt(4), landingAt(6)]);
    expect(r.files[0]).toEqual({ file: FILE, outcome: "red-before", commit: sha(3) });
    expect(r.charged).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  // retired by spec-a-plan-s-regression-reuses-a-stored-suite-that-contains: there is no per-file confirmation at head any more
  // (the suite read is the definition of red); a red that does not repeat alone is caught by the end confirmations instead.
  it("AC-AO-1 a file red in the suite at head whose first failing commit is green on its confirm run alone is flaky-bisection: not charged, no run at head", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 9, sequence: { 9: [0] } } } });
    const r = await measure(f, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured", cause: "flaky-bisection" });
    expect(r.charged).toEqual([]);
    // the only run at head is the confirmation of the transition (which here IS head); there is no separate head confirm
    expect(f.fileRuns.filter((run) => run.commit === f.head)).toEqual([{ commit: f.head, file: FILE }]);
  });

  it("AC-AO-1 a file absent before the plan's landing that is red at head is charged to the landing that added it, absent commits cost no run", async () => {
    const f = build({ commits: 10, files: { [FILE]: { existsFrom: 6, redFrom: 6 } } });
    const r = await measure(f, [landingAt(2), landingAt(6)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(6) }]);
    expect(f.fileRuns.every((run) => Number.parseInt(run.commit, 16) >= 6)).toBe(true);
  });

  it("AC-AO-1 a file the plan's first landing added at the very first commit of main is charged without a lower-bound run", async () => {
    const f = build({ commits: 4, files: { [FILE]: { redFrom: 0 } } });
    const r = await measure(f, [{ landing_commit: sha(0), main_before: sha(0).replace(/0$/, "f"), task_slugs: ["t"] }]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(0) }]);
  });

  it("AC-AO-1 when the end-confirmation disagrees the file is not measured, named flaky during bisection, never charged", async () => {
    // red from 6; the first run at 6 (a bisection probe) is red, its confirm run is green
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6, sequence: { 6: [1, 0] } } } });
    const r = await measure(f, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured" });
    expect(JSON.stringify(r.files[0])).toContain("flaky during bisection");
    expect(r.causes).toEqual(["flaky-bisection"]);
    expect(r.charged).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AO-1 a file that is red at a landing but green at head causes no run at all", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redWhen: (i) => i === 6 } } });
    const r = await measure(f, [landingAt(6)]);
    expect(f.fileRuns).toEqual([]);
    expect(r.files).toEqual([]);
    expect(r.rows[0]).toMatchObject({ subject: f.head, verdict: "pass" });
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AO-1 a single-file run that cannot complete makes regression not-measured, never pass", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } }, failRunFiles: true });
    const r = await measure(f, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured", cause: "unrunnable" });
    expect(r.causes).toEqual(["unrunnable"]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AO-1 a single-file run that timed out is not stored as red and makes the file not-measured, never charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } } });
    const timedOut: CommitSuiteRunnerPort = {
      ...f.ports.runner,
      runFiles: async (_commit, files) => ok(files.map((file): FileRunOutcome => ({ file, exit_code: 1, output_tail: "", duration_ms: 1, incomplete: "timed out after 3600000 ms" }))),
      runFilesTogether: async (_commit, files) => ok(files.map((file): FileRunOutcome => ({ file, exit_code: 1, output_tail: "", duration_ms: 1, incomplete: "timed out after 3600000 ms" }))),
    };
    const r = await measure({ ...f, ports: { ...f.ports, runner: timedOut } }, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured" });
    expect(JSON.stringify(r.files[0])).toContain("timed out");
    expect(r.charged).toEqual([]);
    const stored = await f.service.listFileRuns(`file-confirm@${f.head}`);
    expect(stored.ok && stored.value).toEqual([]);
  });

  it("AC-AO-1 an unrunnable head suite makes regression not-measured and runs no single file", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } }, unrunnableHead: true });
    const r = await measure(f, [landingAt(6)]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured", cause: "unrunnable" });
    expect(r.causes).toEqual(["unrunnable"]);
    expect(f.fileRuns).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AO-1 single-file runs per red file are at most ceil(log2(commits in range)) + 4 wherever the transition is", async () => {
    const commits = 20;
    for (let transition = 3; transition < commits; transition += 1) {
      const f = build({ commits, files: { [FILE]: { redFrom: transition } } });
      const r = await measure(f, [landingAt(3), landingAt(transition)]);
      // range: first parent of the earliest landing (index 2) exclusive .. head inclusive
      expect(f.fileRuns.length).toBeLessThanOrEqual(regressionBisectionBudget(commits - 1 - 2));
      expect(r.files[0], `transition ${String(transition)}`).toMatchObject({ file: FILE, outcome: "regression" });
    }
  });

  it("AC-AO-1 several red files are each bisected alone; one charged, one listed", async () => {
    const f = build({ commits: 12, files: { [FILE]: { redFrom: 8 }, [OTHER]: { redFrom: 5 } } });
    const r = await measure(f, [landingAt(4), landingAt(8)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(8) }]);
    expect(r.files.find((x) => x.file === OTHER)).toMatchObject({ outcome: "other-commit", commit: sha(5) });
  });

  it("AC-AO-1 a stored pass of the file in range is the lower bound: it is not run again and the range is smaller", async () => {
    const baseline = build({ commits: 20, files: { [FILE]: { redFrom: 15 } } });
    await measure(baseline, [landingAt(3), landingAt(15)]);
    const store = new InMemoryStore();
    const f = build({ commits: 20, files: { [FILE]: { redFrom: 15 } } }, { store });
    // a stored full-suite result at commit 12 that does not fail the file
    await f.service.lookupOrRun(sha(12), { ...f.ports.runner, runSuite: async (commit) => ok({ status: "measured", commit, commands: [], skipped: [], failing_test_files: [] }) });
    const r = await measure(f, [landingAt(3), landingAt(15)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(15) }]);
    expect(f.fileRuns.some((run) => run.commit === sha(2))).toBe(false);
    expect(f.fileRuns.length).toBeLessThan(baseline.fileRuns.length);
  });

  it("AC-AO-1 a second review of the same head runs nothing, wherever the transition is", async () => {
    const commits = 18;
    for (let transition = 3; transition < commits; transition += 1) {
      const f = build({ commits, files: { [FILE]: { redFrom: transition } } });
      const landings = [landingAt(3), landingAt(transition)];
      const first = await measure(f, landings);
      const suitesAfterFirst = f.suiteRuns.length;
      const runsAfterFirst = f.fileRuns.length;
      const second = await measure(f, landings);
      expect(f.suiteRuns.length, `suite, transition ${String(transition)}`).toBe(suitesAfterFirst);
      expect(f.fileRuns.length, `files, transition ${String(transition)}`).toBe(runsAfterFirst);
      expect(second.files).toEqual(first.files);
    }
  });

  it("AC-AO-1 a plan with no landing on main charges nothing and runs no single file; unlanded tasks stay not-measured", async () => {
    const f = build({ commits: 6, files: { [FILE]: { redFrom: 2 } } });
    const r = await measure(f, [], ["task-a"]);
    expect(r.files[0]).toEqual({ file: FILE, outcome: "no-landing" });
    expect(r.causes).toEqual(["unlanded"]);
    expect(f.fileRuns).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AO-1 a landing with no main commit containing it and no known main_before could be anywhere: a red file's transition is not-measured, never charged or passed", async () => {
    const f = build({ commits: 6, files: { [FILE]: { redFrom: 2 } } });
    const r = await measure(f, [{ landing_commit: sha(200), main_before: sha(199), task_slugs: ["t"] }]);
    expect(r.files[0]).toMatchObject({ outcome: "not-measured", cause: "unmappable" });
    expect(r.causes).toEqual(["unmappable"]);
    expect(r.charged).toEqual([]);
  });

  it("AC-AO-1 no landings and no unlanded tasks is refused, not a pass", async () => {
    const f = build({ commits: 3, files: {} });
    const r = await regressionAtHead([], [], f.ports);
    expect(r.ok).toBe(false);
  });

  it("AC-AO-1 a landing that reached main through another branch's merge is charged through that merge commit: a file that turned red there is the plan's regression", async () => {
    // branch X (landing_commit sha(200)) was merged into Y, and Y landed as main commit 6
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } }, containing: { 200: 6 } });
    const r = await measure(f, [landingAt(3), { landing_commit: sha(200), main_before: sha(5), task_slugs: ["x"] }]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(6) }]);
    expect(dimensionOf(r.rows).verdict).toBe("fail");
  });

  it("AC-AO-1 an unmappable landing does not unmeasure a file whose transition is clearly another commit, only one whose transition could be that landing", async () => {
    // landing sha(200) has no containing commit; main stood at commit 8 before it, so it can only have landed after 8
    const f = build({ commits: 12, files: { [FILE]: { redFrom: 5 }, [OTHER]: { redFrom: 10 } } });
    const r = await measure(f, [landingAt(3), { landing_commit: sha(200), main_before: sha(8), task_slugs: ["x"] }]);
    expect(r.files.find((x) => x.file === FILE)).toEqual({ file: FILE, outcome: "other-commit", commit: sha(5) });
    expect(r.files.find((x) => x.file === OTHER)).toMatchObject({ outcome: "not-measured" });
    expect(r.charged).toEqual([]);
  });

  it("AC-AO-1 a suite whose test command never ran (exit 5, oracle lock contended) is stored unrunnable, so it is not a lower-bound pass and the bisection does not contradict its confirmation", async () => {
    const store = new InMemoryStore();
    const f = build({ commits: 20, files: { [FILE]: { redFrom: 4 } } }, { store });
    // measured, no failing file, but the test command exited 5: nothing ran at commit 12, though the file is red there
    const stored = await f.service.lookupOrRun(sha(12), { ...f.ports.runner, runSuite: async (commit) => ok({ status: "measured", commit, commands: [{ command: "bun run test", exit_code: 5, output_tail: "oracle-lock: contended" }], skipped: [], failing_test_files: [] }) });
    // the store records the non-run as unrunnable, so it is never a lower bound: the file falls through to a real run at the floor
    expect(stored.ok && stored.value.status).toBe("unrunnable");
    const r = await measure(f, [landingAt(3), landingAt(4)]);
    expect(r.files[0]).toEqual({ file: FILE, outcome: "regression", landing: sha(4) });
  });
});
