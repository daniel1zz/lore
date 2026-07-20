/**
 * Staleness-probe pure layer (SPEC-044 §Design Decisions D1, D2, D5) — candidate
 * selection, priority scoring, and the raw LLM verdict contract for
 * `lore review --staleness`. Pure, browser-safe module: no IO, no wall-clock reads
 * (`nowIso` is always caller-injected, matching SPEC-042/043's D-seam discipline).
 *
 * Public surface:
 *   - StalenessCandidateInput / StalenessCandidate — pure-layer input/output shapes
 *   - SelectProbeCandidatesOpts / SelectProbeCandidatesResult
 *   - computeStalenessPriority({in_degree, age_days}) — in_degree * age_days
 *   - selectProbeCandidates(inputs, nowIso, opts) — filter + score + sort + limit
 *   - STALENESS_VERDICT_DECISIONS / StalenessVerdictDecision — "holds" | "stale_candidate"
 *   - stalenessVerdictSchema / StalenessVerdict — the raw LLM output contract (D5)
 *   - mapStalenessVerdictDecisionToJudgmentDecision — holds->approve, stale_candidate->escalate
 *   - StalenessNeighbor / StalenessBundle — the AIProviderService.probeStaleness input
 *     shape, assembled by StalenessProbeService, mirroring ReviewBundle's role for judgeDoc
 *   - InvalidStalenessLimitError — thrown by selectProbeCandidates on an illegal
 *     opts.limit (BUG-012 audit fail-loud fix, see its own doc comment)
 *
 * @invariant selectProbeCandidates filters, in order: type not in {knowledge, adr}
 *   (silently excluded, not counted — the caller's store query is expected to already
 *   scope to these types); soft-deleted (`deleted_at !== null`, silently excluded);
 *   `isInvalidated(doc, nowIso)` (excluded, counted in `skipped.invalidated`);
 *   `age_days < opts.min_age_days` (excluded, counted in `skipped.too_young` — the
 *   boundary `age_days === min_age_days` is INCLUDED, D1).
 * @invariant `age_days` is measured from `last_confirmed_at = max(updated_at,
 *   latest_holds_probe_at)` — an edit OR a passing ("holds") probe both reset the
 *   staleness clock (D2). The caller resolves `latest_holds_probe_at` BEFORE calling
 *   this function (via a batch `latestJudgmentsByDocIds(docIds, "staleness")` call,
 *   filtered to `decision === "approve"` entries) — this module has no concept of
 *   ReviewJudgment at all, keeping it dependency-light.
 * @invariant `in_degree === 0` docs still qualify (score 0, sorted last by priority,
 *   never gated out by the multiplier) — orphaned knowledge rots too (D2).
 * @invariant Sort order: priority DESC, tiebreak `last_confirmed_at` ASC (older first),
 *   tiebreak `id` ASC (lexicographic) — deterministic for any input, always.
 * @invariant `opts.limit` is applied AFTER the full sort; `limit >= pool size` returns
 *   the whole pool with `excluded_by_limit: 0` (T12 boundary).
 * @invariant `opts.limit` MUST be a non-negative integer — `selectProbeCandidates`
 *   THROWS {@link InvalidStalenessLimitError} for a `NaN`/negative/non-integer value
 *   instead of silently clamping (BUG-012 audit finding, no-silent-fallback
 *   discipline): `Array.prototype.slice(0, limit)` treats a negative `limit` as
 *   "drop the last `|limit|` candidates from the tail" and `NaN` as "return zero
 *   candidates" — either would silently discard real candidates or mask the caller's
 *   own upstream validation bug. `limit === 0` is a legal, non-throwing value (an
 *   explicit "assemble the pool, return no candidates" request).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-044 §Design Decisions D1, D2, D5; §Acceptance Criteria AC-SP-1
 */

import { z } from "zod";
import { isInvalidated } from "./validity.js";
import { supersededCandidateSchema, type ReviewDecision } from "./review-judgment.js";
import type { DocId, DocRecord, DocType, LinkType } from "./types.js";

// ─── Candidate Selection ─────────────────────────────────────────────────────

/** One doc row the caller has already filtered to `type ∈ {knowledge, adr}` (defensively re-checked here). */
export interface StalenessCandidateInput {
  id: DocId;
  type: DocType;
  /** ISO 8601 — the doc's last content/extra edit. */
  updated_at: string;
  extra: Record<string, unknown>;
  deleted_at: string | null;
  /** Count of ALL incoming link rows (any link type) — from `countLinksByToIds`. */
  in_degree: number;
  /**
   * `created_at` of the doc's latest `kind="staleness"`, `decision="approve"` (holds)
   * judgment, if any — resolved by the caller BEFORE calling this function (D2). Absent
   * means no passing probe has ever confirmed this doc; `updated_at` alone anchors the clock.
   */
  latest_holds_probe_at?: string;
}

/** One doc that survived every selection filter, with its computed priority. */
export interface StalenessCandidate {
  id: DocId;
  in_degree: number;
  age_days: number;
  /** ISO 8601 — `max(updated_at, latest_holds_probe_at)` (D2). */
  last_confirmed_at: string;
  /** `in_degree * age_days` (D2). */
  priority: number;
}

/** Behavioral knobs for {@link selectProbeCandidates} — sourced from `workflow.staleness.*`. */
export interface SelectProbeCandidatesOpts {
  /** Inclusive lower bound on age_days (D1 — a doc exactly at this age qualifies). */
  min_age_days: number;
  /** Applied AFTER the full priority sort. */
  limit: number;
}

/** Result of {@link selectProbeCandidates} — every count D9's `--json` payload needs, computed once. */
export interface SelectProbeCandidatesResult {
  /** Top-`limit` candidates, priority-sorted (see module @invariant for tiebreak rules). */
  candidates: StalenessCandidate[];
  /** Count of candidates that passed every filter, BEFORE the limit cut. */
  total_candidates: number;
  /** `total_candidates - candidates.length` — zero when `limit >= total_candidates` (T12). */
  excluded_by_limit: number;
  /** Per-reason skip counts — the two classes a caller's `--json` payload must surface (U2). */
  skipped: {
    invalidated: number;
    too_young: number;
  };
}

/** Eligible doc types for staleness probing (D1) — knowledge/adr only. */
const STALENESS_ELIGIBLE_TYPES: ReadonlySet<DocType> = new Set(["knowledge", "adr"]);

/**
 * Thrown by {@link selectProbeCandidates} when `opts.limit` is not a valid
 * candidate count (BUG-012 audit finding). Fed unchecked, a `NaN`/negative
 * `limit` reaches `Array.prototype.slice(0, limit)` and silently drops
 * candidates from the tail (or returns none at all) instead of erroring —
 * this fails loud at the boundary instead, per the project's no-silent-fallback
 * discipline. Carries the offending `limit` as a typed `context` payload
 * (never just a message string) so a catching layer can render it without
 * re-parsing the error text.
 */
export class InvalidStalenessLimitError extends Error {
  readonly context: { limit: number };

  constructor(limit: number) {
    super(`selectProbeCandidates: opts.limit must be a non-negative integer, got ${String(limit)}`);
    this.name = "InvalidStalenessLimitError";
    this.context = { limit };
  }
}

/**
 * `in_degree * age_days` — the probe-priority multiplier (D2). A pure one-liner, exported
 * so callers/tests never hand-roll the formula.
 *
 * @example
 * computeStalenessPriority({ in_degree: 3, age_days: 20 }); // => 60
 * computeStalenessPriority({ in_degree: 0, age_days: 200 }); // => 0 (orphan, probed last)
 */
export function computeStalenessPriority(input: { in_degree: number; age_days: number }): number {
  return input.in_degree * input.age_days;
}

/** `max(updated_at, latest_holds_probe_at)` as an ISO string (D2). */
function computeLastConfirmedAt(updatedAt: string, latestHoldsProbeAt: string | undefined): string {
  if (latestHoldsProbeAt === undefined) return updatedAt;
  return new Date(latestHoldsProbeAt).getTime() > new Date(updatedAt).getTime() ? latestHoldsProbeAt : updatedAt;
}

/** Whole days between `lastConfirmedAt` and `nowIso`, floored — boundary-inclusive by construction (D1). */
function computeAgeDays(lastConfirmedAt: string, nowIso: string): number {
  const ms = new Date(nowIso).getTime() - new Date(lastConfirmedAt).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Filter, score, sort, and limit a pool of doc rows into staleness-probe candidates.
 * No IO, no wall-clock — `nowIso` is always caller-injected (SPEC-042/043 D-seam
 * discipline). See module header @invariant for the full filter/sort/limit contract.
 *
 * @param inputs - Doc rows plus their pre-resolved in_degree/latest_holds_probe_at
 * @param nowIso - Caller-supplied current time
 * @param opts - `{min_age_days, limit}` — sourced from `workflow.staleness.*` config
 * @returns Candidates plus every skip/limit count D9's `--json` payload needs
 *
 * @example
 * selectProbeCandidates(
 *   [{ id: "d1", type: "knowledge", updated_at: "2026-01-01T00:00:00.000Z", extra: {}, deleted_at: null, in_degree: 2 }],
 *   "2026-07-12T00:00:00.000Z",
 *   { min_age_days: 14, limit: 5 },
 * );
 */
export function selectProbeCandidates(
  inputs: StalenessCandidateInput[],
  nowIso: string,
  opts: SelectProbeCandidatesOpts,
): SelectProbeCandidatesResult {
  // BUG-012 audit: fail loud on an illegal limit BEFORE it ever reaches
  // `.slice(0, opts.limit)` — see this function's @invariant + the thrown
  // error class's own doc comment for why a silent clamp is the wrong call here.
  if (!Number.isInteger(opts.limit) || opts.limit < 0) {
    throw new InvalidStalenessLimitError(opts.limit);
  }

  let skippedInvalidated = 0;
  let skippedTooYoung = 0;

  const candidates: StalenessCandidate[] = [];

  for (const doc of inputs) {
    if (!STALENESS_ELIGIBLE_TYPES.has(doc.type)) continue;
    if (doc.deleted_at !== null) continue;

    if (isInvalidated({ extra: doc.extra }, nowIso)) {
      skippedInvalidated += 1;
      continue;
    }

    const lastConfirmedAt = computeLastConfirmedAt(doc.updated_at, doc.latest_holds_probe_at);
    const ageDays = computeAgeDays(lastConfirmedAt, nowIso);

    if (ageDays < opts.min_age_days) {
      skippedTooYoung += 1;
      continue;
    }

    candidates.push({
      id: doc.id,
      in_degree: doc.in_degree,
      age_days: ageDays,
      last_confirmed_at: lastConfirmedAt,
      priority: computeStalenessPriority({ in_degree: doc.in_degree, age_days: ageDays }),
    });
  }

  // Deterministic sort: priority DESC, then last_confirmed_at ASC (older first),
  // then id ASC (lexicographic) — see module @invariant.
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const confirmedDelta = new Date(a.last_confirmed_at).getTime() - new Date(b.last_confirmed_at).getTime();
    if (confirmedDelta !== 0) return confirmedDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const totalCandidates = candidates.length;
  const limited = candidates.slice(0, opts.limit);
  const excludedByLimit = totalCandidates - limited.length;

  return {
    candidates: limited,
    total_candidates: totalCandidates,
    excluded_by_limit: excludedByLimit,
    skipped: { invalidated: skippedInvalidated, too_young: skippedTooYoung },
  };
}

// ─── Raw LLM Verdict Contract (D5) ───────────────────────────────────────────

/** The two verdicts a staleness probe's raw LLM output can reach. */
export const STALENESS_VERDICT_DECISIONS = ["holds", "stale_candidate"] as const;

/** Derived TypeScript type for a staleness verdict decision. */
export type StalenessVerdictDecision = (typeof STALENESS_VERDICT_DECISIONS)[number];

/**
 * Shape a staleness probe's raw LLM JSON response must match (D5). Deliberately uses
 * plain English decision literals ("holds" / "stale_candidate") rather than reusing
 * `ReviewDecision`'s "approve" / "escalate" directly — the PERSISTED `review_judgments`
 * row DOES reuse the shared decision enum (D3), but the raw judge-facing contract stays
 * self-descriptive; `mapStalenessVerdictDecisionToJudgmentDecision` is the one mapping site.
 *
 * @example
 * stalenessVerdictSchema.parse({
 *   decision: "stale_candidate", confidence: 0.8,
 *   reasons: ["the linked API changed shape in a later spec"],
 *   blocking_questions: ["has anyone re-confirmed this against the current schema?"],
 * });
 */
export const stalenessVerdictSchema = z
  .object({
    decision: z.enum(STALENESS_VERDICT_DECISIONS),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()),
    /** Required (non-empty) iff decision === "stale_candidate" — see superRefine below. */
    blocking_questions: z.array(z.string()),
    superseded_candidate: supersededCandidateSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === "stale_candidate" && data.blocking_questions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "decision 'stale_candidate' requires at least one blocking_questions entry",
        path: ["blocking_questions"],
      });
    }
    if (data.decision !== "stale_candidate" && data.blocking_questions.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "blocking_questions must be empty unless decision is 'stale_candidate'",
        path: ["blocking_questions"],
      });
    }
  });

/** Derived TypeScript type for a validated staleness verdict. */
export type StalenessVerdict = z.infer<typeof stalenessVerdictSchema>;

/**
 * Maps a raw staleness verdict decision onto the shared `ReviewDecision` enum the
 * persisted `review_judgments` row uses (D3) — "holds" -> "approve", "stale_candidate"
 * -> "escalate". `"reject"` is never produced by this mapping (structurally impossible
 * for a probe, enforced separately by `validateKindDecisionInvariant` in review-judgment.ts).
 *
 * @example
 * mapStalenessVerdictDecisionToJudgmentDecision("holds"); // => "approve"
 * mapStalenessVerdictDecisionToJudgmentDecision("stale_candidate"); // => "escalate"
 */
export function mapStalenessVerdictDecisionToJudgmentDecision(
  decision: StalenessVerdictDecision,
): ReviewDecision {
  return decision === "holds" ? "approve" : "escalate";
}

// ─── Probe Bundle (assembled by StalenessProbeService, consumed by AIProviderService) ──

/** One incoming-link neighbor shown to the judge (D5 — "WHO depends on this"). */
export interface StalenessNeighbor {
  slug: string;
  title: string;
  link_type: LinkType;
}

/**
 * Everything `AIProviderService.probeStaleness` and `staleness-template.ts` need to
 * judge one document — assembled by `StalenessProbeService`, mirroring `ReviewBundle`'s
 * role for `judgeDoc` (review-checks.ts) and `PlanBundle`'s role for `assessPlan`
 * (assessment.ts). Lives in `@lore/core` (not `packages/lore/src/service/`) so both the
 * assembling service and the prompt-builder module (`packages/lore/src/ai/`) can import
 * it without a cross-package layering violation.
 */
export interface StalenessBundle {
  doc: DocRecord;
  /** Computed by the pure layer above at candidate-selection time (or, for a single-doc
   *  probe that bypasses selection, computed inline by the caller). */
  age_days: number;
  in_degree: number;
  /** Capped at `ai.staleness.neighbor_limit` by the template builder, not here — this
   *  bundle carries the FULL neighbor list; truncation + the "+n more" tail are a
   *  prompt-rendering concern (D5). */
  neighbors: StalenessNeighbor[];
}
