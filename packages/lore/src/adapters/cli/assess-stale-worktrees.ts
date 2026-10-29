/**
 * Removal of stale throwaway worktrees left by killed assess runs.
 *
 * Purpose: a suite run that is killed (timeout, Ctrl-C, crash) never reaches its cleanup and leaves a registered
 *   `lore-assess-suite-*` worktree behind (four were found after the 2026-10-29 runs); every run now clears the ones
 *   no live process owns before it makes its own (BR-1497).
 * Public surface: pruneStaleAssessWorktrees, ASSESS_WORKTREE_PREFIX, assessWorktreeDirPrefix, ownerPidOfAssessWorktree,
 *   StaleWorktreePorts.
 * Invariants:
 *   - Ownership is recorded IN THE DIRECTORY NAME at creation (`lore-assess-suite-<pid>-XXXXXX`, one atomic `mkdtemp`),
 *     so there is no window in which a live run's worktree has no recorded owner.
 *   - Stale = registered with git AND (its directory is gone, or its owner pid is not alive, or it records no owner and
 *     is older than {@link LEGACY_MAX_AGE_MS}, the longest a run of the pre-pid-name versions can last).
 *   - A worktree whose owner pid is alive is NEVER removed, whatever its age (a live process owns it).
 *   - Only worktrees whose directory name starts with {@link ASSESS_WORKTREE_PREFIX} are considered; every other registered worktree is untouched.
 *   - Removal is `rm -r` of the directory then `git worktree prune`; a failure of either is returned, never ignored.
 * Side-effect class: IO (runs `git worktree list` / `git worktree prune`, removes directories) through {@link StaleWorktreePorts}.
 *
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (BR-1497)
 */

import { basename } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";

/** Directory-name prefix of every throwaway assess worktree. */
export const ASSESS_WORKTREE_PREFIX = "lore-assess-suite-";

/** A run of a version that recorded no owner pid lasted at most this long (suite timeout 1 h, two commands, install). */
export const LEGACY_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** The `mkdtemp` prefix for a worktree owned by process `pid`. */
export function assessWorktreeDirPrefix(pid: number): string {
  return `${ASSESS_WORKTREE_PREFIX}${String(pid)}-`;
}

/** The owner pid recorded in a worktree directory's name, or `undefined` for a legacy name without one. */
export function ownerPidOfAssessWorktree(path: string): number | undefined {
  const match = new RegExp(`^${ASSESS_WORKTREE_PREFIX}(\\d+)-`).exec(basename(path));
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The effects the pruner needs; `assess-suite-runner.ts` binds the real ones, tests bind fakes. */
export interface StaleWorktreePorts {
  /** Absolute paths of every worktree git has registered for the repository. */
  readonly listRegisteredWorktrees: () => Promise<Result<readonly string[], LoreError>>;
  /** Whether the directory still exists. */
  readonly directoryExists: (path: string) => boolean;
  /** Age of the directory in ms, or `undefined` when it cannot be read. */
  readonly directoryAgeMs: (path: string) => number | undefined;
  /** Whether a process with this pid is alive (EPERM counts as alive). */
  readonly isProcessAlive: (pid: number) => boolean;
  /** Removes the directory recursively. */
  readonly removeDirectory: (path: string) => void;
  /** `git worktree prune`. */
  readonly pruneRegistrations: () => Promise<Result<void, LoreError>>;
}

/**
 * Removes the stale assess worktrees and prunes git's registrations.
 *
 * @param ports - git, filesystem and process-liveness effects
 * @returns the paths removed (or whose registration was pruned); `err` when listing, removing or pruning failed
 */
export async function pruneStaleAssessWorktrees(ports: StaleWorktreePorts): Promise<Result<readonly string[], LoreError>> {
  const listed = await ports.listRegisteredWorktrees();
  if (!listed.ok) return listed;
  const removed: string[] = [];
  for (const path of listed.value) {
    if (!basename(path).startsWith(ASSESS_WORKTREE_PREFIX)) continue;
    const owner = ownerPidOfAssessWorktree(path);
    const exists = ports.directoryExists(path);
    if (exists && owner !== undefined && ports.isProcessAlive(owner)) continue;
    if (exists && owner === undefined) {
      const age = ports.directoryAgeMs(path);
      // reason: a legacy-named worktree whose age cannot be read is kept (fail safe): a live run is worse to destroy than a leftover is to keep.
      if (age === undefined || age <= LEGACY_MAX_AGE_MS) continue;
    }
    if (exists) {
      try {
        ports.removeDirectory(path);
      } catch (cause) {
        return err({ code: "STORE_ERROR", message: `could not remove the stale throwaway worktree ${path}: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
    }
    removed.push(path);
  }
  if (removed.length > 0) {
    const pruned = await ports.pruneRegistrations();
    if (!pruned.ok) return pruned;
  }
  return ok(removed);
}
