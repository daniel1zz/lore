/**
 * The document lifecycle transition graph (SPEC-002 §3): the ONE authority on status moves, and on which
 * statuses are terminal (no outgoing transition).
 *
 * Public surface: `VALID_TRANSITIONS`, `isValidTransition`, `getAllowedTransitions`, `isTerminalStatus`
 *   (the first three are re-exported by `schemas.ts`, which also owns the reopen and contract-edit rules).
 * Invariants: pure; imports types only. Leaf module ON PURPOSE: `schemas.ts` imports `task-workflow.ts`
 *   values at load time, so `task-workflow.ts` can only reach this graph through a module that imports neither.
 * Side-effect class: pure.
 */

import type { DocStatus, DocType } from "./types.js";

// ─── Lifecycle Transition Graph ────────────────────────────────────────────

/**
 * Valid status transitions per SPEC-002 §3 diagram.
 * Key: from-status, Value: set of allowed to-statuses.
 */
export const VALID_TRANSITIONS: Readonly<Record<DocStatus, ReadonlySet<DocStatus>>> = {
  // reason: draft -> deprecated lets a never-approved doc of ANY type be abandoned (BR-1366, spec-lean-governance-batch-
  // verbs-judgment-only-at-milestones AC-LG-3); archived and deprecated stay terminal, so archived -> deprecated is
  // still INVALID_TRANSITION.
  draft: new Set<DocStatus>(["in-review", "approved", "deprecated"]),
  "in-review": new Set<DocStatus>(["approved", "draft"]),
  approved: new Set<DocStatus>(["active", "archived", "deprecated"]),
  active: new Set<DocStatus>(["archived", "deprecated"]),
  archived: new Set<DocStatus>([]),
  deprecated: new Set<DocStatus>([]),
};

/**
 * Doc types allowed the `draft -> archived` edge (SPEC-002's base graph has
 * NO such edge — the pre-existing "B1 blocker fix" deliberately keeps a
 * PRD/spec/adr/plan from skipping every workflow gate by jumping straight
 * from `draft` to terminal). Added deliberately, NARROWLY, per
 * spec-lifecycle-archival-plan-close-cascade-deterministic §Design Decisions
 * D3: the lifecycle-archival cascade/sweep (`lore archive --apply`, the
 * plan-close cascade) archives `task`/`knowledge` docs that are almost
 * always still `draft` (tasks default to draft at creation; handoffs are
 * ALWAYS draft, `session-service.ts::writeHandoff`) once their owning plan
 * closes or they go stale. A fake intermediate status (e.g. forcing
 * `approved` first) was explicitly rejected by the governing spec in favor
 * of this direct, TYPE-SCOPED edge — never a blanket widening of
 * `VALID_TRANSITIONS` itself, which would silently reopen the B1 gap for
 * every other doc type.
 */
const DRAFT_TO_ARCHIVED_ALLOWED_TYPES: ReadonlySet<DocType> = new Set<DocType>(["task", "knowledge"]);

/**
 * Returns true if transitioning from -> to is a valid lifecycle step.
 *
 * @param docType - OPTIONAL. When supplied and `from === "draft" && to ===
 *   "archived"`, additionally checks {@link DRAFT_TO_ARCHIVED_ALLOWED_TYPES}
 *   — legal for `task`/`knowledge`, illegal for every other type (same as
 *   omitting `docType` entirely, which preserves the pre-existing strict
 *   behavior for every caller that has no type in scope).
 * Source: SPEC-002 §3; spec-lifecycle-archival-plan-close-cascade-deterministic §Design Decisions D3.
 */
export function isValidTransition(from: DocStatus, to: DocStatus, docType?: DocType): boolean {
  if (VALID_TRANSITIONS[from].has(to)) return true;
  return (
    from === "draft" &&
    to === "archived" &&
    docType !== undefined &&
    DRAFT_TO_ARCHIVED_ALLOWED_TYPES.has(docType)
  );
}

/**
 * Returns the set of statuses reachable from `from`.
 *
 * @param docType - OPTIONAL, same widening rule as {@link isValidTransition}
 *   — when supplied and type-eligible, `"archived"` is included for a
 *   `draft` source even though the base {@link VALID_TRANSITIONS} graph
 *   omits it.
 */
export function getAllowedTransitions(from: DocStatus, docType?: DocType): DocStatus[] {
  const base = [...VALID_TRANSITIONS[from]];
  if (
    from === "draft" &&
    docType !== undefined &&
    DRAFT_TO_ARCHIVED_ALLOWED_TYPES.has(docType) &&
    !base.includes("archived")
  ) {
    return [...base, "archived"];
  }
  return base;
}

/**
 * Whether `status` has no outgoing transition for `docType` (e.g. `archived`, `deprecated`) — the ONE
 * definition of "terminal", shared by the claim predicate and the dashboard badge.
 *
 * @example
 * isTerminalStatus("archived", "task"); // => true
 */
export function isTerminalStatus(status: DocStatus, docType?: DocType): boolean {
  return getAllowedTransitions(status, docType).length === 0;
}
