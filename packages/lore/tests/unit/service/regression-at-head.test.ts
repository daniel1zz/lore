/**
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (BR-1496)
 * (attribution rules from spec-a-plan-s-tests-and-criteria-are-measured-once-at-its, AC-AO-1; the close-selection ACs are owned by
 * tests/integration/regression-selected-at-close.test.ts)
 *
 * Regression on the selector's tests at the commit holding the plan's last landing, attributed by bisection, with a fake
 * runner and selection over a fake first-parent history and the real SuiteResultService over the in-memory store.
 *
 * Dimensions: HAPPY (a transition at a plan landing is charged), NEGATIVE (another commit, red-before, flaky and a
 * disagreeing confirmation are not charged), BOUNDARY (absent file, transition at the first/last commit, no landing),
 * ERROR (a run that cannot complete, an unmappable landing: not-measured, never pass), STATE (a stored pass is the
 * lower bound; a second review of the same plan runs nothing), REGRESSION (per-landing measurement, touched-or-imports
 * attribution and trusting every bisection step are the false greens this guards).
 */

import { describe, expect, it } from "vitest";
import { err, ok, type LoreError, type MilestoneFacts, type Result } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SuiteResultService, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../../src/service/suite-result-service.js";
import { factsDimensions } from "../../../src/service/milestone-review-judgment.js";
import {
  regressionAtHead,
  regressionBisectionBudget,
  type RegressionAtHeadPorts,
  type RegressionLandingInput,
  type TestSelection,
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
  /** Landing commits OFF the first-parent chain (by sha index) and the chain commit index that brought each in. */
  readonly containing?: Readonly<Record<number, number>>;
  /** The files the selection names (default: every file of the script). */
  readonly selected?: readonly string[];
  /** The M of "N selected of M" (default: the number of files of the script). */
  readonly totalTestFiles?: number;
  readonly unparseable?: TestSelection["unparseable"];
  readonly removedTests?: TestSelection["removedTests"];
  readonly needsBuild?: readonly string[];
  readonly selectionError?: boolean;
}

interface Fixture {
  readonly ports: RegressionAtHeadPorts;
  readonly service: SuiteResultService;
  readonly fileRuns: { commit: string; file: string }[];
  readonly batchCalls: { commit: string; files: readonly string[]; buildFirst: boolean }[];
  readonly selectCalls: { commit: string; landingCommits: readonly string[] }[];
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
  const fileRuns: { commit: string; file: string }[] = [];
  const batchCalls: { commit: string; files: readonly string[]; buildFirst: boolean }[] = [];
  const selectCalls: { commit: string; landingCommits: readonly string[] }[] = [];
  const seen = new Map<string, number>();
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: ref === "main" ? sha(headIndex) : ref, tree: sha(0) }),
    runFiles: async (commit, files) => runFilesAt(commit, files),
    // reason: the search runs files together (spec: one batched invocation per probed commit); the model has no interference, so a batch is the per-file runs.
    runFilesTogether: async (commit, files, options) => {
      batchCalls.push({ commit, files: [...files], buildFirst: options?.buildFirst === true });
      return runFilesAt(commit, files);
    },
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
    selectTests: async (input) => {
      selectCalls.push({ commit: input.commit, landingCommits: [...input.landingCommits] });
      if (script.selectionError === true) return err({ code: "STORE_ERROR", message: "git ls-tree failed" });
      const selected = script.selected ?? Object.keys(script.files);
      return ok({
        commit: input.commit,
        selected: selected.map((path) => ({ path, needsCompiledBinary: script.needsBuild?.includes(path) === true })),
        totalTestFiles: script.totalTestFiles ?? Object.keys(script.files).length,
        unparseable: script.unparseable ?? [],
        removedTests: script.removedTests ?? [],
        accounting: `commit: ${input.commit}\nselected total: ${String(selected.length)}`,
      });
    },
    headRef: "main",
    firstParentHistory: async (ref) => ok(Array.from({ length: indexOf(ref === "main" ? sha(headIndex) : ref) + 1 }, (_, i) => sha(i))),
    fileExistsAt: async (commit, file) => ok(exists(file, indexOf(commit))),
    firstParentCommitContaining: async (commit) => {
      const via = script.containing?.[indexOf(commit)];
      return ok(via === undefined ? undefined : sha(via));
    },
  };
  return { ports, service, fileRuns, batchCalls, selectCalls, head: sha(headIndex) };
}

const dimensionOf = (rows: NonNullable<MilestoneFacts["regression"]>) => factsDimensions({ regression: rows }, []).regression;

async function measure(f: Fixture, landings: RegressionLandingInput[], unlanded: string[] = []) {
  const r = await regressionAtHead(landings, unlanded, f.ports);
  if (!r.ok) throw new Error(`regressionAtHead failed: ${r.error.code}`);
  return r.value;
}

describe("regression on the selection at the commit of the last landing", () => {
  it("AC-AO-1 a file red at head whose red transition is one of the plan's landing commits is the plan's regression and fails the gate", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } } });
    const r = await measure(f, [landingAt(3), landingAt(6)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(6) }]);
    expect(r.files[0]).toEqual({ file: FILE, outcome: "regression", landing: sha(6) });
    expect(dimensionOf(r.rows).verdict).toBe("fail");
    // false green guarded: the selection is made and run ONCE at L (the latest landing), not per landing and not at head
    expect(f.selectCalls).toEqual([{ commit: sha(6), landingCommits: [sha(3), sha(6)] }]);
    expect(f.batchCalls[0]).toEqual({ commit: sha(6), files: [FILE], buildFirst: false });
  });

  it("at close:the selection runs at L, never at head: a file added after L is not run and never charged even when red", async () => {
    // the selection names only FILE; OTHER exists and is red at head (it was added after L) but is not selected
    const f = build({ commits: 12, files: { [FILE]: { redFrom: 5 }, [OTHER]: { existsFrom: 9, redFrom: 9 } }, selected: [FILE], totalTestFiles: 2 });
    const r = await measure(f, [landingAt(3), landingAt(5)]);
    expect(f.fileRuns.some((run) => run.file === OTHER)).toBe(false);
    expect(r.files.map((x) => x.file)).toEqual([FILE]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(5) }]);
    expect(f.selectCalls.every((c) => c.commit === sha(5))).toBe(true);
  });

  it("at close:an unselected red file is neither run nor charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 }, [OTHER]: { redFrom: 0 } }, selected: [FILE], totalTestFiles: 2 });
    const r = await measure(f, [landingAt(6)]);
    expect(f.fileRuns.some((run) => run.file === OTHER)).toBe(false);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(6) }]);
  });

  it("at close:the output states the selected count, the total and that the selector accounting is stored", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 99 }, [OTHER]: {} }, selected: [FILE], totalTestFiles: 40 });
    const r = await measure(f, [landingAt(6)]);
    const row = r.rows.find((x) => x.subject === `selection@${sha(6)}`);
    expect(row?.verdict).toBe("pass");
    expect(row?.detail).toContain("regression measured on 1 selected test files of 40 (selector accounting stored)");
    expect(row?.detail).toContain(`commit: ${sha(6)}`);
    expect(r.selection).toEqual({ commit: sha(6), selected: 1, total: 40 });
    expect(dimensionOf(r.rows).reason).toContain("regression measured on 1 selected test files of 40 (selector accounting stored)");
  });

  it("at close:a selection holding a declared-spawn test builds first, one that holds none does not", async () => {
    const withSpawn = build({ commits: 6, files: { [FILE]: {}, [OTHER]: {} }, needsBuild: [OTHER] });
    await measure(withSpawn, [landingAt(4)]);
    expect(withSpawn.batchCalls).toEqual([{ commit: sha(4), files: [FILE, OTHER], buildFirst: true }]);
    const without = build({ commits: 6, files: { [FILE]: {}, [OTHER]: {} } });
    await measure(without, [landingAt(4)]);
    expect(without.batchCalls[0]?.buildFirst).toBe(false);
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

  it("AC-AO-1 a file red at L whose first failing commit is green on its confirm run alone is flaky-bisection: not charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6, sequence: { 6: [1, 0] } } } });
    const r = await measure(f, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured", cause: "flaky-bisection" });
    expect(r.charged).toEqual([]);
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
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6, sequence: { 6: [1, 0] } } } });
    const r = await measure(f, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured" });
    expect(JSON.stringify(r.files[0])).toContain("flaky during bisection");
    expect(r.causes).toEqual(["flaky-bisection"]);
    expect(r.charged).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AO-1 a file that is red at L but green at head (alone as well) is not looked at and not charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redWhen: (i) => i === 6 } } });
    const r = await measure(f, [landingAt(6)]);
    expect(r.files).toEqual([{ file: FILE, outcome: "green-at-head", commit: f.head }]);
    expect(r.charged).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AO-1 a run that cannot complete makes regression not-measured, never pass", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } }, failRunFiles: true });
    const r = await measure(f, [landingAt(6)]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured", cause: "unrunnable" });
    expect(r.causes).toEqual(["unrunnable"]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AO-1 a single-file run that timed out is not stored as red and makes the file not-measured, never charged", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 6 } } });
    // L is green in this runner so the timeout lands on the head recheck / confirmations: only the L batch answers normally
    const timedOut: CommitSuiteRunnerPort = {
      ...f.ports.runner,
      runFiles: async (_commit, files) => ok(files.map((file): FileRunOutcome => ({ file, exit_code: 1, output_tail: "", duration_ms: 1, incomplete: "timed out after 3600000 ms" }))),
      runFilesTogether: async (commit, files, options) =>
        commit === sha(6)
          ? f.ports.runner.runFilesTogether!(commit, files, options)
          : ok(files.map((file): FileRunOutcome => ({ file, exit_code: 1, output_tail: "", duration_ms: 1, incomplete: "timed out after 3600000 ms" }))),
    };
    const r = await measure({ ...f, ports: { ...f.ports, runner: timedOut } }, [landingAt(6)]);
    expect(r.files[0]).toMatchObject({ file: FILE, outcome: "not-measured" });
    expect(JSON.stringify(r.files[0])).toContain("timed out");
    expect(r.charged).toEqual([]);
    const stored = await f.service.listFileRuns(`file-confirm@${f.head}`);
    expect(stored.ok && stored.value).toEqual([]);
  });

  it("AC-AO-1 single-file runs per red file are at most ceil(log2(commits in range)) + 4 wherever the transition is (the L batch and the head recheck are two more)", async () => {
    const commits = 20;
    for (let transition = 3; transition < commits; transition += 1) {
      const f = build({ commits, files: { [FILE]: { redFrom: transition } } });
      const r = await measure(f, [landingAt(3), landingAt(transition)]);
      // range: first parent of the earliest landing (index 2) exclusive .. head inclusive
      expect(f.fileRuns.length).toBeLessThanOrEqual(regressionBisectionBudget(commits - 1 - 2) + 2);
      expect(r.files[0], `transition ${String(transition)}`).toMatchObject({ file: FILE, outcome: "regression" });
    }
  });

  it("AC-AO-1 several red files are each bisected; one charged, one listed", async () => {
    const f = build({ commits: 12, files: { [FILE]: { redFrom: 8 }, [OTHER]: { redFrom: 5 } } });
    const r = await measure(f, [landingAt(4), landingAt(8)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(8) }]);
    expect(r.files.find((x) => x.file === OTHER)).toMatchObject({ outcome: "other-commit", commit: sha(5) });
  });

  it("AC-AO-1 a stored single-file pass in range is the lower bound: it is not run again and the range is smaller", async () => {
    const script: Script = { commits: 20, files: { [FILE]: { redFrom: 15 } } };
    const baseline = build(script);
    await measure(baseline, [landingAt(3), landingAt(15)]);
    const store = new InMemoryStore();
    const f = build(script, { store });
    // a stored single-file pass of the file at commit 12 (made by an earlier review, through a runner of its own)
    const seed = build(script, { store });
    const seeded = await seed.service.runSingleFile(sha(12), FILE, "bisect", seed.ports.runner);
    expect(seeded.ok && seeded.value.exit_code).toBe(0);
    const r = await measure(f, [landingAt(3), landingAt(15)]);
    expect(r.charged).toEqual([{ file: FILE, landing: sha(15) }]);
    expect(f.fileRuns.some((run) => run.commit === sha(2))).toBe(false);
    expect(f.fileRuns.length).toBeLessThan(baseline.fileRuns.length);
  });

  it("AC-AO-1 a second review of the same plan runs nothing, wherever the transition is", async () => {
    const commits = 18;
    for (let transition = 3; transition < commits; transition += 1) {
      const f = build({ commits, files: { [FILE]: { redFrom: transition } } });
      const landings = [landingAt(3), landingAt(transition)];
      const first = await measure(f, landings);
      const runsAfterFirst = f.fileRuns.length;
      const second = await measure(f, landings);
      expect(f.fileRuns.length, `files, transition ${String(transition)}`).toBe(runsAfterFirst);
      expect(second.files).toEqual(first.files);
    }
  });

  it("at close:a second assess of the same plan reuses the stored results at L and invokes no runner for them", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 99 }, [OTHER]: {} } });
    await measure(f, [landingAt(4), landingAt(6)]);
    expect(f.batchCalls).toHaveLength(1);
    await measure(f, [landingAt(4), landingAt(6)]);
    expect(f.batchCalls).toHaveLength(1);
  });

  it("at close (accounting):a plan with no landing on main selects nothing: na, never pass; unlanded tasks stay not-measured", async () => {
    const f = build({ commits: 6, files: { [FILE]: { redFrom: 2 } } });
    const r = await measure(f, [], ["task-a"]);
    expect(r.causes).toEqual(["unlanded"]);
    expect(f.fileRuns).toEqual([]);
    expect(f.selectCalls).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
    const merged = await measure(f, [{ landing_commit: sha(3), main_before: sha(3), task_slugs: ["t"] }]);
    expect(merged.rows[0]).toMatchObject({ verdict: "na" });
    expect(merged.rows[0]?.detail).toContain("no test reaches this plan's changes");
    expect(dimensionOf(merged.rows).verdict).toBe("na");
  });

  it("AC-AO-1 a landing with no main commit containing it cannot fix the selection commit: not-measured (unmappable), nothing runs, never charged or passed", async () => {
    const f = build({ commits: 6, files: { [FILE]: { redFrom: 2 } } });
    const r = await measure(f, [{ landing_commit: sha(200), main_before: sha(199), task_slugs: ["t"] }]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured", cause: "unmappable" });
    expect(r.causes).toEqual(["unmappable"]);
    expect(r.charged).toEqual([]);
    expect(f.selectCalls).toEqual([]);
    expect(f.fileRuns).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
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
    expect(f.selectCalls[0]?.commit).toBe(sha(6));
  });

  it("AC-AO-1 a batch whose test command never ran (exit 5, oracle lock contended) is not stored and is not-measured, never a pass or a red", async () => {
    const f = build({ commits: 10, files: { [FILE]: { redFrom: 4 } } });
    const contended: CommitSuiteRunnerPort = {
      ...f.ports.runner,
      runFilesTogether: async (_commit, files) => ok(files.map((file): FileRunOutcome => ({ file, exit_code: 5, output_tail: "oracle-lock: contended", duration_ms: 1 }))),
    };
    const r = await measure({ ...f, ports: { ...f.ports, runner: contended } }, [landingAt(4)]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured", cause: "unrunnable" });
    expect(r.rows[0]?.detail).toContain("oracle lock");
    const stored = await f.service.listFileRuns(`file-batch@${sha(4)}`);
    expect(stored.ok && stored.value).toEqual([]);
  });
});

describe("selection accounting", () => {
  it("at close (accounting):an unparseable test file at L is named and makes regression not measured, never pass; nothing runs", async () => {
    const f = build({ commits: 8, files: { [FILE]: {} }, unparseable: [{ path: "packages/x/tests/broken.test.ts", message: "malformed @spawns block" }] });
    const r = await measure(f, [landingAt(5)]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(r.rows[0]?.detail).toContain("packages/x/tests/broken.test.ts");
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
    expect(dimensionOf(r.rows).reason).toContain("packages/x/tests/broken.test.ts");
    expect(f.batchCalls).toEqual([]);
  });

  it("at close (accounting):a selection that cannot be read is not measured and names why", async () => {
    const f = build({ commits: 8, files: { [FILE]: {} }, selectionError: true });
    const r = await measure(f, [landingAt(5)]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(r.rows[0]?.detail).toContain("git ls-tree failed");
    expect(f.batchCalls).toEqual([]);
  });

  it("at close (accounting):an empty selection is na with the reason no test reaches this plan's changes, never pass", async () => {
    const f = build({ commits: 8, files: { [FILE]: { redFrom: 0 } }, selected: [], totalTestFiles: 55 });
    const r = await measure(f, [landingAt(5)]);
    expect(r.rows[0]).toMatchObject({ verdict: "na" });
    expect(r.rows[0]?.detail).toContain("no test reaches this plan's changes");
    expect(r.selection).toEqual({ commit: sha(5), selected: 0, total: 55 });
    expect(dimensionOf(r.rows).verdict).toBe("na");
    expect(dimensionOf(r.rows).reason).toContain("no test reaches this plan's changes");
    expect(f.batchCalls).toEqual([]);
  });

  it("at close (accounting):a test the plan removed is named in the stored accounting, is not run and does not make regression not measured", async () => {
    const f = build({ commits: 8, files: { [FILE]: { redFrom: 99 } }, removedTests: [{ path: "packages/x/tests/gone.test.ts" }] });
    const r = await measure(f, [landingAt(5)]);
    // the adapter's accounting text names it; here the fake's accounting is passed through unchanged and the verdict is measured
    expect(r.rows.find((x) => x.subject.startsWith("selection@"))?.verdict).toBe("pass");
    expect(f.fileRuns.some((run) => run.file === "packages/x/tests/gone.test.ts")).toBe(false);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });
});
