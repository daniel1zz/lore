/**
 * Pure validation + parent-inference for `lore create task` (SPEC-065 D4).
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
 * Public surface:
 *   - checkTaskCreateRequiredFlags / formatTaskCreateMissingFlagsError —
 *     single-pass missing-required-flag aggregation + its exit-2 message.
 *   - inferTaskParentId — `--parent` when explicitly passed, else the
 *     resolved `--plan-id` (the dominant shape — a task parented elsewhere
 *     passes `--parent` explicitly).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-065 D4, AC-065-5, AC-065-6
 */

/** Raw, unresolved `lore create task` flag values this module's checks consume. */
export interface TaskCreateFlags {
  /** `args["plan-id"]`, or `undefined`/empty-string when the flag was omitted. */
  planId: string | undefined;
  /** `args.parent`, or `undefined`/empty-string when the flag was omitted. */
  parent: string | undefined;
}

/**
 * Collects every missing required flag for `lore create task` in ONE pass.
 * `--plan-id` is ALWAYS required for `type: "task"`. `--parent` is required
 * ONLY when `--plan-id` is ALSO absent — a present `--plan-id` makes
 * `--parent` inferrable (see {@link inferTaskParentId}), so it is not
 * separately mandatory.
 *
 * @param flags - the caller's raw `--plan-id`/`--parent` values
 * @returns the missing flag names (`"--plan-id"`, `"--parent"`), `--plan-id`
 *   first when both are missing; empty array when nothing is missing
 */
export function checkTaskCreateRequiredFlags(flags: TaskCreateFlags): string[] {
  const missing: string[] = [];
  const hasPlanId = flags.planId !== undefined && flags.planId.trim() !== "";
  const hasParent = flags.parent !== undefined && flags.parent.trim() !== "";
  if (!hasPlanId) missing.push("--plan-id");
  if (!hasParent && !hasPlanId) missing.push("--parent");
  return missing;
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
