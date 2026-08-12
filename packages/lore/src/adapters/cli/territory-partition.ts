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
 * ⛔ No longer side-effect-free (AC-REPLAY-1, spec-multi-session-concurrency-
 * queryable-ownership-checkout §Scope L0): every entry that carries a
 * `branch` is measured for `unmerged_commits` via a SYNCHRONOUS git
 * shell-out (`real-git-port.ts::countUnmergedCommitsSync`) — `bun:sqlite`
 * -free, so this module stays exactly as unit-testable as before (the
 * original reason for this file's split from `commands/territory.ts`); it
 * is `bun:sqlite`-freedom this split protects, never IO-freedom, and the
 * 2026-08-11 diagnosis showed a boolean-only git port was the actual gap.
 * `partitionTerritory` MUST stay callable without `await` (both its
 * callers assign its return value directly) — this is WHY the sync leaf
 * function exists at all, rather than the async `GitPort.
 * countUnmergedCommits` every OTHER git-backed capability in this codebase
 * uses.
 *
 * Invariants:
 *   - Classification routes through `gate-predicates.ts::compareClaimSessions`
 *     — the SAME three-valued session comparator the anchor-overlap mutex
 *     uses — never a new ad hoc boolean equality check.
 *   - The discovered entry set is the union of THREE sources: (a) every
 *     worktree path named by EITHER `worktrees` (current `git worktree
 *     list`) OR any session's own `.worktree` (a claim can outlive its
 *     worktree's removal — "a worktree whose path no longer exists" must
 *     still surface, never vanish); (b) every branch named by a session's
 *     `branches[]` that is NOT the current branch of any worktree in (a) —
 *     an "orphan" branch, claimed but checked out nowhere right now; and
 *     (c) every branch named by the optional `localBranches` parameter that
 *     is NOT already covered by (a) or (b) — a git-known local branch that
 *     NEITHER a worktree NOR any claim currently names. Before source (c)
 *     existed (task-lore-territory-s-discovery-set-is-claim-derived-so-an,
 *     2026-08-13), such a branch was invisible to BOTH (a) and (b) and
 *     silently dropped — exactly the branch a reader deciding what to delete
 *     needs to see. `localBranches` is `undefined`, NEVER `[]`, when the
 *     caller could not enumerate local refs at all (mirrors
 *     `real-git-port.ts::BranchMeasurement`'s "not measured ≠ known-absent"
 *     discipline) — an empty array asserts a MEASURED zero local branches, a
 *     genuinely different fact from "enumeration was not attempted or
 *     failed"; this function never needs to distinguish the two itself
 *     (`undefined` simply contributes nothing to source (c)), but a caller
 *     collapsing "failed" into `[]` before calling in would silently
 *     reintroduce the exact defect this parameter exists to close.
 *   - Ref enumeration for source (c) is deliberately NOT performed by this
 *     module — `localBranches` is injected DATA, never a git shell-out this
 *     file makes itself. Two reasons, both from this module's own prior
 *     history: (1) this file was split out of `commands/territory.ts`
 *     specifically to stay unit-testable without IO (see this header's own
 *     account of that split, and the later AC-REPLAY-1 tension it already
 *     records — adding a SECOND independent git dependency here would widen
 *     that same drift rather than resolve it); (2) a pure function taking an
 *     injected fact set is testable with hand-constructed fixtures AND with
 *     real `mkdtemp` git repos (this file does both), with no repo required
 *     for the former. The actual enumeration (e.g. `git for-each-ref
 *     refs/heads/`) belongs in the adapter git port
 *     (`adapters/real-git-port.ts`, alongside `detectWorktreeBranch`'s
 *     identical "standalone leaf function, not a `GitPort` interface method"
 *     shape — a `GitPort` method would force EVERY `GitPort` implementer,
 *     including `SeatService`'s unrelated fake fixtures, to grow a method
 *     they do not need) and threaded through `commands/territory.ts` into
 *     this parameter. That wiring is NOT yet done as of this remediation —
 *     no current caller of `partitionTerritory` passes a real
 *     `localBranches` value — because `adapters/real-git-port.ts` was, at
 *     the time this parameter was added, under an active `lore claim` by a
 *     concurrent task on a different anchor; landing it here would have
 *     touched a file this task never declared as its own anchor. This
 *     function is ready to receive real refs the moment that wiring lands.
 *   - `unowned`: an entry with NO session recording it at all — a worktree
 *     GAP-B never taken through `lore claim`, OR (since source (c) above) a
 *     git-known branch nobody's claim names either. `unmeasured` is reserved
 *     for the OPPOSITE shape: at least one session names the entry, but
 *     session-identity comparison cannot resolve same-vs-different (see
 *     `classify()`) — "nobody claims this at all" is a more decisive, more
 *     final fact than "someone claims this but we cannot tell who", so it
 *     gets the more decisive bucket. A prior version of this line asserted a
 *     branch entry is "NEVER `unowned` by construction"; that was true only
 *     because source (c) did not exist yet.
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
import { countUnmergedCommitsSync } from "../real-git-port.js";

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
  /**
   * Commits reachable from `branch` but not from the fixed base branch
   * ({@link TERRITORY_BASE_BRANCH}) — AC-REPLAY-1's answer to "does this
   * branch carry unmerged work, and how much" (`isMerged` alone can only
   * say "some or none"). Present ONLY when an actual git measurement
   * succeeded; ABSENT — NEVER `0` — when `branch` is absent, no local
   * worktree path was available to probe from, or the git call itself
   * failed (nonexistent branch, nonexistent base ref, a probe path outside
   * any git work tree). Collapsing "not measured" into `0` would recreate
   * the exact 2026-08-11 defect this field exists to close.
   */
  readonly unmerged_commits?: number;
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
 * The fixed base branch every `unmerged_commits` count is measured against
 * — mirrors `seat-service.ts::SEAT_BASE_BRANCH`'s SAME "main is the
 * integration branch" assumption. Kept as this module's OWN constant
 * rather than importing that one: `SeatService`'s is about "safe to
 * delete", this one is about "surface a number" — today they happen to
 * agree, but a service importing a CLI-adapter constant (or vice versa)
 * would be the wrong dependency direction regardless.
 */
const TERRITORY_BASE_BRANCH = "main";

/**
 * Best-effort per-branch unmerged-commit count (AC-REPLAY-1). Tries each
 * candidate cwd in order via {@link countUnmergedCommitsSync} and returns
 * the FIRST successful measurement — `undefined` (never `0`) when `branch`
 * is absent, every candidate is `undefined`, or every git call failed
 * (nonexistent branch/base ref, a candidate outside any git work tree).
 * Multiple candidates matter for a `kind: "worktree"` entry whose OWN
 * `path` may no longer be a real worktree (this module's own "a worktree
 * whose path no longer exists" case) — falling back to any OTHER currently
 * known worktree still measures the branch correctly, since git branches
 * are visible repo-wide from every worktree sharing one `.git`.
 */
function measureUnmergedCommits(branch: string | undefined, candidateCwds: readonly (string | undefined)[]): number | undefined {
  if (branch === undefined) return undefined;
  for (const cwd of candidateCwds) {
    if (cwd === undefined) continue;
    const result = countUnmergedCommitsSync(cwd, branch, TERRITORY_BASE_BRANCH);
    if (result.ok) return result.value;
  }
  return undefined;
}

/**
 * @param worktrees - Every CURRENT `git worktree list` entry (real: `RealGitPort.worktreeList()`).
 * @param sessions - Every corpus-wide derived session (`SessionService.getActiveSessions()`,
 *   the SAME derivation `lore bootstrap`'s `active_sessions` uses).
 * @param currentSessionId - The CALLING session's own captured session instance
 *   (`resolveClaimSessionId(process.env)`), or `undefined` when unmeasured —
 *   an absent value makes EVERY comparison `"not-measured"`, so nothing is
 *   ever misclassified `mine` on an unmeasured caller.
 * @param localBranches - Every LOCAL branch name git itself reports (e.g. via
 *   `git for-each-ref --format=%(refname:short) refs/heads/`) — discovery
 *   source (c), see this module's own §Invariants. `undefined` when the
 *   caller could not enumerate (or has not been wired to attempt it yet) —
 *   NEVER `[]` to stand in for that; an empty array asserts a MEASURED zero
 *   local branches, a different fact entirely.
 * @returns The four-bucket partition — `mine.length + foreign.length +
 *   unowned.length + unmeasured.length` always equals the discovered entry
 *   count (this module's own §Invariants "never dropped" clause).
 */
export function partitionTerritory(
  worktrees: readonly TerritoryWorktree[],
  sessions: readonly ReadySession[],
  currentSessionId: string | undefined,
  localBranches?: readonly string[],
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

  // reason: AC-REPLAY-1's probe cwd — ANY currently-known real worktree path
  // (git branches are visible repo-wide from every worktree sharing one
  // `.git`, so this need not belong to the entry being measured). Absent
  // only when `worktrees` itself is empty (git reported no worktrees at
  // all) — every count then degrades to `undefined`, never `0`.
  const anyKnownWorktreePath: string | undefined = worktrees[0]?.path;

  for (const path of worktreePaths) {
    const branch = branchByPath.get(path) ?? null;
    const relevant = sessions.filter((s) => s.worktree === path);
    const { bucket, holder } = classify(relevant, currentSessionId);
    const branchName = branch !== null ? branch : undefined;
    // reason: prefer this entry's OWN path (most precise); fall back to any
    // other known worktree when `path` itself is stale (this module's own
    // "a worktree whose path no longer exists" failure mode) — the branch
    // name is still measurable from elsewhere in the same repo.
    const unmergedCommits = measureUnmergedCommits(branchName, [path, anyKnownWorktreePath]);
    const entry: TerritoryEntry = {
      kind: "worktree",
      path,
      ...(branch !== null ? { branch } : {}),
      bucket,
      ...(holder !== undefined ? { holder } : {}),
      ...(unmergedCommits !== undefined ? { unmerged_commits: unmergedCommits } : {}),
    };
    partition[bucket].push(entry);
  }

  const orphanBranches = new Set<string>();
  for (const session of sessions) {
    for (const branch of session.branches) {
      if (!worktreeBranches.has(branch)) orphanBranches.add(branch);
    }
  }
  // reason: discovery source (c), §Invariants — a git-known local branch that
  // is NEITHER a worktree's current branch NOR named by any session's claim
  // was, before this loop existed, invisible to both prior sources and
  // silently dropped. Folding it into the SAME `orphanBranches` set reuses
  // the identical classify+push loop below unchanged: its `relevant` filter
  // naturally comes back empty for a branch no session names, which
  // `classify` resolves to `unowned` with no special-casing needed here.
  // `Set.add` is idempotent, so a branch already added above (claimed) is
  // never duplicated.
  if (localBranches !== undefined) {
    for (const branch of localBranches) {
      if (!worktreeBranches.has(branch)) orphanBranches.add(branch);
    }
  }

  for (const branch of orphanBranches) {
    const relevant = sessions.filter((s) => s.branches.includes(branch));
    const { bucket, holder } = classify(relevant, currentSessionId);
    // reason: an orphan branch has no worktree of its own — the ONLY
    // candidate cwd is a borrowed one (see `anyKnownWorktreePath` above).
    const unmergedCommits = measureUnmergedCommits(branch, [anyKnownWorktreePath]);
    partition[bucket].push({
      kind: "branch",
      branch,
      bucket,
      ...(holder !== undefined ? { holder } : {}),
      ...(unmergedCommits !== undefined ? { unmerged_commits: unmergedCommits } : {}),
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
      // reason: the human view must not silently hide a fact `--json` carries
      // (CLAUDE.md's "human renders are lossy projections" lesson) — an
      // ABSENT count (never measured) prints nothing, never a fabricated "0".
      const unmergedNote = entry.unmerged_commits !== undefined ? ` [${entry.unmerged_commits} unmerged]` : "";
      lines.push(`  - ${target}${branchNote}${unmergedNote}${holderNote}`);
    }
  };

  renderBucket("Mine", partition.mine);
  renderBucket("Foreign", partition.foreign);
  renderBucket("Unowned", partition.unowned);
  renderBucket("Unmeasured", partition.unmeasured);

  return lines.join("\n");
}
