/**
 * Structured acceptance criteria — AC-as-code schema + oracle binding.
 * Pure, browser-safe module: no IO, no Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - AC_VERIFY_MODES / AcVerifyMode — the three verify-union discriminants
 *   - SCRIPT_ORACLES / ScriptOracle — oracle kinds usable when verify.mode === "script"
 *   - acceptanceCriterionSchema / AcceptanceCriterion — one AC declaration
 *   - specAcceptanceCriteriaSchema — spec.extra.acceptance_criteria array (max 50, unique id)
 *   - computeAcCoverage(criteria, tasks) — pure pass/fail aggregation over tasks' evidence
 *   - AcCoverageFact / EvidenceRefLite — computeAcCoverage's output row shapes
 *
 * Invariants:
 *   - `id` format is `^AC-[A-Z0-9]+(-[A-Z0-9]+)*$` — matches every corpus-observed
 *     format (AC-33-1, AC-ASSESS-10, AC-AUDIT-ACTOR, AC-EXPORT-COLLISION-1).
 *   - specAcceptanceCriteriaSchema enforces unique `id` across the array via
 *     superRefine (Zod has no built-in array-uniqueness validator) — same pattern
 *     as `planExtraSchema`'s `phases[].name` uniqueness check in schemas.ts.
 *   - computeAcCoverage never mutates its inputs and performs no presentation
 *     pre-aggregation (badges, text rendering) — that is each consumer's job (D6).
 *     An `ac_ref` on an evidence entry that names an id absent from `criteria` is
 *     silently excluded from every AcCoverageFact (cross-entity validation that an
 *     ac_ref points at a *declared* id is T3's job — TaskWorkflowService.addEvidence
 *     — not this pure aggregator's).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-038 §3 (schema), §7 D1-D3, D6
 */

import { z } from "zod";
import type { DocRecord } from "./types.js";
import { extractEvidence, type OracleKind } from "./task-workflow.js";

// ─── Verify Modes ──────────────────────────────────────────────────────────

/** The three ways an acceptance criterion's verification can be declared. */
export const AC_VERIFY_MODES = ["script", "ai", "human"] as const;

/** Derived TypeScript union for an acceptance criterion's `verify.mode`. */
export type AcVerifyMode = (typeof AC_VERIFY_MODES)[number];

/**
 * Oracle kinds usable when `verify.mode === "script"` — every {@link OracleKind}
 * (task-workflow.ts SSOT) except `"manual"`, since a script-mode AC is by
 * definition not a manual oracle.
 *
 * @invariant Explicit literal tuple (not derived via `.filter()`), paired with the
 *   type-level exhaustiveness assertion below: adding a new kind to `ORACLE_KINDS`
 *   (task-workflow.ts) without deciding whether it belongs here fails
 *   `bun run typecheck` — a compile-time forcing function, not a runtime check
 *   (SPEC-038 §7 D3).
 */
export const SCRIPT_ORACLES = ["tsc", "test", "lint", "build", "e2e", "other"] as const;

/** Derived TypeScript union for `verify.oracle` in script mode. */
export type ScriptOracle = (typeof SCRIPT_ORACLES)[number];

/**
 * Type-level exhaustiveness gate: {@link OracleKind} must equal exactly
 * `SCRIPT_ORACLES ∪ {"manual"}`. If a new oracle kind is ever added to
 * `ORACLE_KINDS` without a matching update here, `OracleKind` is no longer
 * assignable to the target union, `_ScriptOraclesCoverAllButManual` collapses to
 * `never`, and the assignment on the next line fails to typecheck.
 */
type _ScriptOraclesCoverAllButManual = [OracleKind] extends [ScriptOracle | "manual"]
  ? true
  : never;
// reason: type-only exhaustiveness assertion (SPEC-038 §7 D3) — this binding is
// never read at runtime; its sole purpose is to fail `tsc` when the two enums
// drift apart. Do not remove as "unused".
const _scriptOraclesCoverAllButManual: _ScriptOraclesCoverAllButManual = true;
void _scriptOraclesCoverAllButManual;

// ─── Acceptance Criterion Schema ───────────────────────────────────────────

/**
 * One structured acceptance criterion declared on a spec.
 *
 * @example
 * acceptanceCriterionSchema.parse({
 *   id: "AC-ACODE-1",
 *   statement: "acceptanceCriterionSchema rejects malformed input",
 *   verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/core" },
 * });
 */
export const acceptanceCriterionSchema = z.object({
  id: z.string().regex(
    /^AC-[A-Z0-9]+(-[A-Z0-9]+)*$/,
    "AC id must match AC-<SEGMENT>(-<SEGMENT>)*, e.g. AC-ACODE-1",
  ),
  statement: z.string().min(1).max(2000),
  verify: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("script"),
      oracle: z.enum(SCRIPT_ORACLES),
      command: z.string().min(1).max(1000),
    }),
    z.object({
      mode: z.literal("ai"),
      rubric: z.string().min(1).max(2000),
    }),
    z.object({
      mode: z.literal("human"),
      note: z.string().max(500).optional(),
    }),
  ]),
});

/** Derived TypeScript type for one acceptance criterion declaration. */
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

/**
 * `spec.extra.acceptance_criteria` — an array of {@link AcceptanceCriterion}, capped
 * at 50 entries, with `id` uniqueness enforced across the array.
 *
 * @invariant Uniqueness cannot be expressed as a plain Zod array shape — same
 *   superRefine pattern as `planExtraSchema`'s `phases[].name` check (schemas.ts).
 */
export const specAcceptanceCriteriaSchema = z
  .array(acceptanceCriterionSchema)
  .max(50)
  .superRefine((criteria, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < criteria.length; i++) {
      const entry = criteria[i];
      if (!entry) continue;
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "acceptance_criteria[].id must be unique",
          path: [i, "id"],
        });
      }
      seen.add(entry.id);
    }
  });

// ─── AC Coverage ────────────────────────────────────────────────────────────

/** One evidence reference contributing to an {@link AcCoverageFact}. */
export interface EvidenceRefLite {
  task_id: string;
  result: "pass" | "fail";
}

/**
 * Pure pass/fail coverage facts for one declared acceptance criterion, aggregated
 * over a set of tasks' `verification_evidence[].ac_ref`. No presentation
 * pre-aggregation (badges, checkmarks) — renderers live with each consumer (D6).
 */
export interface AcCoverageFact {
  ac_id: string;
  mode: AcVerifyMode;
  pass: number;
  fail: number;
  refs: EvidenceRefLite[];
}

/**
 * Computes per-AC evidence coverage: for each declared criterion, counts how many
 * evidence entries (across all given tasks) reference it via `ac_ref`, split by
 * pass/fail.
 *
 * @param criteria - Declared acceptance criteria (typically a spec's
 *   `extra.acceptance_criteria`)
 * @param tasks - Task documents whose `extra.verification_evidence[]` may carry
 *   `ac_ref` pointers into `criteria` (typically a plan's child tasks)
 * @returns One {@link AcCoverageFact} per input criterion, in input order. An empty
 *   `tasks` array yields `{pass: 0, fail: 0, refs: []}` for every criterion — never
 *   throws, never omits a declared criterion.
 *
 * @example
 * computeAcCoverage(
 *   [{ id: "AC-1", statement: "...", verify: { mode: "script", oracle: "test", command: "bun test" } }],
 *   [taskWithEvidence],
 * );
 * // => [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{ task_id: "...", result: "pass" }] }]
 */
export function computeAcCoverage(
  criteria: AcceptanceCriterion[],
  tasks: DocRecord[],
): AcCoverageFact[] {
  return criteria.map((criterion) => {
    const refs: EvidenceRefLite[] = [];
    for (const task of tasks) {
      for (const entry of extractEvidence(task)) {
        if (entry.ac_ref === criterion.id) {
          refs.push({ task_id: task.id, result: entry.result });
        }
      }
    }
    return {
      ac_id: criterion.id,
      mode: criterion.verify.mode,
      pass: refs.filter((r) => r.result === "pass").length,
      fail: refs.filter((r) => r.result === "fail").length,
      refs,
    };
  });
}
