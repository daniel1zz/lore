/**
 * Plan-membership predicate — the SHARED, single-source rule for "does this
 * task belong to this plan", consumed by every plan-scoped task query in
 * `AcService`, `CorpusService`, `VerificationProjectionService`,
 * `PhaseService`, `OutlineService`, and `SessionService`.
 *
 * `extra.plan_id` IS plan membership — the DECLARED property, mandatory for
 * every non-adhoc task (`createDocInputSchema`'s task branch, `@lore/core`)
 * and written by `--plan-id`. `parent_id` is a PROXY a task's `--parent` may
 * deliberately diverge from: `lore create task --plan-id P --parent Q` (P !==
 * Q) is a SUPPORTED shape (`adapters/cli/commands/create.ts`, SPEC-065 D4 —
 * "a task parented somewhere OTHER than its own plan passes --parent
 * explicitly"; `--parent` merely DEFAULTS to `--plan-id`). A plan-scoped query
 * keyed on `parent_id` alone therefore silently drops a diverged member from
 * ITS OWN plan and attributes it to whatever plan it happens to be filed
 * under instead
 * (task-plan-membership-is-extra-plan-id-but-the-last-task,
 * task-eight-more-plan-member-queries-still-key-on-parent-id).
 *
 * SSOT note — this is NOT the only copy in the codebase: `TaskWorkflowService`
 * and `PhaseWorkflowService` each carry their OWN private, byte-identical
 * one-line predicate (`task-workflow-service.ts`, `phase-workflow-service.ts`)
 * predating this module. This module does not replace those — this file's
 * module boundary (`service/CLAUDE.md`: "Service per concern, no
 * cross-service imports") forbids either this module or those two services
 * importing each other's private symbols, and neither of those two files is
 * anchored to the task that created this module
 * (task-eight-more-plan-member-queries-still-key-on-parent-id), so a
 * three-copies-into-one consolidation is a NAMED FOLLOW-UP, not resolved
 * here. This module exists so the SIX services above share exactly ONE copy
 * between themselves rather than each re-implementing the one-line rule
 * independently (eight independent copies is how the next divergence hides).
 *
 * Proxy / Silence / Opt-in review
 * (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the):
 * - **Proxy** — closes. `parent_id` is the proxy; `extra.plan_id` is the
 *   property this function reads directly. No input satisfies
 *   `extra.plan_id === planId` while the task is not a member of `planId`,
 *   because membership is DEFINED by that field — mirrors the parent fix's
 *   own Q1 answer verbatim (task-plan-membership-is-extra-plan-id-but-the-
 *   last-task).
 * - **Silence** — N/A at this layer. This predicate has no failure mode of
 *   its own (a pure boolean read of one field, never empty/error) — whether
 *   an empty resulting member set needs a distinct "disagreement" signal is
 *   a per-CALLER decision (see each call site's own JSDoc), not something
 *   this shared predicate can decide on their behalf.
 * - **Opt-in** — none. Every call site in the six services above invokes
 *   this unconditionally.
 *
 * Side-effect class: pure (no IO, no store dependency).
 */

import type { DocId, DocRecord } from "@lore/core";

/**
 * @param task - Candidate document. Callers are expected to have already
 *   narrowed to `type === "task"` (this function does not check `type`
 *   itself — a non-task doc's `extra.plan_id` is simply whatever it is).
 * @param planId - The plan's `DocId` membership is being tested against.
 * @returns `true` iff `task.extra.plan_id === planId`.
 * @example
 * isPlanMember(task, plan.id); // => true when task.extra.plan_id === plan.id,
 * // REGARDLESS of task.parent_id.
 */
export function isPlanMember(task: DocRecord, planId: DocId): boolean {
  return task.extra["plan_id"] === planId;
}
