/**
 * Pure message formatting for `lore done`'s human-readable output
 * (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3).
 * Extracted from `commands/done.ts` for testability — that command transitively
 * imports `loader.ts` (`bun:sqlite`), unresolvable by vitest; this module imports
 * only the service's own `DoneResult` type (vitest-safe). Mirrors
 * `pending-render.ts`/`status-stamp-verdict.ts`'s identical split, same reason
 * (`adapters/cli/CLAUDE.md`'s "Vitest-unsafe commands get a sibling *-render.ts
 * split" invariant).
 *
 * Public surface:
 *   - formatDoneMessage(result) — the ONE line `lore done` prints on success,
 *     covering both branches (idempotent no-op vs a real lifecycle walk)
 *   - formatLastTaskAdvisory(result) — the stderr advisory `lore done` prints
 *     when `result.plan_now_fully_terminal` is present (spec-plan-closure-must-
 *     be-loud-terminality-divergence-silent DD-2, AC-CLOSURE-3)
 *
 * Side-effect class: pure.
 * Source: spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3;
 *   spec-plan-closure-must-be-loud-terminality-divergence-silent DD-2, AC-CLOSURE-3
 */

import type { DoneResult } from "../../service/task-workflow-service.js";
import { formatWorktreeOutcomeLine } from "../../service/worktree-cleanup.js";

/**
 * Renders `lore done`'s success message — one branch per {@link DoneResult}
 * discriminant (`already_done`).
 *
 * @param result - The service call's successful `DoneResult`
 * @returns `"<slug> is already <status> (no-op — lore done is idempotent)"` when
 *   `already_done` is `true` (the current TERMINAL status is named, never a stale
 *   "archived" assumption — a task can also terminate at `"deprecated"`), or
 *   `"<slug> archived (v<version>): <status> -> <status> -> ... -> archived"` listing
 *   every lifecycle step {@link DoneResult.transitions} recorded, in order
 */
export function formatDoneMessage(result: DoneResult): string {
  const slug = result.task.slug;
  if (result.already_done) {
    return `${slug} is already ${result.task.status} (no-op — lore done is idempotent)`;
  }
  const path = result.transitions.join(" -> ");
  const archived = `${slug} archived (v${result.task.version}): ${path}`;
  // issue #106: one `worktree: ...` line per claim-recorded worktree (removed / kept <reason> / not-measured).
  const worktreeLines = (result.worktree_outcomes ?? []).map(formatWorktreeOutcomeLine);
  // task-done-floor-accepts-an-anchored-test-file-the-task-deleted: a test file accepted WITHOUT a run says so.
  const removedLines = (result.removed_test_anchors ?? []).map((path) => `test file ${path}: removed by this task (no run needed)`);
  // a declared ac_scope id satisfied by supersession (D15) says so, naming the superseding criterion.
  const supersededLines = (result.superseded_scope ?? []).map(
    (entry) =>
      `ac_scope ${entry.ac_id}: satisfied by supersession (superseded by ${entry.superseded_by.spec}:${entry.superseded_by.ac}: ${entry.superseded_by.reason})`,
  );
  return [archived, ...supersededLines, ...removedLines, ...worktreeLines].join("\n");
}

/**
 * Renders `lore done`'s DD-2 last-task advisory (spec-plan-closure-must-be-loud-
 * terminality-divergence-silent, AC-CLOSURE-3) — printed to STDERR by
 * `commands/done.ts` with a `⚠` prefix (same precedent as `utils.ts::
 * resolveActorWithIdentitySource`'s actor-fallback advisory), but WITHOUT that
 * precedent's once-per-process guard: this fires per plan completion, which is
 * rare by construction (at most once per plan, ever).
 *
 * @param result - The service call's successful `DoneResult`
 * @returns A string naming the plan slug and the literal next command
 *   (`lore set <plan> --status archived`) when `result.plan_now_fully_terminal`
 *   is present; `undefined` otherwise (non-last task, adhoc/planless task, or a
 *   plan that is already terminal — see `TaskWorkflowService.
 *   computePlanNowFullyTerminal`'s own JSDoc for the full undefined-case list)
 */
export function formatLastTaskAdvisory(result: DoneResult): string | undefined {
  const fact = result.plan_now_fully_terminal;
  if (fact === undefined) return undefined;
  if (fact.empty_phases !== undefined && fact.empty_phases.length > 0) {
    // reason: F8 (AC-CRIT-11) — the plan-close gate refuses a plan with an empty declared
    // phase, so NO archive command is printed here; name how to close the gap (BR-211).
    const phases = fact.empty_phases;
    const removals = phases.map((phase) => `lore phase rm ${fact.plan_slug} ${phase}`).join(" ; ");
    return (
      `⚠ "${fact.plan_slug}" has no more non-terminal tasks, but declares empty phase(s): ` +
      `${phases.join(", ")}. The plan cannot be closed yet — remove each empty phase (${removals}) ` +
      `or add a task to it, then close the plan.`
    );
  }
  return (
    `⚠ "${fact.plan_slug}" has no more non-terminal tasks — every child task is now ` +
    `archived/deprecated. The plan itself is still open; the plan-close gate will ` +
    `evaluate it once you run: lore set ${fact.plan_slug} --status archived`
  );
}
