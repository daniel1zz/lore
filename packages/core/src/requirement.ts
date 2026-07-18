/**
 * PRD requirement inventory schema + the pure requirement-coverage oracle (SPEC-055).
 *
 * A PRD declares a numbered inventory of user-facing requirements (`prd.extra.requirements`);
 * downstream spec acceptance criteria declare which requirements they cover
 * (`AcceptanceCriterion.requirement_refs`). The completeness oracle
 * (`lore status --check-requirements`) partitions the inventory into covered/uncovered by
 * gathering every descendant AC's refs — a requirement covered IFF some AC references its id.
 *
 * Pure, browser-safe module: no IO, no Date.now()/Math.random(), no AI import. Mirrors
 * `acceptance.ts`/`uat.ts`'s "schema + pure predicate, rendering is the caller's job" split.
 *
 * Public surface:
 *   - REQUIREMENT_PRIORITIES / RequirementPriority — P0/P1/P2
 *   - requirementSchema / Requirement — one numbered requirement declaration
 *   - prdRequirementsSchema — the `prd.extra.requirements` array (max 100, unique ids)
 *   - computeRequirementCoverage(requirements, refs) / RequirementCoverage — the coverage fact
 *   - requirementCoverageExitCode(coverage) — the single exit-code derivation (3 iff a P0 is
 *     uncovered, else 0), mirroring the drift oracle's exit-precedence helper
 *
 * Invariants:
 *   - Referentially transparent: same (requirements, refs) in → same coverage out, always.
 *   - A requirement is covered IFF its `id` is a member of `refs` (exact string match).
 *   - Empty `requirements` → all-empty coverage (vacuous — a PRD with no inventory is trivially
 *     complete), exit code 0.
 *
 * Side-effect class: pure
 * Source: SPEC-055 §Overview, §Design D3, D4
 */

import { z } from "zod";

// ─── Priority ────────────────────────────────────────────────────────────────

/** Requirement priority tiers — mirror `lore-uat`'s P0/P1/P2 journey tiers. */
export const REQUIREMENT_PRIORITIES = ["P0", "P1", "P2"] as const;

/** Derived TypeScript type for a requirement priority. */
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * One numbered PRD requirement. `id` grammar mirrors the `AC-*` convention (`R-` prefix,
 * uppercase-alphanumeric segments) so `R-1`, `R-NEG-2`, `R-AUTH-3` are all valid.
 */
export const requirementSchema = z.object({
  id: z
    .string()
    .regex(/^R-[A-Z0-9]+(-[A-Z0-9]+)*$/, "Requirement id must match R-<SEGMENT>(-<SEGMENT>)*, e.g. R-1 or R-NEG-2"),
  statement: z.string().min(1).max(2000),
  priority: z.enum(REQUIREMENT_PRIORITIES),
});

/** Derived TypeScript type for one requirement declaration. */
export type Requirement = z.infer<typeof requirementSchema>;

/**
 * The `prd.extra.requirements` array — max 100 entries, ids unique (mirrors
 * `specAcceptanceCriteriaSchema`'s shape). Written exclusively via `lore requirement add/rm`
 * (`RequirementService`, SPEC-055 §Scope), never hand-authored past this schema.
 */
export const prdRequirementsSchema = z
  .array(requirementSchema)
  .max(100)
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i++) {
      const entry = data[i];
      if (entry === undefined) continue;
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate requirement id "${entry.id}"`,
          path: [i, "id"],
        });
      }
      seen.add(entry.id);
    }
  });

// ─── Coverage ────────────────────────────────────────────────────────────────

/** The result of {@link computeRequirementCoverage} — pure facts, no rendering. */
export interface RequirementCoverage {
  /** Total declared requirements. */
  total: number;
  /** Requirement ids covered by ≥1 AC ref. */
  covered: string[];
  /** All uncovered requirement ids (any priority). */
  uncovered: string[];
  /** Uncovered requirement ids whose priority is P0 — the exit-3 trigger. */
  uncovered_p0: string[];
}

/**
 * Partitions a PRD's requirement inventory into covered/uncovered by gathering AC refs
 * (SPEC-055 §Design D4). A requirement is covered IFF its `id` appears in `refs`.
 *
 * @param requirements - The PRD's declared requirement inventory.
 * @param refs - Every `requirement_refs` id gathered from descendant spec ACs (may repeat;
 *   deduplication is internal).
 * @returns Coverage facts. Empty `requirements` → all-empty (vacuous).
 * @example
 * computeRequirementCoverage(
 *   [{ id: "R-1", statement: "x", priority: "P0" }],
 *   ["R-1"],
 * ); // => { total: 1, covered: ["R-1"], uncovered: [], uncovered_p0: [] }
 */
export function computeRequirementCoverage(
  requirements: Requirement[],
  refs: string[],
): RequirementCoverage {
  const refSet = new Set(refs);
  const covered: string[] = [];
  const uncovered: string[] = [];
  const uncovered_p0: string[] = [];
  for (const req of requirements) {
    if (refSet.has(req.id)) {
      covered.push(req.id);
    } else {
      uncovered.push(req.id);
      if (req.priority === "P0") uncovered_p0.push(req.id);
    }
  }
  return { total: requirements.length, covered, uncovered, uncovered_p0 };
}

/**
 * The single exit-code derivation for `lore status --check-requirements` (SPEC-055 §Design
 * D4) — `3` when at least one P0 requirement is uncovered (a CI-gate failure, mirroring the
 * drift oracle's exit 3), `0` otherwise. Never the CLI's own logic — the status command folds
 * this into its pinned exit-precedence.
 *
 * @param coverage - A {@link RequirementCoverage} fact.
 * @returns `3` iff `coverage.uncovered_p0` is non-empty; `0` otherwise.
 */
export function requirementCoverageExitCode(coverage: RequirementCoverage): number {
  return coverage.uncovered_p0.length > 0 ? 3 : 0;
}
