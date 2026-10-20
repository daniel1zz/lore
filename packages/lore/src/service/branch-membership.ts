/**
 * branch-membership — the shared, store-less rules for "which tasks belong to a branch" (BR-1348), used by the landing
 * record (`TaskWorkflowService.recordLanding`) and by the own-diff judgment at `lore integrate`
 * (`own-diff-judgment.ts`), so the two can never disagree about whom a landing belongs to.
 *
 * Public surface: {@link claimedNamesOf}, {@link planIntegrationBranches}, {@link isTaskOfIntegrationBranch}.
 * Side-effect class: pure (no IO, no store). A task belongs to a branch when one of its claims, current or historical,
 * recorded the branch (or a working copy on it; the caller adds the branch a recorded worktree PATH is on), or when the
 * task is a member of a plan whose declared integration branch (`plan.extra.integration_branch`, written by
 * `lore plan integration-branch`) is the branch.
 */
import { readClaimRecord, type AuditEntry, type DocRecord } from "@lore/core";
import { isPlanMember } from "./plan-membership.js";

/**
 * Names `task`'s claims recorded: every claim audit row's `worktree` (a branch NAME under the dispatch protocol, else a
 * path) and `branch` (auto-captured), plus the current claim's.
 *
 * @param auditRows - claim audit rows (any task's; rows of other tasks are ignored when `task.id` differs).
 * @param task - the task.
 */
export function claimedNamesOf(auditRows: readonly AuditEntry[], task: DocRecord): string[] {
  const names = new Set<string>();
  for (const row of auditRows) {
    if (row.doc_id !== undefined && row.doc_id !== task.id) continue;
    for (const key of ["worktree", "branch"] as const) {
      const value = row.details?.[key];
      if (typeof value === "string" && value.trim() !== "") names.add(value);
    }
  }
  const current = readClaimRecord(task);
  if (current?.worktree !== undefined) names.add(current.worktree);
  if (current?.branch !== undefined) names.add(current.branch);
  return [...names];
}

/** Plan id -> the integration branch the plan declares (plans declaring none are absent). */
export function planIntegrationBranches(plans: readonly DocRecord[]): ReadonlyMap<string, string> {
  const branches = new Map<string, string>();
  for (const plan of plans) {
    const declared = plan.extra?.["integration_branch"];
    if (typeof declared === "string" && declared !== "") branches.set(plan.id, declared);
  }
  return branches;
}

/** Whether `task` is a member of a plan whose declared integration branch is `branch`. */
export function isTaskOfIntegrationBranch(task: DocRecord, integrationBranches: ReadonlyMap<string, string>, branch: string): boolean {
  for (const [planId, declared] of integrationBranches) {
    if (declared === branch && isPlanMember(task, planId)) return true;
  }
  return false;
}
