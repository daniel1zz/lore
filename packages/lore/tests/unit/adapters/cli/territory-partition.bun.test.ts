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
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-1
 */

import { describe, expect, it } from "bun:test";
import type { ReadySession } from "@lore/core";
import {
  partitionTerritory,
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
