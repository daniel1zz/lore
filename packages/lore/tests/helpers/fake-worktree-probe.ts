/**
 * Test double for the REQUIRED git probe of `TaskWorkflowService` (spec-lore-done-closes-a-commitless-task-through-an-audited-no).
 *
 * Purpose: a service unit test has no repository, yet the service now demands a probe (no silent "no git" path). This fake
 * answers the two questions a claim asks about a named branch or worktree (its head) with one fixed sha, and answers every
 * other question with "not measurable". Its working directory does not exist, so the git facts built over it fail the way a
 * place that is not a repository does: corpus-only work stays unarmed, branch work stays `unmeasurable`.
 *
 * Public surface: {@link fakeWorktreeProbe}, {@link FAKE_HEAD_SHA}.
 * Side-effect class: pure.
 */

import type { ProbeResult, WorktreeGitProbe } from "../../src/service/worktree-cleanup.js";

/** The one head every named branch or worktree resolves to in a unit test. */
export const FAKE_HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

/** A directory that does not exist: git run there fails, so nothing is measurable from it. */
export const FAKE_REPO_DIR = "/nonexistent-lore-unit-test-repo";

const unmeasurable = <T>(what: string): ProbeResult<T> => ({ ok: false, reason: `${what}: no repository in a unit test` });

/**
 * @param overrides - per-test answers (for example a `branchTip` that reports a missing branch)
 * @returns a probe whose branch tip and head are {@link FAKE_HEAD_SHA}, no path exists, and everything else is unmeasurable
 * @example
 * new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, ..., fakeWorktreeProbe())
 */
export function fakeWorktreeProbe(overrides: Partial<WorktreeGitProbe> = {}): WorktreeGitProbe {
  const probe: WorktreeGitProbe = {
    pathExists: () => false,
    realPath: (path) => path,
    currentWorkingDirectory: () => FAKE_REPO_DIR,
    listWorktrees: () => unmeasurable("git worktree list"),
    isDirty: () => unmeasurable("git status"),
    countCommits: () => unmeasurable("git rev-list"),
    integrationBranch: () => unmeasurable("integration branch"),
    headSha: () => ({ ok: true, value: FAKE_HEAD_SHA }),
    branchTip: () => ({ ok: true, value: FAKE_HEAD_SHA }),
    removeWorktree: () => unmeasurable("git worktree remove"),
    deleteBranch: () => unmeasurable("git branch -d"),
    ignoredPaths: () => unmeasurable("git status --ignored"),
    scratchOwner: () => unmeasurable("scratch owner"),
    isPidAlive: () => false,
    removeScratchWorktree: () => unmeasurable("git worktree remove --force"),
  };
  return { ...probe, ...overrides };
}
