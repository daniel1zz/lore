/**
 * Pure validation + parent-inference for `lore create task` (SPEC-065 D4;
 * extended by SPEC-069 D2/D3/D4 for the ad-hoc task channel).
 * Extracted from `commands/create.ts` for testability — `commands/create.ts`
 * transitively imports `loader.ts` (`bun:sqlite`), which vitest cannot
 * resolve, but this module imports nothing beyond plain TypeScript. Mirrors
 * `handoff-input.ts`'s identical split (same reason).
 *
 * Fixes the P1-5 dogfood finding (guyin 2026-07-22): `lore create task`
 * used to report a missing `--plan-id` and a missing `--parent_id` (Zod's
 * `superRefine`) across TWO separate round trips — a caller supplying
 * neither flag had to run the command twice to discover both problems. It
 * also never inferred `--parent` from `--plan-id` even though the two are
 * almost always the same value.
 *
 * SPEC-069 P2-9 finding: ad-hoc bugs discovered mid-plan had no legitimate
 * lightweight task channel — `--plan-id`/`--parent` were UNCONDITIONALLY
 * required, so the least-resistance path was parking unrelated tasks on
 * whatever plan was open (which `lore assess` then correctly flagged as
 * scope drift). `--adhoc` gives that work a first-class, planless home;
 * `--linkage` is the opposite case — an EXPLAINED attachment to a real plan.
 *
 * Public surface:
 *   - checkTaskCreateRequiredFlags / formatTaskCreateMissingFlagsError —
 *     single-pass missing-required-flag aggregation + its exit-2 message.
 *     `--adhoc` (SPEC-069 D2) makes BOTH `--plan-id`/`--parent` optional.
 *   - checkTaskCreateAdhocConflicts / formatTaskCreateAdhocConflictError —
 *     `--adhoc` is mutually exclusive with `--plan-id`/`--phase` (a planless
 *     task can declare neither) and with `--linkage` (one says "no plan",
 *     the other justifies the plan chosen) — SPEC-069 D2/D3.
 *   - inferTaskParentId — `--parent` when explicitly passed, else the
 *     resolved `--plan-id` (the dominant shape — a task parented elsewhere
 *     passes `--parent` explicitly). Unaffected by `--adhoc`: an ad-hoc task
 *     always resolves to `undefined` here (both inputs are unset by
 *     definition) — `CorpusService._createImpl` performs the actual root-PRD
 *     parenting, since only the service layer can look up "the root PRD".
 *
 * Side-effect class: pure
 *
 * Source: SPEC-065 D4, AC-065-5, AC-065-6; SPEC-069 D2, D3, D4, AC-069-5, AC-069-6
 */

/** Raw, unresolved `lore create task` flag values this module's checks consume. */
export interface TaskCreateFlags {
  /** `args["plan-id"]`, or `undefined`/empty-string when the flag was omitted. */
  planId: string | undefined;
  /** `args.parent`, or `undefined`/empty-string when the flag was omitted. */
  parent: string | undefined;
  /**
   * `args.adhoc`, or `undefined` when the flag was omitted (SPEC-069 D2).
   * Marks this task as planless — relaxes BOTH `--plan-id`/`--parent`
   * required-flag checks, and conflicts with `--plan-id`/`--phase`/`--linkage`.
   * Additive/optional so every pre-SPEC-069 caller of this module (which only
   * ever supplied `planId`/`parent`) keeps compiling and behaving unchanged.
   */
  adhoc?: boolean | undefined;
  /**
   * `args.phase`, or `undefined`/empty-string when the flag was omitted.
   * Conflicts with `--adhoc` (SPEC-069 D2 — an ad-hoc task has no parent
   * plan, so a plan-declared phase name is meaningless).
   */
  phase?: string | undefined;
  /**
   * `args.linkage`, or `undefined`/empty-string when the flag was omitted.
   * Conflicts with `--adhoc` (SPEC-069 D3 — `--linkage` JUSTIFIES a CHOSEN
   * plan; `--adhoc` declares there is none to justify).
   */
  linkage?: string | undefined;
}

/**
 * Collects every missing required flag for `lore create task` in ONE pass.
 * `--plan-id` is ALWAYS required for `type: "task"` — UNLESS `--adhoc` is set
 * (SPEC-069 D2: an ad-hoc task is deliberately planless, so nothing is
 * "missing"). `--parent` is required ONLY when `--plan-id` is ALSO absent
 * (and `--adhoc` is not set) — a present `--plan-id` makes `--parent`
 * inferrable (see {@link inferTaskParentId}), so it is not separately
 * mandatory.
 *
 * @param flags - the caller's raw `--plan-id`/`--parent`/`--adhoc` values
 * @returns the missing flag names (`"--plan-id"`, `"--parent"`), `--plan-id`
 *   first when both are missing; empty array when nothing is missing OR
 *   `flags.adhoc === true`
 */
export function checkTaskCreateRequiredFlags(flags: TaskCreateFlags): string[] {
  if (flags.adhoc === true) return [];
  const missing: string[] = [];
  const hasPlanId = flags.planId !== undefined && flags.planId.trim() !== "";
  const hasParent = flags.parent !== undefined && flags.parent.trim() !== "";
  if (!hasPlanId) missing.push("--plan-id");
  if (!hasParent && !hasPlanId) missing.push("--parent");
  return missing;
}

/**
 * Collects every `--adhoc` mutual-exclusion conflict for `lore create task`
 * in ONE pass (SPEC-069 D2/D3/D4 — participates in the SAME single-pass
 * validation `checkTaskCreateRequiredFlags` established, AC-069-5). A
 * planless (`--adhoc`) task cannot ALSO declare `--plan-id` (nothing to be
 * planless about) or `--phase` (a plan-declared grouping with no plan to
 * belong to), and cannot ALSO declare `--linkage` (which justifies a CHOSEN
 * plan — `--adhoc` says there is none).
 *
 * @param flags - the caller's raw `--adhoc`/`--plan-id`/`--phase`/`--linkage` values
 * @returns the conflicting flag names present alongside `--adhoc`, in
 *   `--plan-id`, `--phase`, `--linkage` order; empty array when `--adhoc` is
 *   not set OR no conflicting flag was also passed
 */
export function checkTaskCreateAdhocConflicts(flags: TaskCreateFlags): string[] {
  if (flags.adhoc !== true) return [];
  const conflicts: string[] = [];
  const hasPlanId = flags.planId !== undefined && flags.planId.trim() !== "";
  const hasPhase = flags.phase !== undefined && flags.phase.trim() !== "";
  const hasLinkage = flags.linkage !== undefined && flags.linkage.trim() !== "";
  if (hasPlanId) conflicts.push("--plan-id");
  if (hasPhase) conflicts.push("--phase");
  if (hasLinkage) conflicts.push("--linkage");
  return conflicts;
}

/**
 * Formats {@link checkTaskCreateAdhocConflicts}'s result into the exit-2
 * error message `lore create task` prints (SPEC-069 D2/D3).
 *
 * @param conflicts - non-empty result of {@link checkTaskCreateAdhocConflicts}
 */
export function formatTaskCreateAdhocConflictError(conflicts: string[]): string {
  const lines = [
    `Error: --adhoc is mutually exclusive with: ${conflicts.join(", ")}.`,
    "  --adhoc creates a planless task (parented to the root PRD) — it cannot also declare",
    "  --plan-id or --phase (both plan-scoped), or --linkage (which JUSTIFIES a chosen plan;",
    "  --adhoc declares there is none).",
  ];
  return lines.join("\n");
}

/**
 * Formats {@link checkTaskCreateRequiredFlags}'s result into the single
 * exit-2 error message `lore create task` prints — AC-065-6 requires BOTH
 * missing flags named in ONE message when neither was passed, not the
 * pre-D4 two-round-trip discovery.
 *
 * @param missing - non-empty result of {@link checkTaskCreateRequiredFlags}
 */
export function formatTaskCreateMissingFlagsError(missing: string[]): string {
  const lines = [
    `Error: type 'task' is missing required flag(s): ${missing.join(", ")}.`,
    "  --plan-id <plan-id-or-slug> is always required for type 'task'.",
  ];
  if (missing.includes("--parent")) {
    lines.push(
      "  --parent <id-or-slug> is required because --plan-id is also missing — with " +
        "--plan-id present, --parent would default to it.",
    );
  }
  return lines.join("\n");
}

/**
 * Resolves a task's `parent_id` per D4's inference rule: an explicit
 * `--parent` always wins; an omitted `--parent` defaults to the
 * (already-resolved) `--plan-id` — the dominant shape, since a task parented
 * somewhere OTHER than its own plan passes `--parent` explicitly.
 *
 * @param rawParent - `args.parent`, unresolved id-or-slug, or `undefined`
 * @param resolvedPlanId - the `--plan-id` value AFTER `resolveDoc`
 *   resolution (a canonical ULID), or `undefined` when `--plan-id` was
 *   omitted — callers for non-task doc types always pass `undefined` here,
 *   which makes this fn transparently return `rawParent` unchanged for them
 * @returns the value to place in `CreateDocInput.parent_id`, or `undefined`
 *   when neither is available
 */
export function inferTaskParentId(
  rawParent: string | undefined,
  resolvedPlanId: string | undefined,
): string | undefined {
  if (rawParent !== undefined) return rawParent;
  return resolvedPlanId;
}
