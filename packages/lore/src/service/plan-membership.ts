/**
 * Plan-membership predicate — the SHARED, single-source rule for "does this
 * task belong to this plan", consumed by every plan-scoped task query in
 * `AcService`, `CorpusService`, `VerificationProjectionService`,
 * `PhaseService`, `OutlineService`, `SessionService`,
 * `PhaseMigrationService`, `TaskWorkflowService`, and `PhaseWorkflowService`
 * — NINE modules, zero private copies.
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
 * SSOT note — this file holds the codebase's ONLY definition of the
 * predicate: `grep -rl 'function isPlanMember' packages/lore/src/` prints
 * exactly this path, and nothing else. It did not always. Until
 * task-three-byte-identical-copies-of-isplanmember-survive,
 * `TaskWorkflowService` and `PhaseWorkflowService` each carried a private,
 * byte-identical one-line duplicate, and the reason recorded HERE for leaving
 * them alone was factually WRONG: it claimed this file's module boundary
 * (`service/CLAUDE.md`: "Service per concern, no cross-service imports")
 * stopped those two services from importing this module. It does not.
 * `plan-membership.ts` is **not a service** — no store dependency, no class,
 * no service surface, no `Result`-returning method — it is a pure predicate
 * module, exactly the shared infrastructure that pattern exists to permit.
 * The disproof was already in the tree when the claim was written: SIX modules
 * imported this one and violated no boundary (seven by the time it was
 * retired). Importing `./plan-membership.js` from a workflow service is
 * therefore the SAME import those seven already make, not a cross-service
 * import. All three copies are now consolidated onto this file.
 *
 * fence: do NOT re-derive that retired blocker. The "no cross-service
 * imports" pattern scopes SERVICES — store-holding classes composed in
 * `app.ts` — and this module is neither. Nor is "the consumer isn't anchored
 * to this module's originating task"
 * (task-eight-more-plan-member-queries-still-key-on-parent-id) a reason for a
 * copy to exist: that was a scoping fact about ONE past slice, not a property
 * of the code. Re-adding a private copy anywhere under `packages/lore/src/`
 * is a regression pinned by
 * `tests/unit/service/isplanmember-single-definition.test.ts`; to justify one,
 * you would first have to show this module IS a service.
 *
 * Proxy / Silence / Opt-in review
 * (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the):
 * - **Proxy** — closes. `parent_id` is the proxy; `extra.plan_id` is the
 *   property this function reads directly. No input satisfies
 *   `extra.plan_id === planId` while the task is not a member of `planId`,
 *   because membership is DEFINED by that field — mirrors the parent fix's
 *   own Q1 answer verbatim (task-plan-membership-is-extra-plan-id-but-the-
 *   last-task).
 *   Stated RESIDUAL on the SSOT note above: `function isPlanMember` counts
 *   DEFINITION SITES, so an arrow-const or differently-named inline
 *   `t.extra["plan_id"] === planId` would satisfy the count while violating
 *   the property. That residual is closed by a SHIPPED, EXECUTABLE oracle:
 *   `bun run check:plan-member-sites` (`scripts/check-plan-membership-sites.ts`)
 *   walks `packages/**` + `scripts/**` and reports three rules — a second
 *   predicate definition in ANY form (R1), a raw `extra.plan_id` comparison
 *   outside this module (R2), and a plan-scoped resolution keyed on the
 *   `parent_id` proxy (R3) — exiting 3 on any hit and 4, never 0, when it
 *   cannot measure what it claims. Its test
 *   (`scripts/tests/check-plan-membership-sites.test.ts`) asserts the real
 *   tree's open set equals an EXACT ledger, so a NEW site fails by
 *   construction instead of waiting for the next reader's attention; that
 *   ledger is empty as of 2026-08-03. `export-docs-service.ts`'s `typeof
 *   doc.extra["plan_id"] === "string"` is an R2 ALLOWLIST entry, not an open
 *   site — adjudicated NOT a membership test and it must stay as it is: it has
 *   no `planId` to compare against, it narrows a task's declared plan id to a
 *   string so it can be used as an `index.mappings` key, and routing it
 *   through this predicate would be a type error, not a de-duplication.
 *   Machine-visibility residual (documented, deliberately NOT widened): R3
 *   matches a COMPARISON, so a plan scope written as
 *   `activePlanIds.has(task.parent_id)` stays invisible to it. Admitting the
 *   `.has()` shape was measured and REJECTED while the guard was built — it
 *   flags legitimate `knowledge`/handoff groupings whose plan link genuinely IS
 *   `parent_id`, and because allowlisting is BY FILE the exemption would blind
 *   R3 to real violations inside that same file. `bootstrap`'s `active_sessions`
 *   derivation was exactly such an invisible site until
 *   task-the-eleventh-plan-member-site-found-by-enumeration converted it; the
 *   comparison-shaped sibling site in the same function is the one the oracle
 *   caught.
 * - **Silence** — N/A at this layer. This predicate has no failure mode of
 *   its own (a pure boolean read of one field, never empty/error) — whether
 *   an empty resulting member set needs a distinct "disagreement" signal is
 *   a per-CALLER decision (see each call site's own JSDoc), not something
 *   this shared predicate can decide on their behalf.
 * - **Opt-in** — none. Every call site in the nine modules above invokes this
 *   unconditionally; there is no flag, config key, or env var gating it.
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
