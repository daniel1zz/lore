/**
 * The ONE definition of "this task holds a claim": its status is not terminal AND it carries a valid
 * `extra.claim`. Terminal = no outgoing transition in the lifecycle graph (`getAllowedTransitions`, the same
 * authority the dashboard badge uses). A terminal task's stored `extra.claim` stays as history; it is simply
 * not a held claim, so archived rows need no migration and no backstop.
 *
 * Public surface: {@link isTerminalStatus}, {@link extractHeldClaim}.
 * Invariants: pure (no IO, no clock). Lives in its own file because `schemas.ts` already imports
 *   `task-workflow.ts`'s values, so `task-workflow.ts` cannot import `schemas.ts` without a load-order cycle.
 * Side-effect class: pure.
 * Source: task-skill-fix-a-terminal-task-holds-no-claim-by-definition; SPEC-042 D5, BR-1040.
 */

import { getAllowedTransitions } from "./schemas.js";
import { extractClaim } from "./task-workflow.js";
import type { TaskClaim } from "./task-workflow.js";
import type { DocRecord, DocStatus, DocType } from "./types.js";

/**
 * Whether `status` has no outgoing transition for `docType` (e.g. `archived`, `deprecated`).
 *
 * @example
 * isTerminalStatus("archived", "task"); // => true
 */
export function isTerminalStatus(status: DocStatus, docType?: DocType): boolean {
  return getAllowedTransitions(status, docType).length === 0;
}

/**
 * The claim `task` HOLDS, or `undefined`: a terminal task holds none even if `extra.claim` is still stored.
 * Every reader of sibling claims (gate context, run-end selection, readiness advisories) goes through this.
 *
 * @example
 * extractHeldClaim({ status: "archived", type: "task", extra: { claim: { by: "a", at: "…" } } } as DocRecord); // => undefined
 */
export function extractHeldClaim(task: DocRecord): TaskClaim | undefined {
  if (isTerminalStatus(task.status, task.type)) return undefined;
  return extractClaim(task);
}
