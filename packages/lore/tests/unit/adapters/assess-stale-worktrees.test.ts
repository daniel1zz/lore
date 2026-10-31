// @spawns-external git builds a throwaway git repository the test runs against
/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (BR-1497)
 *
 * Stale `lore-assess-suite-*` worktrees left by killed runs are removed at the start of the next run; a worktree a live
 * process owns is never removed.
 *
 * Dimensions: HAPPY (dead owner and gone directory are removed), NEGATIVE (live owner, foreign worktrees, young legacy
 * worktrees are kept), BOUNDARY (legacy name without pid, unknown age), ERROR (removal and prune failures are returned),
 * STATE (real git: a registered worktree of a dead pid is cleaned by the next throwaway run, a live one survives).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { err, ok } from "@lore/core";
import {
  ASSESS_WORKTREE_PREFIX,
  LEGACY_MAX_AGE_MS,
  assessWorktreeDirPrefix,
  ownerPidOfAssessWorktree,
  pruneStaleAssessWorktrees,
  type StaleWorktreePorts,
} from "../../../src/adapters/cli/assess-stale-worktrees.js";
import { runInThrowawayWorktree } from "../../../src/adapters/cli/assess-suite-runner.js";

const DEAD = 4_000_001;
const LIVE = 4242;

function fakePorts(paths: readonly string[], overrides: Partial<StaleWorktreePorts> = {}) {
  const removed: string[] = [];
  let pruned = 0;
  const ports: StaleWorktreePorts = {
    listRegisteredWorktrees: async () => ok(paths),
    directoryExists: () => true,
    directoryAgeMs: () => 0,
    isProcessAlive: (pid) => pid === LIVE,
    removeDirectory: (path) => {
      removed.push(path);
    },
    pruneRegistrations: async () => {
      pruned += 1;
      return ok(undefined);
    },
    ...overrides,
  };
  return { ports, removed, pruned: () => pruned };
}

describe("owner pid in the directory name", () => {
  it("round-trips the pid and reads a legacy name as unowned", () => {
    expect(ownerPidOfAssessWorktree(`/tmp/${assessWorktreeDirPrefix(321)}aB3dEf`)).toBe(321);
    expect(ownerPidOfAssessWorktree(`/tmp/${ASSESS_WORKTREE_PREFIX}aVd1Sp`)).toBeUndefined();
  });
});

describe("pruneStaleAssessWorktrees", () => {
  it("removes a worktree whose owner pid is not alive and prunes git's registration", async () => {
    const stale = `/tmp/${assessWorktreeDirPrefix(DEAD)}abc`;
    const f = fakePorts([stale]);
    const result = await pruneStaleAssessWorktrees(f.ports);
    expect(result).toEqual(ok([stale]));
    expect(f.removed).toEqual([stale]);
    expect(f.pruned()).toBe(1);
  });

  it("never removes a worktree a live process owns, whatever its age", async () => {
    const live = `/tmp/${assessWorktreeDirPrefix(LIVE)}abc`;
    const f = fakePorts([live], { directoryAgeMs: () => LEGACY_MAX_AGE_MS * 10 });
    const result = await pruneStaleAssessWorktrees(f.ports);
    expect(result).toEqual(ok([]));
    expect(f.removed).toEqual([]);
    expect(f.pruned()).toBe(0);
  });

  it("prunes a registration whose directory is gone without removing anything", async () => {
    const gone = `/tmp/${assessWorktreeDirPrefix(LIVE)}gone`;
    const f = fakePorts([gone], { directoryExists: () => false });
    expect(await pruneStaleAssessWorktrees(f.ports)).toEqual(ok([gone]));
    expect(f.removed).toEqual([]);
    expect(f.pruned()).toBe(1);
  });

  it("leaves every worktree that is not an assess worktree alone", async () => {
    const f = fakePorts(["/work/agent-one", "/tmp/other-worktree"]);
    expect(await pruneStaleAssessWorktrees(f.ports)).toEqual(ok([]));
    expect(f.removed).toEqual([]);
  });

  it("keeps a legacy-named worktree younger than the longest legacy run, removes an older one, keeps one of unknown age", async () => {
    const legacy = `/tmp/${ASSESS_WORKTREE_PREFIX}aVd1Sp`;
    expect((await pruneStaleAssessWorktrees(fakePorts([legacy], { directoryAgeMs: () => 60_000 }).ports))).toEqual(ok([]));
    expect((await pruneStaleAssessWorktrees(fakePorts([legacy], { directoryAgeMs: () => undefined }).ports))).toEqual(ok([]));
    const old = fakePorts([legacy], { directoryAgeMs: () => LEGACY_MAX_AGE_MS + 1 });
    expect(await pruneStaleAssessWorktrees(old.ports)).toEqual(ok([legacy]));
    expect(old.removed).toEqual([legacy]);
  });

  it("returns a failed removal and a failed prune instead of ignoring them", async () => {
    const stale = `/tmp/${assessWorktreeDirPrefix(DEAD)}abc`;
    const noRemove = fakePorts([stale], {
      removeDirectory: () => {
        throw new Error("EACCES");
      },
    });
    const removal = await pruneStaleAssessWorktrees(noRemove.ports);
    expect(!removal.ok && removal.error).toMatchObject({ code: "STORE_ERROR" });
    const noPrune = fakePorts([stale], { pruneRegistrations: async () => err({ code: "STORE_ERROR", message: "prune failed" }) });
    const pruneFailure = await pruneStaleAssessWorktrees(noPrune.ports);
    expect(!pruneFailure.ok && pruneFailure.error).toMatchObject({ message: "prune failed" });
  });

  it("returns a failed listing", async () => {
    const f = fakePorts([], { listRegisteredWorktrees: async () => err({ code: "STORE_ERROR", message: "no git" }) });
    expect((await pruneStaleAssessWorktrees(f.ports)).ok).toBe(false);
  });
});

describe("a real throwaway run clears killed runs' worktrees", () => {
  const cleanup: string[] = [];
  afterEach(() => {
    while (cleanup.length > 0) rmSync(cleanup.pop() ?? "", { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    const ran = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
    return ran.stdout.trim();
  }

  it("removes the registered worktree of a dead pid, keeps the one this live process owns, and its own is gone afterwards", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "stale-wt-repo-")));
    cleanup.push(repo);
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "a");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    const commit = git(repo, "rev-parse", "HEAD");

    const holder = realpathSync(mkdtempSync(join(tmpdir(), "stale-wt-holder-")));
    cleanup.push(holder);
    const dead = join(holder, `${assessWorktreeDirPrefix(DEAD)}dead01`);
    const alive = join(holder, `${assessWorktreeDirPrefix(process.pid)}live01`);
    mkdirSync(holder, { recursive: true });
    git(repo, "worktree", "add", "--detach", dead, commit);
    git(repo, "worktree", "add", "--detach", alive, commit);

    const ran = await runInThrowawayWorktree(repo, process.env, commit, async (root) => existsSync(join(root, "a.txt")));
    expect(ran).toEqual(ok(true));
    const registered = git(repo, "worktree", "list", "--porcelain");
    expect(registered).not.toContain(dead);
    expect(existsSync(dead)).toBe(false);
    expect(registered).toContain(alive);
    expect(existsSync(alive)).toBe(true);
    expect(registered.match(/lore-assess-suite-/g)?.length).toBe(1);
  });
});
