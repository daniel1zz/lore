/**
 * `lore territory --json`'s pure partitioning logic (spec-multi-session-
 * concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-1) — split out
 * from `commands/territory.ts` so it stays directly unit-testable without a
 * `bun:sqlite`-backed App (the "Vitest-unsafe commands get a sibling module"
 * convention, `adapters/cli/CLAUDE.md`, applied here even though this
 * particular suite runs under `bun test` rather than vitest).
 *
 * Partitions the CORPUS-WIDE union of every git worktree and every claimed
 * branch into exactly one of four disjoint buckets: `mine` / `foreign` /
 * `unowned` / `unmeasured`. The four buckets are a partition, not merely a
 * classification — every discovered entry lands in EXACTLY one bucket, never
 * zero (AC-OWN-1's own "never silently dropped" clause) and never more than
 * one (buckets are checked in a fixed, mutually-exclusive precedence).
 *
 * Public surface:
 *   - TerritoryBucket / TerritoryHolder / TerritoryEntry / TerritoryPartition
 *   - partitionTerritory(worktrees, sessions, currentSessionId)
 *   - formatTerritoryHuman(partition)
 *
 * Invariants:
 *   - Classification routes through `gate-predicates.ts::compareClaimSessions`
 *     — the SAME three-valued session comparator the anchor-overlap mutex
 *     uses — never a new ad hoc boolean equality check.
 *   - The discovered entry set is the union of (a) every worktree path named
 *     by EITHER `worktrees` (current `git worktree list`) OR any session's
 *     own `.worktree` (a claim can outlive its worktree's removal — "a
 *     worktree whose path no longer exists" must still surface, never
 *     vanish), and (b) every branch named by a session's `branches[]` that
 *     is NOT the current branch of any worktree in (a) — an "orphan" branch,
 *     claimed but checked out nowhere right now.
 *   - `unowned`: a worktree entry with NO session recording that worktree at
 *     all (GAP-B: the main checkout, or any worktree never taken through
 *     `lore claim`, is an anchor of no task). A branch entry is NEVER
 *     `unowned` by construction — it exists in the discovered set ONLY
 *     because some session's claim named it.
 *   - Per-entry bucket precedence when MULTIPLE sessions reference the same
 *     worktree/branch: `mine` (any session compares same-session) beats
 *     `foreign` (any session compares different-session) beats `unmeasured`
 *     (every session compares not-measured) — mirrors
 *     `findAnchorOverlapConflict`'s "first sibling in scan order" precedent,
 *     generalised to "the most decisive verdict among the candidates wins"
 *     since here there is no single "attempted claim" to check against many
 *     siblings, but many claims against one shared target.
 *   - `foreign` NAMES its holder (`session_id` + `by` + `worktree` when
 *     known) — copying git's own `fatal: 'x' is already used by worktree at
 *     <path>` refusal shape (module rationale for this whole command).
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-1.
 */

import type { ReadySession } from "@lore/core";
import { compareClaimSessions } from "../../service/gate-predicates.js";

/** The four disjoint buckets `partitionTerritory` sorts every discovered entry into. */
export type TerritoryBucket = "mine" | "foreign" | "unowned" | "unmeasured";

/** A `foreign` entry's holder — names WHO holds it, copying git's own worktree-refusal shape. */
export interface TerritoryHolder {
  readonly session_id: string;
  readonly by: string;
  readonly worktree?: string;
}

/** One partitioned worktree or orphan-branch entry. */
export interface TerritoryEntry {
  readonly kind: "worktree" | "branch";
  /** Present iff `kind === "worktree"`. */
  readonly path?: string;
  /**
   * Present iff `kind === "branch"` (an orphan branch, no live worktree), OR
   * `kind === "worktree"` AND git currently reports a branch there (absent
   * for a detached-HEAD worktree).
   */
  readonly branch?: string;
  readonly bucket: TerritoryBucket;
  /** Present iff `bucket === "foreign"`. */
  readonly holder?: TerritoryHolder;
}

/** The full corpus-wide partition `lore territory --json` prints. */
export interface TerritoryPartition {
  readonly mine: TerritoryEntry[];
  readonly foreign: TerritoryEntry[];
  readonly unowned: TerritoryEntry[];
  readonly unmeasured: TerritoryEntry[];
}

/** One `git worktree list` entry, as `partitionTerritory` needs it (a narrowed `WorktreeInfo`, `seat-service.ts`). */
export interface TerritoryWorktree {
  readonly path: string;
  /** `null` marks a detached-HEAD worktree. */
  readonly branch: string | null;
}

/**
 * Classifies the sessions relevant to ONE discovered entry (a worktree or an
 * orphan branch) into a bucket + optional holder, per this module's own
 * documented precedence (`mine` > `foreign` > `unmeasured`, `unowned` only
 * when `relevant` is empty).
 */
function classify(
  relevant: readonly ReadySession[],
  currentSessionId: string | undefined,
): { bucket: TerritoryBucket; holder?: TerritoryHolder } {
  if (relevant.length === 0) return { bucket: "unowned" };

  let foreignHolder: TerritoryHolder | undefined;

  for (const session of relevant) {
    const comparison = compareClaimSessions(currentSessionId, session.session_id);
    if (comparison === "same-session") {
      return { bucket: "mine" };
    }
    if (comparison === "different-session" && session.session_id !== undefined && foreignHolder === undefined) {
      foreignHolder = {
        session_id: session.session_id,
        by: session.by,
        ...(session.worktree !== undefined ? { worktree: session.worktree } : {}),
      };
    }
  }

  if (foreignHolder !== undefined) return { bucket: "foreign", holder: foreignHolder };
  return { bucket: "unmeasured" };
}

/**
 * @param worktrees - Every CURRENT `git worktree list` entry (real: `RealGitPort.worktreeList()`).
 * @param sessions - Every corpus-wide derived session (`SessionService.getActiveSessions()`,
 *   the SAME derivation `lore bootstrap`'s `active_sessions` uses).
 * @param currentSessionId - The CALLING session's own captured session instance
 *   (`resolveClaimSessionId(process.env)`), or `undefined` when unmeasured —
 *   an absent value makes EVERY comparison `"not-measured"`, so nothing is
 *   ever misclassified `mine` on an unmeasured caller.
 * @returns The four-bucket partition — `mine.length + foreign.length +
 *   unowned.length + unmeasured.length` always equals the discovered entry
 *   count (this module's own §Invariants "never dropped" clause).
 */
export function partitionTerritory(
  worktrees: readonly TerritoryWorktree[],
  sessions: readonly ReadySession[],
  currentSessionId: string | undefined,
): TerritoryPartition {
  const partition: TerritoryPartition = { mine: [], foreign: [], unowned: [], unmeasured: [] };

  const worktreeBranches = new Set<string>();
  const branchByPath = new Map<string, string | null>();
  const worktreePaths = new Set<string>();
  for (const wt of worktrees) {
    worktreePaths.add(wt.path);
    branchByPath.set(wt.path, wt.branch);
    if (wt.branch !== null) worktreeBranches.add(wt.branch);
  }
  // reason: a session's OWN recorded worktree must surface even when git no
  // longer reports it (the worktree was removed out-of-band, or the claim's
  // path was always wrong) — "a worktree whose path no longer exists" is a
  // named failure mode, never a silent omission.
  for (const session of sessions) {
    if (session.worktree !== undefined && !worktreePaths.has(session.worktree)) {
      worktreePaths.add(session.worktree);
      branchByPath.set(session.worktree, null);
    }
  }

  for (const path of worktreePaths) {
    const branch = branchByPath.get(path) ?? null;
    const relevant = sessions.filter((s) => s.worktree === path);
    const { bucket, holder } = classify(relevant, currentSessionId);
    const entry: TerritoryEntry = {
      kind: "worktree",
      path,
      ...(branch !== null ? { branch } : {}),
      bucket,
      ...(holder !== undefined ? { holder } : {}),
    };
    partition[bucket].push(entry);
  }

  const orphanBranches = new Set<string>();
  for (const session of sessions) {
    for (const branch of session.branches) {
      if (!worktreeBranches.has(branch)) orphanBranches.add(branch);
    }
  }

  for (const branch of orphanBranches) {
    const relevant = sessions.filter((s) => s.branches.includes(branch));
    const { bucket, holder } = classify(relevant, currentSessionId);
    partition[bucket].push({
      kind: "branch",
      branch,
      bucket,
      ...(holder !== undefined ? { holder } : {}),
    });
  }

  return partition;
}

/** Compact human-readable rendering of a `TerritoryPartition` — pointers only, `console.log`-ready. */
export function formatTerritoryHuman(partition: TerritoryPartition): string {
  const lines: string[] = ["── lore territory ──"];

  const renderBucket = (label: string, entries: readonly TerritoryEntry[]): void => {
    lines.push(`${label} (${entries.length}):`);
    if (entries.length === 0) {
      lines.push("  (none)");
      return;
    }
    for (const entry of entries) {
      const target = entry.kind === "worktree" ? (entry.path ?? "(unknown)") : `branch:${entry.branch}`;
      const branchNote = entry.kind === "worktree" && entry.branch !== undefined ? ` (${entry.branch})` : "";
      const holderNote =
        entry.holder !== undefined
          ? ` — held by ${entry.holder.by} (session ${entry.holder.session_id}` +
            `${entry.holder.worktree !== undefined ? `, worktree ${entry.holder.worktree}` : ""})`
          : "";
      lines.push(`  - ${target}${branchNote}${holderNote}`);
    }
  };

  renderBucket("Mine", partition.mine);
  renderBucket("Foreign", partition.foreign);
  renderBucket("Unowned", partition.unowned);
  renderBucket("Unmeasured", partition.unmeasured);

  return lines.join("\n");
}
