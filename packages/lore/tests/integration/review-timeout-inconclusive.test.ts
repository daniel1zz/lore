// @reads packages/lore/src/service/regression-at-head.ts
// @reads packages/lore/src/service/selection-run-at-l.ts
// @reads packages/lore/src/service/suite-result-service.ts
// @reads packages/lore/src/service/test-run-classification.ts
// @reads packages/lore/src/store/migrations/migration-047.ts
// @reads scripts/test-outcome-reporter.ts
// @spawns .scratch/timeout-fixture-*/*.test.ts -- throwaway fixture test files created and removed by the real-run cases
// @spawns-external bun real vitest runs over throwaway fixture test files (the production batched invocation path, read through the outcome reporter)
/**
 * @spec_ref spec-review-test-runs-are-capped-per-machine-and-a-run-that (AC-MC-3, BR-1533)
 *
 * A review test run whose failures are all test or hook timeouts is inconclusive, never red and never green. Four groups:
 *   1. REAL RUNS: real vitest runs over fixture files (an assertion, a test timeout, a beforeAll timeout, a pass) read through the
 *      per-test outcome report, not the console text.
 *   2. STORE: the real SQLiteStore keeps an inconclusive run beside the conclusive ones; a retry runs again; the newest conclusive run is reused.
 *   3. ATTRIBUTION: `regressionAtHead` over a real store with a scripted runner whose runs can time out.
 *   4. MIGRATION: a schema-46 store with old rows is classified once (passing -> green, failing -> inconclusive `unclassified`).
 *
 * Dimensions: HAPPY (assertion red, pass green), NEGATIVE (a timeout is never charged), BOUNDARY (hook timeout with skipped tests),
 * STATE (a retry in the next review concludes and charges), ERROR (an inconclusive point leaves the file not measured, cause timeout),
 * REGRESSION (every false-green clause of AC-MC-3).
 */

import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import { runTestFilesTogether } from "../../src/adapters/cli/assess-suite-runner.js";
import { parseFailingTestFiles } from "../../src/service/milestone-review-inputs.js";
import { regressionAtHead, type RegressionAtHead, type RegressionAtHeadPorts, type RegressionLandingInput } from "../../src/service/regression-at-head.js";
import { SuiteResultService, singleFileRunKey, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../src/service/suite-result-service.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { SuiteFileRunRecord } from "../../src/store/store-interface.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

// ---------------------------------------------------------------------------------------------------------------------
// 1. Real vitest runs
// ---------------------------------------------------------------------------------------------------------------------

describe("real vitest runs over fixture files", () => {
  let fixtureRoot: string;
  let outcomes: FileRunOutcome[];

  const FILES = ["assertion.test.ts", "slow-test.test.ts", "slow-hook.test.ts", "passing.test.ts"] as const;

  beforeAll(async () => {
    mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
    fixtureRoot = mkdtempSync(join(REPO_ROOT, ".scratch", "timeout-fixture-"));
    writeFileSync(join(fixtureRoot, "assertion.test.ts"), `import { it, expect } from "vitest";\nit("asserts", () => { expect(1).toBe(2); });\n`);
    writeFileSync(join(fixtureRoot, "slow-test.test.ts"), `import { it } from "vitest";\nit("is slow", async () => { await new Promise((r) => setTimeout(r, 600)); }, 50);\n`);
    writeFileSync(
      join(fixtureRoot, "slow-hook.test.ts"),
      `import { it, beforeAll } from "vitest";\nbeforeAll(async () => { await new Promise((r) => setTimeout(r, 600)); }, 50);\nit("one", () => {});\nit("two", () => {});\n`,
    );
    writeFileSync(join(fixtureRoot, "passing.test.ts"), `import { it, expect } from "vitest";\nit("passes", () => { expect(1).toBe(1); });\n`);
    writeFileSync(join(fixtureRoot, "vc.mjs"), `export default { test: { include: ["*.test.ts"] } };\n`);
    // reason: this stands in for the project's `test:file` script; it runs the REAL vitest with the REAL outcome reporter, the way scripts/test-file.ts does in production.
    writeFileSync(
      join(fixtureRoot, "run-fixture.mjs"),
      [
        `import { spawnSync } from "node:child_process";`,
        `import { dirname, join } from "node:path";`,
        `import { fileURLToPath } from "node:url";`,
        `const dir = dirname(fileURLToPath(import.meta.url));`,
        `const reporter = ${JSON.stringify(join(REPO_ROOT, "scripts", "test-outcome-reporter.ts"))};`,
        `const r = spawnSync("bunx", ["vitest", "run", "--root", dir, "--config", join(dir, "vc.mjs"), "--reporter=dot", "--reporter=" + reporter, ...process.argv.slice(2)], { stdio: "inherit", cwd: dir });`,
        `process.exit(r.status ?? 1);`,
        ``,
      ].join("\n"),
    );
    writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ scripts: { "test:file": "bun run-fixture.mjs" } }));
    outcomes = await runTestFilesTogether(fixtureRoot, "c".repeat(40), FILES, process.env, { timeoutMs: 170_000, graceMs: 2000 });
  }, 180_000);

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  const outcomeOf = (file: string): FileRunOutcome => {
    const found = outcomes.find((o) => o.file === file);
    if (found === undefined) throw new Error(`no outcome for ${file}`);
    return found;
  };

  it("AC-MC-3 the assertion file is red, the passing file is green", () => {
    expect(outcomeOf("assertion.test.ts")).toMatchObject({ exit_code: 1, classification: "red" });
    expect(outcomeOf("assertion.test.ts").inconclusive_cause).toBeUndefined();
    expect(outcomeOf("passing.test.ts")).toMatchObject({ exit_code: 0, classification: "green" });
  });

  it("AC-MC-3 the test-timeout file and the beforeAll-timeout file are inconclusive with cause timeout", () => {
    expect(outcomeOf("slow-test.test.ts")).toMatchObject({ classification: "inconclusive", inconclusive_cause: "timeout" });
    expect(outcomeOf("slow-hook.test.ts")).toMatchObject({ classification: "inconclusive", inconclusive_cause: "timeout" });
  });

  it("AC-MC-3 false green guarded: the console text of the hook timeout reads as a failing file, so a console-text classifier would call it red", () => {
    const tail = outcomeOf("slow-hook.test.ts").output_tail.replace(ANSI, "");
    // the old reader: the file shows up as FAIL in the runner's console output ...
    expect(parseFailingTestFiles(tail)).toContain("slow-hook.test.ts");
    // ... while the outcome report classifies it by the failures' own error, so it is not red
    expect(outcomeOf("slow-hook.test.ts").classification).not.toBe("red");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// shared world for the store and attribution groups: a real SQLite store, a scripted runner whose runs can time out
// ---------------------------------------------------------------------------------------------------------------------

const sha = (index: number): string => index.toString(16).padStart(40, "0");
const indexOf = (commit: string): number => Number.parseInt(commit, 16);
const landingAt = (index: number): RegressionLandingInput => ({ landing_commit: sha(index), main_before: sha(index - 1), task_slugs: [`task-${String(index)}`] });
const F = "packages/x/tests/f.test.ts";
const G = "packages/x/tests/g.test.ts";

type Behavior = "red" | "green" | "timeout";

interface Invocation {
  readonly commit: string;
  readonly files: readonly string[];
  readonly together: boolean;
}

class World {
  readonly dir = mkdtempSync(join(tmpdir(), "lore-timeout-inconclusive-"));
  readonly store = new SQLiteStore(join(this.dir, "corpus.db"));
  readonly invocations: Invocation[] = [];
  private clock = 0;
  /** What a file does at a history position; changed between reviews to model a machine that is no longer loaded. */
  behave: (file: string, index: number) => Behavior = () => "green";

  constructor(readonly commits: number, readonly files: readonly string[]) {}

  newService(): SuiteResultService {
    return new SuiteResultService({
      store: this.store,
      now: () => `2026-11-01T10:00:00.${String(++this.clock).padStart(3, "0")}Z`,
      newId: () => `suite-${String(++this.clock)}`,
      clockMs: () => this.clock * 10,
    });
  }

  private outcomes(commit: string, files: readonly string[]): FileRunOutcome[] {
    return files.map((file): FileRunOutcome => {
      const behavior = this.behave(file, indexOf(commit));
      if (behavior === "timeout") {
        return { file, exit_code: 1, output_tail: "Test timed out in 50ms.", duration_ms: 50, classification: "inconclusive", inconclusive_cause: "timeout", incomplete: "timed out" };
      }
      return { file, exit_code: behavior === "red" ? 1 : 0, output_tail: "", duration_ms: 1, classification: behavior };
    });
  }

  readonly runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: ref === "main" ? sha(this.commits - 1) : ref, tree: sha(0) }),
    runFiles: async (commit, files) => {
      this.invocations.push({ commit, files: [...files], together: false });
      return ok(this.outcomes(commit, files));
    },
    runFilesTogether: async (commit, files) => {
      this.invocations.push({ commit, files: [...files], together: true });
      return ok(this.outcomes(commit, files));
    },
    disposeWorktrees: async () => ok(undefined),
  };

  ports(service: SuiteResultService): RegressionAtHeadPorts {
    return {
      suites: service,
      runner: this.runner,
      selectTests: async ({ commit }) =>
        ok({ commit, selected: this.files.map((path) => ({ path, needsCompiledBinary: false })), totalTestFiles: this.files.length, unparseable: [], removedTests: [], accounting: `commit: ${commit}` }),
      headRef: "main",
      firstParentHistory: async (ref) => ok(Array.from({ length: indexOf(ref) + 1 }, (_, i) => sha(i))),
      fileExistsAt: async () => ok(true),
      firstParentCommitContaining: async () => ok(undefined),
    };
  }

  /** One review: a fresh service over the SAME store, as a later `lore assess` process would have. */
  async review(landings: RegressionLandingInput[]): Promise<RegressionAtHead> {
    const result = await regressionAtHead(landings, [], this.ports(this.newService()));
    if (!result.ok) throw new Error(`regressionAtHead failed: ${result.error.code}`);
    return result.value;
  }

  singlesAt(commit: string): Invocation[] {
    return this.invocations.filter((i) => !i.together && i.commit === commit);
  }

  close(): void {
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const fileRow = (key: string, commit: string, file: string, overrides: Partial<SuiteFileRunRecord>): SuiteFileRunRecord => ({
  suite_result_id: key,
  commit_sha: commit,
  file,
  exit_code: 0,
  output_tail: "",
  duration_ms: 1,
  measured_at: "2026-11-01T09:00:00.000Z",
  classification: "green",
  inconclusive_cause: null,
  ...overrides,
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. Store
// ---------------------------------------------------------------------------------------------------------------------

describe("stored runs carry a classification", () => {
  let world: World;
  beforeEach(() => {
    world = new World(10, [F]);
  });
  afterEach(() => world.close());

  it("AC-MC-3 an inconclusive run is stored beside the conclusive ones; a retry runs again; the newest conclusive run is reused", async () => {
    const commit = sha(4);
    world.behave = () => "timeout";
    const first = await world.newService().runSingleFile(commit, F, "bisect", world.runner);
    expect(first.ok && first.value).toMatchObject({ classification: "inconclusive", inconclusive_cause: "timeout" });
    // the next review runs it again (an inconclusive run is no result) and stores the second inconclusive run too
    const second = await world.newService().runSingleFile(commit, F, "bisect", world.runner);
    expect(second.ok && second.value).toMatchObject({ classification: "inconclusive" });
    expect(world.singlesAt(commit)).toHaveLength(2);
    // the load is gone: the third run concludes and is stored
    world.behave = () => "green";
    const third = await world.newService().runSingleFile(commit, F, "bisect", world.runner);
    expect(third.ok && third.value).toMatchObject({ classification: "green", inconclusive_cause: null });
    // a conclusive run is reused: nothing runs, and a later red run cannot replace it
    world.behave = () => "red";
    const reused = await world.newService().runSingleFile(commit, F, "bisect", world.runner);
    expect(reused.ok && reused.value).toMatchObject({ classification: "green" });
    expect(world.singlesAt(commit)).toHaveLength(3);
    const stored = await world.store.listSuiteFileRuns(singleFileRunKey("bisect", commit));
    expect(stored.ok && stored.value.map((r) => r.classification)).toEqual(["inconclusive", "inconclusive", "green"]);
  });

  it("AC-MC-3 a batched run stores an inconclusive file as such and the next batch runs only that file", async () => {
    const commit = sha(3);
    world.behave = (file) => (file === F ? "timeout" : "green");
    const service = world.newService();
    const first = await service.runBatch(commit, [F, G], world.runner);
    expect(first.ok && first.value.map((r) => [r.file, r.classification])).toEqual([[F, "inconclusive"], [G, "green"]]);
    world.behave = () => "green";
    const second = await world.newService().runBatch(commit, [F, G], world.runner);
    expect(second.ok && second.value.map((r) => [r.file, r.classification])).toEqual([[F, "green"], [G, "green"]]);
    expect(world.invocations.filter((i) => i.together).map((i) => i.files)).toEqual([[F, G], [F]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. Attribution
// ---------------------------------------------------------------------------------------------------------------------

describe("attribution never charges a timeout", () => {
  let world: World;
  afterEach(() => world.close());

  it("AC-MC-3 a file red at a landing only by timeout and green at its parent is not charged: not measured, cause timeout, named", async () => {
    // landings 5 and 8 (L = head = 8). F is green before 5, TIMES OUT at 5, red from 6. Read as red, the timeout at 5 would charge landing 5.
    world = new World(9, [F, G]);
    world.behave = (file, index) => (file === G ? "green" : index < 5 ? "green" : index === 5 ? "timeout" : "red");
    const r = await world.review([landingAt(5), landingAt(8)]);
    expect(r.charged).toEqual([]);
    expect(r.files).toEqual([expect.objectContaining({ file: F, outcome: "not-measured", cause: "timeout" })]);
    const row = r.rows.find((x) => x.subject === F);
    expect(row).toMatchObject({ verdict: "not-measured", cause: "timeout" });
    expect(row?.detail).toContain(F);
    expect(r.causes).toEqual(["timeout"]);
    // the green file is untouched by the other file's timeout
    expect(r.rows.some((x) => x.subject === G)).toBe(false);
  });

  it("AC-MC-3 a file inconclusive at the selection commit is not measured (cause timeout) while the other selected files are measured", async () => {
    world = new World(6, [F, G]);
    world.behave = (file) => (file === F ? "timeout" : "green");
    const r = await world.review([landingAt(5)]);
    expect(r.charged).toEqual([]);
    expect(r.files).toEqual([expect.objectContaining({ file: F, outcome: "not-measured", cause: "timeout" })]);
    expect(r.causes).toEqual(["timeout"]);
    // not the whole dimension: the selection row stands and counts the measured file
    expect(r.rows.find((x) => x.subject.startsWith("selection@"))).toMatchObject({ verdict: "pass" });
  });

  it("AC-MC-3 a file red by assertion at the landing and inconclusive at its parent is not measured (no confirmation), never charged; the next review retries and concludes", async () => {
    // landing 5 = head = L. F is red from 5; at the parent (4) the first review's run times out.
    world = new World(6, [F]);
    world.behave = (_file, index) => (index >= 5 ? "red" : "timeout");
    const first = await world.review([landingAt(5)]);
    // false green guarded: an inconclusive parent read as green would confirm the transition and charge landing 5
    expect(first.charged).toEqual([]);
    expect(first.files).toEqual([expect.objectContaining({ file: F, outcome: "not-measured", cause: "timeout" })]);
    // one run per point per review: the parent was run once, alone; no confirmation ran
    expect(world.singlesAt(sha(4))).toHaveLength(1);
    expect(world.singlesAt(sha(5))).toHaveLength(0);

    // the next review: the load is gone, the parent is run again (its stored run was inconclusive) and the transition is confirmed
    world.behave = (_file, index) => (index >= 5 ? "red" : "green");
    const second = await world.review([landingAt(5)]);
    expect(second.charged).toEqual([{ file: F, landing: sha(5) }]);
    expect(world.singlesAt(sha(4)).length).toBeGreaterThan(1);
  });

  it("AC-MC-3 at one point an inconclusive run newer than a conclusive red leaves the red deciding", async () => {
    // landing 5 = head. F is red from 5. At the floor (4) an OLD conclusive red run is stored, then a NEWER inconclusive one.
    world = new World(6, [F]);
    world.behave = (_file, index) => (index >= 5 ? "red" : "green");
    const key = singleFileRunKey("bisect", sha(4));
    const stored = await world.store.insertSuiteFileRuns([
      fileRow(key, sha(4), F, { exit_code: 1, classification: "red", measured_at: "2026-11-01T08:00:00.000Z" }),
      fileRow(key, sha(4), F, { exit_code: 1, classification: "inconclusive", inconclusive_cause: "timeout", measured_at: "2026-11-01T09:00:00.000Z" }),
    ]);
    expect(stored.ok).toBe(true);
    const r = await world.review([landingAt(5)]);
    expect(r.files).toEqual([expect.objectContaining({ file: F, outcome: "red-before", commit: sha(4) })]);
    expect(r.charged).toEqual([]);
    // the stored red decided: nothing ran at the floor
    expect(world.singlesAt(sha(4))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. Migration
// ---------------------------------------------------------------------------------------------------------------------

describe("the store migration classifies the old rows once", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-migration-047-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("AC-MC-3 passing rows become green, failing rows inconclusive (unclassified), and no stored run lacks a classification afterwards", async () => {
    const path = join(dir, "lore.db");
    new SQLiteStore(path, { schemaCeiling: 46 }).close();
    const old = new Database(path);
    const insert = "INSERT INTO suite_file_runs (suite_result_id, commit_sha, file, exit_code, output_tail, duration_ms, measured_at) VALUES (?, ?, ?, ?, '', 1, '2026-10-30T10:00:00.000Z')";
    old.run(insert, [`file-bisect@${sha(1)}`, sha(1), "a.test.ts", 0]);
    old.run(insert, [`file-bisect@${sha(1)}`, sha(1), "b.test.ts", 1]);
    old.run(insert, [`file-batch@${sha(2)}`, sha(2), "b.test.ts", 1]);
    old.run(insert, ["suite-legacy", sha(3), "c.test.ts", 1]);
    expect(old.query("PRAGMA user_version").get()).toEqual({ user_version: 46 });
    old.close();

    const migrated = new SQLiteStore(path, { migrate: true });
    const rows = [
      ...((await migrated.listSuiteFileRuns(`file-bisect@${sha(1)}`)).ok ? ((await migrated.listSuiteFileRuns(`file-bisect@${sha(1)}`)) as { ok: true; value: SuiteFileRunRecord[] }).value : []),
      ...((await migrated.listSuiteFileRuns(`file-batch@${sha(2)}`)) as { ok: true; value: SuiteFileRunRecord[] }).value,
      ...((await migrated.listSuiteFileRuns("suite-legacy")) as { ok: true; value: SuiteFileRunRecord[] }).value,
    ];
    migrated.close();
    expect(rows.map((r) => [r.file, r.exit_code, r.classification, r.inconclusive_cause])).toEqual([
      ["a.test.ts", 0, "green", null],
      ["b.test.ts", 1, "inconclusive", "unclassified"],
      ["b.test.ts", 1, "inconclusive", "unclassified"],
      ["c.test.ts", 1, "inconclusive", "unclassified"],
    ]);
    const after = new Database(path);
    expect(after.query("SELECT COUNT(*) AS n FROM suite_file_runs WHERE classification IS NULL OR classification NOT IN ('red','green','inconclusive')").get()).toEqual({ n: 0 });
    expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: 47 });
    after.close();
  });

  it("AC-MC-3 false green guarded: no reader of stored runs has a branch for unclassified rows (every row read has a classification)", () => {
    for (const file of ["regression-at-head.ts", "selection-run-at-l.ts", "suite-result-service.ts"]) {
      const source = readFileSync(join(REPO_ROOT, "packages", "lore", "src", "service", file), "utf8");
      expect(source, `${file} must not branch on unclassified rows`).not.toMatch(/unclassified/);
    }
  });
});
