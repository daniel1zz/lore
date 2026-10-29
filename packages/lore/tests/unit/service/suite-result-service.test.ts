/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-2, BR-1497, BR-1412)
 *
 * The suite-result store keeps one result per commit. A fake runner counts how often the suite runs; the store is the
 * in-memory double (the SQLite round-trip is pinned in `tests/unit/store/suite-result-store.bun.test.ts`).
 *
 * Dimensions: HAPPY (first lookup runs once and stores the full shape; second runs nothing), NEGATIVE (an unresolvable
 * ref stores nothing; unknown result id / no files refused), BOUNDARY (two commits run once each; a retry that finally
 * succeeds is then cached), ERROR (a runner error is stored as unrunnable, never thrown), STATE (unrunnable -> retry
 * with a new id and attempt + 1 -> measured), REGRESSION (main red/green is derived from the store and no
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
import {
  SuiteResultService,
  deriveMainCheckedRows,
  suiteRunOfResult,
  type CommitSuiteRunnerPort,
  type FileRunOutcome,
} from "../../../src/service/suite-result-service.js";
import { MAIN_CHECKED_ACTION, MAIN_RED_ACTION, classifySuiteForMainRed, foldMainRedRecords, planMainRedWrites } from "../../../src/service/milestone-review.js";
import type { SuiteRun } from "../../../src/service/milestone-review-inputs.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const TREE_A = "1".repeat(40);
const TREE_B = "2".repeat(40);
const FILE_X = "packages/x/tests/x.test.ts";

const GREEN: SuiteRun = {
  status: "measured",
  commit: COMMIT_A,
  commands: [{ command: "bun run test", exit_code: 0, output_tail: "all passed" }],
  skipped: [{ command: "bun run check:plan-close", reason: 'package.json defines no "check:plan-close" script' }],
  failing_test_files: [],
};

function red(commit: string): SuiteRun {
  return {
    status: "measured",
    commit,
    commands: [{ command: "bun run test", exit_code: 1, output_tail: "FAIL x" }],
    skipped: [],
    failing_test_files: [{ file: FILE_X, imports: ["packages/x/src/x.ts"] }],
  };
}

interface FakeRunner extends CommitSuiteRunnerPort {
  readonly suiteRuns: string[];
  readonly fileRuns: { commit: string; files: readonly string[] }[];
}

function fakeRunner(script: (commit: string, attempt: number) => Result<SuiteRun, LoreError>): FakeRunner {
  const suiteRuns: string[] = [];
  const fileRuns: { commit: string; files: readonly string[] }[] = [];
  const trees: Record<string, string> = { main: TREE_A, [COMMIT_A]: TREE_A, [COMMIT_B]: TREE_B };
  return {
    suiteRuns,
    fileRuns,
    resolveCommit: async (ref) => {
      const commit = ref === "main" ? COMMIT_A : ref;
      const tree = trees[ref];
      if (tree === undefined) return err({ code: "STORE_ERROR", message: `no commit ${ref}` });
      return ok({ commit, tree });
    },
    runSuite: async (commit) => {
      suiteRuns.push(commit);
      return script(commit, suiteRuns.filter((c) => c === commit).length);
    },
    runFiles: async (commit, files) => {
      fileRuns.push({ commit, files });
      return ok(files.map((file): FileRunOutcome => ({ file, exit_code: file === FILE_X ? 1 : 0, output_tail: `out ${file}`, duration_ms: 7 })));
    },
  };
}

function build(): { service: SuiteResultService; store: InMemoryStore; tick: () => string } {
  const store = new InMemoryStore();
  let n = 0;
  let ms = 0;
  const tick = (): string => `2026-10-28T10:00:${String(n).padStart(2, "0")}.000Z`;
  const service = new SuiteResultService({
    store,
    now: () => {
      n += 1;
      return tick();
    },
    newId: () => `suite-test-${String(++idCounter)}`,
    clockMs: () => {
      ms += 250;
      return ms;
    },
  });
  return { service, store, tick };
}
let idCounter = 0;

describe("suite-result store: lookup-or-run", () => {
  it("AC-AF-2 first lookup of a commit runs the suite once and stores commit, tree, exit codes, failing files, tail, duration, time", async () => {
    const { service, store } = build();
    const runner = fakeRunner(() => ok(red(COMMIT_A)));
    const looked = await service.lookupOrRun("main", runner);
    expect(looked.ok).toBe(true);
    if (!looked.ok) return;
    expect(runner.suiteRuns).toEqual([COMMIT_A]);
    expect(looked.value).toMatchObject({
      commit_sha: COMMIT_A,
      tree_sha: TREE_A,
      status: "measured",
      attempt: 1,
      cause: null,
      commands: [{ command: "bun run test", exit_code: 1, output_tail: "FAIL x" }],
      failing_test_files: [{ file: FILE_X, imports: ["packages/x/src/x.ts"] }],
      duration_ms: 250,
    });
    expect(looked.value.measured_at).toMatch(/^2026-10-28T/);
    const stored = await store.listSuiteResultsForCommit(COMMIT_A);
    expect(stored.ok && stored.value).toEqual([looked.value]);
  });

  it("AC-AF-2 a second lookup of the same commit runs nothing and returns the stored result", async () => {
    const { service } = build();
    const runner = fakeRunner(() => ok(GREEN));
    const first = await service.lookupOrRun("main", runner);
    const second = await service.lookupOrRun(COMMIT_A, runner);
    const third = await service.lookupOrRun("main", runner);
    expect(runner.suiteRuns).toHaveLength(1);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (first.ok && second.ok && third.ok) {
      expect(second.value.id).toBe(first.value.id);
      expect(third.value).toEqual(first.value);
    }
  });

  it("AC-AF-2 two different commits each run once", async () => {
    const { service } = build();
    const runner = fakeRunner((commit) => ok(commit === COMMIT_A ? GREEN : red(COMMIT_B)));
    await service.lookupOrRun(COMMIT_A, runner);
    await service.lookupOrRun(COMMIT_B, runner);
    await service.lookupOrRun(COMMIT_A, runner);
    await service.lookupOrRun(COMMIT_B, runner);
    expect(runner.suiteRuns).toEqual([COMMIT_A, COMMIT_B]);
  });

  it("AC-AF-2 an incomplete run is stored unrunnable with cause and attempt number, and the next lookup retries under a new id", async () => {
    const { service, store } = build();
    const runner = fakeRunner((_commit, attempt) =>
      attempt === 1 ? ok({ status: "not_measured", reason: "dependency install failed" }) : ok(GREEN),
    );
    const first = await service.lookupOrRun(COMMIT_A, runner);
    expect(first.ok && first.value).toMatchObject({ status: "unrunnable", attempt: 1, cause: "dependency install failed", commands: [] });
    const retry = await service.lookupOrRun(COMMIT_A, runner);
    expect(runner.suiteRuns).toHaveLength(2);
    expect(retry.ok && retry.value).toMatchObject({ status: "measured", attempt: 2, cause: null });
    if (first.ok && retry.ok) expect(retry.value.id).not.toBe(first.value.id);
    const stored = await store.listSuiteResultsForCommit(COMMIT_A);
    expect(stored.ok && stored.value.map((r) => [r.status, r.attempt])).toEqual([
      ["unrunnable", 1],
      ["measured", 2],
    ]);
    // once measured, the commit is cached again
    await service.lookupOrRun(COMMIT_A, runner);
    expect(runner.suiteRuns).toHaveLength(2);
  });

  it("AC-AF-2 a runner that fails outright is stored as unrunnable with the error text, never thrown", async () => {
    const { service } = build();
    const runner = fakeRunner(() => err({ code: "STORE_ERROR", message: "could not create the throwaway worktree: boom" }));
    const looked = await service.lookupOrRun(COMMIT_A, runner);
    expect(looked.ok && looked.value).toMatchObject({ status: "unrunnable", attempt: 1, cause: "could not create the throwaway worktree: boom" });
    const again = await service.lookupOrRun(COMMIT_A, runner);
    expect(again.ok && again.value.attempt).toBe(2);
  });

  it("AC-AF-2 a ref that does not resolve is an error and stores nothing", async () => {
    const { service, store } = build();
    const runner = fakeRunner(() => ok(GREEN));
    const looked = await service.lookupOrRun("nope", runner);
    expect(looked.ok).toBe(false);
    expect(runner.suiteRuns).toEqual([]);
    const all = await store.listSuiteResults();
    expect(all.ok && all.value).toEqual([]);
  });

  it("AC-AF-2 a stored measured result is returned as the review's suite shape; an unrunnable one is not_measured with its cause", async () => {
    const { service } = build();
    const measured = await service.lookupOrRun(COMMIT_A, fakeRunner(() => ok(red(COMMIT_A))));
    const unrunnable = await service.lookupOrRun(COMMIT_B, fakeRunner(() => ok({ status: "not_measured", reason: "no worktree" })));
    expect(measured.ok && suiteRunOfResult(measured.value)).toMatchObject({ status: "measured", commit: COMMIT_A });
    expect(unrunnable.ok && suiteRunOfResult(unrunnable.value)).toEqual({ status: "not_measured", reason: "no worktree" });
  });
});

describe("suite-result store: main red/green is read from the store", () => {
  it("AC-AF-2 main-checked rows are derived from measured results; an unrunnable result checks nothing", async () => {
    const { service } = build();
    await service.lookupOrRun(COMMIT_A, fakeRunner(() => ok(GREEN)));
    await service.lookupOrRun(COMMIT_B, fakeRunner(() => ok({ status: "not_measured", reason: "no worktree" })));
    const rows = await service.listMainCheckedRows();
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    expect(rows.value).toHaveLength(1);
    expect(rows.value[0]).toMatchObject({ action: MAIN_CHECKED_ACTION, details: { commit: COMMIT_A, status: "green" } });
  });

  it("AC-AF-2 red at a later commit opens one main-red record whose range starts at the green commit stored before it, and writes no main-checked row", async () => {
    const { service } = build();
    await service.lookupOrRun(COMMIT_A, fakeRunner(() => ok(GREEN)));
    const redLookup = await service.lookupOrRun(COMMIT_B, fakeRunner(() => ok(red(COMMIT_B))));
    expect(redLookup.ok).toBe(true);
    if (!redLookup.ok) return;
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
    const measured = classifySuiteForMainRed(suiteRunOfResult(redLookup.value) as Parameters<typeof classifySuiteForMainRed>[0]);
    const written = planMainRedWrites(folded.value, measured, "2026-10-28T11:00:00.000Z");
    expect(written.map((r) => r.action)).toEqual([MAIN_RED_ACTION]);
    expect(written[0]?.details).toMatchObject({ range_from: COMMIT_A, range_to: COMMIT_B, failing_files: [FILE_X], failing_checks: ["bun run test"] });
  });

  it("AC-AF-2 red with no earlier check starts the range at null, not at the red commit itself", async () => {
    const { service } = build();
    const redLookup = await service.lookupOrRun(COMMIT_B, fakeRunner(() => ok(red(COMMIT_B))));
    if (!redLookup.ok) throw new Error("lookup failed");
    const rows = await service.listMainCheckedRows();
    if (!rows.ok) throw new Error("rows failed");
    const folded = foldMainRedRecords(rows.value);
    if (!folded.ok) throw new Error("fold failed");
    const written = planMainRedWrites(folded.value, classifySuiteForMainRed(suiteRunOfResult(redLookup.value) as Parameters<typeof classifySuiteForMainRed>[0]), "t");
    expect(written[0]?.details).toMatchObject({ range_from: null, last_green_at: null });
  });

  it("AC-AF-2 deriveMainCheckedRows of nothing is empty", () => {
    expect(deriveMainCheckedRows([])).toEqual([]);
  });
});

describe("suite-result store: per-file re-runs", () => {
  it("AC-AF-2 re-running named files at a result's commit stores one row per file attached to that result", async () => {
    const { service } = build();
    const runner = fakeRunner(() => ok(red(COMMIT_A)));
    const looked = await service.lookupOrRun(COMMIT_A, runner);
    if (!looked.ok) throw new Error("lookup failed");
    const rerun = await service.rerunFiles(looked.value.id, [FILE_X, "packages/x/tests/y.test.ts"], runner);
    expect(rerun.ok).toBe(true);
    expect(runner.fileRuns).toEqual([{ commit: COMMIT_A, files: [FILE_X, "packages/x/tests/y.test.ts"] }]);
    const listed = await service.listFileRuns(looked.value.id);
    expect(listed.ok && listed.value.map((r) => [r.file, r.exit_code, r.output_tail, r.commit_sha, r.suite_result_id])).toEqual([
      [FILE_X, 1, `out ${FILE_X}`, COMMIT_A, looked.value.id],
      ["packages/x/tests/y.test.ts", 0, "out packages/x/tests/y.test.ts", COMMIT_A, looked.value.id],
    ]);
    expect(runner.suiteRuns).toHaveLength(1);
  });

  it("AC-AF-2 a re-run for an unknown result id or with no files is refused and runs nothing", async () => {
    const { service } = build();
    const runner = fakeRunner(() => ok(GREEN));
    const unknown = await service.rerunFiles("suite-missing", [FILE_X], runner);
    expect(unknown.ok).toBe(false);
    const looked = await service.lookupOrRun(COMMIT_A, runner);
    if (!looked.ok) throw new Error("lookup failed");
    const empty = await service.rerunFiles(looked.value.id, [], runner);
    expect(empty.ok).toBe(false);
    expect(runner.fileRuns).toEqual([]);
  });

  it("AC-AF-2 a failing file runner stores no per-file rows", async () => {
    const { service } = build();
    const runner = fakeRunner(() => ok(GREEN));
    const looked = await service.lookupOrRun(COMMIT_A, runner);
    if (!looked.ok) throw new Error("lookup failed");
    const failing: CommitSuiteRunnerPort = { ...runner, runFiles: async () => err({ code: "STORE_ERROR", message: "no test:file script" }) };
    const rerun = await service.rerunFiles(looked.value.id, [FILE_X], failing);
    expect(rerun.ok).toBe(false);
    const listed = await service.listFileRuns(looked.value.id);
    expect(listed.ok && listed.value).toEqual([]);
  });
});

/**
 * The real git runner against a throwaway repo whose `test` / `test:file` scripts run a fake suite: a node process that
 * ignores SIGTERM and spawns a grandchild that ignores SIGTERM too and holds stdout open (the shape of the 2026-10-29
 * hang, where a test's hung `lore` child kept `spawnSync` waiting for 10 h).
 */
describe("AC-AF-2 the suite runner's timeout ends the whole process tree", () => {
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

  it("AC-AF-2 a suite whose tree ignores SIGTERM is ended within timeout + grace, stored unrunnable naming the timeout and elapsed ms, no process survives and the worktree is gone", async () => {
    // (per-test limit below is far above timeout + grace + drain, so load cannot read as a hang)
    const { repo, commit, pidFile } = makeRepo({ test: "node hang.js" }, {});
    writeFileSync(join(repo, "hang.js"), hangScript(pidFile));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "hang");
    const head = git(repo, "rev-parse", "HEAD").trim();
    expect(head).not.toBe(commit);
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS });
    const { service, store } = build();
    const startedMs = Date.now();
    const looked = await service.lookupOrRun(head, runner);
    const wallMs = Date.now() - startedMs;
    expect(wallMs).toBeLessThan(WALL_BOUND_MS);
    expect(looked.ok && looked.value).toMatchObject({ status: "unrunnable", attempt: 1, commands: [] });
    const cause = looked.ok ? (looked.value.cause ?? "") : "";
    expect(cause).toMatch(/timed out after \d+ ms/);
    expect(cause).toContain("bun run test");
    const stored = await store.listSuiteResultsForCommit(head);
    expect(stored.ok && stored.value.map((r) => r.status)).toEqual(["unrunnable"]);
    expect(await allGone(readPids(pidFile))).toBe(true);
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 a per-file re-run whose tree ignores SIGTERM is ended within the limit, reported as a failed file with the timeout cause, tree gone, worktree gone", async () => {
    const { repo, pidFile } = makeRepo({ "test:file": "node hang.js" }, {});
    writeFileSync(join(repo, "hang.js"), hangScript(pidFile));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "hang");
    const head = git(repo, "rev-parse", "HEAD").trim();
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS });
    const startedMs = Date.now();
    const ran = await runner.runFiles(head, ["x.test.ts"]);
    expect(Date.now() - startedMs).toBeLessThan(WALL_BOUND_MS);
    if (!ran.ok) throw new Error(`runFiles failed: ${JSON.stringify(ran.error)}`);
    expect(ran.value[0]).toMatchObject({ file: "x.test.ts", exit_code: 1 });
    expect(ran.value[0]?.output_tail).toMatch(/timed out after \d+ ms/);
    expect(await allGone(readPids(pidFile))).toBe(true);
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 a group signal that fails with EPERM while the group still has live members settles the run, recording the failed kill as the unrunnable cause", async () => {
    const { repo, pidFile } = makeRepo({ test: "node hang.js" }, {});
    writeFileSync(join(repo, "hang.js"), hangScript(pidFile));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "hang");
    const head = git(repo, "rev-parse", "HEAD").trim();
    const kill = (): void => {
      throw Object.assign(new Error("kill() failed: EPERM: Operation not permitted"), { code: "EPERM" });
    };
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS, kill });
    const { service } = build();
    const startedMs = Date.now();
    const looked = await service.lookupOrRun(head, runner);
    expect(Date.now() - startedMs).toBeLessThan(WALL_BOUND_MS);
    expect(looked.ok && looked.value).toMatchObject({ status: "unrunnable" });
    const cause = looked.ok ? (looked.value.cause ?? "") : "";
    expect(cause).toContain("EPERM");
    expect(cause).toContain("live member");
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 a group signal that fails with EPERM when no live member remains counts as ended and the run's own result stands", async () => {
    const { repo } = makeRepo({ test: "node -e 0" }, {});
    const head = git(repo, "rev-parse", "HEAD").trim();
    const kill = (): void => {
      throw Object.assign(new Error("kill() failed: EPERM: Operation not permitted"), { code: "EPERM" });
    };
    const runner = createGitCommitSuiteRunner(repo, process.env, { timeoutMs: 60_000, graceMs: GRACE_MS, kill });
    const { service } = build();
    const looked = await service.lookupOrRun(head, runner);
    expect(looked.ok && looked.value).toMatchObject({ status: "measured" });
    expect(worktreeCount(repo)).toBe(1);
  }, 90_000);

  it("AC-AF-2 work in the same worktree (the landed-criteria attestation) runs in it and the worktree is removed afterwards, also when the work throws", async () => {
    const { repo, commit } = makeRepo({ test: "true" }, {});
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

  it("AC-AF-2 a normal run is unchanged: a green suite is measured with its exit code, a red one keeps its exit code and tail", async () => {
    const green = makeRepo({ test: "echo all-green" }, {});
    const greenRun = await createGitCommitSuiteRunner(green.repo, process.env, { timeoutMs: 20_000, graceMs: GRACE_MS }).runSuite(green.commit);
    expect(greenRun.ok && greenRun.value).toMatchObject({ status: "measured", commit: green.commit, failing_test_files: [] });
    if (greenRun.ok && greenRun.value.status === "measured") {
      expect(greenRun.value.commands).toHaveLength(1);
      expect(greenRun.value.commands[0]).toMatchObject({ command: "bun run test", exit_code: 0 });
      expect(greenRun.value.commands[0]?.output_tail).toContain("all-green");
    }
    const redRepo = makeRepo({ test: "echo boom; exit 3" }, {});
    const redRun = await createGitCommitSuiteRunner(redRepo.repo, process.env, { timeoutMs: 20_000, graceMs: GRACE_MS }).runSuite(redRepo.commit);
    expect(redRun.ok && redRun.value.status === "measured" && redRun.value.commands[0]).toMatchObject({ exit_code: 3 });
    expect(worktreeCount(green.repo)).toBe(1);
  }, 30_000);
});
