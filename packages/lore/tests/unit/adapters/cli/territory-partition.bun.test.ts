/**
 * AC-OWN-1 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * `partitionTerritory` (`adapters/cli/territory-partition.ts`) partitions
 * every worktree and branch CORPUS-WIDE into mine / foreign / unowned /
 * unmeasured, naming each foreign entry's holder, and NEVER silently drops
 * an entry it cannot classify.
 *
 * Six-dimension coverage:
 *   HAPPY:      a worktree claimed by the CALLING session classifies "mine";
 *               a worktree claimed by a DIFFERENT, measured session
 *               classifies "foreign" and names the holder
 *   NEGATIVE:   a claim with NO session_id never classifies mine/foreign —
 *               it is "unmeasured", regardless of which worktree it names
 *   BOUNDARY:   sum-equals-total over a seeded corpus (the four buckets are
 *               disjoint and their union equals the total discovered set);
 *               a detached-HEAD worktree (git branch: null) with no claim
 *               still surfaces, unowned, with no `branch` field
 *   ERROR:      a worktree whose path no longer exists in `git worktree
 *               list` (only a claim still names it) still surfaces — never
 *               dropped — and classifies by its claim as normal
 *   STATE:      two sessions referencing the SAME worktree, one mine and one
 *               foreign — mine takes precedence (a caller's own claim always
 *               wins the classification for a target it also touches)
 *   REGRESSION: an unmeasured CALLING session (no session_id) never
 *               misclassifies any entry as "mine" — a genuinely foreign
 *               claim degrades to "unmeasured", never a false negative that
 *               would read as "not mine, therefore safe to treat as foreign"
 *               either; the safe, honest answer is "unmeasured"
 *
 * A branch entry is NEVER dropped: `orphanBranch` (an unmeasured-session,
 * worktree-less claim) is asserted present in `unmeasured`, not absent from
 * every bucket — the exact "shape-only" failure mode this AC was tightened
 * to catch (an implementation that drops what it cannot classify would pass
 * a bucket-shape test while silently losing data).
 *
 * A SECOND describe block below (AC-REPLAY-1) covers `unmerged_commits`
 * with REAL `mkdtemp` git fixtures — the tests above use fake string paths
 * because they exercise classification only, but measuring a commit count
 * genuinely shells `git`. Its own six dimensions: HAPPY (several commits),
 * BOUNDARY (a MEASURED zero, distinguishable from uncountable), ERROR
 * (nonexistent branch; nonexistent base ref), STATE (a live foreign
 * worktree entry, not just an orphan branch, measures correctly), and
 * REGRESSION (a probe path outside any git repo; a worktree entry whose OWN
 * path is stale still measures via fallback).
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-1, AC-REPLAY-1
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadySession } from "@lore/core";
import {
  partitionTerritory,
  type TerritoryEntry,
  type TerritoryPartition,
  type TerritoryWorktree,
} from "../../../../src/adapters/cli/territory-partition.js";

const CURRENT_SESSION_ID = "aaaa1111";

function totalEntries(partition: TerritoryPartition): number {
  return partition.mine.length + partition.foreign.length + partition.unowned.length + partition.unmeasured.length;
}

/** Independently-derived expected total (never reads `partitionTerritory`'s own output) — the sum-equals-total oracle. */
function expectedDiscoveredTotal(worktrees: readonly TerritoryWorktree[], sessions: readonly ReadySession[]): number {
  const worktreeBranches = new Set(worktrees.filter((w) => w.branch !== null).map((w) => w.branch as string));
  const worktreePaths = new Set(worktrees.map((w) => w.path));
  for (const s of sessions) {
    if (s.worktree !== undefined) worktreePaths.add(s.worktree);
  }
  const orphanBranches = new Set<string>();
  for (const s of sessions) {
    for (const b of s.branches) {
      if (!worktreeBranches.has(b)) orphanBranches.add(b);
    }
  }
  return worktreePaths.size + orphanBranches.size;
}

describe("partitionTerritory (AC-OWN-1)", () => {
  it("HAPPY: a worktree claimed by the calling session classifies mine; a foreign, measured claim classifies foreign and names its holder", () => {
    const worktrees: TerritoryWorktree[] = [
      { path: "/wt-mine", branch: "feature-mine" },
      { path: "/wt-peer", branch: "feature-peer" },
    ];
    const sessions: ReadySession[] = [
      {
        by: "agent:me",
        session_id: CURRENT_SESSION_ID,
        worktree: "/wt-mine",
        branches: ["feature-mine"],
        task_slugs: ["t-mine"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
      {
        by: "agent:peer",
        session_id: "bbbb2222",
        worktree: "/wt-peer",
        branches: ["feature-peer"],
        task_slugs: ["t-peer"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    expect(partition.mine.some((e) => e.kind === "worktree" && e.path === "/wt-mine")).toBe(true);
    const foreignEntry = partition.foreign.find((e) => e.kind === "worktree" && e.path === "/wt-peer");
    expect(foreignEntry).toBeDefined();
    expect(foreignEntry?.holder).toEqual({ session_id: "bbbb2222", by: "agent:peer", worktree: "/wt-peer" });
  });

  it("NEGATIVE: a claim with no session_id never classifies mine/foreign, regardless of the worktree it names", () => {
    const worktrees: TerritoryWorktree[] = [{ path: "/wt-nosess", branch: "feature-nosess" }];
    const sessions: ReadySession[] = [
      {
        by: "agent:legacy",
        worktree: "/wt-nosess",
        branches: ["feature-nosess"],
        task_slugs: ["t-legacy"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    expect(partition.mine).toHaveLength(0);
    expect(partition.foreign).toHaveLength(0);
    expect(partition.unmeasured.some((e) => e.kind === "worktree" && e.path === "/wt-nosess")).toBe(true);
  });

  it("BOUNDARY: sum-equals-total over a seeded corpus, and a detached-HEAD worktree with no claim surfaces unowned with no branch field", () => {
    const worktrees: TerritoryWorktree[] = [
      { path: "/wt-mine", branch: "feature-mine" },
      { path: "/wt-peer", branch: "feature-peer" },
      { path: "/wt-detached", branch: null },
    ];
    const sessions: ReadySession[] = [
      {
        by: "agent:me",
        session_id: CURRENT_SESSION_ID,
        worktree: "/wt-mine",
        branches: ["feature-mine"],
        task_slugs: ["t-mine"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
      {
        by: "agent:peer",
        session_id: "bbbb2222",
        worktree: "/wt-peer",
        branches: ["feature-peer"],
        task_slugs: ["t-peer"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
      {
        by: "agent:orphan",
        session_id: "cccc3333",
        branches: ["orphan-branch"],
        task_slugs: ["t-orphan"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    expect(totalEntries(partition)).toBe(expectedDiscoveredTotal(worktrees, sessions));
    // reason: not a tautology — this is INDEPENDENTLY computed (never reads
    // partitionTerritory's own output) and the fixture above deliberately
    // has a known, hand-countable answer: 3 worktree paths + 1 orphan branch = 4.
    expect(expectedDiscoveredTotal(worktrees, sessions)).toBe(4);

    const detachedEntry = partition.unowned.find((e) => e.kind === "worktree" && e.path === "/wt-detached");
    expect(detachedEntry).toBeDefined();
    expect(detachedEntry?.branch).toBeUndefined();
  });

  it("ERROR: a worktree path no longer reported by git worktree list still surfaces (never dropped) and classifies by its claim", () => {
    const worktrees: TerritoryWorktree[] = []; // git reports NO worktrees at all — e.g. all removed out-of-band
    const sessions: ReadySession[] = [
      {
        by: "agent:me",
        session_id: CURRENT_SESSION_ID,
        worktree: "/wt-gone",
        branches: ["feature-gone"],
        task_slugs: ["t-gone"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    // reason: TWO discovered entries, not one — git corroborates NEITHER the
    // worktree path NOR that "feature-gone" is its current branch (that link
    // only exists via the claim itself), so the worktree axis and the branch
    // axis each surface their OWN entry rather than being collapsed into one.
    // Both are still classified "mine" (same claiming session), and neither
    // is silently dropped.
    expect(totalEntries(partition)).toBe(2);
    expect(partition.mine.some((e) => e.kind === "worktree" && e.path === "/wt-gone")).toBe(true);
    expect(partition.mine.some((e) => e.kind === "branch" && e.branch === "feature-gone")).toBe(true);
  });

  it("STATE: two sessions referencing the SAME worktree, one mine and one foreign — mine wins", () => {
    const worktrees: TerritoryWorktree[] = [{ path: "/wt-mixed", branch: "feature-mixed" }];
    const sessions: ReadySession[] = [
      {
        by: "agent:me",
        session_id: CURRENT_SESSION_ID,
        worktree: "/wt-mixed",
        branches: [],
        task_slugs: ["t-mixed-mine"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
      {
        by: "agent:peer3",
        session_id: "dddd4444",
        worktree: "/wt-mixed",
        branches: [],
        task_slugs: ["t-mixed-peer"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    expect(partition.mine.some((e) => e.kind === "worktree" && e.path === "/wt-mixed")).toBe(true);
    expect(partition.foreign.some((e) => e.kind === "worktree" && e.path === "/wt-mixed")).toBe(false);
    expect(totalEntries(partition)).toBe(1);
  });

  it("REGRESSION: an unmeasured calling session id never misclassifies a genuinely foreign claim as mine", () => {
    const worktrees: TerritoryWorktree[] = [{ path: "/wt-peer", branch: "feature-peer" }];
    const sessions: ReadySession[] = [
      {
        by: "agent:peer",
        session_id: "bbbb2222",
        worktree: "/wt-peer",
        branches: ["feature-peer"],
        task_slugs: ["t-peer"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    // currentSessionId is undefined — the caller could not measure its OWN session.
    const partition = partitionTerritory(worktrees, sessions, undefined);

    expect(partition.mine).toHaveLength(0);
    // reason: compareClaimSessions("not-measured" whenever either side is
    // absent) means an unmeasured caller can prove NEITHER same-session NOR
    // different-session against this claim — the honest answer is
    // "unmeasured", never a guessed "foreign".
    expect(partition.unmeasured.some((e) => e.kind === "worktree" && e.path === "/wt-peer")).toBe(true);
    expect(partition.foreign).toHaveLength(0);
  });

  it("never silently drops an unclassifiable branch entry (an unmeasured-session, worktree-less claim files under unmeasured)", () => {
    const worktrees: TerritoryWorktree[] = [];
    const sessions: ReadySession[] = [
      {
        by: "agent:ghost",
        branches: ["ghost-branch"],
        task_slugs: ["t-ghost"],
        newest_at: "2026-08-12T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    expect(totalEntries(partition)).toBe(1);
    expect(partition.unmeasured.some((e) => e.kind === "branch" && e.branch === "ghost-branch")).toBe(true);
  });
});

// ─── `unmerged_commits` (AC-REPLAY-1) — real `mkdtemp` git fixtures ─────────
//
// The tests above use fake, non-existent worktree paths (by design — they
// exercise pure classification logic that needs no real git repo). Measuring
// `unmerged_commits` genuinely shells `git`, so THESE tests need a real
// throwaway repo — mirrors `real-git-port.test.ts`'s / `territory-
// replay.bun.test.ts`'s own fixture style. ⛔ Never this repo's own tree.

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** See `territory-replay.bun.test.ts`'s identically-named helper for the macOS symlink rationale. */
function mkdtempReal(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanupDirs.push(dir);
  return dir;
}

function commitFile(repoRoot: string, name: string, message: string): void {
  writeFileSync(join(repoRoot, name), `${name} content\n`);
  git(repoRoot, ["add", name]);
  git(repoRoot, ["commit", "-q", "-m", message]);
}

/** Initializes a git repo at `dir` with one commit on `main`. */
function initRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "territory-partition-test@example.invalid"]);
  git(dir, ["config", "user.name", "territory-partition Test"]);
  commitFile(dir, "seed.txt", "seed");
}

function findEntry(partition: TerritoryPartition, predicate: (e: TerritoryEntry) => boolean): TerritoryEntry | undefined {
  return [...partition.mine, ...partition.foreign, ...partition.unowned, ...partition.unmeasured].find(predicate);
}

function branchSession(by: string, sessionId: string, branch: string): ReadySession {
  return { by, session_id: sessionId, branches: [branch], task_slugs: [`t-${branch}`], newest_at: "2026-08-13T10:00:00.000Z" };
}

describe("partitionTerritory — unmerged_commits (AC-REPLAY-1)", () => {
  it("HAPPY: an orphan branch several commits ahead of main counts exactly", () => {
    const repoRoot = mkdtempReal("tp-count-happy-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "peer-feature"]);
    git(repoRoot, ["checkout", "-q", "peer-feature"]);
    commitFile(repoRoot, "a.txt", "a");
    commitFile(repoRoot, "b.txt", "b");
    commitFile(repoRoot, "c.txt", "c");
    commitFile(repoRoot, "d.txt", "d");
    git(repoRoot, ["checkout", "-q", "main"]);

    const worktrees: TerritoryWorktree[] = [{ path: repoRoot, branch: "main" }];
    const sessions: ReadySession[] = [branchSession("agent:peer", "peer0001", "peer-feature")];

    const partition = partitionTerritory(worktrees, sessions, undefined);
    const entry = findEntry(partition, (e) => e.branch === "peer-feature");
    expect(entry?.unmerged_commits).toBe(4);
  });

  it("BOUNDARY: a fully-merged orphan branch counts exactly 0 — a MEASURED zero, distinguishable from uncountable", () => {
    const repoRoot = mkdtempReal("tp-count-boundary-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "merged-peer"]);
    git(repoRoot, ["checkout", "-q", "merged-peer"]);
    commitFile(repoRoot, "merged.txt", "merged work");
    git(repoRoot, ["checkout", "-q", "main"]);
    git(repoRoot, ["merge", "-q", "--no-ff", "merged-peer", "-m", "merge merged-peer"]);

    const worktrees: TerritoryWorktree[] = [{ path: repoRoot, branch: "main" }];
    const sessions: ReadySession[] = [branchSession("agent:peer", "peer0002", "merged-peer")];

    const partition = partitionTerritory(worktrees, sessions, undefined);
    const entry = findEntry(partition, (e) => e.branch === "merged-peer");
    // reason: `0` must be PRESENT, not absent — a measured zero is a fact,
    // not the same silence as "could not measure" (module @invariant).
    expect(entry?.unmerged_commits).toBe(0);
    expect("unmerged_commits" in (entry ?? {})).toBe(true);
  });

  it("ERROR: a claimed branch that does not exist in the repo never invents a count", () => {
    const repoRoot = mkdtempReal("tp-count-error-nobranch-");
    initRepo(repoRoot);

    const worktrees: TerritoryWorktree[] = [{ path: repoRoot, branch: "main" }];
    const sessions: ReadySession[] = [branchSession("agent:ghost", "ghost001", "ghost-branch")];

    const partition = partitionTerritory(worktrees, sessions, undefined);
    const entry = findEntry(partition, (e) => e.branch === "ghost-branch");
    expect(entry).toBeDefined();
    expect(entry?.unmerged_commits).toBeUndefined();
  });

  it("ERROR: a base ref (main) that does not exist never invents a count for ANY entry", () => {
    const repoRoot = mkdtempReal("tp-count-error-nobase-");
    // reason: default branch deliberately named "trunk" — "main" resolves
    // NOWHERE in this repo, so every count must degrade to absent.
    git(repoRoot, ["init", "-q", "-b", "trunk"]);
    git(repoRoot, ["config", "user.email", "territory-partition-test@example.invalid"]);
    git(repoRoot, ["config", "user.name", "territory-partition Test"]);
    commitFile(repoRoot, "seed.txt", "seed");
    git(repoRoot, ["branch", "feature-on-trunk"]);
    git(repoRoot, ["checkout", "-q", "feature-on-trunk"]);
    commitFile(repoRoot, "feature.txt", "feature work");
    git(repoRoot, ["checkout", "-q", "trunk"]);

    const worktrees: TerritoryWorktree[] = [{ path: repoRoot, branch: "trunk" }];
    const sessions: ReadySession[] = [branchSession("agent:peer", "peer0003", "feature-on-trunk")];

    const partition = partitionTerritory(worktrees, sessions, undefined);
    const worktreeEntry = findEntry(partition, (e) => e.kind === "worktree" && e.path === repoRoot);
    const branchEntry = findEntry(partition, (e) => e.branch === "feature-on-trunk" && e.kind === "branch");
    expect(worktreeEntry?.unmerged_commits).toBeUndefined();
    expect(branchEntry?.unmerged_commits).toBeUndefined();
  });

  it("REGRESSION: a worktrees list pointing outside any git repo never invents a count", () => {
    const notARepo = mkdtempReal("tp-count-regression-notarepo-");
    // deliberately never `git init`'d.

    const worktrees: TerritoryWorktree[] = [{ path: notARepo, branch: "main" }];
    const sessions: ReadySession[] = [branchSession("agent:ghost", "ghost002", "some-branch")];

    const partition = partitionTerritory(worktrees, sessions, undefined);
    const worktreeEntry = findEntry(partition, (e) => e.kind === "worktree" && e.path === notARepo);
    const branchEntry = findEntry(partition, (e) => e.branch === "some-branch");
    expect(worktreeEntry?.unmerged_commits).toBeUndefined();
    expect(branchEntry?.unmerged_commits).toBeUndefined();
  });

  it("STATE: a live foreign WORKTREE entry (not just an orphan branch) also measures its own branch's count correctly", () => {
    const repoRoot = mkdtempReal("tp-count-state-worktree-");
    initRepo(repoRoot);
    const wtParent = mkdtempReal("tp-count-state-worktree-parent-");
    const peerWorktreePath = join(wtParent, "peer-wt");
    git(repoRoot, ["worktree", "add", "-q", "-b", "peer-worktree-branch", peerWorktreePath]);
    commitFile(peerWorktreePath, "peer-1.txt", "peer 1");
    commitFile(peerWorktreePath, "peer-2.txt", "peer 2");

    const worktrees: TerritoryWorktree[] = [
      { path: repoRoot, branch: "main" },
      { path: peerWorktreePath, branch: "peer-worktree-branch" },
    ];
    const sessions: ReadySession[] = [
      {
        by: "agent:peer",
        session_id: "peer0004",
        worktree: peerWorktreePath,
        branches: ["peer-worktree-branch"],
        task_slugs: ["t-peer-wt"],
        newest_at: "2026-08-13T10:00:00.000Z",
      },
    ];

    const partition = partitionTerritory(worktrees, sessions, undefined);
    const entry = findEntry(partition, (e) => e.kind === "worktree" && e.path === peerWorktreePath);
    expect(entry?.unmerged_commits).toBe(2);
  });

  it("REGRESSION: a worktree entry whose OWN path is stale still measures its branch by falling back to another known worktree", () => {
    const repoRoot = mkdtempReal("tp-count-regression-fallback-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "stale-path-branch"]);
    git(repoRoot, ["checkout", "-q", "stale-path-branch"]);
    commitFile(repoRoot, "stale-1.txt", "stale 1");
    commitFile(repoRoot, "stale-2.txt", "stale 2");
    git(repoRoot, ["checkout", "-q", "main"]);

    // `repoRoot` (a REAL, valid worktree) listed FIRST so it becomes the
    // fallback probe cwd; the SECOND entry's own `path` is fabricated and
    // does not exist on disk at all — its branch is still measurable only
    // by borrowing the first entry's path.
    const worktrees: TerritoryWorktree[] = [
      { path: repoRoot, branch: "main" },
      { path: "/definitely/does/not/exist/lore-territory-partition-test", branch: "stale-path-branch" },
    ];

    const partition = partitionTerritory(worktrees, [], undefined);
    const entry = findEntry(
      partition,
      (e) => e.kind === "worktree" && e.path === "/definitely/does/not/exist/lore-territory-partition-test",
    );
    expect(entry?.unmerged_commits).toBe(2);
  });
});
