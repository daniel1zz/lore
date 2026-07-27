/**
 * Pure message formatting for `lore done`'s human-readable output
 * (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3).
 * Extracted from `commands/done.ts` for testability — that command transitively
 * imports `loader.ts` (`bun:sqlite`), unresolvable by vitest; this module imports
 * only the service's own `DoneResult` type (vitest-safe). Mirrors
 * `pending-render.ts`/`assess-render.ts`'s identical split, same reason
 * (`adapters/cli/CLAUDE.md`'s "Vitest-unsafe commands get a sibling *-render.ts
 * split" invariant).
 *
 * Public surface:
 *   - formatDoneMessage(result) — the ONE line `lore done` prints on success,
 *     covering both branches (idempotent no-op vs a real lifecycle walk)
 *
 * Side-effect class: pure.
 * Source: spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3
 */

import type { DoneResult } from "../../service/task-workflow-service.js";

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
  return `${slug} archived (v${result.task.version}): ${path}`;
}
