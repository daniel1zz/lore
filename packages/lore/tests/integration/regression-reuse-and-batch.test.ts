// @reads package.json -- the production batched invocation runs this checkout's `test:file` script
// @spawns packages/lore/tests/zz-batched-fixture-*/*.test.ts -- throwaway real test files created and removed by the real-runner case
/**
 * @spec_ref spec-a-plan-s-regression-reuses-a-stored-suite-that-contains (AC-AC-1, AC-AC-2, AC-AC-3, BR-1496, BR-1497)
 *
 * A plan's regression reads a stored suite that contains its landings (or joins one in flight), rechecks the red files at
 * head in one batched run, and bisects them together: one batched invocation per probed commit, one prepared worktree per
 * commit per review. The real SuiteResultService over the in-memory store, the real PreparedWorktreeCache, stub runners that
 * count every invocation and every worktree preparation.
 *
 * Dimensions: HAPPY (reuse, shared bisection), NEGATIVE (a suite missing a landing is not reused, a batch-only failure is not
 * charged), BOUNDARY (M is head: no recheck; nothing red at M), ERROR (an unrunnable joined run), STATE (stored batch rows only
 * steer), REGRESSION (every "false green guarded" clause of the three criteria).
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, type LoreError, type Result } from "@lore/core";
import { outcomesOfTogetherRun, runTestFilesTogether } from "../../src/adapters/cli/assess-suite-runner.js";
import { PreparedWorktreeCache } from "../../src/adapters/cli/assess-worktree-cache.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import type { SuiteResultRecord } from "../../src/store/store-interface.js";
import { ReviewLeases, suiteLeaseKey } from "../../src/service/review-batch-lease.js";
import { milestoneFactsFingerprint } from "../../src/service/milestone-review.js";
import type { SuiteRun } from "../../src/service/milestone-review-inputs.js";
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
  /** A suite run that blocks until released (a suite in flight), per commit index. */
  readonly gated?: Readonly<Record<number, { readonly gate: Promise<void>; readonly unrunnable?: boolean }>>;
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
  const suiteRuns: string[] = [];
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
    runSuite: async (commit): Promise<Result<SuiteRun, LoreError>> => {
      suiteRuns.push(commit);
      const gated = script.gated?.[indexOf(commit)];
      if (gated !== undefined) {
        await gated.gate;
        if (gated.unrunnable === true) return ok({ status: "not_measured", reason: "checkout failed" });
      }
      const failing = Object.keys(script.files).filter((file) => modelOf(file).redWhen(indexOf(commit), { together: true, withOthers: true }));
      return ok({
        status: "measured",
        commit,
        commands: [{ command: "bun run test", exit_code: failing.length > 0 ? 1 : 0, output_tail: "" }],
        skipped: [],
        failing_test_files: failing.map((file) => ({ file, imports: [] })),
      });
    },
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
    headRef: "main",
    firstParentHistory: async (ref) => ok(Array.from({ length: indexOf(ref) + 1 }, (_, i) => sha(i))),
    fileExistsAt: async () => ok(true),
    firstParentCommitContaining: async () => ok(undefined),
  };
  /** Stores a measured suite result at a history position, as an earlier review would have. */
  const storeSuite = async (index: number, failing: readonly string[], id = `stored-${String(index)}`): Promise<SuiteResultRecord> => {
    const record: SuiteResultRecord = {
      id,
      commit_sha: sha(index),
      tree_sha: sha(0),
      status: "measured",
      attempt: 1,
      cause: null,
      commands: [{ command: "bun run test", exit_code: failing.length > 0 ? 1 : 0, output_tail: "" }],
      skipped: [],
      failing_test_files: failing.map((file) => ({ file, imports: [] })),
      duration_ms: 1,
      measured_at: "2026-10-30T09:00:00.000Z",
    };
    const inserted = await store.insertSuiteResult(record);
    if (!inserted.ok) throw new Error(`could not store the fixture suite: ${inserted.error.code}`);
    return record;
  };
  /** Stores one file's `batch` row at a commit, as an earlier review's search would have. */
  const storeBatchRow = async (index: number, file: string, exitCode: number): Promise<void> => {
    const inserted = await store.insertSuiteFileRuns([
      { suite_result_id: singleFileRunKey("batch", sha(index)), commit_sha: sha(index), file, exit_code: exitCode, output_tail: "", duration_ms: 1, measured_at: "2026-10-30T09:30:00.000Z" },
    ]);
    if (!inserted.ok) throw new Error(`could not store the fixture batch row: ${inserted.error.code}`);
  };
  return { ports, service, store, leases, suiteRuns, invocations, prepared, disposed, runner, storeSuite, storeBatchRow, head: sha(headIndex) };
}

type Fixture = ReturnType<typeof build>;

async function measure(f: Fixture, landings: RegressionLandingInput[]): Promise<RegressionAtHead> {
  const r = await regressionAtHead(landings, [], f.ports);
  await f.runner.disposeWorktrees?.();
  if (!r.ok) throw new Error(`regressionAtHead failed: ${r.error.code}`);
  return r.value;
}

const fingerprintOf = (r: RegressionAtHead): string =>
  milestoneFactsFingerprint({ ...(r.head !== undefined ? { headSuiteResultId: r.head.result_id } : {}), singleFileRunIds: r.single_file_run_ids, criteriaAttestationIds: [], citedRules: [], promptVersion: "p" });

const batchesAt = (f: Fixture, commit: string): Invocation[] => f.invocations.filter((i) => i.together && i.commit === commit);
const singles = (f: Fixture): Invocation[] => f.invocations.filter((i) => !i.together);

describe("suite reuse", () => {
  it("AC-AC-1 a stored suite containing every landing is read as M: no full suite runs, one batched run at head holds exactly the files red at M, a red-at-M green-at-head file is not charged, a green-at-M red-at-head file is not listed", async () => {
    // plan landings 3 and 6; M = 8 (stored); head = 39. A red from 6 (stays red), B red 6..20 (green at head), C red from 25 (turned red after M).
    const f = build({ commits: 40, files: { [A]: redFrom(6), [B]: { redWhen: (i) => i >= 6 && i <= 20 }, [C]: redFrom(25) } });
    const m = await f.storeSuite(8, [A, B]);
    const r = await measure(f, [landingAt(3), landingAt(6)]);
    // false green guarded: reading the suite at head runs the suite once
    expect(f.suiteRuns).toEqual([]);
    expect(r.head).toEqual({ commit: sha(8), result_id: m.id });
    // exactly one batched invocation at head, holding exactly the files red at M
    expect(f.invocations.filter((i) => i.together && i.commit === f.head)).toEqual([{ commit: f.head, files: [A, B], together: true }]);
    // false green guarded: skipping the head recheck charges the red-at-M green-at-H file
    expect(r.files.find((x) => x.file === B)).toMatchObject({ outcome: "green-at-head" });
    expect(r.charged).toEqual([{ file: A, landing: sha(6) }]);
    // B was run once more ALONE at head before it was dropped
    expect(f.invocations).toContainEqual({ commit: f.head, files: [B], together: false });
    // a file green at M and red at head is never listed
    expect(r.files.map((x) => x.file)).not.toContain(C);
    expect(r.rows.some((row) => row.subject === C)).toBe(false);
    // the fingerprint names M's suite id and the recheck's run ids, and changes with them
    expect(r.single_file_run_ids.map((x) => x.key)).toEqual(expect.arrayContaining([`${A}@${f.head}:batch`, `${B}@${f.head}:batch`]));
    expect(fingerprintOf(r)).not.toBe(milestoneFactsFingerprint({ headSuiteResultId: "another-suite", singleFileRunIds: r.single_file_run_ids, criteriaAttestationIds: [], citedRules: [], promptVersion: "p" }));
    expect(fingerprintOf(r)).not.toBe(milestoneFactsFingerprint({ headSuiteResultId: m.id, singleFileRunIds: [], criteriaAttestationIds: [], citedRules: [], promptVersion: "p" }));
  });

  it("AC-AC-1 a stored suite that misses the plan's last landing is not reused: the full suite runs exactly once, at head, and is stored", async () => {
    const f = build({ commits: 40, files: { [A]: redFrom(6) } });
    await f.storeSuite(4, []);
    const r = await measure(f, [landingAt(3), landingAt(6)]);
    // false green guarded: reusing the suite at 4 would read M without landing 6
    expect(f.suiteRuns).toEqual([f.head]);
    expect(r.head?.commit).toBe(f.head);
    const stored = await f.store.listSuiteResultsForCommit(f.head);
    expect(stored.ok && stored.value.filter((x) => x.status === "measured")).toHaveLength(1);
    // M is head: no recheck batch
    expect(batchesAt(f, f.head)).toEqual([]);
    expect(r.charged).toEqual([{ file: A, landing: sha(6) }]);
    // the next plan's review reads that stored suite and runs nothing
    const again = await measure(f, [landingAt(3), landingAt(6)]);
    expect(f.suiteRuns).toEqual([f.head]);
    expect(again.head?.result_id).toBe(r.head?.result_id);
  });

  it("AC-AC-1 M is main's head: no recheck runs and the suite result is the head result; nothing red at M: no head run at all", async () => {
    const atHead = build({ commits: 12, files: { [A]: redFrom(6) } });
    await atHead.storeSuite(11, [A]);
    const r = await measure(atHead, [landingAt(6)]);
    expect(atHead.suiteRuns).toEqual([]);
    expect(batchesAt(atHead, atHead.head)).toEqual([]);
    expect(r.charged).toEqual([{ file: A, landing: sha(6) }]);

    const green = build({ commits: 40, files: {} });
    await green.storeSuite(8, []);
    const g = await measure(green, [landingAt(6)]);
    expect(green.suiteRuns).toEqual([]);
    expect(green.invocations).toEqual([]);
    expect(g.charged).toEqual([]);
  });

  it("AC-AC-1 a landing no main commit can be found for disables reuse: containment cannot be shown, so the suite runs at head", async () => {
    const f = build({ commits: 40, files: {} });
    await f.storeSuite(30, []);
    // a landing that is not on main's chain and has no containing commit
    const stray: RegressionLandingInput = { landing_commit: sha(500), main_before: sha(20), task_slugs: ["stray"] };
    await measure(f, [stray]);
    expect(f.suiteRuns).toEqual([f.head]);
  });
});

describe("batched attribution", () => {
  /** The fixture of (a): a 32-commit plan range (1..32), M = 32, head = 40. */
  const rangeFixture = (files: Record<string, FileModel>): Fixture => build({ commits: 41, files });

  it("AC-AC-2 (a) three files red at M and at head that turned red at the same commit cost at most 15 invocations and one preparation per distinct commit", async () => {
    const f = rangeFixture({ [A]: redFrom(21), [B]: redFrom(21), [C]: redFrom(21) });
    await f.storeSuite(32, [A, B, C]);
    const r = await measure(f, [landingAt(1), landingAt(21)]);
    expect(r.charged.map((x) => x.file).sort()).toEqual([A, B, C]);
    expect(r.charged.every((x) => x.landing === sha(21))).toBe(true);
    const headBatches = batchesAt(f, f.head);
    expect(headBatches).toEqual([{ commit: f.head, files: [A, B, C], together: true }]);
    const searches = f.invocations.filter((i) => i.together && i.commit !== f.head);
    expect(searches.length).toBeLessThanOrEqual(5);
    for (const search of searches) expect(search.files).toEqual([A, B, C]);
    const alone = singles(f);
    // 3 red-before runs (at the floor) + 6 confirmations (2 per file); the floor run is not repeated per search probe
    expect(alone.filter((i) => i.commit === sha(0))).toHaveLength(3);
    expect(alone).toHaveLength(9);
    // false green guarded: one invocation per file per commit would exceed 15
    expect(f.invocations.length).toBeLessThanOrEqual(15);
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
    await f.storeSuite(32, [A, B, C]);
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
    // total does not exceed the per-file bisection total plus the one head recheck invocation
    expect(f.invocations.length).toBeLessThanOrEqual(perFileTotal + batchesAt(f, f.head).length);
    expect(f.invocations.length).toBeLessThan(perFileTotal);
  });

  it("AC-AC-2 (c) a file that fails only when run beside another file is never charged: its confirmation alone disagrees, so it is not measured as flaky-bisection", async () => {
    const interfering: FileModel = { redWhen: (_index, context) => context.withOthers };
    const f = rangeFixture({ [A]: redFrom(21), [B]: interfering });
    await f.storeSuite(32, [A, B]);
    const r = await measure(f, [landingAt(1), landingAt(21)]);
    expect(r.charged).toEqual([{ file: A, landing: sha(21) }]);
    const b = r.files.find((x) => x.file === B);
    expect(b).toMatchObject({ outcome: "not-measured", cause: "flaky-bisection" });
    expect(r.causes).toEqual(["flaky-bisection"]);
    // false green guarded: confirming in a batch would charge B; every confirmation was a single-file invocation
    for (const invocation of f.invocations.filter((i) => !i.together)) expect(invocation.files).toHaveLength(1);
  });

  it("AC-AC-2 (d) a file red at M that passes in the head batch but fails alone at head is kept and attributed, never dropped", async () => {
    const hidesInBatch: FileModel = { redWhen: (index, context) => index >= 21 && !(context.withOthers && index === 40) };
    const f = rangeFixture({ [A]: redFrom(21), [B]: hidesInBatch });
    await f.storeSuite(32, [A, B]);
    const r = await measure(f, [landingAt(1), landingAt(21)]);
    expect(r.files.find((x) => x.file === B)).not.toMatchObject({ outcome: "green-at-head" });
    expect(r.charged.map((x) => x.file).sort()).toEqual([A, B]);
    expect(f.invocations).toContainEqual({ commit: f.head, files: [B], together: false });
  });

  it("AC-AC-2 (e) a stored batch result is never used as red-before, as a confirmation or as an interval start; it may answer a search step at a probed commit", async () => {
    // red-before: A is red at the floor (commit 0) although a stored batch row says green there
    const before = rangeFixture({ [A]: redFrom(0) });
    await before.storeSuite(32, [A]);
    await before.storeBatchRow(0, A, 0);
    const b = await measure(before, [landingAt(1), landingAt(21)]);
    expect(b.files.find((x) => x.file === A)).toMatchObject({ outcome: "red-before" });
    expect(singles(before).filter((i) => i.commit === sha(0))).toHaveLength(1);

    // interval start: a lying batch row (green at 25) must not become the interval's known-green start
    const start = rangeFixture({ [A]: redFrom(21) });
    await start.storeSuite(32, [A]);
    await start.storeBatchRow(25, A, 0);
    const s = await measure(start, [landingAt(1), landingAt(21)]);
    expect(s.charged).toEqual([{ file: A, landing: sha(21) }]);

    // confirmation: a stored batch row (red at 21, 20) never stands in for the single-file confirmation runs
    const confirm = rangeFixture({ [A]: redFrom(21) });
    await confirm.storeSuite(32, [A]);
    await confirm.storeBatchRow(21, A, 1);
    await confirm.storeBatchRow(20, A, 0);
    const c = await measure(confirm, [landingAt(1), landingAt(21)]);
    expect(c.charged).toEqual([{ file: A, landing: sha(21) }]);
    expect(singles(confirm).filter((i) => i.commit === sha(21) || i.commit === sha(20))).toHaveLength(2);

    // search step: a stored batch row at the first probe (16) answers it without a run
    const step = rangeFixture({ [A]: redFrom(21) });
    await step.storeSuite(32, [A]);
    await step.storeBatchRow(16, A, 0);
    const t = await measure(step, [landingAt(1), landingAt(21)]);
    expect(t.charged).toEqual([{ file: A, landing: sha(21) }]);
    expect(batchesAt(step, sha(16))).toEqual([]);
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

describe("join in flight", () => {
  /** Waits until a full suite is live at `index` (its `suite:<sha>` lease is held). */
  const untilLive = async (f: Fixture, index: number): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const live = await f.service.listLiveSuiteCommits();
      if (live.ok && live.value.includes(sha(index))) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`no suite went live at ${String(index)}`);
  };
  const deferred = (): { promise: Promise<void>; release: () => void } => {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it("AC-AC-3 a containing suite in flight is joined: no full suite starts at head, the runner is invoked once in total, M is the joined result", async () => {
    const gate = deferred();
    const f = build({ commits: 40, files: {}, gated: { 30: { gate: gate.promise } } });
    const running = f.service.lookupOrRun(sha(30), f.runner);
    await untilLive(f, 30);
    const assessing = regressionAtHead([landingAt(10)], [], f.ports);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // still waiting: nothing started at head
    expect(f.suiteRuns).toEqual([sha(30)]);
    gate.release();
    const [, result] = await Promise.all([running, assessing]);
    expect(f.suiteRuns).toEqual([sha(30)]);
    expect(result.ok && result.value.head?.commit).toBe(sha(30));
    // false green guarded: starting a run at the newer head would invoke the runner twice
    expect(f.suiteRuns).toHaveLength(1);
  });

  it("AC-AC-3 two plans whose landings the run contains, assessed while it runs, invoke the runner once in total", async () => {
    const gate = deferred();
    const f = build({ commits: 40, files: {}, gated: { 30: { gate: gate.promise } } });
    const running = f.service.lookupOrRun(sha(30), f.runner);
    await untilLive(f, 30);
    const first = regressionAtHead([landingAt(10)], [], f.ports);
    const second = regressionAtHead([landingAt(12), landingAt(20)], [], f.ports);
    await new Promise((resolve) => setTimeout(resolve, 30));
    gate.release();
    const [, one, two] = await Promise.all([running, first, second]);
    expect(f.suiteRuns).toEqual([sha(30)]);
    expect(one.ok && one.value.head?.commit).toBe(sha(30));
    expect(two.ok && two.value.head?.commit).toBe(sha(30));
  });

  it("AC-AC-3 a run in flight that misses the plan's last landing is not joined: the plan runs its own full suite at head", async () => {
    const gate = deferred();
    const f = build({ commits: 40, files: {}, gated: { 5: { gate: gate.promise } } });
    const running = f.service.lookupOrRun(sha(5), f.runner);
    await untilLive(f, 5);
    // landing 10 is above the run's commit 5: joining would read M without it
    const result = await regressionAtHead([landingAt(3), landingAt(10)], [], f.ports);
    expect(f.suiteRuns).toEqual([sha(5), f.head]);
    expect(result.ok && result.value.head?.commit).toBe(f.head);
    // the M the review used contains the landing: its position is at or above landing 10
    expect(result.ok && indexOf(result.value.head?.commit ?? sha(0))).toBeGreaterThanOrEqual(10);
    gate.release();
    await running;
  });

  it("AC-AC-3 a joined run that ends unrunnable is never read as M: with nothing else containing the landings the plan runs its own suite at head", async () => {
    const gate = deferred();
    const f = build({ commits: 40, files: {}, gated: { 30: { gate: gate.promise, unrunnable: true } } });
    const running = f.service.lookupOrRun(sha(30), f.runner);
    await untilLive(f, 30);
    const assessing = regressionAtHead([landingAt(10)], [], f.ports);
    await new Promise((resolve) => setTimeout(resolve, 30));
    gate.release();
    const [, result] = await Promise.all([running, assessing]);
    expect(f.suiteRuns).toEqual([sha(30), f.head]);
    expect(result.ok && result.value.head?.commit).toBe(f.head);
    // false green guarded: the unrunnable result at 30 was not taken as M (its row would be not-measured, not a measured head)
    expect(result.ok && result.value.rows.every((row) => row.verdict !== "not-measured")).toBe(true);
  });
});
