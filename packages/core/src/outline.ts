/**
 * PRD budget schema — the corpus-governed `prd.extra.outline_budget` (SPEC-080 C3). Pure, browser-safe leaf module:
 * no IO, no `Date.now()`/`Math.random()` calls.
 *
 * The structured outline itself (`prd.extra.outline[]`, its entry schema, its renderer, its write verbs and the plan-close
 * sync exemption) is REMOVED: stored outlines were archived by `lore migrate outline-sections`, and the baseline tree
 * carries what the outline summarised. Only the budget schema survives, because `lore status --check-prd-budget` still
 * reads it.
 *
 * Public surface:
 *   - outlineBudgetSchema / OutlineBudget — `prd.extra.outline_budget` (C3): the corpus-governed char budgets the
 *     `--check-prd-budget` oracle enforces, plus the content-flight scan's free-text threshold.
 *
 * Invariants:
 *   - `outlineBudgetSchema`'s three char-count fields (`core_max_chars`, `domain_max_chars`, `whole_body_max_chars`) are
 *     all REQUIRED — a corpus author must explicitly commit to the body-budget values rather than silently inheriting an
 *     implicit default; only `extra_prose_chars` carries a DEFAULT (1000).
 *   - Every char-count field rejects zero and negative values (`.positive()`) — a non-positive budget is nonsensical.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-080 C3 (outline_budget).
 */

import { z } from "zod";

/**
 * `prd.extra.outline_budget` (SPEC-080 C3) — corpus-governed char budgets the `--check-prd-budget` oracle enforces, plus
 * the content-flight scan's free-text threshold. Stored on the PRD itself (version-bumped, review-gated) rather than
 * `.lore/config.yaml` — plain-YAML numeric thresholds demonstrably rot unaudited (`workflow.attestation.min_ratio`
 * precedent, SPEC-080 T4).
 *
 * @example
 * outlineBudgetSchema.parse({
 *   core_max_chars: 4000,
 *   domain_max_chars: 2000,
 *   whole_body_max_chars: 24000,
 * });
 * // => { core_max_chars: 4000, domain_max_chars: 2000, whole_body_max_chars: 24000, extra_prose_chars: 1000 }
 */
export const outlineBudgetSchema = z.object({
  /** Max rendered chars for a core section. */
  core_max_chars: z.number().int().positive(),
  /** Max rendered chars for a domain section. */
  domain_max_chars: z.number().int().positive(),
  /** Max rendered chars for the WHOLE PRD body (G1). */
  whole_body_max_chars: z.number().int().positive(),
  /**
   * Content-flight scan threshold (SPEC-080 C3): any free-text string value in `extra` outside typed schemas
   * (requirements/acceptance_criteria/phases) exceeding this many chars is flagged. Defaults to 1000 when absent.
   */
  extra_prose_chars: z.number().int().positive().default(1000),
});

/** Derived TypeScript type for the corpus-governed budget. */
export type OutlineBudget = z.infer<typeof outlineBudgetSchema>;
