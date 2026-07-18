/**
 * UAT (user-acceptance-testing) verdict schema + the pure `plan-close` gate predicate
 * (SPEC-054). A UAT verdict is the machine-readable result of a `lore-uat` acceptance run —
 * persisted as a `knowledge` doc's `extra.uat` payload (sub_type `"uat"`), the SSOT a
 * `plan-close` gate reads to decide whether a plan that OPTS IN (`plan.extra.requires_uat`)
 * may close (archive).
 *
 * Pure, browser-safe module: no IO, no Date.now()/Math.random(), no AI import. Mirrors
 * `acceptance.ts`/`assessment.ts`'s "schema + pure predicate, rendering is the caller's job"
 * split — `isP0Accepted` is the SINGLE read both the gate predicate and any future advisory
 * surface consume (SPEC-054 D4), never a re-derivation.
 *
 * Public surface:
 *   - UAT_VERDICTS / UatVerdictDecision — the three top-level run outcomes
 *   - UAT_TIERS / UatTier — P0/P1/P2 priority tiers
 *   - uatTierResultSchema / uatVerdictSchema + UatVerdict — the typed extra.uat payload
 *   - isP0Accepted(uat) — the pure gate predicate (P0 acceptance, all four conditions)
 *
 * Invariants:
 *   - Referentially transparent: same UatVerdict in → same isP0Accepted out, always.
 *   - `isP0Accepted` is `true` IFF verdict !== "reject" AND no P0 tier row has rejected>0
 *     AND requirement_coverage.uncovered_p0 is empty AND uiux.blocker_count === 0. Any one
 *     failing condition ⇒ false (SPEC-054 §Design D4).
 *
 * Side-effect class: pure
 * Source: SPEC-054 §Overview, §Design D4
 */

import { z } from "zod";

// ─── Verdict + Tier enums ────────────────────────────────────────────────────

/** The three top-level outcomes a `lore-uat` run can reach for the whole product/feature. */
export const UAT_VERDICTS = ["accept", "reject", "accept_with_conditions"] as const;

/** Derived TypeScript type for a top-level UAT verdict decision. */
export type UatVerdictDecision = (typeof UAT_VERDICTS)[number];

/** The three journey priority tiers a `lore-uat` run classifies requirements/journeys into. */
export const UAT_TIERS = ["P0", "P1", "P2"] as const;

/** Derived TypeScript type for a UAT priority tier. */
export type UatTier = (typeof UAT_TIERS)[number];

// ─── Schema ──────────────────────────────────────────────────────────────────

/** Per-tier accept/reject/unverified journey counts from one acceptance run. */
export const uatTierResultSchema = z.object({
  tier: z.enum(UAT_TIERS),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  unverified: z.number().int().nonnegative(),
});

/** Derived TypeScript type for one tier's journey counts. */
export type UatTierResult = z.infer<typeof uatTierResultSchema>;

/**
 * The typed `extra.uat` payload — a machine-readable UAT verdict. Written EXCLUSIVELY by
 * `lore uat record` (via `CorpusService.createUatDoc`'s writer-identity guard, mirroring
 * the `handoff` sub_type precedent); direct `lore create knowledge --sub-type uat` is
 * rejected loud so the payload can never be hand-forged past this schema.
 */
export const uatVerdictSchema = z.object({
  /** The whole-run outcome. `"reject"` fails the P0 gate outright (see `isP0Accepted`). */
  verdict: z.enum(UAT_VERDICTS),
  /** Per-tier journey counts. A P0 row with `rejected > 0` fails the P0 gate. */
  tier_results: z.array(uatTierResultSchema),
  /**
   * Requirement-inventory coverage. `uncovered_p0` lists the numbered P0 requirement ids
   * (e.g. `R-3`, `R-NEG-2`) left with no accepting journey — a non-empty list fails the
   * P0 gate (`lore-uat` failure mode #6: an uncovered P0 requirement blocks clean ACCEPT).
   */
  requirement_coverage: z.object({
    total: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    uncovered_p0: z.array(z.string()),
  }),
  /**
   * Independent UIUX production-bar audit result (`lore-uat` failure mode #8). Any blocker
   * (`blocker_count > 0`) fails the P0 gate; `min_dimension_score` is the lowest of the six
   * production-bar dimension scores (informational at the gate — a blocker is the hard signal).
   */
  uiux: z.object({
    blocker_count: z.number().int().nonnegative(),
    min_dimension_score: z.number(),
  }),
  /** Slug/id of the plan (or spec) this run accepted — informational; the corpus `informs`
   *  link is the authoritative binding. */
  plan_ref: z.string().optional(),
  /** Run provenance. `degraded: true` marks a self-verified run (independence not achievable). */
  run_meta: z.object({
    at: z.string(),
    by: z.string(),
    tool_version: z.string().optional(),
    degraded: z.boolean().optional(),
  }),
});

/** Derived TypeScript type for a persisted UAT verdict (`extra.uat`). */
export type UatVerdict = z.infer<typeof uatVerdictSchema>;

// ─── Pure gate predicate ─────────────────────────────────────────────────────

/**
 * The SINGLE read the `plan-close` gate (and any future advisory surface) makes on a UAT
 * verdict (SPEC-054 §Design D4). A plan that requires UAT may close IFF its latest linked
 * verdict is P0-accepted, which requires ALL of:
 *   - the top-level verdict is not `"reject"`, AND
 *   - no P0 tier row reports any rejected journey (`rejected === 0`), AND
 *   - the requirement inventory leaves no P0 requirement uncovered (`uncovered_p0` empty), AND
 *   - the UIUX production-bar audit found no blocker (`blocker_count === 0`).
 *
 * @param uat - A validated UAT verdict.
 * @returns `true` when every condition holds; `false` when any one fails.
 * @example
 * isP0Accepted({ verdict: "accept", tier_results: [{tier:"P0",accepted:5,rejected:0,unverified:0}],
 *   requirement_coverage: {total:5,covered:5,uncovered_p0:[]}, uiux:{blocker_count:0,min_dimension_score:4},
 *   run_meta:{at:"...",by:"..."} }); // => true
 */
export function isP0Accepted(uat: UatVerdict): boolean {
  if (uat.verdict === "reject") return false;
  const p0Rejected = uat.tier_results.some((t) => t.tier === "P0" && t.rejected > 0);
  if (p0Rejected) return false;
  if (uat.requirement_coverage.uncovered_p0.length > 0) return false;
  if (uat.uiux.blocker_count > 0) return false;
  return true;
}

// ─── Deterministic content rendering ─────────────────────────────────────────

/**
 * Deterministic Markdown rendering of a UAT verdict for the knowledge doc's `content`
 * field (SPEC-054) — `extra.uat` is the SSOT, `content` is generated ONLY by this function
 * at record time, mirroring `renderAssessmentContent`/`renderHandoffContent`. Pure.
 *
 * @param uat - A validated UAT verdict.
 * @returns A Markdown summary (verdict, P0-accept status, per-tier counts, coverage, UIUX).
 */
export function renderUatContent(uat: UatVerdict): string {
  const tierLines = uat.tier_results
    .map((t) => `- ${t.tier}: ${t.accepted} accepted, ${t.rejected} rejected, ${t.unverified} unverified`)
    .join("\n");
  const uncovered =
    uat.requirement_coverage.uncovered_p0.length > 0
      ? uat.requirement_coverage.uncovered_p0.join(", ")
      : "(none)";
  const degraded = uat.run_meta.degraded === true ? " ⚠ degraded (self-verified — independence not achievable)" : "";
  return (
    `# UAT Verdict\n\n` +
    `**Verdict:** ${uat.verdict}\n` +
    `**P0 accepted:** ${isP0Accepted(uat) ? "yes" : "no"}${degraded}\n\n` +
    `## Tier results\n${tierLines || "(none)"}\n\n` +
    `## Requirement coverage\n` +
    `- Covered: ${uat.requirement_coverage.covered} / ${uat.requirement_coverage.total}\n` +
    `- Uncovered P0: ${uncovered}\n\n` +
    `## UIUX production bar\n` +
    `- Blockers: ${uat.uiux.blocker_count}\n` +
    `- Min dimension score: ${uat.uiux.min_dimension_score}\n\n` +
    `## Run\n` +
    `- At: ${uat.run_meta.at}\n` +
    `- By: ${uat.run_meta.by}\n`
  );
}
