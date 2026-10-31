// @reads package.json -- the production batched invocation runs this checkout's `test:file` script
// @spawns packages/lore/tests/zz-batched-fixture-*/*.test.ts -- throwaway real test files created and removed by the real-runner case
// @spawns-external bun the build-first cases run `bun run build` / `test:file` scripts of a throwaway package
/**
 * @spec_ref spec-a-plan-s-regression-reuses-a-stored-suite-that-contains (AC-AC-2, BR-1496, BR-1497)
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (AC-SC-3, BR-1496)
 *
 * A plan's red files at the selection commit are rechecked at head in one batched run and bisected together: one batched
 * invocation per probed commit, one prepared worktree per commit per review. The real SuiteResultService over the in-memory
 * store, the real PreparedWorktreeCache, stub runners that count every invocation and every worktree preparation.
 *
 * RETIRED with spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach: the "suite reuse" cases (AC-AC-1: a stored full
 * suite read as M) and the "join in flight" cases (AC-AC-3: waiting for a full suite at a commit). A close runs no full suite, so
 * there is no M to read or join; the head recheck and the attribution below start from the files red at the selection commit L.
 *
 * Dimensions: HAPPY (shared bisection), NEGATIVE (a batch-only failure is not charged), STATE (stored batch rows only steer),
 * ERROR (a failed build makes every file incomplete), REGRESSION (every "false green guarded" clause of AC-AC-2).
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok } from "@lore/core";
import { outcomesOfTogetherRun, runTestFilesTogether } from "../../src/adapters/cli/assess-suite-runner.js";
import { PreparedWorktreeCache } from "../../src/adapters/cli/assess-worktree-cache.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { ReviewLeases } from "../../src/service/review-batch-lease.js";
import { milestoneFactsFingerprint } from "../../src/service/milestone-review.js";
import { regressionAtHead, type RegressionAtHead, type RegressionAtHeadPorts, type RegressionLandingInput } from "../../src/service/regression-at-head.js";
import { SuiteResultService, singleFileRunKey, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../src/service/suite-result-service.js";

const A = "packages/x/tests/a.test.ts";
const B = "packages/x/tests/b.test.ts";
const C = "packages/x/tests/c.test.ts";
const sha = (index: number): string => index.toString(16).padStart(40, "0");
const indexOf = (commit: string): number => Number.parseInt(commit, 16);
const landingAt = (index: number): RegressionLandingInput => ({ landing_commit: sha(index), main_before: sha(index - 1), task_slugs: [`task-${String(index)}`] });

/** How a run sees a file: alone or beside others, at a history position. */
interface RunContext {
  readonly together: boolean;
  readonly withOthers: boolean;
}

interface FileModel {
  /** Red at history position `index` under `context`. */
  readonly redWhen: (index: number, context: RunContext) => boolean;
}

const redFrom = (from: number): FileModel => ({ redWhen: (index) => index >= from });

interface Invocation {
  readonly commit: string;
  readonly files: readonly string[];
  readonly together: boolean;
}

interface Script {
  readonly commits: number;
  readonly files: Readonly<Record<string, FileModel>>;
}

function build(script: Script) {
  const store = new InMemoryStore();
  let counter = 0;
  const leases = new ReviewLeases(
    store,
    "test",
    Date.now,
    () => () => undefined,
    (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
  );
  const service = new SuiteResultService({
    store,
    leases,
    now: () => `2026-10-30T10:00:00.${String(++counter).padStart(3, "0")}Z`,
    newId: () => `suite-rb-${String(++counter)}`,
    clockMs: () => counter * 10,
  });
  const headIndex = script.commits - 1;
  const modelOf = (file: string): FileModel => script.files[file] ?? { redWhen: () => false };
  const invocations: Invocation[] = [];
  const prepared: string[] = [];
  const disposed: string[] = [];
  const cache = new PreparedWorktreeCache(async (commit) => {
    prepared.push(commit);
    return ok({
      root: commit,
      dispose: async () => {
        disposed.push(commit);
        return ok(undefined);
      },
    });
  });
  const outcomesOf = (commit: string, files: readonly string[], together: boolean): FileRunOutcome[] =>
    files.map((file) => ({
      file,
      exit_code: modelOf(file).redWhen(indexOf(commit), { together, withOthers: together && files.length > 1 }) ? 1 : 0,
      output_tail: "",
      duration_ms: 1,
    }));
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: ref === "main" ? sha(headIndex) : ref, tree: sha(0) }),
    runFiles: async (commit, files) => {
      invocations.push({ commit, files: [...files], together: false });
      return cache.use(commit, async () => outcomesOf(commit, files, false));
    },
    runFilesTogether: async (commit, files) => {
      invocations.push({ commit, files: [...files], together: true });
      return cache.use(commit, async () => outcomesOf(commit, files, true));
    },
    disposeWorktrees: () => cache.disposeAll(),
  };
  const ports: RegressionAtHeadPorts = {
    suites: service,
    runner,
    // reason: the selection names every file of the script; the selector itself is tested by scripts/tests/changed-tests-commit-mode.test.ts.
    selectTests: async ({ commit }) =>
      ok({
        commit,
        selected: Object.keys(script.files).map((path) => ({ path, needsCompiledBinary: false })),
        totalTestFiles: Object.keys(script.files).length,
        unparseable: [],
        removedTests: [],
        accounting: `commit: ${commit}`,
      }),
    headRef: "main",
    firstParentHistory: async (ref) => ok(Array.from({ length: indexOf(ref) + 1 }, (_, i) => sha(i))),
    fileExistsAt: async () => ok(true),
    firstParentCommitContaining: async () => ok(undefined),
  };
  /** Stores one file's `batch` row at a commit, as an earlier review's search would have. */
  const storeBatchRow = async (index: number, file: string, exitCode: number): Promise<void> => {
    const inserted = await store.insertSuiteFileRuns([
      { suite_result_id: singleFileRunKey("batch", sha(index)), commit_sha: sha(index), file, exit_code: exitCode, output_tail: "", duration_ms: 1, measured_at: "2026-10-30T09:30:00.000Z" },
    ]);
    if (!inserted.ok) throw new Error(`could not store the fixture batch row: ${inserted.error.code}`);
  };
  return { ports, service, store, leases, invocations, prepared, disposed, runner, storeBatchRow, head: sha(headIndex) };
}

type Fixture = ReturnType<typeof build>;

async function measure(f: Fixture, landings: RegressionLandingInput[]): Promise<RegressionAtHead> {
  const r = await regressionAtHead(landings, [], f.ports);
  await f.runner.disposeWorktrees?.();
  if (!r.ok) throw new Error(`regressionAtHead failed: ${r.error.code}`);
  return r.value;
}

const fingerprintOf = (r: RegressionAtHead): string => milestoneFactsFingerprint({ singleFileRunIds: r.single_file_run_ids, criteriaAttestationIds: [], citedRules: [], promptVersion: "p" });

const batchesAt = (f: Fixture, commit: string): Invocation[] => f.invocations.filter((i) => i.together && i.commit === commit);
const singles = (f: Fixture): Invocation[] => f.invocations.filter((i) => !i.together);

describe("head recheck of the files red at the selection commit", () => {
  it("AC-AC-2 a file red at L and green at head (alone as well) is not charged; one batched run at head holds exactly the files red at L; a file green at L is never run again", async () => {
    // plan landings 3 and 6 (L = 6); head = 39. A red from 6 (stays red), B red 6..20 (green at head), C red from 25 (turned red after L).
    const f = build({ commits: 40, files: { [A]: redFrom(6), [B]: { redWhen: (i) => i >= 6 && i <= 20 }, [C]: redFrom(25) } });
    const r = await measure(f, [landingAt(3), landingAt(6)]);
    // (the runner port has no full-suite verb, so none can run)
    // the selection ran at L in ONE batch holding all three files
    expect(batchesAt(f, sha(6))).toEqual([{ commit: sha(6), files: [A, B, C], together: true }]);
    // exactly one batched invocation at head, holding exactly the files red at L
    expect(batchesAt(f, f.head)).toEqual([{ commit: f.head, files: [A, B], together: true }]);
    // false green guarded: skipping the head recheck charges the red-at-L green-at-head file
    expect(r.files.find((x) => x.file === B)).toMatchObject({ outcome: "green-at-head" });
    expect(r.charged).toEqual([{ file: A, landing: sha(6) }]);
    // B was run once more ALONE at head before it was dropped
    expect(f.invocations).toContainEqual({ commit: f.head, files: [B], together: false });
    // a file green at L and red at head is never listed
    expect(r.files.map((x) => x.file)).not.toContain(C);
    expect(r.rows.some((row) => row.subject === C)).toBe(false);
    // the fingerprint names the stored runs the verdict used (L's rows and the recheck's), and changes with them
    expect(r.single_file_run_ids.map((x) => x.key)).toEqual(expect.arrayContaining([`${A}@${sha(6)}:batch`, `${A}@${f.head}:batch`, `${B}@${f.head}:batch`]));
    expect(fingerprintOf(r)).not.toBe(milestoneFactsFingerprint({ singleFileRunIds: [], criteriaAttestationIds: [], citedRules: [], promptVersion: "p" }));
  });

  it("AC-AC-2 L is main's head: no recheck runs; nothing red at L: no head run at all", async () => {
    const atHead = build({ commits: 12, files: { [A]: redFrom(6) } });
    const r = await measure(atHead, [landingAt(11)]);
    expect(batchesAt(atHead, atHead.head)).toHaveLength(1); // the selection's own batch at L = head
    expect(r.charged).toEqual([]); // red since 6, not at the landing 11: red-before or other commit, never charged
    expect(r.files[0]).toMatchObject({ file: A });
    expect(atHead.invocations.filter((i) => i.together && i.files.length > 0 && i.commit === atHead.head)).toHaveLength(1);

    const green = build({ commits: 40, files: {} });
    const g = await measure(green, [landingAt(6)]);
    expect(green.invocations).toEqual([]);
    expect(g.charged).toEqual([]);
  });
});

describe("batched attribution", () => {
  /** The fixture of (a): a 32-commit plan range (1..32), head = 40. */
  const rangeFixture = (files: Record<string, FileModel>): Fixture => build({ commits: 41, files });

  it("AC-AC-2 (a) three files red at L and at head that turned red at the same commit cost at most 16 invocations and one preparation per distinct commit", async () => {
    const f = rangeFixture({ [A]: redFrom(21), [B]: redFrom(21), [C]: redFrom(21) });
    const r = await measure(f, [landingAt(1), landingAt(21)]);
    expect(r.charged.map((x) => x.file).sort()).toEqual([A, B, C]);
    expect(r.charged.every((x) => x.landing === sha(21))).toBe(true);
    const headBatches = batchesAt(f, f.head);
    expect(headBatches).toEqual([{ commit: f.head, files: [A, B, C], together: true }]);
    // the selection's batch at L holds all three too; every batched search holds all three
    expect(batchesAt(f, sha(21))).toEqual([{ commit: sha(21), files: [A, B, C], together: true }]);
    const searches = f.invocations.filter((i) => i.together && i.commit !== f.head);
    expect(searches.length).toBeLessThanOrEqual(6);
    for (const search of searches) expect(search.files).toEqual([A, B, C]);
    const alone = singles(f);
    // 3 red-before runs (at the floor) + 6 confirmations (2 per file); the floor run is not repeated per search probe
    expect(alone.filter((i) => i.commit === sha(0))).toHaveLength(3);
    expect(alone).toHaveLength(9);
    // false green guarded: one invocation per file per commit would exceed 16
    expect(f.invocations.length).toBeLessThanOrEqual(16);
    // false green guarded: a worktree per run would exceed the distinct-commit count
    const distinct = new Set(f.invocations.map((i) => i.commit));
    expect(f.prepared.length).toBe(distinct.size);
    expect(new Set(f.prepared).size).toBe(f.prepared.length);
    // the review ended: every prepared worktree was removed
    expect([...f.disposed].sort()).toEqual([...f.prepared].sort());
  });

  /** Per-file bisection cost the old design paid for one file: floor + probes + two confirmations. */
  const perFileCost = (low: number, high: number, firstRed: number): number => {
    let cost = 3;
    let lo = low;
    let hi = high;
    while (hi - lo > 1) {
      const middle = lo + Math.floor((hi - lo) / 2);
      cost += 1;
      if (middle >= firstRed) hi = middle;
      else lo = middle;
    }
    return cost;
  };

  it("AC-AC-2 (b) three files with transitions at three commits share the search: one batched invocation per commit, same first failing commits and charges as bisecting each file alone", async () => {
    const f = rangeFixture({ [A]: redFrom(10), [B]: redFrom(20), [C]: redFrom(28) });
    const r = await measure(f, [landingAt(1), landingAt(10), landingAt(20), landingAt(28)]);
    expect(r.charged).toEqual([
      { file: A, landing: sha(10) },
      { file: B, landing: sha(20) },
      { file: C, landing: sha(28) },
    ]);
    const searchCommits = f.invocations.filter((i) => i.together && i.commit !== f.head).map((i) => i.commit);
    expect(new Set(searchCommits).size).toBe(searchCommits.length);
    const distinct = new Set(f.invocations.map((i) => i.commit));
    expect(f.prepared.length).toBe(distinct.size);
    const perFileTotal = perFileCost(0, 32, 10) + perFileCost(0, 32, 20) + perFileCost(0, 32, 28);
    // total does not exceed the per-file bisection total plus the head recheck invocation and the selection's batch at L
    expect(f.invocations.length).toBeLessThanOrEqual(perFileTotal + batchesAt(f, f.head).length + 1);
  });

  it("AC-AC-2 (c) a file that fails only when run beside another file is never charged: its confirmation alone disagrees, so it is not measured as flaky-bisection", async () => {
    const interfering: FileModel = { redWhen: (_index, context) => context.withOthers };
    const f = rangeFixture({ [A]: redFrom(21), [B]: interfering });
    const r = await measure(f, [landingAt(1), landingAt(21)]);
    expect(r.charged).toEqual([{ file: A, landing: sha(21) }]);
    const b = r.files.find((x) => x.file === B);
    expect(b).toMatchObject({ outcome: "not-measured", cause: "flaky-bisection" });
    expect(r.causes).toEqual(["flaky-bisection"]);
    // false green guarded: confirming in a batch would charge B; every confirmation was a single-file invocation
    for (const invocation of f.invocations.filter((i) => !i.together)) expect(invocation.files).toHaveLength(1);
  });

  it("AC-AC-2 (d) a file red at L that passes in the head batch but fails alone at head is kept and attributed, never dropped", async () => {
    const hidesInBatch: FileModel = { redWhen: (index, context) => index >= 21 && !(context.withOthers && index === 40) };
    const f = rangeFixture({ [A]: redFrom(21), [B]: hidesInBatch });
    const r = await measure(f, [landingAt(1), landingAt(21)]);
    expect(r.files.find((x) => x.file === B)).not.toMatchObject({ outcome: "green-at-head" });
    expect(r.charged.map((x) => x.file).sort()).toEqual([A, B]);
    expect(f.invocations).toContainEqual({ commit: f.head, files: [B], together: false });
  });

  it("AC-AC-2 (e) a stored batch result is never used as red-before, as a confirmation or as an interval start; it may answer a search step at a probed commit", async () => {
    // red-before: A is red at the floor (commit 0) although a stored batch row says green there
    const before = rangeFixture({ [A]: redFrom(0) });
    await before.storeBatchRow(0, A, 0);
    const b = await measure(before, [landingAt(1), landingAt(21)]);
    expect(b.files.find((x) => x.file === A)).toMatchObject({ outcome: "red-before" });
    expect(singles(before).filter((i) => i.commit === sha(0))).toHaveLength(1);

    // interval start: a stored batch row (green at 15) must not become the interval's known-green start: the floor (commit 0) is
    // still decided by a single-file run, which only happens when no single-file knowledge starts the interval higher.
    const start = rangeFixture({ [A]: redFrom(21) });
    await start.storeBatchRow(15, A, 0);
    const s = await measure(start, [landingAt(1), landingAt(21)]);
    expect(s.charged).toEqual([{ file: A, landing: sha(21) }]);
    expect(singles(start).filter((i) => i.commit === sha(0))).toHaveLength(1);

    // confirmation: a stored batch row (red at 21, green at 20) never stands in for the single-file confirmation runs
    const confirm = rangeFixture({ [A]: redFrom(21) });
    await confirm.storeBatchRow(21, A, 1);
    await confirm.storeBatchRow(20, A, 0);
    const c = await measure(confirm, [landingAt(1), landingAt(21)]);
    expect(c.charged).toEqual([{ file: A, landing: sha(21) }]);
    expect(singles(confirm).filter((i) => i.commit === sha(21) || i.commit === sha(20))).toHaveLength(2);

    // search step: a stored batch row at the first probe (10, the midpoint of (0, 21): the file is red at L = 21) answers it without a run
    const step = rangeFixture({ [A]: redFrom(21) });
    await step.storeBatchRow(10, A, 0);
    const t = await measure(step, [landingAt(1), landingAt(21)]);
    expect(t.charged).toEqual([{ file: A, landing: sha(21) }]);
    expect(batchesAt(step, sha(10))).toEqual([]);
  });
});

describe("batched attribution: the production batched invocation against a real test runner", () => {
  /** The environment of a clean shell: the outer vitest's own variables must not steer the inner `bun run test:file`. */
  const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITEST|VITE_|NODE_ENV$|TEST$)/.test(name)));
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

  it("AC-AC-2 one `bun run test:file f1 f2 f3` invocation reports each file's own outcome: pass, fail, and a collect error (missing import) as failed", { timeout: 300_000 }, async () => {
    const relDir = `packages/lore/tests/zz-batched-fixture-${String(process.pid)}-${String(Date.now())}`;
    const dir = join(repoRoot, relDir);
    mkdirSync(dir, { recursive: true });
    try {
      const body = (assertion: string): string => `import { expect, it } from "vitest";\nit("case", () => {\n  ${assertion}\n});\n`;
      writeFileSync(join(dir, "pass.test.ts"), body("expect(1).toBe(1);"));
      writeFileSync(join(dir, "fail.test.ts"), body("expect(1).toBe(2);"));
      writeFileSync(join(dir, "collect.test.ts"), `import "./does-not-exist.js";\n${body("expect(1).toBe(1);")}`);
      const [pass, fail, collect] = ["pass", "fail", "collect"].map((name) => `${relDir}/${name}.test.ts`) as [string, string, string];
      const exact = (outcomes: readonly FileRunOutcome[]) => outcomes.map((o) => [o.file, o.exit_code, o.incomplete]);

      // order must not matter: the failing file sits in the middle, then at the ends
      expect(exact(await runTestFilesTogether(repoRoot, "fixture", [pass, fail, collect], cleanEnv()))).toEqual([[pass, 0, undefined], [fail, 1, undefined], [collect, 1, undefined]]);
      expect(exact(await runTestFilesTogether(repoRoot, "fixture", [collect, pass, fail], cleanEnv()))).toEqual([[collect, 1, undefined], [pass, 0, undefined], [fail, 1, undefined]]);
      // a batch of passing files only is green for every file; a batch with one failing file charges only that file
      expect(exact(await runTestFilesTogether(repoRoot, "fixture", [pass], cleanEnv()))).toEqual([[pass, 0, undefined]]);
      expect(exact(await runTestFilesTogether(repoRoot, "fixture", [pass, fail], cleanEnv()))).toEqual([[pass, 0, undefined], [fail, 1, undefined]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-AC-2 a batched run that exits 1 with no readable failing file is incomplete for every file, never all green or all red", () => {
    const outcomes = outcomesOfTogetherRun([A, B], { status: 1, output: "something broke before any test ran", durationMs: 1 });
    expect(outcomes.map((o) => [o.exit_code, o.incomplete !== undefined])).toEqual([[1, true], [1, true]]);
    // coloured output (FORCE_COLOR) is read the same as plain output
    const esc = String.fromCharCode(27);
    const coloured = outcomesOfTogetherRun([A, B], { status: 1, output: ` ${esc}[41m${esc}[1m FAIL ${esc}[22m${esc}[49m  ${B} > case\n`, durationMs: 1 });
    expect(coloured.map((o) => o.exit_code)).toEqual([0, 1]);
  });
});

describe("build first for a selection holding a declared-spawn test", () => {
  const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITEST|VITE_|NODE_ENV$|TEST$)/.test(name)));
  /** A throwaway package whose `build` and `test:file` scripts are the given shell commands. */
  const packageWith = (scripts: { build: string; testFile: string }): string => {
    const root = mkdtempSync(join(tmpdir(), "build-first-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { build: scripts.build, "test:file": scripts.testFile } }));
    return root;
  };

  it("AC-SC-3 buildFirst runs `bun run build` before the tests: a build that writes a marker is seen by the test script", { timeout: 120_000 }, async () => {
    const root = packageWith({ build: "echo built > built.marker", testFile: "test -f built.marker" });
    try {
      const without = await runTestFilesTogether(root, "fixture", [A], cleanEnv());
      // the script fails without the build: not a green (the exit is whatever the script gave, which is no test result: a runner
      // exit outside {0, 1} is refused by the service, and exit 1 with no readable failing file is incomplete)
      expect(without[0]?.exit_code).not.toBe(0);
      const built = await runTestFilesTogether(root, "fixture", [A], cleanEnv(), undefined, { buildFirst: true });
      expect(built.map((o) => [o.exit_code, o.incomplete])).toEqual([[0, undefined]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-SC-3 a build that fails makes every file incomplete, naming the build: never red, never green, and the tests do not run", { timeout: 120_000 }, async () => {
    const root = packageWith({ build: "echo build broke >&2; exit 3", testFile: "touch tests-ran.marker" });
    try {
      const outcomes = await runTestFilesTogether(root, "fixture", [A, B], cleanEnv(), undefined, { buildFirst: true });
      expect(outcomes.every((o) => o.incomplete !== undefined && o.incomplete.includes("bun run build"))).toBe(true);
      expect(outcomes.map((o) => o.file)).toEqual([A, B]);
      const marker = await Bun.file(join(root, "tests-ran.marker")).exists();
      expect(marker).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
