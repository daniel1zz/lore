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
 * Another describe block below, positioned BEFORE the AC-REPLAY-1 one
 * ("local branch discovery", task-lore-territory-s-discovery-set-is-claim-
 * derived-so-an, 2026-08-13), covers the optional 4th
 * `localBranches` parameter — a discovery source that closes the gap this
 * task exists for: a local branch NEITHER a worktree's current branch NOR
 * named by any session's claim was previously invisible to the discovered
 * set entirely, hence silently dropped rather than filed `unowned`. Its own
 * dimensions: HAPPY (a git-known, unclaimed, un-worktreed branch surfaces
 * `unowned`, no double-count of a worktree's own branch), a dedup/regression
 * case (a claimed branch is not re-bucketed `unowned` by the new source),
 * NEGATIVE (omitting the parameter entirely never invents entries — pre-
 * remediation behaviour is preserved), and BOUNDARY (sum-equals-total
 * checked against git's OWN ref list from a REAL `mkdtemp` repo — an
 * INDEPENDENT enumeration, never a re-derivation over the same
 * `worktrees`/`sessions` objects `partitionTerritory` itself consumes, which
 * is exactly what made the ORIGINAL `expectedDiscoveredTotal`-based
 * sum-equals-total oracle above vacuous: it could never disagree with a bug
 * shared by both the check and the code under test).
 *
 * A THIRD pair of describe blocks below covers the PRODUCER side of
 * `localBranches` (task-thread-real-local-branch-enumeration-from-the-git-
 * port, 2026-08-13) — the "local branch discovery" block above only proved
 * `partitionTerritory` correctly CONSUMES an injected branch list; until
 * this task, nothing supplied one, so every real `lore territory` run still
 * passed `undefined` and the gap this parameter exists to close reproduced
 * one layer down. Two blocks: `real-git-port.ts::listLocalBranches` (the
 * enumeration function itself, real `mkdtemp` git fixtures, six dimensions:
 * HAPPY — a slash-named branch enumerates correctly; NEGATIVE — a `cwd`
 * outside any git repository degrades to `undefined`; BOUNDARY — a
 * zero-commit repo is a MEASURED empty list, distinguishable from
 * `undefined`; ERROR — `for-each-ref` itself failing via a broken git-
 * directory pointer, a DIFFERENT fixture from "no repo at all", also
 * degrades to `undefined`; STATE — a detached-HEAD checkout does not shrink
 * the enumerated list, unlike `detectWorktreeBranch`'s own answer for that
 * same state; REGRESSION — see the second block), and its ONE production
 * caller, `commands/territory.ts`'s `run()` (REGRESSION: driven end-to-end
 * through the REAL CLI command — not a hand-rolled call to the pure
 * functions — so a future revert of the WIRING, not just the enumeration
 * function, goes red).
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
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-1, spec-multi-session-concurrency-queryable-ownership-checkout#AC-REPLAY-1
 */

import { afterEach, describe, expect, it, vi } from "vitest";
const spyOn = vi.spyOn.bind(vi);
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadySession } from "@lore/core";
import { createApp } from "../../../../src/app.js";
import { listLocalBranches } from "../../../../src/adapters/real-git-port.js";
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

// ─── Local branch discovery (AC-OWN-1 remediation, task-lore-territory-s-
// discovery-set-is-claim-derived-so-an, 2026-08-13) ─────────────────────────
//
// `worktrees` (git worktree list) and `sessions[].branches` (claim-derived
// orphans) are not the only two facts git can supply: a LOCAL branch that no
// worktree currently checks out AND no session claims exists in neither
// structure, so it was previously invisible to `partitionTerritory` and
// silently dropped — exactly the branch a reader deciding what to delete is
// deciding about. The optional 4th parameter `localBranches` closes this by
// injecting a THIRD fact set (every local branch name, e.g. from `git
// for-each-ref refs/heads/`) rather than having the partitioner shell out
// itself — see `territory-partition.ts`'s own module header for why.
describe("partitionTerritory — local branch discovery (AC-OWN-1 remediation)", () => {
  it("an unclaimed, un-worktreed local branch is reported unowned, never dropped, and never double-counts a worktree's own current branch", () => {
    const worktrees: TerritoryWorktree[] = [{ path: "/wt-mine", branch: "main" }];
    const sessions: ReadySession[] = [];
    // "main" is ALSO one of the git-reported local branches — it must fold
    // into the worktree's own single entry, never mint a second entry.
    const localBranches = ["main", "nobody-claims-this"];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID, localBranches);

    expect(totalEntries(partition)).toBe(2); // 1 worktree (main) + 1 orphan branch, never 3
    const entry = partition.unowned.find((e) => e.kind === "branch" && e.branch === "nobody-claims-this");
    expect(entry).toBeDefined();
    expect(partition.mine.some((e) => e.kind === "branch" && e.branch === "nobody-claims-this")).toBe(false);
    expect(partition.foreign.some((e) => e.kind === "branch" && e.branch === "nobody-claims-this")).toBe(false);
    expect(partition.unmeasured.some((e) => e.kind === "branch" && e.branch === "nobody-claims-this")).toBe(false);
  });

  it("a local branch ALSO named by a session's claim is still classified by that claim, not re-filed unowned by the third source", () => {
    const worktrees: TerritoryWorktree[] = [{ path: "/wt-mine", branch: "main" }];
    const sessions: ReadySession[] = [branchSession("agent:peer", "peer5555", "claimed-branch")];
    const localBranches = ["main", "claimed-branch"];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID, localBranches);

    expect(totalEntries(partition)).toBe(2);
    expect(partition.unmeasured.some((e) => e.kind === "branch" && e.branch === "claimed-branch")).toBe(false);
    // reason: `compareClaimSessions` cannot prove same/different for a peer
    // it has no relation to via CURRENT_SESSION_ID here, so this specific
    // fixture's claimant is "foreign" — the point under test is only that it
    // is NOT re-classified `unowned` by the new discovery source.
    const claimedEntry = [...partition.foreign, ...partition.unmeasured].find(
      (e) => e.kind === "branch" && e.branch === "claimed-branch",
    );
    expect(claimedEntry).toBeDefined();
    expect(partition.unowned.some((e) => e.kind === "branch" && e.branch === "claimed-branch")).toBe(false);
  });

  it("omitting localBranches (enumeration not attempted/failed) never invents entries — behaves exactly as before this remediation", () => {
    const worktrees: TerritoryWorktree[] = [{ path: "/wt-mine", branch: "main" }];
    const sessions: ReadySession[] = [];

    const partition = partitionTerritory(worktrees, sessions, CURRENT_SESSION_ID);

    expect(totalEntries(partition)).toBe(1);
  });

  it("BOUNDARY: sum-equals-total checked against git's OWN ref list (real repo) — an INDEPENDENT enumeration, never a re-derivation over the same worktrees/sessions objects fed to partitionTerritory", () => {
    const repoRoot = mkdtempReal("tp-independent-total-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "claimed-elsewhere"]);
    git(repoRoot, ["branch", "nobody-claims-this"]);

    // Ground truth: queried DIRECTLY from git in this repo, never through
    // `partitionTerritory` or any helper that mirrors its own discovery
    // algorithm (the previous `expectedDiscoveredTotal` helper re-derived the
    // total from the exact same `worktrees`/`sessions` JS objects using
    // near-identical set-construction rules — vacuous, since it could never
    // disagree with a bug shared by both. This query is a genuinely separate
    // data source: real git state, read independently.)
    const groundTruthBranches = git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
      .split("\n")
      .filter((line) => line.length > 0);
    expect(new Set(groundTruthBranches)).toEqual(new Set(["main", "claimed-elsewhere", "nobody-claims-this"]));

    const worktrees: TerritoryWorktree[] = [{ path: repoRoot, branch: "main" }];
    const sessions: ReadySession[] = [branchSession("agent:peer", "peer9999", "claimed-elsewhere")];
    const partition = partitionTerritory(worktrees, sessions, undefined, groundTruthBranches);

    // THE case this remediation exists to catch: present, not absent.
    const unclaimedEntry = partition.unowned.find((e) => e.kind === "branch" && e.branch === "nobody-claims-this");
    expect(unclaimedEntry).toBeDefined();

    // sum-equals-total, with the TOTAL derived from `groundTruthBranches` (the
    // independent git query above) rather than from replaying
    // worktrees/sessions/localBranches through partitionTerritory's own
    // set-construction: 1 worktree entry (main) + every ground-truth branch
    // NOT currently checked out by that worktree (2: claimed-elsewhere,
    // nobody-claims-this). Before this remediation, `nobody-claims-this` was
    // dropped and this assertion would read totalEntries === 2 while
    // independentTotal === 3 — a genuine, catchable mismatch.
    const checkedOutBranches = new Set(worktrees.filter((w) => w.branch !== null).map((w) => w.branch as string));
    const independentTotal = worktrees.length + groundTruthBranches.filter((b) => !checkedOutBranches.has(b)).length;
    expect(independentTotal).toBe(3); // hand-countable: 1 worktree (main) + 2 orphan branches
    expect(totalEntries(partition)).toBe(independentTotal);
    // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
    // D1) — this body's real `git` fixture construction spawns >= SPAWN_THRESHOLD
    // times (initRepo + 2 `git branch` + 1 `git for-each-ref`), mirroring the
    // AC-REPLAY-1 cases below in this same file.
  }, 15000);
});

// ─── real-git-port.ts::listLocalBranches — the PRODUCER side of AC-OWN-1's
// localBranches parameter (task-thread-real-local-branch-enumeration-from-
// the-git-port, 2026-08-13) ─────────────────────────────────────────────────
//
// The block above proved `partitionTerritory` correctly CONSUMES an
// injected branch list. It never proved anything SUPPLIES one — before this
// task, `territory-partition.ts`'s own module header recorded that no
// caller passed a real value, so every real `lore territory --json`
// invocation still passed `undefined` and the exact defect `localBranches`
// exists to close reproduced one layer down. These tests cover the
// standalone leaf function beside `detectWorktreeBranch` (never a `GitPort`
// interface method — same reason: `SeatService`'s fake fixtures need no new
// method) that performs the actual `git for-each-ref` shell-out.
//
// Six-dimension coverage:
//   HAPPY:      a branch name containing a slash (`feat/x`) enumerates
//               correctly, alongside an ordinary name
//   NEGATIVE:   a `cwd` outside any git repository degrades to `undefined`
//               — never `[]`, which would assert a MEASURED zero
//   BOUNDARY:   a freshly-`git init`'d repo with ZERO commits (so
//               `refs/heads/` has no members at all yet) is a legitimately
//               MEASURED empty list — `[]`, distinguishable from `undefined`
//   ERROR:      `for-each-ref` itself failing (a `.git` FILE pointing at a
//               nonexistent gitdir — a DIFFERENT fixture from "no repo at
//               all") also degrades to `undefined`, uniformly with every
//               other failure mode (module @invariant)
//   STATE:      a detached-HEAD checkout does not shrink the enumerated
//               list at all — every local branch still lists, unlike
//               `detectWorktreeBranch`'s OWN "unmeasured" answer for the
//               SAME checkout state (a deliberate, documented difference:
//               this function answers "what branches exist", never "what
//               is currently checked out")
//   REGRESSION: see the SECOND describe block below — the live call site.
describe("real-git-port.ts::listLocalBranches — the producer side of AC-OWN-1's localBranches parameter", () => {
  it("HAPPY: enumerates every local branch, including one whose name contains a slash", async () => {
    const repoRoot = mkdtempReal("lb-happy-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "feat/x"]);

    const branches = await listLocalBranches(repoRoot);

    expect(branches).toBeDefined();
    expect(new Set(branches)).toEqual(new Set(["main", "feat/x"]));
  });

  it("NEGATIVE: a cwd outside any git repository degrades to undefined, never an empty array", async () => {
    const notARepo = mkdtempReal("lb-negative-notarepo-");
    // deliberately never `git init`'d.

    const branches = await listLocalBranches(notARepo);

    expect(branches).toBeUndefined();
  });

  it("BOUNDARY: a freshly-initialized repo with zero commits is a MEASURED empty list ([]), distinguishable from undefined", async () => {
    const emptyRepo = mkdtempReal("lb-boundary-empty-");
    git(emptyRepo, ["init", "-q", "-b", "main"]);
    // deliberately no commit — refs/heads/ has no members yet, but the
    // git call itself still succeeds (exit 0), which is the whole point:
    // this is a MEASURED fact, never the same silence as `undefined`.

    const branches = await listLocalBranches(emptyRepo);

    expect(branches).not.toBeUndefined();
    expect(branches).toEqual([]);
  });

  it("ERROR: for-each-ref itself failing (a broken .git gitdir pointer, not merely 'no repo') degrades to undefined uniformly", async () => {
    const brokenRepo = mkdtempReal("lb-error-broken-gitdir-");
    // reason: a DIFFERENT fixture from the NEGATIVE case above — this
    // directory LOOKS like a linked worktree (a `.git` FILE, not a bare
    // absence of one) whose gitdir pointer resolves nowhere, so `git`
    // itself fails inside `for-each-ref`'s own repository-discovery step
    // rather than never finding a `.git` marker at all. Empirically
    // verified (2026-08-13): exits 128 with "fatal: not a git repository:
    // <target>", a DIFFERENT message from the NEGATIVE case's "(or any of
    // the parent directories)" — genuinely a separate failure path,
    // asserted here to degrade to the SAME `undefined` outcome.
    writeFileSync(join(brokenRepo, ".git"), "gitdir: /definitely/does/not/exist/lore-lb-test\n");

    const branches = await listLocalBranches(brokenRepo);

    expect(branches).toBeUndefined();
  });

  it("STATE: a detached-HEAD checkout still enumerates every local branch — unaffected by current checkout state", async () => {
    const repoRoot = mkdtempReal("lb-state-detached-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "side-branch"]);
    const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
    git(repoRoot, ["checkout", "-q", headSha]);

    // Confirm the checkout genuinely IS detached (mirrors
    // `detectWorktreeBranch`'s own "unmeasured" precondition) — `git
    // symbolic-ref -q HEAD` exits nonzero only when HEAD is detached.
    let symbolicRefThrew = false;
    try {
      git(repoRoot, ["symbolic-ref", "-q", "HEAD"]);
    } catch {
      symbolicRefThrew = true;
    }
    expect(symbolicRefThrew).toBe(true);

    const branches = await listLocalBranches(repoRoot);

    // The point under test: detachment does NOT shrink or empty this list —
    // both "main" and "side-branch" still enumerate, in direct contrast to
    // `detectWorktreeBranch`'s own "unmeasured" answer for this same repo.
    expect(new Set(branches)).toEqual(new Set(["main", "side-branch"]));
    // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
    // D1) — this body's real `git` fixture construction spawns >= SPAWN_THRESHOLD
    // times (branch + rev-parse + checkout + symbolic-ref), mirroring the
    // AC-REPLAY-1 cases elsewhere in this same file.
  }, 15000);
});

// ─── commands/territory.ts's production run() — the live call site
// (task-thread-real-local-branch-enumeration-from-the-git-port) ───────────
//
// The block above proves the enumeration FUNCTION works. This block proves
// the one thing the task brief calls out by name as the actual gap: that
// `lore territory`'s production command THREADS its result through, rather
// than continuing to pass `undefined` unconditionally. A unit test on
// `listLocalBranches` alone, with `commands/territory.ts` left unwired,
// would reproduce this exact defect one layer down — the failure mode this
// describe block exists to catch.
describe("commands/territory.ts's production run() — the live call site (AC-OWN-1 remediation)", () => {
  it("REGRESSION: threads a genuinely non-undefined localBranches value into partitionTerritory, surfacing an unclaimed local branch that used to be silently dropped", async () => {
    const repoRoot = mkdtempReal("tp-live-callsite-");
    initRepo(repoRoot);
    git(repoRoot, ["branch", "nobody-claims-this-live"]);

    const loreDir = join(repoRoot, ".lore");
    mkdirSync(loreDir, { recursive: true });
    // reason: constructs the throwaway corpus file only — `createApp`
    // derives `repoRoot` itself from `dirname(dirname(dbPath))` (never
    // `process.cwd()`), so no explicit override is needed or accepted here
    // (its public overloads take only `dbPath`/`config`). The command under
    // test performs its OWN `loadLoreApp()` call below, which re-opens this
    // SAME db (mirrors `loader-foreign-write-surface.bun.test.ts`'s
    // established fixture pattern).
    const bootstrapApp = createApp(join(loreDir, "lore.db"));
    bootstrapApp.close();

    const originalCwd = process.cwd();
    process.chdir(repoRoot);
    // reason: `spy.mock.calls` does NOT reliably populate under this bun
    // version (empirically verified, 2026-08-13) — the established capture
    // pattern in this codebase (`cli-evidence-result-rendering.bun.test.ts::
    // captureConsoleLog`) instead pushes into its OWN closure array from
    // inside `mockImplementation` itself, which does work. Mirrored here.
    const printedLines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...logArgs: unknown[]) => {
      printedLines.push(String(logArgs[0]));
    });
    try {
      const mod = await import("../../../../src/adapters/cli/commands/territory.js");
      const territoryCommand = (
        mod as { default?: { run?: (ctx: { args: Record<string, unknown> }) => Promise<void> } }
      ).default;
      if (!territoryCommand?.run) throw new Error("territory command not exported");
      await territoryCommand.run({ args: { json: true } });
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
    }

    const printedLine = printedLines.find((line) => line.includes("nobody-claims-this-live"));
    // reason: the historical defect (nothing supplies `localBranches` at the
    // live call site) means this line — and this entry — would be ENTIRELY
    // ABSENT, not merely miscategorized. Asserting presence, never just a
    // bucket shape, is what this AC's own header warns a shape-only test
    // would miss.
    expect(printedLine).toBeDefined();

    const parsed = JSON.parse(printedLine as string) as { ok: boolean; data: TerritoryPartition };
    expect(parsed.ok).toBe(true);
    const allEntries: TerritoryEntry[] = [
      ...parsed.data.mine,
      ...parsed.data.foreign,
      ...parsed.data.unowned,
      ...parsed.data.unmeasured,
    ];
    const entry = allEntries.find((e) => e.kind === "branch" && e.branch === "nobody-claims-this-live");
    expect(entry).toBeDefined();
    expect(entry?.bucket).toBe("unowned");
  }, 15000);
});

describe("partitionTerritory — unmerged_commits (spec-multi-session-concurrency-queryable-ownership-checkout#AC-REPLAY-1)", () => {
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
    // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
    // D1) — this body's real `git` fixture construction spawns >= SPAWN_THRESHOLD times.
  }, 15000);

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
    // ^ explicit timeout — see the HAPPY case above.
  }, 15000);

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
    // ^ explicit timeout — see the HAPPY case above.
  }, 15000);

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
    // ^ explicit timeout — see the HAPPY case above.
  }, 15000);
});
