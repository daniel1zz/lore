/**
 * AI plan-outcome assessment — LLM-as-judge result schema, plan bundle shape, JSON
 * extraction from raw AI output, truncation helpers, deterministic content rendering,
 * and deterministic facts computation (SPEC-040).
 * Pure, browser-safe module: no IO, no Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - evidenceRefSchema / EvidenceRef — one evidence citation inside an ac_scores entry
 *   - acScoreSchema / AcScore — per-AC judge score + reasoning + evidence
 *   - judgmentSchema / Judgment — judge run metadata (provider, prompt version, retry, truncation)
 *   - scopeSchema — discriminator for what was assessed (v1 always {type: "plan", id})
 *   - ASSESSMENT_DIMENSIONS / AssessmentDimension — closed, append-only dimension taxonomy
 *     (SPEC-040 D2) — documented, not schema-enforced (see dimensionScoresSchema invariant)
 *   - dimensionScoresSchema / DimensionScores — permissive per-dimension judge score record
 *   - unverifiableEntrySchema / UnverifiableEntry — a material the judge could not verify
 *   - TYPED_FINDING_SEVERITIES / TypedFindingSeverity — typed_gaps[].severity enum
 *   - typedGapSchema / TypedGap — one structured gap finding (SPEC-040 D3)
 *   - RECOMMENDATION_TARGETS / RecommendationTarget — typed_recommendations[].target enum
 *   - typedRecommendationSchema / TypedRecommendation — one structured recommendation (SPEC-040 D3)
 *   - deriveLegacyFindings(typedGaps, typedRecommendations) — pure statement/action projection
 *     onto the legacy gaps/recommendations string arrays (SPEC-040 D3)
 *   - sourceVersionRefSchema / SourceVersionRef — {doc_id, version} pin recorded at judge time
 *   - assessmentFactsSchema / AssessmentFacts — the D1 deterministic-facts output shape
 *   - llmAssessmentOutputSchema / LlmAssessmentOutput — the shape the AI judge must emit
 *     (verdict/overall_score/ac_scores/gaps/recommendations, plus OPTIONAL dimension_scores/
 *     unverifiable/rubric_warning/typed_gaps/typed_recommendations — SPEC-040 D2/D3 — no
 *     scope, no judgment, no facts: those are filled in by AIProviderService after a
 *     successful parse, not by the model)
 *   - assessmentResultSchema / AssessmentResult — full persisted shape (llm output + scope +
 *     judgment + OPTIONAL facts/source_versions, SPEC-040 D2)
 *   - planBundleSchema / PlanBundle — {plan, spec?, tasks[], knowledge_links?} assembled by
 *     CorpusService.getPlanBundle (knowledge_links populated by SPEC-040 T2)
 *   - DiffMeta — pre-classified diff shape consumed by computeAssessmentFacts (caller-built,
 *     not schema-validated: an in-process function argument, not an external boundary)
 *   - computeAssessmentFacts(bundle, declaredCriteria, diffMeta?) — pure deterministic facts
 *     snapshot: AC coverage, per-task evidence completeness, AC-scope-vs-declared drift,
 *     knowledge-capture, and regression signals (SPEC-040 D1)
 *   - extractAssessmentJson(raw) — tolerant JSON extraction from raw AI text (fences, prose-wrapped)
 *   - truncateSection(text, maxChars) — single-section truncation primitive
 *   - clipTextToBudget(text, maxChars) — single-string, surrogate-pair-safe character clip
 *   - clipOverlongReasoning(value, maxChars?) — clips ac_scores[].reasoning AND (SPEC-040 D9)
 *     dimension_scores{}.reasoning / typed_gaps[].statement / typed_recommendations[].action+
 *     .rationale / unverifiable[].reason on an UNVALIDATED judge response, before it reaches
 *     llmAssessmentOutputSchema.safeParse (SPEC-029 AC-AR-2)
 *   - renderAssessmentContent(result) — deterministic Markdown rendering of a persisted result;
 *     additionally renders typed tables/dimension scores/facts/rubric warnings when present
 *     (SPEC-040 D3) — legacy-only results render byte-identically to before (regression-protected)
 *
 * Invariants:
 *   - No IO, no wall-clock reads, no Math.random() — renderAssessmentContent is deterministic:
 *     the same AssessmentResult always renders to the same string.
 *   - llmAssessmentOutputSchema validates ONLY what the AI judge is asked to produce; scope,
 *     judgment, and facts are service-computed and layered on top to build AssessmentResult.
 *   - extractAssessmentJson never throws — parse failures return a VALIDATION_ERROR Result.
 *   - planBundleSchema performs a light structural check (not a full DocRecord re-validation —
 *     DocRecord has no Zod schema elsewhere in this codebase; it is produced by the trusted
 *     store layer). The check exists to catch PlanBundle *assembly* bugs (e.g. wrong doc.type
 *     landing in the wrong slot) at the CorpusService/AIProviderService seam.
 *   - clipOverlongReasoning is applied BEFORE Zod validation, never after — a semantically
 *     valid but verbose judgment must never fail the whole assess run on acScoreSchema's
 *     `.max(300)` (SPEC-029 AC-AR-2). It never mutates its input (returns a shallow clone
 *     only when something was actually clipped) and never throws on malformed shapes — it
 *     leaves anything it cannot positively identify as an overlong reasoning/statement/action/
 *     rationale/reason string for Zod to reject downstream as usual.
 *   - judgment.reasoning_clipped is additive-only — an optional field so every assessment
 *     persisted before SPEC-029 still validates unchanged (AC-AR-3).
 *   - dimension_scores is a PERMISSIVE record (z.record, string keys), not a strict object
 *     keyed by ASSESSMENT_DIMENSIONS — a future append to the dimension taxonomy must not
 *     invalidate assessments already persisted under it (SPEC-040 D2 "tolerant read of
 *     unknown keys"). typed_gaps[].dimension mirrors this tolerance (a free string, not
 *     z.enum(ASSESSMENT_DIMENSIONS)) for the same forward-compatibility reason.
 *   - typed_gaps / typed_recommendations are ADDITIVE to, never a replacement for, the legacy
 *     gaps/recommendations string arrays — deriveLegacyFindings is a pure projection the
 *     service layer (T2) calls at persist time; this module never mutates gaps/recommendations
 *     itself.
 *   - computeAssessmentFacts never throws — a spec-less bundle (bundle.spec undefined) yields
 *     `facts.scope === undefined` (present-iff-meaningful, mirroring ReadyRecord.claim/.phase
 *     in task-workflow.ts), never a thrown error or a fabricated empty-but-present scope.
 *   - computeAssessmentFacts.ac_coverage MUST be produced by acceptance.ts's computeAcCoverage
 *     — never reimplemented here (single derivation site).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §3 D2, D6, D7; §4 AC-ASSESS-1..13; §5; §8.1, §8.2; SPEC-029 AC-AR-2, AC-AR-3;
 *   SPEC-040 §T1 D1, D2, D3, D9; AC-ADF-2, AC-ADF-10
 */

import { z } from "zod";
import type { DocRecord } from "./types.js";
import type { LoreError } from "./errors.js";
import { err, ok, type Result } from "./errors.js";
import { AC_VERIFY_MODES, computeAcCoverage, type AcceptanceCriterion } from "./acceptance.js";
import { ORACLE_KINDS, extractEvidence } from "./task-workflow.js";
import { headChars } from "./truncate.js";

// ─── Evidence Ref / AC Score / Judgment / Scope ────────────────────────────

/**
 * One evidence citation attached to an ac_scores entry — points at a task/doc the
 * judge used as grounds for the score.
 *
 * @example
 * evidenceRefSchema.parse({ doc_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", note: "tsc pass evidence" });
 */
export const evidenceRefSchema = z.object({
  doc_id: z.string().min(1),
  note: z.string().optional(),
});

/** Derived TypeScript type for one evidence citation. */
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/**
 * Judge's score for a single acceptance criterion.
 *
 * @invariant reasoning is capped at 300 chars (keeps the persisted doc scannable).
 * @invariant score is an integer 0-100 (rubric anchors — see SPEC-026 §5).
 *
 * @example
 * acScoreSchema.parse({
 *   ac_id: "AC-ASSESS-1", score: 85,
 *   reasoning: "Doc created with correct sub_type and informs link.",
 *   evidence_refs: [{ doc_id: "01ARZ3..." }],
 * });
 */
export const acScoreSchema = z.object({
  ac_id: z.string().min(1),
  score: z.number().int().min(0).max(100),
  reasoning: z.string().max(300),
  evidence_refs: z.array(evidenceRefSchema),
});

/** Derived TypeScript type for one AC score entry. */
export type AcScore = z.infer<typeof acScoreSchema>;

/**
 * Judge run metadata — filled in by AIProviderService.assessPlan, never by the model.
 *
 * @invariant truncated lists section names the judge did NOT see in full (e.g. "plan",
 *   "spec", "task:<slug>", "diff") — see {@link truncateSection}.
 * @invariant reasoning_clipped is additive-only (SPEC-029 AC-AR-3) — optional so every
 *   assessment persisted before SPEC-029 still validates. Absent/undefined means no
 *   ac_scores[].reasoning was clipped; when present, it lists the ac_id of every AC score
 *   whose reasoning was shortened by {@link clipOverlongReasoning} before this judgment was
 *   built — never an empty array (the field is simply omitted when nothing was clipped).
 *
 * @example
 * judgmentSchema.parse({
 *   provider: "claude-cli", prompt_version: 1, duration_ms: 4230,
 *   retried: false, truncated: [],
 * });
 * judgmentSchema.parse({
 *   provider: "claude-cli", prompt_version: 1, duration_ms: 4230,
 *   retried: false, truncated: [], reasoning_clipped: ["AC-ASSESS-3"],
 * });
 */
export const judgmentSchema = z.object({
  provider: z.string().min(1),
  prompt_version: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative(),
  retried: z.boolean(),
  truncated: z.array(z.string()),
  reasoning_clipped: z.array(z.string()).optional(),
});

/** Derived TypeScript type for judge run metadata. */
export type Judgment = z.infer<typeof judgmentSchema>;

/**
 * Discriminates what was assessed. v1 always produces `{type: "plan", id: <plan.id>}` —
 * the discriminator exists so task-level assessments (SPEC-026 §2.2 non-goal) are additive
 * later without a breaking schema reshape.
 */
export const scopeSchema = z.object({
  type: z.enum(["plan", "task"]),
  id: z.string().min(1),
});

// ─── Typed Dimension Scores / Findings (SPEC-040 D2, D3) ───────────────────

/**
 * Closed, append-only dimension taxonomy for {@link dimensionScoresSchema} and
 * {@link typedGapSchema}.dimension. "Closed" describes the currently-known set for
 * documentation/UI purposes only — the Zod shapes that reference dimension NAMES stay
 * permissive (see module invariants) so a future append here never invalidates an
 * already-persisted assessment.
 */
export const ASSESSMENT_DIMENSIONS = ["outcome", "evidence_integrity", "scope_fidelity"] as const;

/** Derived TypeScript union for the currently-known assessment dimensions. */
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

/**
 * One dimension's score within {@link dimensionScoresSchema}.
 *
 * @invariant confidence is advisory-only and self-reported by the judge — never treated
 *   as a calibrated probability. {@link renderAssessmentContent} labels it accordingly.
 * @invariant reasoning is capped at 200 chars; clipped pre-validation by
 *   {@link clipOverlongReasoning} (SPEC-040 D9), mirroring acScoreSchema's reasoning cap.
 */
const dimensionScoreEntrySchema = z.object({
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  based_on: z.enum(["evidence", "absence"]),
  reasoning: z.string().max(200),
});

/** Derived TypeScript type for one dimension score entry. */
export type DimensionScoreEntry = z.infer<typeof dimensionScoreEntrySchema>;

/**
 * Per-dimension judge scores, keyed by dimension name. Deliberately a PERMISSIVE
 * `z.record` (any non-empty string key), not a strict object keyed by
 * {@link ASSESSMENT_DIMENSIONS} — a strict shape would reject an assessment persisted
 * under a future dimension taxonomy append (SPEC-040 D2 "tolerant read of unknown keys").
 *
 * @example
 * dimensionScoresSchema.parse({
 *   outcome: { score: 80, confidence: 0.7, based_on: "evidence", reasoning: "AC coverage strong." },
 * });
 */
export const dimensionScoresSchema = z.record(z.string().min(1), dimensionScoreEntrySchema);

/** Derived TypeScript type for the dimension_scores record. */
export type DimensionScores = z.infer<typeof dimensionScoresSchema>;

/**
 * One material the judge could not verify (e.g. a cited doc that no longer exists, an
 * evidence entry with no reachable command output). Distinct from a `gaps` entry — this
 * is about the JUDGE's epistemic limits, not the PLAN's shortcomings.
 */
export const unverifiableEntrySchema = z.object({
  material: z.string().min(1),
  reason: z.string().max(200),
});

/** Derived TypeScript type for one unverifiable-material entry. */
export type UnverifiableEntry = z.infer<typeof unverifiableEntrySchema>;

/** Severity taxonomy for {@link typedGapSchema}.severity. */
export const TYPED_FINDING_SEVERITIES = ["blocker", "major", "minor"] as const;

/** Derived TypeScript union for a typed gap's severity. */
export type TypedFindingSeverity = (typeof TYPED_FINDING_SEVERITIES)[number];

/**
 * One structured gap finding (SPEC-040 D3) — additive to, never a replacement for, the
 * legacy `gaps: string[]` array. {@link deriveLegacyFindings} projects `statement` onto
 * the legacy array at persist time.
 *
 * @invariant `dimension` is a free string (not `z.enum(ASSESSMENT_DIMENSIONS)`) — same
 *   forward-compatibility rationale as {@link dimensionScoresSchema}'s permissive keys.
 */
export const typedGapSchema = z.object({
  dimension: z.string().min(1),
  severity: z.enum(TYPED_FINDING_SEVERITIES),
  ac_ref: z.string().optional(),
  statement: z.string().max(500),
});

/** Derived TypeScript type for one typed gap. */
export type TypedGap = z.infer<typeof typedGapSchema>;

/** Closed enum of recommendation targets — the corpus doc family a fix belongs in. */
export const RECOMMENDATION_TARGETS = ["spec", "plan", "prompt", "skill", "process"] as const;

/** Derived TypeScript union for a typed recommendation's target. */
export type RecommendationTarget = (typeof RECOMMENDATION_TARGETS)[number];

/**
 * One structured recommendation (SPEC-040 D3) — additive to, never a replacement for,
 * the legacy `recommendations: string[]` array. {@link deriveLegacyFindings} projects
 * `action` onto the legacy array at persist time.
 */
export const typedRecommendationSchema = z.object({
  target: z.enum(RECOMMENDATION_TARGETS),
  action: z.string().max(500),
  rationale: z.string().max(300),
});

/** Derived TypeScript type for one typed recommendation. */
export type TypedRecommendation = z.infer<typeof typedRecommendationSchema>;

/**
 * Pure statement/action projection from typed findings onto the legacy string-array
 * shape — called by the service layer (T2) at persist time so every assessment keeps
 * populating `gaps`/`recommendations` even when the judge emits typed findings.
 *
 * @invariant Pure — no IO, no mutation of inputs, deterministic (same input → same output).
 * @param typedGaps - `llmAssessmentOutputSchema.typed_gaps`, when the judge emitted any
 * @param typedRecommendations - `llmAssessmentOutputSchema.typed_recommendations`, when present
 * @returns `{ gaps, recommendations }` — `gaps` is every `typedGaps[].statement` in order;
 *   `recommendations` is every `typedRecommendations[].action` in order. Absent input yields
 *   an empty array, never undefined.
 *
 * @example
 * deriveLegacyFindings(
 *   [{ dimension: "outcome", severity: "major", statement: "AC-1 unverified." }],
 *   [{ target: "spec", action: "Add a script AC for AC-1.", rationale: "No oracle exists." }],
 * );
 * // → { gaps: ["AC-1 unverified."], recommendations: ["Add a script AC for AC-1."] }
 */
export function deriveLegacyFindings(
  typedGaps: TypedGap[] | undefined,
  typedRecommendations: TypedRecommendation[] | undefined,
): { gaps: string[]; recommendations: string[] } {
  return {
    gaps: (typedGaps ?? []).map((gap) => gap.statement),
    recommendations: (typedRecommendations ?? []).map((rec) => rec.action),
  };
}

// ─── LLM Output Schema (what the judge must produce) ───────────────────────

/**
 * Shape the AI judge's raw JSON response must match. Deliberately excludes `scope` and
 * `judgment` — those fields are computed by AIProviderService.assessPlan after a
 * successful parse (the model has no way to know its own provider name, prompt version,
 * or wall-clock duration). Source: SPEC-026 §5 "Output instruction".
 *
 * @invariant dimension_scores/unverifiable/rubric_warning/typed_gaps/typed_recommendations
 *   are OPTIONAL (SPEC-040 D2/D3) — a judge prompt version predating SPEC-040 never emits
 *   them, and that response must still validate.
 *
 * @example
 * llmAssessmentOutputSchema.parse({
 *   verdict: "partially_met", overall_score: 62,
 *   ac_scores: [{ ac_id: "AC-ASSESS-1", score: 85, reasoning: "...", evidence_refs: [] }],
 *   gaps: ["No evidence for AC-ASSESS-7 truncation path"],
 *   recommendations: ["Add a budget-boundary test"],
 * });
 *
 * @example
 * // SPEC-040 typed-finding shape, additive to the legacy fields above
 * llmAssessmentOutputSchema.parse({
 *   verdict: "partially_met", overall_score: 62,
 *   ac_scores: [], gaps: [], recommendations: [],
 *   dimension_scores: {
 *     outcome: { score: 70, confidence: 0.6, based_on: "evidence", reasoning: "Partial AC coverage." },
 *   },
 *   unverifiable: [{ material: "AC-9 evidence doc", reason: "doc_id not found in bundle." }],
 *   typed_gaps: [{ dimension: "outcome", severity: "major", statement: "AC-9 has no evidence." }],
 *   typed_recommendations: [
 *     { target: "plan", action: "Add a task for AC-9.", rationale: "No task currently covers it." },
 *   ],
 * });
 */
export const llmAssessmentOutputSchema = z.object({
  verdict: z.enum(["met", "partially_met", "not_met"]),
  overall_score: z.number().int().min(0).max(100),
  ac_scores: z.array(acScoreSchema),
  gaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  dimension_scores: dimensionScoresSchema.optional(),
  unverifiable: z.array(unverifiableEntrySchema).optional(),
  rubric_warning: z.array(z.string()).optional(),
  typed_gaps: z.array(typedGapSchema).optional(),
  typed_recommendations: z.array(typedRecommendationSchema).optional(),
});

/** Derived TypeScript type for the raw judge output. */
export type LlmAssessmentOutput = z.infer<typeof llmAssessmentOutputSchema>;

// ─── Deterministic Facts (SPEC-040 D1) ──────────────────────────────────────

/**
 * Zod counterpart of `acceptance.ts`'s hand-written `AcCoverageFact`/`EvidenceRefLite`
 * interfaces — structurally identical, so `computeAcCoverage`'s return value is directly
 * assignable here. NOT re-exported as the canonical AC-coverage type (that stays
 * `acceptance.ts`'s job); this schema exists solely to give {@link assessmentFactsSchema}
 * a Zod-typed `ac_coverage` field.
 */
const evidenceRefLiteSchema = z.object({
  task_id: z.string(),
  result: z.enum(["pass", "fail"]),
  attested: z.boolean().optional(),
});

const acCoverageFactSchema = z.object({
  ac_id: z.string(),
  mode: z.enum(AC_VERIFY_MODES),
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  refs: z.array(evidenceRefLiteSchema),
  attested_pass: z.number().int().nonnegative(),
  attested_fail: z.number().int().nonnegative(),
});

/**
 * Per-task evidence completeness fact — one entry per task in the bundle, regardless of
 * whether that task has any evidence at all (a task with zero entries still gets a
 * `has_evidence: false` row, never an omission).
 */
const taskEvidenceFactSchema = z.object({
  task_id: z.string(),
  has_evidence: z.boolean(),
  oracle_kinds: z.array(z.enum(ORACLE_KINDS)),
  attested_count: z.number().int().nonnegative(),
  self_reported_count: z.number().int().nonnegative(),
});

/**
 * AC-scope-vs-declared-set drift fact — compares the plan's `extra.ac_scope` (a
 * caller-declared array of AC ids the plan claims to address) against the ids actually
 * declared on the spec.
 */
const acScopeFactsSchema = z.object({
  declared_ids: z.array(z.string()),
  scoped_ids: z.array(z.string()),
  /** ids present in the plan's ac_scope but absent from the declared criteria set. */
  dangling: z.array(z.string()),
});

/**
 * Knowledge-capture fact — how many `informs`-linked knowledge docs the plan has
 * accumulated (SPEC-040 T2 populates `PlanBundle.knowledge_links`).
 *
 * @invariant `source: "unavailable"` (count 0, sub_types []) is used — not a thrown
 *   error, not a silently-omitted field — when the bundle predates T2's population
 *   (`PlanBundle.knowledge_links === undefined`), so "zero because none exist" is never
 *   conflated with "zero because we don't know" (module invariant: no silent fallback).
 */
const knowledgeCaptureFactSchema = z.object({
  count: z.number().int().nonnegative(),
  sub_types: z.array(z.string()),
  source: z.enum(["bundle", "unavailable"]),
});

/**
 * Regression signals derived from an optional pre-classified diff and the bundle's
 * aggregate evidence attestation.
 */
const regressionFactsSchema = z.object({
  /** Whether a {@link DiffMeta} was supplied at all (vs. no diff attached to this run). */
  diff_available: z.boolean(),
  /** True iff diffMeta was supplied AND diffMeta.test_files is non-empty. */
  tests_touched: z.boolean(),
  /** attested evidence entries / total evidence entries across the bundle's tasks; 0 when there is no evidence at all (never NaN). */
  attested_evidence_ratio: z.number().min(0).max(1),
});

/**
 * The full D1 deterministic-facts snapshot — a frozen creation-time audit trail computed
 * directly from the untruncated `PlanBundle` (never from prompt text, which may be
 * truncated per `ai.assess.*` budgets — AC-ADF-10).
 *
 * @invariant `scope` is present iff the bundle has a spec (`bundle.spec !== undefined`);
 *   a spec-less bundle yields `scope: undefined`, never a thrown error (AC-ADF-10).
 */
export const assessmentFactsSchema = z.object({
  ac_coverage: z.array(acCoverageFactSchema),
  task_evidence: z.array(taskEvidenceFactSchema),
  scope: acScopeFactsSchema.optional(),
  knowledge_capture: knowledgeCaptureFactSchema,
  regression: regressionFactsSchema,
});

/** Derived TypeScript type for the D1 facts snapshot. */
export type AssessmentFacts = z.infer<typeof assessmentFactsSchema>;

/** One `{doc_id, version}` pin recorded at judge time (SPEC-040 D2) — which exact version of each source doc the judge saw. */
export const sourceVersionRefSchema = z.object({
  doc_id: z.string().min(1),
  version: z.number().int().positive(),
});

/** Derived TypeScript type for one source-version pin. */
export type SourceVersionRef = z.infer<typeof sourceVersionRefSchema>;

// ─── Full Assessment Result (persisted shape) ──────────────────────────────

/**
 * Full persisted assessment shape: the judge's output plus the service-computed
 * `scope`, `judgment`, and (SPEC-040, optional) `facts`/`source_versions` fields. This
 * is what lands in `extra.assessment` on the `knowledge` doc (sub_type="assessment") and
 * what `knowledgeExtraSchema` validates against (schemas.ts superRefine).
 *
 * @invariant `facts`/`source_versions` are OPTIONAL and ADDITIVE — every assessment
 *   persisted before SPEC-040 has neither field and still validates unchanged (AC-ADF-2).
 *
 * @example
 * assessmentResultSchema.parse({
 *   scope: { type: "plan", id: "01ARZ3..." },
 *   verdict: "met", overall_score: 88,
 *   ac_scores: [], gaps: [], recommendations: [],
 *   judgment: { provider: "claude-cli", prompt_version: 1, duration_ms: 3000, retried: false, truncated: [] },
 * });
 */
export const assessmentResultSchema = llmAssessmentOutputSchema.extend({
  scope: scopeSchema,
  judgment: judgmentSchema,
  facts: assessmentFactsSchema.optional(),
  source_versions: z.array(sourceVersionRefSchema).optional(),
});

/** Derived TypeScript type for a full persisted assessment result. */
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;

// ─── Plan Bundle ────────────────────────────────────────────────────────────

/**
 * Minimal structural predicate for a DocRecord-shaped value, scoped to `expectedType`.
 * Not a full DocRecord validator (see module invariants) — just enough to catch
 * PlanBundle assembly bugs (wrong doc landing in the wrong slot).
 */
function isDocRecordOfType(value: unknown, expectedType: DocRecord["type"]): value is DocRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "title" in value &&
    "content" in value &&
    (value as { type: unknown }).type === expectedType
  );
}

/**
 * PlanBundle — {plan, spec?, tasks[], knowledge_links?} assembled by
 * `CorpusService.getPlanBundle`. `spec` is undefined when the plan hangs directly off a
 * PRD (no spec parent). `knowledge_links` is OPTIONAL — populated by SPEC-040 T2's
 * extension of `getPlanBundle`; a bundle assembled by pre-SPEC-040 callers omits it, and
 * {@link computeAssessmentFacts} degrades that to an explicit "unavailable" knowledge-capture
 * fact rather than a fabricated zero (see assessmentFactsSchema's knowledge_capture invariant).
 *
 * @example
 * planBundleSchema.parse({ plan: planDoc, tasks: [taskDoc1, taskDoc2] }); // no spec
 *
 * @example
 * planBundleSchema.parse({
 *   plan: planDoc, tasks: [],
 *   knowledge_links: [{ slug: "knowledge-retro-1", sub_type: "retro", title: "Retro: plan X" }],
 * });
 */
export const planBundleSchema = z.object({
  plan: z.custom<DocRecord>((v) => isDocRecordOfType(v, "plan"), {
    message: "plan must be a DocRecord with type 'plan'",
  }),
  spec: z
    .custom<DocRecord>((v) => isDocRecordOfType(v, "spec"), {
      message: "spec must be a DocRecord with type 'spec'",
    })
    .optional(),
  tasks: z.array(
    z.custom<DocRecord>((v) => isDocRecordOfType(v, "task"), {
      message: "each task must be a DocRecord with type 'task'",
    }),
  ),
  knowledge_links: z
    .array(
      z.object({
        slug: z.string().min(1),
        sub_type: z.string().min(1),
        title: z.string().min(1),
      }),
    )
    .optional(),
});

/** Derived TypeScript type for a plan bundle. */
export type PlanBundle = z.infer<typeof planBundleSchema>;

// ─── computeAssessmentFacts (SPEC-040 D1) ──────────────────────────────────

/**
 * Pre-classified diff shape consumed by {@link computeAssessmentFacts}. Built by the
 * caller (T2, `packages/lore`) from a git diff/patch — this module never parses diff
 * text itself and never imports from `packages/lore` (this stays a plain in-process
 * argument type, not a Zod-validated external boundary).
 */
export interface DiffMeta {
  source_files: string[];
  test_files: string[];
  other_files: string[];
}

/**
 * Defensive `plan.extra.ac_scope` accessor — `extra` is untyped storage and `ac_scope`
 * is not part of `planExtraSchema` (schemas.ts); a corrupted/legacy row may hand this
 * anything. Returns `[]` for anything that isn't an array of strings, never throws
 * (mirrors `task-workflow.ts`'s `safeTaskExtra`/`extractEvidence` defensive pattern).
 */
function extractAcScope(plan: DocRecord): string[] {
  const extra: unknown = plan.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return [];
  const raw = (extra as Record<string, unknown>)["ac_scope"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Computes {@link AssessmentFacts} — a deterministic, creation-time-frozen snapshot of
 * facts about a plan's execution, independent of anything a judge prompt may have
 * truncated (AC-ADF-10). Never throws.
 *
 * @param bundle - {plan, spec?, tasks[], knowledge_links?} — typically `CorpusService.getPlanBundle`'s output
 * @param declaredCriteria - The spec's `extra.acceptance_criteria`, or `[]` when the
 *   bundle has no spec (or the spec declares none) — always the FULL declared set,
 *   independent of any prompt-budget truncation
 * @param diffMeta - Optional pre-classified diff (SPEC-040 D1) — absent means "no diff
 *   was attached to this assess run", not "the diff touched nothing"
 * @returns `AssessmentFacts` — `scope` is present iff `bundle.spec !== undefined`
 *
 * @example
 * computeAssessmentFacts({ plan: planDoc, tasks: [taskDoc] }, []);
 * // → { ac_coverage: [], task_evidence: [...], knowledge_capture: {count: 0, sub_types: [], source: "unavailable"},
 * //     regression: { diff_available: false, tests_touched: false, attested_evidence_ratio: 0 } }
 * // scope is omitted — bundle.spec is undefined (spec-less bundle, AC-ADF-10)
 */
export function computeAssessmentFacts(
  bundle: PlanBundle,
  declaredCriteria: AcceptanceCriterion[],
  diffMeta?: DiffMeta,
): AssessmentFacts {
  const acCoverage = computeAcCoverage(declaredCriteria, bundle.tasks);

  const taskEvidence = bundle.tasks.map((task) => {
    const evidence = extractEvidence(task);
    const attestedCount = evidence.filter((entry) => entry.attestation !== undefined).length;
    return {
      task_id: task.id,
      has_evidence: evidence.length > 0,
      oracle_kinds: Array.from(new Set(evidence.map((entry) => entry.oracle))),
      attested_count: attestedCount,
      self_reported_count: evidence.length - attestedCount,
    };
  });

  const knowledgeCapture =
    bundle.knowledge_links === undefined
      ? { count: 0, sub_types: [], source: "unavailable" as const }
      : {
          count: bundle.knowledge_links.length,
          sub_types: Array.from(new Set(bundle.knowledge_links.map((link) => link.sub_type))),
          source: "bundle" as const,
        };

  const totalEvidence = taskEvidence.reduce(
    (sum, entry) => sum + entry.attested_count + entry.self_reported_count,
    0,
  );
  const totalAttested = taskEvidence.reduce((sum, entry) => sum + entry.attested_count, 0);

  const regression = {
    diff_available: diffMeta !== undefined,
    tests_touched: diffMeta !== undefined && diffMeta.test_files.length > 0,
    attested_evidence_ratio: totalEvidence === 0 ? 0 : totalAttested / totalEvidence,
  };

  const facts: AssessmentFacts = {
    ac_coverage: acCoverage,
    task_evidence: taskEvidence,
    knowledge_capture: knowledgeCapture,
    regression,
  };

  // reason: exactOptionalPropertyTypes forbids `scope: undefined` — the key must be
  // entirely absent for a spec-less bundle, not present-with-undefined (AC-ADF-10).
  if (bundle.spec !== undefined) {
    const declaredIds = declaredCriteria.map((criterion) => criterion.id);
    const declaredIdSet = new Set(declaredIds);
    const scopedIds = extractAcScope(bundle.plan);
    facts.scope = {
      declared_ids: declaredIds,
      scoped_ids: scopedIds,
      dangling: scopedIds.filter((id) => !declaredIdSet.has(id)),
    };
  }

  return facts;
}

// ─── JSON Extraction ────────────────────────────────────────────────────────

/** Attempt JSON.parse; returns undefined (not throw) on failure. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Extract a JSON value from raw AI judge output, tolerating common LLM formatting jitter.
 * Tries, in order:
 *   1. Bare JSON — the whole trimmed string parses directly.
 *   2. ```json ... ``` fenced block.
 *   3. Generic ``` ... ``` fenced block (no language tag).
 *   4. Prose-wrapped — first `{` to the last `}` in the string.
 *
 * Does NOT validate the parsed value's shape (that is llmAssessmentOutputSchema's job) —
 * a bare JSON array, for instance, parses successfully here and fails downstream schema
 * validation, keeping "can we find JSON" separate from "is the JSON the right shape".
 *
 * @param raw - Raw text content from the AI provider
 * @returns Result<unknown, LoreError> — VALIDATION_ERROR when no JSON can be found
 *
 * @example
 * extractAssessmentJson('{"verdict":"met"}'); // → ok({verdict: "met"})
 * extractAssessmentJson('```json\n{"verdict":"met"}\n```'); // → ok({verdict: "met"})
 * extractAssessmentJson('Here is my assessment:\n{"verdict":"met"}\nHope this helps!');
 * // → ok({verdict: "met"})
 * extractAssessmentJson('no json here'); // → err({ code: "VALIDATION_ERROR", ... })
 */
export function extractAssessmentJson(raw: string): Result<unknown, LoreError> {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "assessment_json",
      message: "AI judge response was empty; no JSON found.",
    });
  }

  // 1. Bare JSON
  const bare = tryParseJson(trimmed);
  if (bare !== undefined) return ok(bare);

  // 2. ```json ... ``` fence
  const jsonFenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFenceMatch?.[1] !== undefined) {
    const fenced = tryParseJson(jsonFenceMatch[1].trim());
    if (fenced !== undefined) return ok(fenced);
  }

  // 3. Generic ``` ... ``` fence
  const genericFenceMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (genericFenceMatch?.[1] !== undefined) {
    const fenced = tryParseJson(genericFenceMatch[1].trim());
    if (fenced !== undefined) return ok(fenced);
  }

  // 4. Prose-wrapped — first '{' through the matching last '}'
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = tryParseJson(candidate);
    if (parsed !== undefined) return ok(parsed);
  }

  return err({
    code: "VALIDATION_ERROR",
    field: "assessment_json",
    message: `No valid JSON object found in AI judge response (${raw.length} chars).`,
    value: raw.slice(0, 500),
  });
}

// ─── Truncation ─────────────────────────────────────────────────────────────

/** Result of {@link truncateSection} — the (possibly shortened) text plus whether it was cut. */
export interface TruncationResult {
  text: string;
  truncated: boolean;
}

/**
 * Truncate a single prompt section to a character budget.
 * Boundary semantics: text.length === maxChars is NOT truncated (strict `>` comparison).
 *
 * Uses `headChars` (BUG-001 fix, `./truncate.js`) rather than a bare `text.slice(0,
 * maxChars)` — the naive slice can land mid-surrogate-pair on astral-plane input (e.g.
 * emoji in a plan/task body or diff), producing a lone unpaired surrogate that
 * `bun:sqlite` silently accepts on write but does not round-trip on read.
 *
 * @param text - Section text (e.g. a plan's content, a task's content, a diff)
 * @param maxChars - Budget from `ai.assess.*` config (SPEC-026 §3 D7)
 * @returns { text, truncated } — text is clipped to at most maxChars when over budget
 *
 * @example
 * truncateSection("hello world", 5); // → { text: "hello", truncated: true }
 * truncateSection("hi", 5); // → { text: "hi", truncated: false }
 */
export function truncateSection(text: string, maxChars: number): TruncationResult {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: headChars(text, maxChars), truncated: true };
}

// ─── Reasoning-Length Resilience (SPEC-029) ────────────────────────────────

/** Marker appended to a clipped `reasoning` string — signals partial content, not a typo. */
const REASONING_CLIP_MARKER = "…";

/** Default character budget for one ac_scores[].reasoning entry — mirrors acScoreSchema's `.max(300)`. */
export const DEFAULT_REASONING_CLIP_CHARS = 300;

/** Character budget for one dimension_scores{}.reasoning entry — mirrors dimensionScoreEntrySchema's `.max(200)` (SPEC-040 D9). */
export const DIMENSION_REASONING_CLIP_CHARS = 200;

/** Character budget for one typed_gaps[].statement entry — mirrors typedGapSchema's `.max(500)` (SPEC-040 D9). */
export const TYPED_GAP_STATEMENT_CLIP_CHARS = 500;

/** Character budget for one typed_recommendations[].action entry — mirrors typedRecommendationSchema's `.max(500)` (SPEC-040 D9). */
export const TYPED_RECOMMENDATION_ACTION_CLIP_CHARS = 500;

/** Character budget for one typed_recommendations[].rationale entry — mirrors typedRecommendationSchema's `.max(300)` (SPEC-040 D9). */
export const TYPED_RECOMMENDATION_RATIONALE_CLIP_CHARS = 300;

/** Character budget for one unverifiable[].reason entry — mirrors unverifiableEntrySchema's `.max(200)` (SPEC-040 D9). */
export const UNVERIFIABLE_REASON_CLIP_CHARS = 200;

/**
 * Clip a single string to at most `maxChars` UTF-16 code units, appending a trailing
 * ellipsis marker when clipped. Boundary semantics mirror {@link truncateSection}:
 * `text.length <= maxChars` is a no-op (strict `>` comparison) — a string exactly at the
 * budget is never touched.
 *
 * @invariant Never splits a UTF-16 surrogate pair. If the naive cut point falls right
 *   after a high surrogate (i.e. would emit a lone unpaired high surrogate as the last
 *   code unit before the marker), the cut backs off by one unit so the returned string
 *   only ever contains complete code points.
 *
 * @param text - Candidate string (e.g. one ac_scores[].reasoning entry)
 * @param maxChars - Character budget (default 300, matches acScoreSchema's cap)
 * @returns The original string unchanged, or a clipped string ending in "…" whose
 *   `.length` is `<= maxChars`
 *
 * @example
 * clipTextToBudget("a".repeat(305), 300).length; // → 300
 * clipTextToBudget("short reasoning", 300); // → "short reasoning" (unchanged, under budget)
 */
export function clipTextToBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  let cut = maxChars - REASONING_CLIP_MARKER.length;
  if (cut < 0) cut = 0;

  // reason: avoid emitting a lone high surrogate as the char immediately before the
  // ellipsis marker — if the naive cut point lands right after one, back off by one code
  // unit so `text.slice(0, cut)` never ends mid-surrogate-pair (SPEC-029 AC-AR-6).
  const precedingCodeUnit = cut > 0 ? text.charCodeAt(cut - 1) : 0;
  const cutsMidSurrogatePair = precedingCodeUnit >= 0xd800 && precedingCodeUnit <= 0xdbff;
  if (cutsMidSurrogatePair) cut -= 1;

  return text.slice(0, cut) + REASONING_CLIP_MARKER;
}

/** Result of {@link clipOverlongReasoning} — the (possibly modified) value plus which AC ids were clipped. */
export interface ClipReasoningResult {
  value: unknown;
  clippedAcIds: string[];
}

/**
 * Clips one array-valued field in an UNVALIDATED judge response object, given an
 * accessor for the single string sub-field to clip on each array entry. Shared by every
 * branch of {@link clipOverlongReasoning} — one array-walk shape, five call sites
 * (SPEC-040 D9), rather than five hand-copied loops.
 *
 * @invariant Never mutates `entries` or its elements; returns the SAME array reference
 *   when nothing needed clipping (referential transparency, mirrors clipOverlongReasoning
 *   itself). Non-object/array-shaped entries are returned untouched — this is a
 *   pre-validation defensive pass, not a schema check.
 */
function clipArrayField(
  entries: unknown,
  field: string,
  maxChars: number,
): { entries: unknown; clipped: boolean } {
  if (!Array.isArray(entries)) return { entries, clipped: false };

  let clipped = false;
  const next = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    const fieldValue = record[field];
    if (typeof fieldValue !== "string" || fieldValue.length <= maxChars) return entry;
    clipped = true;
    return { ...record, [field]: clipTextToBudget(fieldValue, maxChars) };
  });

  return clipped ? { entries: next, clipped: true } : { entries, clipped: false };
}

/**
 * Clip every overlong reasoning/statement/action/rationale/reason field in an
 * UNVALIDATED judge response, BEFORE it reaches `llmAssessmentOutputSchema.safeParse`.
 * Exists because a semantically valid but verbose judgment must never fail the whole
 * assess run on a schema `.max(N)` violation (SPEC-029 AC-AR-2) — the one
 * corrective-retry budget (SPEC-026 §3 D2) should be spent on genuinely malformed JSON,
 * not on a judge that wrote a few characters too many of otherwise-good text.
 *
 * Clips, when present and over budget:
 *   - `ac_scores[].reasoning` (maxChars param, default {@link DEFAULT_REASONING_CLIP_CHARS})
 *   - `dimension_scores{}.reasoning` ({@link DIMENSION_REASONING_CLIP_CHARS}, SPEC-040 D9)
 *   - `typed_gaps[].statement` ({@link TYPED_GAP_STATEMENT_CLIP_CHARS}, SPEC-040 D9)
 *   - `typed_recommendations[].action` ({@link TYPED_RECOMMENDATION_ACTION_CLIP_CHARS}, SPEC-040 D9)
 *   - `typed_recommendations[].rationale` ({@link TYPED_RECOMMENDATION_RATIONALE_CLIP_CHARS}, SPEC-040 D9)
 *   - `unverifiable[].reason` ({@link UNVERIFIABLE_REASON_CLIP_CHARS}, SPEC-040 D9)
 *
 * Operates defensively on `unknown` (pre-validation) input — `value` may not even be an
 * object, and none of the above fields need be present or array/record-shaped; that is
 * Zod's job to reject downstream. This function only clips what it can positively
 * identify as an overlong string at the documented path and leaves everything else
 * (including malformed shapes at any of those paths) untouched, never throwing.
 *
 * @param value - Parsed-but-unvalidated JSON, typically from {@link extractAssessmentJson}
 * @param maxChars - Character budget for `ac_scores[].reasoning` specifically (default
 *   {@link DEFAULT_REASONING_CLIP_CHARS}) — the SPEC-040 fields each use their own fixed
 *   budget above, not this parameter (their caps are schema-fixed, not caller-tunable)
 * @returns `{ value, clippedAcIds }` — `value` is a shallow-cloned copy ONLY when at least
 *   one field anywhere was clipped (referential transparency: the input is never mutated
 *   in place); `clippedAcIds` lists the `ac_id` of every clipped `ac_scores` entry, in
 *   encounter order (empty when no ac_scores entry needed clipping — SPEC-040 fields do
 *   not have an "id" to report here, matching judgment.reasoning_clipped's pre-existing
 *   ac_scores-only contract)
 *
 * @example
 * const raw = { ac_scores: [{ ac_id: "AC-1", reasoning: "x".repeat(400) }] };
 * const { value, clippedAcIds } = clipOverlongReasoning(raw);
 * clippedAcIds; // → ["AC-1"]
 *
 * @example
 * // SPEC-040 field, no ac_id to report — clippedAcIds stays empty even though clipping happened
 * const raw2 = { typed_gaps: [{ dimension: "outcome", severity: "major", statement: "x".repeat(600) }] };
 * const { value, clippedAcIds } = clipOverlongReasoning(raw2);
 * clippedAcIds; // → []
 */
export function clipOverlongReasoning(
  value: unknown,
  maxChars: number = DEFAULT_REASONING_CLIP_CHARS,
): ClipReasoningResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { value, clippedAcIds: [] };
  }

  let working = value as Record<string, unknown>;
  let anyClipped = false;
  const clippedAcIds: string[] = [];

  // ac_scores[].reasoning — pre-existing SPEC-029 behavior, unchanged: records clipped
  // ac_id (the only field here that carries an identifiable id).
  const acScores = working["ac_scores"];
  if (Array.isArray(acScores)) {
    let acScoresClipped = false;
    const nextAcScores = acScores.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
      const reasoning = (entry as { reasoning?: unknown }).reasoning;
      if (typeof reasoning !== "string" || reasoning.length <= maxChars) return entry;
      acScoresClipped = true;
      const acId = (entry as { ac_id?: unknown }).ac_id;
      clippedAcIds.push(typeof acId === "string" ? acId : "(unknown)");
      return { ...entry, reasoning: clipTextToBudget(reasoning, maxChars) };
    });
    if (acScoresClipped) {
      working = { ...working, ac_scores: nextAcScores };
      anyClipped = true;
    }
  }

  // dimension_scores{}.reasoning (SPEC-040 D9) — permissive record, any string key.
  const dimensionScores = working["dimension_scores"];
  if (typeof dimensionScores === "object" && dimensionScores !== null && !Array.isArray(dimensionScores)) {
    let dimensionScoresClipped = false;
    const nextDimensionScores: Record<string, unknown> = {};
    for (const [dimensionKey, entry] of Object.entries(dimensionScores)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        nextDimensionScores[dimensionKey] = entry;
        continue;
      }
      const reasoning = (entry as { reasoning?: unknown }).reasoning;
      if (typeof reasoning === "string" && reasoning.length > DIMENSION_REASONING_CLIP_CHARS) {
        dimensionScoresClipped = true;
        nextDimensionScores[dimensionKey] = {
          ...entry,
          reasoning: clipTextToBudget(reasoning, DIMENSION_REASONING_CLIP_CHARS),
        };
      } else {
        nextDimensionScores[dimensionKey] = entry;
      }
    }
    if (dimensionScoresClipped) {
      working = { ...working, dimension_scores: nextDimensionScores };
      anyClipped = true;
    }
  }

  // typed_gaps[].statement (SPEC-040 D9)
  const typedGapsResult = clipArrayField(working["typed_gaps"], "statement", TYPED_GAP_STATEMENT_CLIP_CHARS);
  if (typedGapsResult.clipped) {
    working = { ...working, typed_gaps: typedGapsResult.entries };
    anyClipped = true;
  }

  // typed_recommendations[].action, then .rationale (SPEC-040 D9) — two independent
  // single-field passes composed sequentially so either, both, or neither may clip.
  const actionResult = clipArrayField(
    working["typed_recommendations"],
    "action",
    TYPED_RECOMMENDATION_ACTION_CLIP_CHARS,
  );
  let typedRecommendations = actionResult.entries;
  let typedRecommendationsClipped = actionResult.clipped;
  const rationaleResult = clipArrayField(
    typedRecommendations,
    "rationale",
    TYPED_RECOMMENDATION_RATIONALE_CLIP_CHARS,
  );
  typedRecommendations = rationaleResult.entries;
  typedRecommendationsClipped = typedRecommendationsClipped || rationaleResult.clipped;
  if (typedRecommendationsClipped) {
    working = { ...working, typed_recommendations: typedRecommendations };
    anyClipped = true;
  }

  // unverifiable[].reason (SPEC-040 D9)
  const unverifiableResult = clipArrayField(working["unverifiable"], "reason", UNVERIFIABLE_REASON_CLIP_CHARS);
  if (unverifiableResult.clipped) {
    working = { ...working, unverifiable: unverifiableResult.entries };
    anyClipped = true;
  }

  if (!anyClipped) return { value, clippedAcIds: [] };
  return { value: working, clippedAcIds };
}

// ─── Content Rendering ──────────────────────────────────────────────────────

/**
 * Deterministically render a persisted AssessmentResult as human-readable Markdown.
 * No Date.now() / Math.random() — the same result always renders identically, so the
 * `content` field never drifts from `extra.assessment` for reasons outside the data itself.
 *
 * @param result - Full persisted assessment result
 * @returns Markdown string suitable for the knowledge doc's `content` field
 *
 * @example
 * renderAssessmentContent({
 *   scope: { type: "plan", id: "01ARZ3..." }, verdict: "met", overall_score: 90,
 *   ac_scores: [{ ac_id: "AC-1", score: 90, reasoning: "ok", evidence_refs: [] }],
 *   gaps: [], recommendations: [],
 *   judgment: { provider: "claude-cli", prompt_version: 1, duration_ms: 100, retried: false, truncated: [] },
 * });
 * // → "# Assessment: met (90/100)\n\n## AC Scores\n..."
 */
export function renderAssessmentContent(result: AssessmentResult): string {
  const lines: string[] = [];

  lines.push(`# Assessment: ${result.verdict} (${result.overall_score}/100)`);
  lines.push("");
  lines.push(`Scope: ${result.scope.type} \`${result.scope.id}\``);
  lines.push("");

  lines.push("## AC Scores");
  lines.push("");
  if (result.ac_scores.length > 0) {
    lines.push("| AC | Score | Reasoning | Evidence |");
    lines.push("|---|---|---|---|");
    for (const ac of result.ac_scores) {
      const evidence = ac.evidence_refs.map((e) => (e.note ? `${e.doc_id} (${e.note})` : e.doc_id)).join(", ") || "—";
      lines.push(`| ${ac.ac_id} | ${ac.score} | ${ac.reasoning.replace(/\|/g, "\\|")} | ${evidence} |`);
    }
  } else {
    lines.push("(no AC scores)");
  }
  lines.push("");

  lines.push("## Gaps");
  lines.push("");
  lines.push(result.gaps.length > 0 ? result.gaps.map((g) => `- ${g}`).join("\n") : "(none)");
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  lines.push(
    result.recommendations.length > 0
      ? result.recommendations.map((r) => `- ${r}`).join("\n")
      : "(none)",
  );
  lines.push("");

  lines.push("## Judgment");
  lines.push("");
  lines.push(`- Provider: ${result.judgment.provider}`);
  lines.push(`- Prompt version: ${result.judgment.prompt_version}`);
  lines.push(`- Duration: ${result.judgment.duration_ms}ms`);
  lines.push(`- Retried: ${result.judgment.retried}`);
  lines.push(
    `- Truncated sections: ${result.judgment.truncated.length > 0 ? result.judgment.truncated.join(", ") : "(none)"}`,
  );
  if (result.judgment.reasoning_clipped && result.judgment.reasoning_clipped.length > 0) {
    // reason: additive-only field (SPEC-029 AC-AR-3) — only rendered when present, so
    // pre-SPEC-029 assessments (no reasoning_clipped in judgment) render identically to
    // before this line existed.
    lines.push(`- Reasoning clipped for: ${result.judgment.reasoning_clipped.join(", ")}`);
  }

  // reason: every block below is additive-only (SPEC-040 D3) — each is guarded by
  // presence of its own optional field, so a legacy (pre-SPEC-040) AssessmentResult with
  // none of these fields set renders BYTE-IDENTICALLY to before this code existed
  // (regression-protected by assessment-schema-compat.test.ts).

  if (result.dimension_scores && Object.keys(result.dimension_scores).length > 0) {
    lines.push("");
    lines.push("## Dimension Scores");
    lines.push("");
    lines.push("| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |");
    lines.push("|---|---|---|---|---|");
    for (const [dimension, entry] of Object.entries(result.dimension_scores)) {
      lines.push(
        `| ${dimension} | ${entry.score} | ${entry.confidence} | ${entry.based_on} | ${entry.reasoning.replace(/\|/g, "\\|")} |`,
      );
    }
  }

  if (result.typed_gaps && result.typed_gaps.length > 0) {
    lines.push("");
    lines.push("## Typed Gaps");
    lines.push("");
    lines.push("| Dimension | Severity | AC Ref | Statement |");
    lines.push("|---|---|---|---|");
    for (const gap of result.typed_gaps) {
      lines.push(
        `| ${gap.dimension} | ${gap.severity} | ${gap.ac_ref ?? "—"} | ${gap.statement.replace(/\|/g, "\\|")} |`,
      );
    }
  }

  if (result.typed_recommendations && result.typed_recommendations.length > 0) {
    lines.push("");
    lines.push("## Typed Recommendations");
    lines.push("");
    lines.push("| Target | Action | Rationale |");
    lines.push("|---|---|---|");
    for (const rec of result.typed_recommendations) {
      lines.push(`| ${rec.target} | ${rec.action.replace(/\|/g, "\\|")} | ${rec.rationale.replace(/\|/g, "\\|")} |`);
    }
  }

  if (result.unverifiable && result.unverifiable.length > 0) {
    lines.push("");
    lines.push("## Unverifiable Materials");
    lines.push("");
    for (const entry of result.unverifiable) {
      lines.push(`- ${entry.material}: ${entry.reason}`);
    }
  }

  if (result.rubric_warning && result.rubric_warning.length > 0) {
    lines.push("");
    lines.push("## Rubric Warnings");
    lines.push("");
    for (const warning of result.rubric_warning) {
      lines.push(`- ${warning}`);
    }
  }

  if (result.facts) {
    lines.push("");
    lines.push("## Facts Summary");
    lines.push("");
    lines.push(`- AC coverage: ${result.facts.ac_coverage.length} declared criteria`);
    lines.push(`- Task evidence: ${result.facts.task_evidence.length} tasks`);
    if (result.facts.scope) {
      lines.push(
        `- AC scope: ${result.facts.scope.scoped_ids.length} scoped, ${result.facts.scope.dangling.length} dangling`,
      );
    }
    lines.push(
      `- Knowledge capture: ${result.facts.knowledge_capture.count} docs (${result.facts.knowledge_capture.source})`,
    );
    lines.push(
      `- Regression: tests_touched=${result.facts.regression.tests_touched}, attested_evidence_ratio=${result.facts.regression.attested_evidence_ratio.toFixed(2)}`,
    );
  }

  return lines.join("\n") + "\n";
}
