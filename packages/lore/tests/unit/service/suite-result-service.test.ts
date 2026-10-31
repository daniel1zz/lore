// @spawns-external git throwaway fixture repositories for the real runner's process-tree cases
// @spawns-external bun the real runner runs a fixture package's `test:file` script through `bun run`
// @spawns-external node the fixture scripts are node programs that ignore SIGTERM
/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-2, BR-1497, BR-1412)
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (BR-1497)
 *
 * The suite-result store keeps per-(commit, file) runs once, and the suite results older measurements left behind (read by the
 * main red/green ledger). A fake runner counts runs; the store is the in-memory double (the SQLite round-trip is pinned in
 * `tests/unit/store/suite-result-store.bun.test.ts`).
 *
 * RETIRED with spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (no review runs the full suite): the "lookup-or-run"
 * cases (a first lookup runs the suite once and stores it, a second reads the store, an incomplete run is stored unrunnable and
 * retried, a runner error / exit 5 is stored unrunnable) and the real-runner cases of a SUITE run (a suite whose tree ignores
 * SIGTERM, an EPERM kill of a suite, the oracle lock wait of a suite). What survives of them is carried by the cases below: the
 * process-tree timeout for single-file AND batched runs, the EPERM kill handling, and the "exit outside {0, 1} is no result" rule.
 *
 * Dimensions: HAPPY (a stored result is read back in the review's shape), NEGATIVE (unknown result id / no files refused),
 * BOUNDARY (a single-file run that exited outside {0, 1} stores nothing), ERROR (a hung process tree is ended, a failed kill
 * settles), STATE (a (commit, file, kind) is stored once), REGRESSION (main red/green is derived from the store and no
 * `main-checked` row is written any more; an unrunnable result checks nothing).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitCommitSuiteRunner } from "../../../src/adapters/cli/assess-suite-runner.js";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { SuiteResultRecord } from "../../../src/store/store-interface.js";
import {
  SuiteResultService,
  deriveMainCheckedRows,
  suiteRunOfResult,
  type CommitSuiteRunnerPort,
  type FileRunOutcome,
} from "../../../src/service/suite-result-service.js";
import { MAIN_CHECKED_ACTION, MAIN_RED_ACTION, classifySuiteForMainRed, foldMainRedRecords, planMainRedWrites } from "../../../src/service/milestone-review.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const TREE_A = "1".repeat(40);
const TREE_B = "2".repeat(40);
const FILE_X = "packages/x/tests/x.test.ts";

type SuiteSeed = Pick<SuiteResultRecord, "status" | "cause" | "commands" | "skipped" | "failing_test_files">;

const GREEN: SuiteSeed = {
  status: "measured",
  cause: null,
  commands: [{ command: "bun run test", exit_code: 0, output_tail: "all passed" }],
  skipped: [{ command: "bun run check:plan-close", reason: 'package.json defines no "check:plan-close" script' }],
  failing_test_files: [],
};

const RED: SuiteSeed = {
  status: "measured",
  cause: null,
  commands: [{ command: "bun run test", exit_code: 1, output_tail: "FAIL x" }],
  skipped: [],
  failing_test_files: [{ file: FILE_X, imports: ["packages/x/src/x.ts"] }],
};

const UNRUNNABLE: SuiteSeed = { status: "unrunnable", cause: "no worktree", commands: [], skipped: [], failing_test_files: [] };

interface FakeRunner extends CommitSuiteRunnerPort {
  readonly fileRuns: { commit: string; files: readonly string[] }[];
}

function fakeRunner(): FakeRunner {
  const fileRuns: { commit: string; files: readonly string[] }[] = [];
  return {
    fileRuns,
    resolveCommit: async (ref) => ok({ commit: ref, tree: ref === COMMIT_B ? TREE_B : TREE_A }),
    runFiles: async (commit, files) => {
      fileRuns.push({ commit, files });
      return ok(files.map((file): FileRunOutcome => ({ file, exit_code: file === FILE_X ? 1 : 0, output_tail: `out ${file}`, duration_ms: 7 })));
    },
  };
}

let idCounter = 0;

function build(): { service: SuiteResultService; store: InMemoryStore; seed: (commit: string, shape: SuiteSeed) => Promise<SuiteResultRecord> } {
  const store = new InMemoryStore();
  let n = 0;
  let ms = 0;
  const service = new SuiteResultService({
    store,
    now: () => {
      n += 1;
      return `2026-10-28T10:00:${String(n).padStart(2, "0")}.000Z`;
    },
    newId: () => `suite-test-${String(++idCounter)}`,
    clockMs: () => {
      ms += 250;
      return ms;
    },
  });
  /** Stores a suite result as an older measurement would have left it (the main red/green ledger reads these). */
  const seed = async (commit: string, shape: SuiteSeed): Promise<SuiteResultRecord> => {
    n += 1;
    const record: SuiteResultRecord = {
      id: `suite-seed-${String(++idCounter)}`,
      commit_sha: commit,
      tree_sha: commit === COMMIT_B ? TREE_B : TREE_A,
      attempt: 1,
      duration_ms: 250,
      measured_at: `2026-10-28T10:00:${String(n).padStart(2, "0")}.000Z`,
      ...shape,
    };
    const inserted = await store.insertSuiteResult(record);
    if (!inserted.ok) throw new Error(`could not seed the suite result: ${inserted.error.code}`);
    return record;
  };
  return { service, store, seed };
}

describe("suite-result store: stored results are read back", () => {
  it("AC-AF-2 a single-file run that exited outside {0, 1} is refused and stores no row", async () => {
    const { service } = build();
    const runner = { ...fakeRunner(), runFiles: async (_c: string, files: readonly string[]) => ok(files.map((file): FileRunOutcome => ({ file, exit_code: 2, output_tail: "usage", duration_ms: 1 }))) };
    const ran = await service.runSingleFile(COMMIT_A, FILE_X, "bisect", runner);
    expect(ran.ok).toBe(false);
    const rows = await service.listFileRuns(`file-bisect@${COMMIT_A}`);
    expect(rows.ok && rows.value).toEqual([]);
  });

  it("AC-AF-2 a batched run that exited outside {0, 1} (5 = oracle lock contended) is refused and stores no row", async () => {
    const { service } = build();
    const runner: CommitSuiteRunnerPort = {
      ...fakeRunner(),
      runFilesTogether: async (_c, files) => ok(files.map((file): FileRunOutcome => ({ file, exit_code: 5, output_tail: "oracle-lock: contended", duration_ms: 1 }))),
    };
    const ran = await service.runBatch(COMMIT_A, [FILE_X], runner);
    expect(ran.ok).toBe(false);
    expect(!ran.ok && "message" in ran.error ? ran.error.message : "").toContain("oracle lock");
    const rows = await service.listFileRuns(`file-batch@${COMMIT_A}`);
    expect(rows.ok && rows.value).toEqual([]);
  });

  it("AC-AF-2 a stored measured result is returned as the review's suite shape; an unrunnable one is not_measured with its cause", async () => {
    const { seed } = build();
    const measured = await seed(COMMIT_A, RED);
    const unrunnable = await seed(COMMIT_B, UNRUNNABLE);
    expect(suiteRunOfResult(measured)).toMatchObject({ status: "measured", commit: COMMIT_A });
    expect(suiteRunOfResult(unrunnable)).toEqual({ status: "not_measured", reason: "no worktree" });
  });
});

describe("suite-result store: main red/green is read from the store", () => {
  it("AC-AF-2 main-checked rows are derived from measured results; an unrunnable result checks nothing", async () => {
    const { service, seed } = build();
    await seed(COMMIT_A, GREEN);
    await seed(COMMIT_B, UNRUNNABLE);
    const rows = await service.listMainCheckedRows();
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    expect(rows.value).toHaveLength(1);
    expect(rows.value[0]).toMatchObject({ action: MAIN_CHECKED_ACTION, details: { commit: COMMIT_A, status: "green" } });
  });

  it("AC-AF-2 red at a later commit opens one main-red record whose range starts at the green commit stored before it, and writes no main-checked row", async () => {
    const { service, seed } = build();
    await seed(COMMIT_A, GREEN);
    const redResult = await seed(COMMIT_B, RED);
    // the store already holds the red commit's own check when the review records main red
    const rows = await service.listMainCheckedRows();
    if (!rows.ok) throw new Error("listMainCheckedRows failed");
    const folded = foldMainRedRecords(rows.value);
    expect(folded.ok).toBe(true);
    if (!folded.ok) return;
    expect(folded.value.checks.map((c) => [c.commit, c.status])).toEqual([
      [COMMIT_A, "green"],
      [COMMIT_B, "red"],
    ]);
    const measured = classifySuiteForMainRed(suiteRunOfResult(redResult) as Parameters<typeof classifySuiteForMainRed>[0]);
    const written = planMainRedWrites(folded.value, measured, "2026-10-28T11:00:00.000Z");
    expect(written.map((r) => r.action)).toEqual([MAIN_RED_ACTION]);
    expect(written[0]?.details).toMatchObject({ range_from: COMMIT_A, range_to: COMMIT_B, failing_files: [FILE_X], failing_checks: ["bun run test"] });
  });

  it("AC-AF-2 red with no earlier check starts the range at null, not at the red commit itself", async () => {
    const { service, seed } = build();
    const redResult = await seed(COMMIT_B, RED);
    const rows = await service.listMainCheckedRows();
    if (!rows.ok) throw new Error("rows failed");
    const folded = foldMainRedRecords(rows.value);
    if (!folded.ok) throw new Error("fold failed");
    const written = planMainRedWrites(folded.value, classifySuiteForMainRed(suiteRunOfResult(redResult) as Parameters<typeof classifySuiteForMainRed>[0]), "t");
    expect(written[0]?.details).toMatchObject({ range_from: null, last_green_at: null });
  });

  it("AC-AF-2 deriveMainCheckedRows of nothing is empty", () => {
    expect(deriveMainCheckedRows([])).toEqual([]);
  });
});

describe("suite-result store: per-file re-runs", () => {
  it("AC-AF-2 re-running named files at a result's commit stores one row per file attached to that result", async () => {
    const { service, seed } = build();
    const runner = fakeRunner();
    const stored = await seed(COMMIT_A, RED);
    const rerun = await service.rerunFiles(stored.id, [FILE_X, "packages/x/tests/y.test.ts"], runner);
    expect(rerun.ok).toBe(true);
    expect(runner.fileRuns).toEqual([{ commit: COMMIT_A, files: [FILE_X, "packages/x/tests/y.test.ts"] }]);
    const listed = await service.listFileRuns(stored.id);
    expect(listed.ok && listed.value.map((r) => [r.file, r.exit_code, r.output_tail, r.commit_sha, r.suite_result_id])).toEqual([
      [FILE_X, 1, `out ${FILE_X}`, COMMIT_A, stored.id],
      ["packages/x/tests/y.test.ts", 0, "out packages/x/tests/y.test.ts", COMMIT_A, stored.id],
    ]);
  });

  it("AC-AF-2 a re-run for an unknown result id or with no files is refused and runs nothing", async () => {
    const { service, seed } = build();
    const runner = fakeRunner();
    const unknown = await service.rerunFiles("suite-missing", [FILE_X], runner);
    expect(unknown.ok).toBe(false);
    const stored = await seed(COMMIT_A, GREEN);
    const empty = await service.rerunFiles(stored.id, [], runner);
    expect(empty.ok).toBe(false);
    expect(runner.fileRuns).toEqual([]);
  });

  it("AC-AF-2 a failing file runner stores no per-file rows", async () => {
    const { service, seed } = build();
    const stored = await seed(COMMIT_A, GREEN);
    const failing: CommitSuiteRunnerPort = { ...fakeRunner(), runFiles: async () => err({ code: "STORE_ERROR", message: "no test:file script" }) };
    const rerun = await service.rerunFiles(stored.id, [FILE_X], failing);
    expect(rerun.ok).toBe(false);
    const listed = await service.listFileRuns(stored.id);
    expect(listed.ok && listed.value).toEqual([]);
  });
});

/**
 * The real git runner against a throwaway repo whose `test:file` script runs a fake test: a node process that ignores SIGTERM
 * and spawns a grandchild that ignores SIGTERM too and holds stdout open (the shape of the 2026-10-29 hang, where a test's hung
 * `lore` child kept `spawnSync` waiting for 10 h).
 */
describe("AC-AF-2 the runner's timeout ends the whole process tree", () => {
  const TIMEOUT_MS = 1500;
  const GRACE_MS = 500;
  // timeout + grace + pipe drain (2 s) + slack for git/bun start-up and worktree removal
  const WALL_BOUND_MS = TIMEOUT_MS + GRACE_MS + 2000 + 20_000;
  const dirs: string[] = [];
  const killers: number[] = [];

  afterEach(() => {
    for (const pid of killers.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // reason: the pid is already gone, which is what the tests assert.
      }
    }
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

  /** A repo with one commit; `scripts` are the package.json scripts, `files` the committed helper files. */
  function makeRepo(scripts: Record<string, string>, files: Record<string, string>): { repo: string; commit: string; pidFile: string } {
    const base = mkdtempSync(join(tmpdir(), "suite-timeout-test-"));
    dirs.push(base);
    const repo = join(base, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture", scripts }));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(repo, name), content);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "fixture");
    return { repo, commit: git(repo, "rev-parse", "HEAD").trim(), pidFile: join(base, "pids.txt") };
  }

  /** hang.js: records its own pid and a SIGTERM-immune grandchild's pid (one per line), then never exits. */
  function hangScript(pidFile: string): string {
    return [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      'process.on("SIGTERM", () => {});',
      'const grand = spawn(process.execPath, ["-e", "process.on(\'SIGTERM\', () => {}); setInterval(() => process.stdout.write(\'.\'), 200)"], { stdio: ["ignore", "inherit", "inherit"] });',
      `fs.writeFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n" + grand.pid + "\\n");`,
      "setInterval(() => {}, 1000);",
    ].join("\n");
  }

  const readPids = (pidFile: string): number[] => {
    const pids = readFileSync(pidFile, "utf8").split("\n").filter((l) => l !== "").map(Number);
    killers.push(...pids);
    return pids;
  };

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  async function allGone(pids: readonly number[]): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (pids.every((pid) => !alive(pid))) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  const worktreeCount = (repo: string): number => git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

  /** A repo whose `test:file` script hangs (tree ignoring SIGTERM), committed on top of a first commit. */
  function hangingRepo(): { repo: string; head: string; pidFile: string } {
    const { repo, pidFile } = makeRepo({ "test:file": "node hang.js" }, {});
    writeFileSync(join(repo, "hang.js"), hangScript(pidFile));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "hang");
    return { repo, head: git(repo, "rev-parse", "HEAD").trim(), pidFile };
  }

  it("AC-AF-2 a per-file re-run whose tree ignores SIGTERM is ended within the limit, reported as a failed file with the timeout cause, tree gone, worktree gone", async () => {
    const { repo, head, pidFile } = hangingRepo();
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS });
    const startedMs = Date.now();
    const ran = await runner.runFiles(head, ["x.test.ts"]);
    expect(Date.now() - startedMs).toBeLessThan(WALL_BOUND_MS);
    if (!ran.ok) throw new Error(`runFiles failed: ${JSON.stringify(ran.error)}`);
    expect(ran.value[0]).toMatchObject({ file: "x.test.ts", exit_code: 1 });
    expect(ran.value[0]?.output_tail).toMatch(/timed out after \d+ ms/);
    expect(await allGone(readPids(pidFile))).toBe(true);
    // the commit's prepared worktree is kept for the review's later runs and removed when the review ends (`disposeWorktrees`).
    expect(worktreeCount(repo)).toBe(2);
    const ended = await runner.disposeWorktrees?.();
    expect(ended?.ok).toBe(true);
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 a batched run whose tree ignores SIGTERM is ended within the limit, every file is incomplete with the timeout cause, nothing is stored, tree gone, worktree gone after the review ends", async () => {
    const { repo, head, pidFile } = hangingRepo();
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS });
    const { service } = build();
    const startedMs = Date.now();
    // the runner alone: both files come back incomplete, naming the timeout, and the whole group is gone
    const together = await runner.runFilesTogether?.(head, ["x.test.ts", "y.test.ts"]);
    expect(Date.now() - startedMs).toBeLessThan(WALL_BOUND_MS);
    if (together === undefined || !together.ok) throw new Error(`runFilesTogether failed: ${JSON.stringify(together)}`);
    expect(together.value.map((o) => o.file)).toEqual(["x.test.ts", "y.test.ts"]);
    for (const outcome of together.value) {
      expect(outcome.incomplete).toMatch(/timed out after \d+ ms/);
    }
    expect(await allGone(readPids(pidFile))).toBe(true);
    // through the service: an incomplete batch is refused, so no row is stored and a later review runs it again
    const stored = await service.runBatch(head, ["x.test.ts", "y.test.ts"], { ...runner, runFilesTogether: async () => together });
    expect(stored.ok).toBe(false);
    const rows = await service.listFileRuns(`file-batch@${head}`);
    expect(rows.ok && rows.value).toEqual([]);
    const ended = await runner.disposeWorktrees?.();
    expect(ended?.ok).toBe(true);
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 a group signal that fails with EPERM while the group still has live members settles the run, recording the failed kill as the incomplete cause", async () => {
    const { repo, head } = hangingRepo();
    const kill = (): void => {
      throw Object.assign(new Error("kill() failed: EPERM: Operation not permitted"), { code: "EPERM" });
    };
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS, kill });
    const startedMs = Date.now();
    const ran = await runner.runFilesTogether?.(head, ["x.test.ts"]);
    expect(Date.now() - startedMs).toBeLessThan(WALL_BOUND_MS);
    if (ran === undefined || !ran.ok) throw new Error(`runFilesTogether failed: ${JSON.stringify(ran)}`);
    expect(ran.value[0]?.incomplete).toContain("EPERM");
    expect(ran.value[0]?.incomplete).toContain("live member");
    await runner.disposeWorktrees?.();
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 a group signal that fails with EPERM when no live member remains counts as ended and the run's own result stands", async () => {
    const { repo, commit } = makeRepo({ "test:file": "node -e 0" }, {});
    const kill = (): void => {
      throw Object.assign(new Error("kill() failed: EPERM: Operation not permitted"), { code: "EPERM" });
    };
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: 60_000, graceMs: GRACE_MS, kill });
    const ran = await runner.runFiles(commit, ["x.test.ts"]);
    if (!ran.ok) throw new Error(`runFiles failed: ${JSON.stringify(ran.error)}`);
    expect(ran.value[0]).toMatchObject({ file: "x.test.ts", exit_code: 0 });
    expect(ran.value[0]?.incomplete).toBeUndefined();
    await runner.disposeWorktrees?.();
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 work in the same worktree (the head-bound criteria) runs in it and the worktree is removed afterwards, also when the work throws", async () => {
    const { repo, commit } = makeRepo({ "test:file": "true" }, {});
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS });
    if (runner.withWorktree === undefined) throw new Error("runner has no withWorktree");
    let seenRoot = "";
    const done = await runner.withWorktree(commit, async (root) => {
      seenRoot = root;
      expect(existsSync(join(root, "package.json"))).toBe(true);
    });
    expect(done.ok).toBe(true);
    expect(existsSync(seenRoot)).toBe(false);
    const thrown = await runner.withWorktree(commit, async (root) => {
      seenRoot = root;
      throw new Error("attestation blew up");
    });
    expect(thrown.ok).toBe(false);
    expect(existsSync(seenRoot)).toBe(false);
    expect(worktreeCount(repo)).toBe(1);
  }, 30_000);

  it("AC-AF-2 a normal run is unchanged: a green file is exit 0 with its tail, a red one keeps its exit code and tail", async () => {
    const green = makeRepo({ "test:file": "echo all-green" }, {});
    const greenRunner = createGitCommitSuiteRunner(green.repo, process.env, { timeoutMs: 20_000, graceMs: GRACE_MS });
    const greenRun = await greenRunner.runFiles(green.commit, ["x.test.ts"]);
    expect(greenRun.ok && greenRun.value[0]).toMatchObject({ file: "x.test.ts", exit_code: 0 });
    expect(greenRun.ok && greenRun.value[0]?.output_tail).toContain("all-green");
    await greenRunner.disposeWorktrees?.();
    // reason: the runner appends the file names to the script, so the fixture is a program that ignores its arguments.
    const redRepo = makeRepo({ "test:file": "node red.js" }, { "red.js": 'console.log("boom"); process.exit(3);\n' });
    const redRunner = createGitCommitSuiteRunner(redRepo.repo, process.env, { timeoutMs: 20_000, graceMs: GRACE_MS });
    const redRun = await redRunner.runFiles(redRepo.commit, ["x.test.ts"]);
    expect(redRun.ok && redRun.value[0]).toMatchObject({ exit_code: 3 });
    expect(redRun.ok && redRun.value[0]?.output_tail).toContain("boom");
    await redRunner.disposeWorktrees?.();
    expect(worktreeCount(green.repo)).toBe(1);
  }, 30_000);
});

describe("single-file runs are stored once per (commit, file, kind) (#528, BR-1497)", () => {
  /** A runner whose every file run is numbered (the tail and exit code say which run it was) and waits on a gate. */
  function gatedRunner(gate: Promise<void>): { runner: CommitSuiteRunnerPort; calls: () => number } {
    let calls = 0;
    const base = fakeRunner();
    const runner: CommitSuiteRunnerPort = {
      ...base,
      runFiles: async (_commit, files) => {
        calls += 1;
        const mine = calls;
        await gate;
        return ok(files.map((file): FileRunOutcome => ({ file, exit_code: mine === 1 ? 0 : 1, output_tail: `run ${String(mine)}`, duration_ms: 3 })));
      },
    };
    return { runner, calls: () => calls };
  }

  it("AC-AF-2 two concurrent runs of the same (commit, file, kind) store one row and both callers get it", async () => {
    const { service } = build();
    let open: () => void = () => undefined;
    const { runner } = gatedRunner(new Promise<void>((resolve) => (open = resolve)));
    const a = service.runSingleFile(COMMIT_A, FILE_X, "bisect", runner);
    const b = service.runSingleFile(COMMIT_A, FILE_X, "bisect", runner);
    open();
    const [first, second] = await Promise.all([a, b]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.output_tail).toBe(first.value.output_tail);
    expect(second.value.exit_code).toBe(first.value.exit_code);
    const stored = await service.listFileRuns(`file-bisect@${COMMIT_A}`);
    expect(stored.ok && stored.value).toHaveLength(1);
    expect(stored.ok && stored.value[0]?.output_tail).toBe(first.value.output_tail);
  });

  it("AC-AF-2 a later review of the same (commit, file, kind) reads the stored outcome and does not run again", async () => {
    const { service } = build();
    const { runner, calls } = gatedRunner(Promise.resolve());
    const first = await service.runSingleFile(COMMIT_A, FILE_X, "confirm", runner);
    const second = await service.runSingleFile(COMMIT_A, FILE_X, "confirm", runner);
    expect(calls()).toBe(1);
    expect(first.ok && second.ok && second.value).toEqual(first.ok ? first.value : null);
  });

  it("AC-AF-2 kind, commit and file each keep their own row", async () => {
    const { service } = build();
    const { runner, calls } = gatedRunner(Promise.resolve());
    await service.runSingleFile(COMMIT_A, FILE_X, "bisect", runner);
    await service.runSingleFile(COMMIT_A, FILE_X, "confirm", runner);
    await service.runSingleFile(COMMIT_B, FILE_X, "bisect", runner);
    await service.runSingleFile(COMMIT_A, "packages/x/tests/y.test.ts", "bisect", runner);
    expect(calls()).toBe(4);
  });

  it("AC-AF-2 the store ignores a second row for a single-file key but still appends re-runs under a suite result id", async () => {
    const store = new InMemoryStore();
    const base = { commit_sha: COMMIT_A, file: FILE_X, duration_ms: 1, measured_at: "2026-10-28T10:00:00.000Z" };
    const key = `file-bisect@${COMMIT_A}`;
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: key, exit_code: 0, output_tail: "first" }]);
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: key, exit_code: 1, output_tail: "second" }]);
    const kept = await store.listSuiteFileRuns(key);
    expect(kept.ok && kept.value.map((r) => r.output_tail)).toEqual(["first"]);
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: "suite-1", exit_code: 0, output_tail: "a" }]);
    await store.insertSuiteFileRuns([{ ...base, suite_result_id: "suite-1", exit_code: 1, output_tail: "b" }]);
    const reruns = await store.listSuiteFileRuns("suite-1");
    expect(reruns.ok && reruns.value.map((r) => r.output_tail)).toEqual(["a", "b"]);
  });
});

/** Keeps the Result type import honest for fixtures that return it. */
export type _FixtureResult = Result<unknown, LoreError>;
