/**
 * AI plan-outcome assessment — LLM-as-judge result schema, plan bundle shape, JSON
 * extraction from raw AI output, truncation helpers, deterministic content rendering,
 * and deterministic facts computation (SPEC-040).
 * Pure, browser-safe module: no IO, no Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - evidenceRefSchema / EvidenceRef — one evidence citation inside an ac_scores entry
 *   - acScoreSchema / AcScore — per-AC judge score + reasoning + evidence
 *   - judgmentSchema / Judgment — judge run metadata (provider, prompt version, retry,
 *     truncation, optional three-state `reproducible` declaration for `prompt_version`)
 *   - scopeSchema — discriminator for what was assessed (v1 always {type: "plan", id})
 *   - ASSESSMENT_DIMENSIONS / AssessmentDimension — closed, append-only dimension taxonomy
 *     (SPEC-040 D2) — documented, not schema-enforced (see dimensionScoresSchema invariant)
 *   - dimensionScoresSchema / DimensionScores — permissive per-dimension judge score record
 *   - unverifiableEntrySchema / UnverifiableEntry — a material the judge could not verify
 *   - TYPED_FINDING_SEVERITIES / TypedFindingSeverity — typed_gaps[].severity enum
 *   - typedGapSchema / TypedGap — one structured gap finding (SPEC-040 D3); `paths` (D1,
 *     spec-judgment-surfaces-must-verify-before-they-certify-machine) is the finding's
 *     EXPLICITLY declared file-path list, `.default([])`
 *   - unverifiableFindingSchema / UnverifiableFinding — a TypedGap withdrawn from the scored
 *     set because a declared path was confirmed absent at the assessed commit (D2/D3); one
 *     entry per withdrawn finding in `unverifiable_findings[]`
 *   - pathsVerifiedSchema / PathsVerified — `{checked, unverifiable, unchecked}` three-state
 *     tally over every path any `typed_gaps[]` entry declared (D2/D3)
 *   - AssessDiffSource — caller-built (not schema-validated) mirror of the CLI/MCP adapters'
 *     `DiffSourceRecord` union, the input to `resolveAssessedCommit`
 *   - AssessedCommitResolution — `{status: "resolved", commit} | {status: "unchecked", reason}`
 *   - extractDiffRangeTip(range) — pure `A..B`/`A...B` range-string tip extraction
 *   - resolveAssessedCommit(diffSource) — pure D2 referent resolution, pinned per
 *     `AssessDiffSource.mode`, exhaustively — NEVER `HEAD`
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
 *     judgment + OPTIONAL facts/source_versions/unverifiable_findings/paths_verified,
 *     SPEC-040 D2; unverifiable_findings/paths_verified per D2/D3 above)
 *   - planBundleSchema / PlanBundle — {plan, spec?, tasks[], knowledge_links?} assembled by
 *     CorpusService.getPlanBundle (knowledge_links populated by SPEC-040 T2)
 *   - DiffMeta — pre-classified diff shape consumed by computeAssessmentFacts (caller-built,
 *     not schema-validated: an in-process function argument, not an external boundary)
 *   - computeAssessmentFacts(bundle, declaredCriteria, diffMeta?) — pure deterministic facts
 *     snapshot: AC coverage, per-task evidence completeness, AC-scope-vs-declared drift,
 *     knowledge-capture, and regression signals (SPEC-040 D1); additionally task-level
 *     `extra.linkage` justifications and the plan's attestation-floor exemption state
 *     (SPEC-069 §Design Decisions D1/D3, `task_linkage`/`attestation_exemption`)
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
 *   - parseDiffFilePaths(diffText) — pure `diff --git a/… b/…` header parse, returns the
 *     "b/" (post-change) path per file, deduplicated, in first-seen order (assess
 *     diff-range scope guard, hotfix plan)
 *   - scopeMismatchWarningSchema / ScopeMismatchWarning — non-blocking advisory shape
 *     surfaced when a `lore assess --diff` range looks too wide for the plan it's assessing
 *   - ScopeMismatchNotMeasured — distinct "the comparison could not be attempted" outcome of
 *     computeScopeMismatchWarning, never confusable with `undefined` (measured, fine) or a
 *     real ScopeMismatchWarning (measured, mismatch) — task-computescopemismatchwarning-
 *     cannot-distinguish-a-too-wide, per adr-lore-s-mechanisms-validate-a-proxy-for-the-
 *     property-not-the's Q2 (Silence)
 *   - DeriveTestedSourcePath — caller-injected, repo-specific test-file→source-file path
 *     convention (pure string transform; this browser-safe leaf package has no opinion on
 *     any project's test-file layout)
 *   - isFileInScopeForAnchors(file, taskAnchors, deriveTestedSourcePath?) — the classification
 *     rule computeScopeMismatchWarning scores against, exported standalone so the rule itself
 *     is directly testable
 *   - computeScopeMismatchWarning(diffFiles, taskAnchors, deriveTestedSourcePath?) — pure
 *     fact-only comparison between a diff's changed files and a plan's declared task
 *     file_anchors; classifies non-anchor files as in-scope test-of-anchor evidence vs.
 *     genuine drift BEFORE scoring the ratio
 *   - TRUNCATION_DOWNGRADE_THRESHOLDS — the SPEC-067 D4 truncation-ratio thresholds
 *     (single exported constant, never scattered literals)
 *   - computeTaskTruncationRatio(truncatedSections, totalTaskCount) — pure fraction of a
 *     plan's tasks whose section was truncated in the judge prompt (SPEC-067 D4)
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
 *   - parseDiffFilePaths never throws — a diff with no recognizable `diff --git a/... b/...`
 *     headers (e.g. empty string, a non-git diff format) simply yields `[]`.
 *   - computeScopeMismatchWarning is a deterministic FACTS comparison (diff files vs. task
 *     anchors, test-of-anchor files reclassified as in-scope by isFileInScopeForAnchors
 *     BEFORE scoring), never an LLM judgment — it must not be confused with the judge's own
 *     `scope_fidelity` dimension score. It returns {@link ScopeMismatchNotMeasured} — never a
 *     bare `undefined` — in two cases: `taskAnchors` is empty (no task in the plan declared
 *     any file_anchors) OR `diffFiles` is empty (nothing to compare against); both are
 *     "the comparison could not be attempted", distinct from `undefined` ("attempted, and
 *     it's fine") per adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the's Q2 —
 *     see task-computescopemismatchwarning-cannot-distinguish-a-too-wide. Otherwise it warns
 *     iff STRICTLY fewer than half of `diffFiles` are in-scope — exactly half is NOT a
 *     mismatch (boundary-tested, byte-identical to the pre-fix behaviour).
 *   - `scope_warning` on {@link assessmentResultSchema} is OPTIONAL and ADDITIVE, mirroring
 *     `facts`/`source_versions` — every assessment persisted before this warning existed
 *     has no `scope_warning` and still validates unchanged. It NEVER affects `verdict`,
 *     `overall_score`, or whether the assessment persists — advisory only.
 *   - SPEC-067 D3/D4 mechanical downgrades (computed by the service layer, `ai-provider-service.ts`,
 *     NOT here — this module stays schema+pure-helper-only, same division as every prior
 *     assessment feature):
 *     - `dimensionScoreEntrySchema.confidence` is widened from a bare `z.number().min(0).max(1)`
 *       to `number | "low"` — `"low"` is a service-written sentinel DISTINCT from any
 *       judge-reported float, stamped when a `based_on:"absence"` score has no matching
 *       `unverifiable[]`/`judgment.truncated[]` citation (D3). Backward-compatible: every
 *       already-persisted numeric confidence value still parses.
 *     - `dimensionScoreEntrySchema.confidence_reason` is a NEW optional field, additive-only
 *       (present only alongside a service-forced `confidence: "low"`, absent on every
 *       pre-SPEC-067 dimension score and on judge-reported floats).
 *     - `judgmentSchema.overall_confidence`/`degraded_by_truncation` are NEW optional fields
 *       (both additive-only, present-iff-true/present-iff-"low") — set when
 *       {@link computeTaskTruncationRatio} exceeds {@link TRUNCATION_DOWNGRADE_THRESHOLDS}'s
 *       `confidenceCapRatio` (D4).
 *     - `assessmentResultSchema.verdict` is widened to add `"inconclusive"` and
 *       `assessmentResultSchema.overall_score` is widened from required to optional — both
 *       ONLY on the persisted shape (never on `llmAssessmentOutputSchema` — the judge itself
 *       never emits either override), set when {@link computeTaskTruncationRatio} reaches
 *       `TRUNCATION_DOWNGRADE_THRESHOLDS.inconclusiveRatio` (100% of tasks truncated, D4).
 *   - `judgmentSchema.reproducible` (task-assess-templates-5-binds-the-projected-renderer-
 *     while-two) is a NEW optional field, additive-only, mirroring the SPEC-067 fields above
 *     — a GENUINE three-state boolean (`true` / `false` / absent-means-"not recorded", never
 *     coerced): declares whether `prompt_version`'s registry entry
 *     (`packages/lore/src/ai/assess-template.ts`'s `ASSESS_TEMPLATES` /
 *     `getAssessTemplateReproducibility`) is guaranteed byte-identical output forever. See
 *     the field's own JSDoc on {@link judgmentSchema} for the full three-state contract and
 *     `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` (Q2) for why absence
 *     must never read as `true`.
 *   - `typedGapSchema.paths` / `unverifiableFindingSchema` / `pathsVerifiedSchema` /
 *     `resolveAssessedCommit` (D1/D2/D3, spec-judgment-surfaces-must-verify-before-they-
 *     certify-machine) declare the SHAPES and the PURE referent-resolution rule only — the
 *     actual `git cat-file -e` verification is IO and lives in the exported
 *     `verifyFindingPaths` function (`packages/lore/src/service/ai-provider-service.ts`,
 *     called from `AIProviderService`'s private `_finalizeAssessment`), never here.
 *     `resolveAssessedCommit` never substitutes `HEAD` for the assessed commit — that
 *     substitution IS the defect this mechanism exists to fix.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §3 D2, D6, D7; §4 AC-ASSESS-1..13; §5; §8.1, §8.2; SPEC-029 AC-AR-2, AC-AR-3;
 *   SPEC-040 §T1 D1, D2, D3, D9; AC-ADF-2, AC-ADF-10;
 *   task-assess-diff-range-scope-mismatch-warning (hotfix plan, AC-040-SCOPE-1);
 *   task-assess-templates-5-binds-the-projected-renderer-while-two (judgment.reproducible);
 *   SPEC-067 D3, D4;
 *   task-computescopemismatchwarning-cannot-distinguish-a-too-wide (test-of-anchor
 *   reclassification, ScopeMismatchNotMeasured);
 *   adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the (Proxy/Silence/Opt-in);
 *   spec-judgment-surfaces-must-verify-before-they-certify-machine D1, D2, D3
 *   (task-verify-assess-finding-paths-against-the-assessed-commit)
 */

import { z } from "zod";
import type { DocRecord } from "./types.js";
import type { LoreError } from "./errors.js";
import { err, ok, type Result } from "./errors.js";
import { AC_VERIFY_MODES, computeAcCoverage, type AcceptanceCriterion } from "./acceptance.js";
import { ORACLE_KINDS, extractEvidence } from "./task-workflow.js";
import { headChars } from "./truncate.js";
import { anchorsOverlap } from "./file-anchors.js";

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
 * @invariant reproducible is additive-only and a genuine THREE-STATE field, never coerced
 *   to a boolean (task-assess-templates-5-binds-the-projected-renderer-while-two, per
 *   `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`'s Q2): `true` means
 *   `prompt_version`'s registry entry (`ASSESS_TEMPLATES`/`getAssessTemplateReproducibility`,
 *   `packages/lore/src/ai/assess-template.ts`) is declared OUTPUT-FROZEN — re-rendering the
 *   same input through the SAME registry key will always produce byte-identical text.
 *   `false` means the registry entry is explicitly declared NOT reproducible (currently
 *   only slot 5, `buildAssessPrompt` — SPEC-040 §T2 D6 exempted it from the byte-identical
 *   guarantee, and its rendering genuinely changed at commit a639485 while the registry key
 *   stayed `5`). `undefined` (the field simply absent) means NEITHER of those — this
 *   assessment was persisted before this field existed, and NO claim about reproducibility
 *   can be read from it. A reader (or any future code) MUST treat absence as "not recorded",
 *   never as an implicit `true` — an absent field silently reading as "reproducible" is
 *   exactly the failure mode the cited ADR's Question 2 names. Stamped by the caller that
 *   resolves `prompt_version`'s registry entry (see `getAssessTemplateReproducibility` in
 *   `assess-template.ts`) — this schema only declares the shape, it never derives the value.
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
 * judgmentSchema.parse({
 *   provider: "claude-cli", prompt_version: 6, duration_ms: 4230,
 *   retried: false, truncated: ["task:t1", "task:t2"],
 *   overall_confidence: "low", degraded_by_truncation: true,
 * });
 * judgmentSchema.parse({
 *   provider: "claude-cli", prompt_version: 5, duration_ms: 4230,
 *   retried: false, truncated: [], reproducible: false,
 * });
 */
export const judgmentSchema = z.object({
  provider: z.string().min(1),
  prompt_version: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative(),
  retried: z.boolean(),
  truncated: z.array(z.string()),
  reasoning_clipped: z.array(z.string()).optional(),
  /**
   * SPEC-067 D4 — set to `"low"` ONLY when {@link computeTaskTruncationRatio} exceeds
   * {@link TRUNCATION_DOWNGRADE_THRESHOLDS}.confidenceCapRatio. Additive-only: absent on
   * every assessment persisted before SPEC-067 and on every run below the cap threshold.
   * `"low"` is the only value this field ever holds — no other cap tier is defined.
   */
  overall_confidence: z.literal("low").optional(),
  /**
   * SPEC-067 D4 — `true` iff `overall_confidence` was forced to `"low"` by task-truncation
   * coverage. Present-iff-true (mirrors `evidenceEntrySchema.attestation.first_seen`'s
   * convention) — never `false`, just omitted.
   */
  degraded_by_truncation: z.literal(true).optional(),
  /**
   * task-assess-templates-5-binds-the-projected-renderer-while-two — whether `prompt_version`'s
   * registry entry is declared reproducible (byte-identical output forever). Genuinely
   * three-state: `true` / `false` / absent-means-"not recorded" — see this field's own
   * `@invariant` above on {@link judgmentSchema} for the full contract. Additive-only:
   * absent on every assessment persisted before this field existed.
   */
  reproducible: z.boolean().optional(),
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
 * @invariant confidence is advisory-only and self-reported by the judge as a 0-1 float —
 *   never treated as a calibrated probability. {@link renderAssessmentContent} labels it
 *   accordingly. SPEC-067 D3 widens this to `number | "low"`: the literal string `"low"`
 *   is a SERVICE-WRITTEN sentinel (never judge-emitted — the prompt only ever asks for a
 *   float), stamped by `applyGroundingConfidenceDowngrade` (`ai-provider-service.ts`) when
 *   this entry is `based_on:"absence"` with no matching `unverifiable[]`/
 *   `judgment.truncated[]` citation. Distinguishing the sentinel from any float means a
 *   downgraded entry is identifiable by an exact `confidence === "low"` check alone.
 * @invariant reasoning is capped at 200 chars; clipped pre-validation by
 *   {@link clipOverlongReasoning} (SPEC-040 D9), mirroring acScoreSchema's reasoning cap.
 * @invariant confidence_reason is additive-only (SPEC-067 D3) — present ONLY alongside a
 *   service-forced `confidence: "low"`; absent on every pre-SPEC-067 dimension score and
 *   on every judge-reported float confidence.
 */
const dimensionScoreEntrySchema = z.object({
  score: z.number().int().min(0).max(100),
  confidence: z.union([z.number().min(0).max(1), z.literal("low")]),
  based_on: z.enum(["evidence", "absence"]),
  reasoning: z.string().max(200),
  confidence_reason: z.string().optional(),
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
 * @invariant `paths` (spec-judgment-surfaces-must-verify-before-they-certify-machine D1) is
 *   `.default([])`, NEVER required — a required field would make every assessment stored
 *   before this field existed fail to re-parse. It is the EXPLICIT list of file paths this
 *   finding names in `statement`'s prose; `AIProviderService`'s path-verification pass (D2)
 *   checks each entry against the assessed commit, never regex-extracting paths out of
 *   `statement` itself (a heuristic extractor would be a second, unverified surface — see
 *   this field's governing spec's Problem section). Defaults to `[]` for a finding that
 *   names no file path at all.
 */
export const typedGapSchema = z.object({
  dimension: z.string().min(1),
  severity: z.enum(TYPED_FINDING_SEVERITIES),
  ac_ref: z.string().optional(),
  statement: z.string().max(500),
  paths: z.array(z.string()).default([]),
});

/** Derived TypeScript type for one typed gap. */
export type TypedGap = z.infer<typeof typedGapSchema>;

/**
 * One {@link TypedGap} that could NOT be verified against the assessed commit (D2/D3,
 * spec-judgment-surfaces-must-verify-before-they-certify-machine) — carries every field the
 * original finding had, PLUS which declared path failed verification and which commit it
 * was checked against. Moved here out of the scored set (`typed_gaps[]`) rather than
 * silently dropped: `overall_score` is left byte-identical to what the judge emitted (the
 * severity→score arithmetic lives in the judge LLM, never re-derived here), so a withdrawn
 * finding must remain visible as the record of WHY the score and the surviving findings
 * disagree in count.
 *
 * @invariant Extends {@link typedGapSchema} — every field a surviving finding has, a
 *   withdrawn one keeps, so a reader never needs to cross-reference the original judge
 *   output to see what was withdrawn.
 * @invariant `failing_path` is exactly ONE of `paths` — the first path (encounter order)
 *   that `git cat-file -e <checked_against_commit>:<path>` reported absent. A finding
 *   declaring multiple paths where only one fails is STILL withdrawn wholesale (the finding
 *   is the unit of withdrawal, not the individual path) — `failing_path` names which one
 *   triggered it, it does not claim it was the ONLY one.
 */
export const unverifiableFindingSchema = typedGapSchema.extend({
  failing_path: z.string().min(1),
  /** Absent for `not-shown-to-judge` withdrawals — that fact needs no git referent. */
  checked_against_commit: z.string().min(1).optional(),
  /**
   * Why the finding was withdrawn. `"not-shown-to-judge"`: a path it declares was wholly
   * omitted from the diff the judge saw (F2, AC-CRIT-3) — `failing_path` is the first such
   * path. Absent means the legacy meaning, `"path-absent"` (a declared path does not exist at
   * `checked_against_commit`); records written before F2 never carry the field.
   */
  reason: z.enum(["not-shown-to-judge", "path-absent"]).optional(),
});

/** Derived TypeScript type for one withdrawn (unverifiable) finding. */
export type UnverifiableFinding = z.infer<typeof unverifiableFindingSchema>;

/**
 * Path-verification tallies for one assess run (D2/D3) — a THREE-STATE partition over every
 * path any `typed_gaps[]` entry declared, never a two-state checked/unchecked collapse.
 *
 * @invariant `checked` — paths confirmed to EXIST at the assessed commit (their finding was
 *   kept, or another path on the same finding failed while this one passed).
 * @invariant `unverifiable` — paths confirmed ABSENT at the assessed commit (their finding
 *   moved to {@link unverifiableFindingSchema}[]).
 * @invariant `unchecked` — paths that were NEVER looked up at all, because
 *   `extra.diff_source` resolved to no git referent (`explicit_diff_text`,
 *   `explicit_diff_file`, or an `auto_derived` run with zero commits) — see
 *   `resolveAssessedCommit`'s own JSDoc. MUST render distinctly from `checked`: a reader
 *   must never mistake "we did not look" for "we looked and it was fine".
 */
export const pathsVerifiedSchema = z.object({
  checked: z.number().int().nonnegative(),
  unverifiable: z.number().int().nonnegative(),
  unchecked: z.number().int().nonnegative(),
  /**
   * Findings withdrawn because a path they declare was wholly omitted from the diff the judge
   * saw (F2, AC-CRIT-3) — a COUNT OF FINDINGS, distinct from `unverifiable` (paths absent at
   * the commit). Absent on records written before F2.
   */
  not_shown: z.number().int().nonnegative().optional(),
});

/** Derived TypeScript type for the D2/D3 path-verification tallies. */
export type PathsVerified = z.infer<typeof pathsVerifiedSchema>;

// ─── Assessed-Commit Resolution (D2, spec-judgment-surfaces-must-verify-before-they-certify-machine) ───

/**
 * Service-layer-owned mirror of the CLI/MCP adapters' `DiffSourceRecord` union
 * (`packages/lore/src/adapters/cli/assess-commit-derivation.ts`) — deliberately NOT
 * imported from there: this package is a dependency-free leaf (see this module's own
 * header) and services never depend on the adapter layer either
 * (`packages/lore/src/service/CLAUDE.md`'s "Service per concern" pattern). Every field
 * name/shape here matches `DiffSourceRecord` exactly, so a real `DiffSourceRecord` value
 * satisfies this type with zero cast the day a caller threads `opts.diffSource` through
 * from `commands/assess.ts` / MCP `tools.ts` (currently NOT wired — see
 * `AIProviderService.assessPlan`'s own JSDoc on `opts.diffSource`).
 */
export type AssessDiffSource =
  | { mode: "explicit_diff"; range: string }
  | { mode: "explicit_diff_file"; path: string }
  | { mode: "explicit_diff_text" }
  | {
      mode: "auto_derived";
      status: "derived" | "no_commits_found" | "unverifiable_convention_mismatch";
      /** Oldest-first, mirroring `deriveCommitSetForPlan`'s own ordering — see {@link resolveAssessedCommit}. */
      commits: ReadonlyArray<{ sha: string }>;
    };

/**
 * The outcome of resolving ONE assessed commit to check finding paths against — a
 * discriminated union, never a bare `string | undefined`, so a caller cannot mistake "there
 * is no referent" for "the referent is the empty string".
 */
export type AssessedCommitResolution = { status: "resolved"; commit: string } | { status: "unchecked"; reason: string };

/**
 * Extracts the "B" (tip) side of a `git diff`-style range string — `A..B` or `A...B` (the
 * latter git's symmetric-difference syntax; both keep the SAME tip semantics for "which tree
 * was the judge shown"). A range with NO dot-run at all (a single ref, e.g. `"HEAD"`,
 * diffing that ref against the working tree) is its own tip.
 *
 * @invariant Greedy match on the LEADING group — for a pathological multi-dot-run input
 *   (`"a..b..c"`), the LAST dot-run's suffix wins (`"c"`), matching "the tip is whatever
 *   comes after the final range separator".
 * @param range - Raw `--diff <range>` string, e.g. `"HEAD~3..HEAD"`
 * @returns The tip ref, or `undefined` for an empty/whitespace-only input
 *
 * @example
 * extractDiffRangeTip("HEAD~3..HEAD"); // → "HEAD"
 * extractDiffRangeTip("abc123...def456"); // → "def456"
 * extractDiffRangeTip("HEAD"); // → "HEAD" (no dot-run — the whole string is the tip)
 */
export function extractDiffRangeTip(range: string): string | undefined {
  const trimmed = range.trim();
  if (trimmed.length === 0) return undefined;
  const dotRangeMatch = /^(.*)\.{2,3}([^.]+)$/.exec(trimmed);
  if (dotRangeMatch) {
    const tip = (dotRangeMatch[2] ?? "").trim();
    return tip.length > 0 ? tip : undefined;
  }
  return trimmed;
}

/**
 * Resolves the ONE commit finding-path verification must check against (D2) — pinned
 * per {@link AssessDiffSource}.mode, exhaustively, NEVER `HEAD` (substituting `HEAD` for the
 * assessed commit is precisely the original defect this mechanism exists to fix):
 *   - `explicit_diff` — the range's tip (`B` in `A..B`): the tree state the judge was
 *     actually shown; the range's baseline (`A`) and the merge base are neither.
 *   - `explicit_diff_file` — records a FILE PATH read from disk (`--diff-file <path>`),
 *     never a git range or commit. There is no git ref to resolve here at all — the SAME
 *     "no referent exists" case `explicit_diff_text` is below, even though a literal
 *     reading of this mechanism's governing spec groups this mode with `explicit_diff`'s
 *     range-bearing case; `DiffSourceRecord`'s actual persisted shape
 *     (`assess-commit-derivation.ts`) has never carried a `range` for this mode.
 *   - `explicit_diff_text` — no range, no commits: there IS no referent. Verification is
 *     SKIPPED and recorded as `"unchecked"`, never silently counted as verified and never a
 *     hard failure.
 *   - `auto_derived` — the NEWEST entry in `commits[]` (oldest-first order, per
 *     `deriveCommitSetForPlan`'s own documented ordering) — NOT every commit: a path added
 *     partway through the derived range exists at the tip and not at the earliest commit, so
 *     an all-commits rule would withdraw findings about newly added files. Zero commits
 *     (either zero-match status) is the same "no referent" case as `explicit_diff_text`.
 *   - `undefined` (no diff source recorded at all — e.g. a caller that has not yet threaded
 *     `opts.diffSource` through) — same "no referent" / `"unchecked"` treatment.
 *
 * @invariant Pure — no IO, no git calls. Resolving WHICH commit to check is separate from
 *   verifying paths AGAINST it (that requires `git cat-file -e`, a service-layer concern —
 *   `AIProviderService._verifyFindingPaths`).
 * @param diffSource - The run's recorded diff-source record, or `undefined`
 * @returns `{status: "resolved", commit}` when a referent exists; `{status: "unchecked",
 *   reason}` naming why not, otherwise
 *
 * @example
 * resolveAssessedCommit({ mode: "explicit_diff", range: "HEAD~3..HEAD" });
 * // → { status: "resolved", commit: "HEAD" }
 *
 * @example
 * resolveAssessedCommit({ mode: "auto_derived", status: "derived", commits: [{ sha: "aaa" }, { sha: "bbb" }] });
 * // → { status: "resolved", commit: "bbb" } (the NEWEST — last — entry)
 *
 * @example
 * resolveAssessedCommit({ mode: "explicit_diff_text" });
 * // → { status: "unchecked", reason: "explicit_diff_text has no range and no commits" }
 */
export function resolveAssessedCommit(diffSource: AssessDiffSource | undefined): AssessedCommitResolution {
  if (diffSource === undefined) {
    return { status: "unchecked", reason: "no diff source was recorded for this assess run" };
  }
  switch (diffSource.mode) {
    case "explicit_diff": {
      const tip = extractDiffRangeTip(diffSource.range);
      return tip === undefined
        ? { status: "unchecked", reason: `explicit_diff range "${diffSource.range}" has no resolvable endpoint` }
        : { status: "resolved", commit: tip };
    }
    case "explicit_diff_file":
      return {
        status: "unchecked",
        reason: "explicit_diff_file records a file path read from disk, not a git commit reference",
      };
    case "explicit_diff_text":
      return { status: "unchecked", reason: "explicit_diff_text has no range and no commits" };
    case "auto_derived": {
      const newest = diffSource.commits[diffSource.commits.length - 1];
      return newest === undefined
        ? { status: "unchecked", reason: `auto_derived (${diffSource.status}) recorded no commits` }
        : { status: "resolved", commit: newest.sha };
    }
  }
}

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
  // SPEC-061 §Scope D5 — mirrors acceptance.ts's EvidenceRefLite.result widening
  // (a runner-issued "inconclusive" verdict never counts as attested_pass/fail
  // there; this Zod mirror must accept the same value or assigning a real
  // computeAcCoverage() result here fails to typecheck). "expected-fail" (spec-
  // workflow-hardening-evidence-red-vocabulary-claim-worktree §M1, AC-WH-1) is
  // the self-reported RED-phase sibling of "inconclusive" — same widening
  // requirement, same "never counted as passing" property.
  result: z.enum(["pass", "fail", "inconclusive", "expected-fail"]),
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
 * One task's `extra.linkage` justification (SPEC-069 §Design Decisions D3) — the
 * free-text explanation of WHY an `--linkage`-created task is attached to this plan
 * despite looking unrelated to its declared scope. Only tasks that actually carry a
 * non-empty `extra.linkage` appear here (an omission-based "unavailable" state would
 * be noise on the many plans with zero `--linkage` tasks — mirrors this module's
 * `knowledge_capture.source: "unavailable"` distinction being reserved for a
 * genuinely different situation: bundle assembly predating T2, not "nothing to say").
 */
const taskLinkageFactSchema = z.object({
  task_id: z.string(),
  linkage: z.string(),
});

/**
 * Plan-level attestation-floor exemption fact (SPEC-069 §Design Decisions D1, consumed
 * here per D1's own text: "exemption is visible in `lore assess` facts either way").
 * `exempt: false` (with `reason` omitted) is the default, non-exempted state — this
 * field is ALWAYS present (unlike `scope`, which is spec-presence-gated) since
 * exemption is a plan-level fact independent of whether the plan has a spec parent.
 */
const attestationExemptionFactSchema = z.object({
  exempt: z.boolean(),
  reason: z.string().optional(),
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
 * @invariant `task_linkage` and `attestation_exemption` (SPEC-069 §Design Decisions
 *   D1/D3, AC-069-4/AC-069-6) are `.optional()` at the SCHEMA layer ONLY for
 *   backward compatibility — a pre-SPEC-069 persisted `facts` object (SPEC-040-era,
 *   missing these two keys entirely) must still `safeParse` successfully, the same
 *   additive-field discipline `dimension_scores`/`typed_gaps`/`unverifiable`/
 *   `rubric_warning` already established on the LLM output side. {@link
 *   computeAssessmentFacts} itself ALWAYS populates both for every NEW facts
 *   snapshot it computes (`task_linkage: []` / `attestation_exemption: {exempt:
 *   false}` are the "nothing to report" states, never an omitted key) — unlike
 *   `scope`, which genuinely IS absent for a spec-less bundle (AC-ADF-10).
 */
export const assessmentFactsSchema = z.object({
  ac_coverage: z.array(acCoverageFactSchema),
  task_evidence: z.array(taskEvidenceFactSchema),
  scope: acScopeFactsSchema.optional(),
  knowledge_capture: knowledgeCaptureFactSchema,
  regression: regressionFactsSchema,
  task_linkage: z.array(taskLinkageFactSchema).optional(),
  attestation_exemption: attestationExemptionFactSchema.optional(),
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

// ─── Diff-Range Scope-Mismatch Warning (assess diff-range scope guard) ──────

/** Matches a git unified-diff file header, e.g. `diff --git a/src/foo.ts b/src/foo.ts`. */
const DIFF_GIT_HEADER_PATTERN = /^diff --git a\/(.*) b\/(.*)$/;

/**
 * Pure parse of a unified diff's changed-file set from its `diff --git a/… b/…` headers.
 * Never throws — a diff with no recognizable headers (empty string, a non-git diff
 * format) simply yields `[]`.
 *
 * @param diffText - Raw unified diff text (e.g. `git diff <range>` stdout)
 * @returns The "b/" (post-change) path of every distinct file header, deduplicated,
 *   first-seen order preserved
 *
 * @example
 * parseDiffFilePaths(
 *   "diff --git a/src/foo.ts b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n" +
 *   "diff --git a/src/bar.ts b/src/bar.ts\n@@ -1 +1 @@\n-old\n+new\n",
 * );
 * // → ["src/foo.ts", "src/bar.ts"]
 *
 * @example
 * parseDiffFilePaths("not a diff at all"); // → []
 */
export function parseDiffFilePaths(diffText: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of diffText.split("\n")) {
    const match = DIFF_GIT_HEADER_PATTERN.exec(line);
    if (match === null) continue;
    const filePath = match[2];
    if (filePath === undefined || filePath.length === 0) continue;
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    paths.push(filePath);
  }
  return paths;
}

/**
 * Non-blocking advisory surfaced on {@link AssessmentResult} when a `lore assess --diff`
 * range looks too wide for the plan being assessed (mechanizes the discipline behind
 * three real incidents — see task-assess-diff-range-scope-mismatch-warning).
 */
export const scopeMismatchWarningSchema = z.object({
  /** Total distinct files the diff touches. */
  diff_file_count: z.number().int().nonnegative(),
  /**
   * How many of those files are IN SCOPE per {@link isFileInScopeForAnchors} — a direct
   * anchor overlap OR a recognized test of an anchor-overlapping source file. NOT merely
   * "directly touches a declared anchor" (that was the pre-fix, over-narrow meaning).
   */
  intersecting_count: z.number().int().nonnegative(),
  /** Human-readable warning text — ready to print as-is (CLI text + `--json`). */
  message: z.string().min(1),
});

/** Derived TypeScript type for the scope-mismatch warning. */
export type ScopeMismatchWarning = z.infer<typeof scopeMismatchWarningSchema>;

/**
 * Distinct "the comparison could not be attempted" outcome of
 * {@link computeScopeMismatchWarning} (ADR Q2, Silence) — a check's absent precondition must
 * never collapse into the same value as "measured, genuinely fine, no warning". Deliberately
 * NOT structurally compatible with {@link ScopeMismatchWarning} (different field set): a
 * caller that narrows on `.status` cannot mistake a not-measured marker for a real warning to
 * surface, and one that ignores `.status` entirely still gets a value it must explicitly
 * decide to persist/print (never a silent pass-through, since it is not `undefined`).
 *
 * Whether a caller SURFACES this to a human is a presentation choice; that it EXISTS as a
 * value distinct from `undefined` is not (task-computescopemismatchwarning-cannot-
 * distinguish-a-too-wide).
 */
export interface ScopeMismatchNotMeasured {
  /** Discriminant — always `"not-measured"`. */
  readonly status: "not-measured";
  /** Why the comparison could not be attempted. Stable `"not-measured: "` prefix. */
  readonly reason: string;
}

/**
 * Caller-supplied convention for mapping a candidate diff file path to the SOURCE path it is
 * a TEST for — a pure string transformation, never filesystem access. Returns `undefined`
 * when the caller's convention does not recognize `filePath` as a test file at all.
 *
 * `@lore/core` is a browser-safe, dependency-free leaf package (see this module's own
 * header) with no opinion on any project's test-file layout — a sibling `.test.ts`, a
 * `.bun.test.ts` runner split, a mirrored `tests/` directory tree, or none of the above.
 * Every consumer answers this differently, so the convention is injected as a parameter
 * rather than hard-coded here.
 *
 * @example
 * // A repo-specific convention — NOT implemented in this package, only its shape is:
 * const deriveTestedSourcePath: DeriveTestedSourcePath = (f) => {
 *   if (f.endsWith(".bun.test.ts")) return f.slice(0, -".bun.test.ts".length) + ".ts";
 *   if (f.endsWith(".test.ts")) return f.slice(0, -".test.ts".length) + ".ts";
 *   return undefined;
 * };
 */
export type DeriveTestedSourcePath = (filePath: string) => string | undefined;

/**
 * The classification rule {@link computeScopeMismatchWarning} scores against. A diff file is
 * IN SCOPE for `taskAnchors` iff EITHER:
 *   (a) it directly overlaps a declared anchor ({@link anchorsOverlap}), OR
 *   (b) `deriveTestedSourcePath` recognizes it as a test file AND the SOURCE path it derives
 *       overlaps a declared anchor.
 *
 * (b) exists because task `file_anchors` declare the IMPLEMENTATION surface (so the
 * `noAnchorOverlap` gate can serialize concurrent writers on source files) — they are never
 * expected to also enumerate every test file beside that source. A test file for an in-scope
 * source file is in-scope EVIDENCE of that change, not scope drift. Every other file —
 * neither a declared anchor nor a recognized test of one — is OUT OF SCOPE: the genuine
 * range-drift signal {@link computeScopeMismatchWarning} warns on.
 *
 * Pure: `deriveTestedSourcePath`, if supplied, MUST itself be a pure string transformation —
 * this function never touches the filesystem to decide test-ness, and neither may its caller.
 *
 * @param file - One diff file path (as {@link parseDiffFilePaths} yields).
 * @param taskAnchors - The plan's declared task `file_anchors` (already-normalized — the
 *   same precondition {@link anchorsOverlap} documents).
 * @param deriveTestedSourcePath - Optional repo-specific test→source convention (see
 *   {@link DeriveTestedSourcePath}). Omitted → `file` is judged by direct overlap only, i.e.
 *   no test-file reclassification (rule (a) alone).
 * @returns `true` iff `file` is in scope by (a) or (b) above.
 *
 * @example
 * isFileInScopeForAnchors("src/a.ts", ["src/a.ts"]); // → true (direct overlap)
 *
 * @example
 * isFileInScopeForAnchors("src/a.test.ts", ["src/a.ts"], (f) =>
 *   f.endsWith(".test.ts") ? f.slice(0, -".test.ts".length) + ".ts" : undefined,
 * ); // → true (recognized test of an in-scope source file)
 *
 * @example
 * isFileInScopeForAnchors("docs/readme.md", ["src/a.ts"]); // → false (neither anchor nor test)
 */
export function isFileInScopeForAnchors(
  file: string,
  taskAnchors: string[],
  deriveTestedSourcePath?: DeriveTestedSourcePath,
): boolean {
  if (anchorsOverlap([file], taskAnchors).overlaps) return true;
  const testedSource = deriveTestedSourcePath?.(file);
  return testedSource !== undefined && anchorsOverlap([testedSource], taskAnchors).overlaps;
}

/**
 * Compares a diff's changed-file set against a plan's declared task `file_anchors` and
 * returns a non-blocking warning when the diff looks too wide for that plan — a deterministic
 * FACTS comparison, never an LLM judgment (must not be confused with the judge's own
 * `scope_fidelity` dimension score).
 *
 * Classification rule (task-computescopemismatchwarning-cannot-distinguish-a-too-wide):
 * every non-intersecting file is classified by {@link isFileInScopeForAnchors} BEFORE the
 * ratio is applied — a file that is a recognized test beside a declared anchor is in-scope
 * evidence, never counted as drift. This closes the false positive this function used to
 * raise on every correctly-scoped plan whose tasks shipped more test files than source files
 * (this repo's own six-dimension test mandate makes that the COMMON case, not the edge case;
 * measured twice in the session that filed this task: 17 files/4 intersecting, and 8 files/2
 * intersecting — both plans were correctly scoped, both warnings were false).
 *
 * ADR three-question review (`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`):
 *   - **Proxy** — the ratio is a proxy for "this range matches the plan's own work", never
 *     the property itself. Concrete input that satisfies the proxy while violating the
 *     property: a plan whose declared anchors are unrelated to the diff, but whose diff
 *     happens to also touch a same-named test file for one of those unrelated anchors —
 *     {@link isFileInScopeForAnchors} counts it in-scope by coincidence. Accepted: bounded by
 *     `anchorsOverlap`'s segment-exact semantics (no fuzzy/substring matching), and strictly
 *     narrower than the false-positive gap this fix closes.
 *   - **Silence** — the PRIOR implementation returned a bare `undefined` for THREE distinct
 *     causes (no task declared anchors; the diff touched no files; measured and genuinely
 *     fine) — all indistinguishable downstream. The first two now return
 *     {@link ScopeMismatchNotMeasured}, a value distinct from both `undefined` (measured,
 *     fine) and `ScopeMismatchWarning` (measured, mismatch).
 *   - **Opt-in** — the check still only runs meaningfully for plans where ≥1 task declared
 *     `file_anchors` (SPEC-042's opt-in anchor discipline) — that population boundary is
 *     unchanged by this fix, but the exemption is now VISIBLE via
 *     {@link ScopeMismatchNotMeasured} rather than silently absorbed into "no warning".
 *
 * @invariant Returns {@link ScopeMismatchNotMeasured} — never bare `undefined` — when
 *   `taskAnchors` is empty (no task in the plan declared any file_anchors) or `diffFiles` is
 *   empty (nothing to compare). Each carries its own distinct `reason` string; both are
 *   distinct from the `undefined` returned by the "measured, no mismatch" path below.
 * @invariant Returns `undefined` (measured; genuinely fine, no warning) iff at least half of
 *   `diffFiles` are in-scope per {@link isFileInScopeForAnchors}. Exactly half is NOT a
 *   mismatch (boundary-tested, byte-identical to the pre-fix behaviour).
 * @invariant `taskAnchors` is assumed already-normalized (the same precondition
 *   {@link anchorsOverlap} itself documents) — callers pass `extractFileAnchors(task)`
 *   output, which is written only through the sanctioned SPEC-042 anchor-mutation seams.
 * @invariant Pure — `deriveTestedSourcePath`, if supplied, must itself be pure; this function
 *   never reaches for IO to decide test-ness.
 *
 * @param diffFiles - {@link parseDiffFilePaths} output for the diff under assessment
 * @param taskAnchors - Union of every task-in-plan's declared `file_anchors` (may contain
 *   duplicates across tasks — harmless, `anchorsOverlap` treats it as a plain candidate set)
 * @param deriveTestedSourcePath - Optional repo-specific test→source convention (see
 *   {@link DeriveTestedSourcePath}). Omitted → no test-file reclassification is attempted
 *   (every file scored by direct overlap only — the pre-fix scoring for that one file).
 * @returns {@link ScopeMismatchWarning} when the range looks too wide,
 *   {@link ScopeMismatchNotMeasured} when the comparison could not be attempted at all, or
 *   `undefined` when it was attempted and found fine.
 *
 * @example
 * computeScopeMismatchWarning(["src/a.ts", "src/b.ts"], ["src/a.ts"]);
 * // → { diff_file_count: 2, intersecting_count: 1, message: "⚠ diff touches 2 files, ..." }
 *
 * @example
 * computeScopeMismatchWarning(["src/a.ts"], []);
 * // → { status: "not-measured", reason: "not-measured: no task declares file_anchors" }
 *
 * @example
 * computeScopeMismatchWarning(
 *   ["src/a.ts", "src/a.test.ts"], ["src/a.ts"],
 *   (f) => (f.endsWith(".test.ts") ? f.slice(0, -".test.ts".length) + ".ts" : undefined),
 * ); // → undefined (both files in-scope: one a direct anchor, one a recognized test of it)
 */
export function computeScopeMismatchWarning(
  diffFiles: string[],
  taskAnchors: string[],
  deriveTestedSourcePath?: DeriveTestedSourcePath,
): ScopeMismatchWarning | ScopeMismatchNotMeasured | undefined {
  if (taskAnchors.length === 0) {
    return { status: "not-measured", reason: "not-measured: no task declares file_anchors" };
  }
  if (diffFiles.length === 0) {
    return { status: "not-measured", reason: "not-measured: diff touched no files" };
  }

  const inScopeCount = diffFiles.filter((file) =>
    isFileInScopeForAnchors(file, taskAnchors, deriveTestedSourcePath),
  ).length;

  if (inScopeCount >= diffFiles.length / 2) return undefined;

  return {
    diff_file_count: diffFiles.length,
    intersecting_count: inScopeCount,
    message:
      `⚠ diff touches ${diffFiles.length} files; only ${inScopeCount} are this plan's declared ` +
      `task anchors or a recognized test of one — check whether this assess range matches ` +
      `the plan's own task commits.`,
  };
}

// ─── Truncation-Coverage Downgrade Thresholds (SPEC-067 D4) ────────────────

/**
 * Single exported home for the SPEC-067 D4 truncation-ratio thresholds — never inline
 * these fractions as scattered literals at call sites.
 *
 * @invariant `confidenceCapRatio` is a STRICT lower bound (`ratio > confidenceCapRatio`,
 *   not `>=`) — exactly 25% truncated is NOT degraded, matching the spec text "> 25%".
 * @invariant `inconclusiveRatio` is reached via `ratio >= inconclusiveRatio` — with
 *   `inconclusiveRatio` set to `1`, this is only ever true at exactly 100% (a ratio can
 *   never exceed 1 by construction of {@link computeTaskTruncationRatio}).
 */
export const TRUNCATION_DOWNGRADE_THRESHOLDS = {
  /** > this fraction of a plan's tasks truncated → overall confidence capped at "low" + `judgment.degraded_by_truncation: true`. */
  confidenceCapRatio: 0.25,
  /** >= this fraction (i.e. 100%) of a plan's tasks truncated → `overall_score` omitted, `verdict` forced to "inconclusive". */
  inconclusiveRatio: 1,
} as const;

/**
 * Fraction of a plan's tasks whose material was truncated in the judge prompt — the SPEC-067
 * D4 truncation-coverage signal. Per-task truncated-section entries are written as
 * `` `task:${task.slug}` `` (see `assess-template.ts`'s `truncated.push` convention); this
 * function counts those, never re-deriving the prefix convention at each call site.
 *
 * @invariant Pure — no IO, no mutation.
 * @invariant `totalTaskCount === 0` → ratio `0`, never a divide-by-zero and never a vacuous
 *   100% ("no tasks" is not "all tasks truncated").
 * @param truncatedSections - `judgment.truncated[]` (or the pre-finalization `truncated`
 *   array `assessPlan` builds the prompt with — same shape either way)
 * @param totalTaskCount - `bundle.tasks.length` — the plan's full task count, not just the
 *   ones that appear in `truncatedSections`
 * @returns A fraction in `[0, 1]`
 *
 * @example
 * computeTaskTruncationRatio(["task:t1", "task:t2", "plan"], 16); // → 0.125 (2/16)
 *
 * @example
 * computeTaskTruncationRatio(["task:t1", "task:t2"], 2); // → 1 (100% truncated)
 *
 * @example
 * computeTaskTruncationRatio([], 0); // → 0 (no tasks at all — not "fully truncated")
 */
export function computeTaskTruncationRatio(truncatedSections: string[], totalTaskCount: number): number {
  if (totalTaskCount === 0) return 0;
  const truncatedTaskCount = truncatedSections.filter((section) => section.startsWith("task:")).length;
  return truncatedTaskCount / totalTaskCount;
}

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
  scope_warning: scopeMismatchWarningSchema.optional(),
  // SPEC-067 D4 — both fields OVERRIDE llmAssessmentOutputSchema's narrower base shape.
  // The judge itself never emits "inconclusive" or omits overall_score — these are
  // service-computed finalization overrides (_finalizeAssessment, ai-provider-service.ts)
  // applied only at 100% task-truncation coverage; llmAssessmentOutputSchema (what the
  // judge is validated against) is untouched.
  verdict: z.enum(["met", "partially_met", "not_met", "inconclusive"]),
  overall_score: z.number().int().min(0).max(100).optional(),
  // reason: D2/D3 (spec-judgment-surfaces-must-verify-before-they-certify-machine) —
  // service-computed, additive, mirroring facts/source_versions/scope_warning above: every
  // assessment persisted before this mechanism existed has neither field and still
  // validates unchanged. `overall_score` above is left byte-identical to what the judge
  // emitted even when `unverifiable_findings` is non-empty — the score is NEVER recomputed
  // from the surviving finding count (see unverifiableFindingSchema's own JSDoc for why).
  unverifiable_findings: z.array(unverifiableFindingSchema).optional(),
  paths_verified: pathsVerifiedSchema.optional(),
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
 * Defensive `task.extra.linkage` accessor (SPEC-069 §Design Decisions D3) — returns
 * the verbatim justification string, or `undefined` when absent/empty/non-string.
 * Mirrors `extractAcScope`'s defensive-read shape immediately above (extra is
 * untyped storage; never throws).
 */
function extractTaskLinkage(task: DocRecord): string | undefined {
  const extra: unknown = task.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const raw = (extra as Record<string, unknown>)["linkage"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Defensive `plan.extra.attestation_exempt` (+ sibling `attestation_exempt_reason`)
 * accessor (SPEC-069 §Design Decisions D1) — the plan-close attestation floor's
 * escape hatch. `exempt: false` (reason omitted) for every plan that doesn't
 * explicitly carry `extra.attestation_exempt === true`; never throws.
 */
function extractAttestationExemption(plan: DocRecord): { exempt: boolean; reason?: string } {
  const extra: unknown = plan.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    return { exempt: false };
  }
  const record = extra as Record<string, unknown>;
  if (record["attestation_exempt"] !== true) return { exempt: false };
  const reasonRaw = record["attestation_exempt_reason"];
  return {
    exempt: true,
    ...(typeof reasonRaw === "string" && reasonRaw.length > 0 ? { reason: reasonRaw } : {}),
  };
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

  const taskLinkage = bundle.tasks
    .map((task) => {
      const linkage = extractTaskLinkage(task);
      return linkage === undefined ? undefined : { task_id: task.id, linkage };
    })
    .filter((entry): entry is { task_id: string; linkage: string } => entry !== undefined);

  const facts: AssessmentFacts = {
    ac_coverage: acCoverage,
    task_evidence: taskEvidence,
    knowledge_capture: knowledgeCapture,
    regression,
    task_linkage: taskLinkage,
    attestation_exemption: extractAttestationExemption(bundle.plan),
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
      rule: "BR-264",
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
    rule: "BR-264",
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

  // SPEC-067 D4: overall_score is omitted (not a number) at 100% task-truncation coverage —
  // render an explicit placeholder rather than interpolating `undefined` into the heading.
  const scoreLabel = result.overall_score !== undefined ? `${result.overall_score}/100` : "N/A (fully truncated)";
  lines.push(`# Assessment: ${result.verdict} (${scoreLabel})`);
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
  // reason: additive-only field (task-assess-templates-5-binds-the-projected-renderer-
  // while-two) — rendered immediately alongside "Prompt version" (the field it qualifies),
  // NOT presence-guarded away to silence: an assessment persisted before this field existed
  // simply omits the line (byte-identical to pre-existing legacy rendering, REGRESSION-
  // pinned by assessment-schema-compat.test.ts's "ends with Truncated sections: (none)"
  // assertion), but whenever the value IS known, `true`/`false` render as visibly distinct
  // text — never inferred, never defaulted. See judgmentSchema's own JSDoc for the full
  // three-state contract (absence must NOT be read as "reproducible": ADR
  // lore-s-mechanisms-validate-a-proxy-for-the-property-not-the, Q2).
  if (result.judgment.reproducible !== undefined) {
    lines.push(
      `- Reproducible: ${
        result.judgment.reproducible
          ? "yes (this prompt_version's rendering is guaranteed byte-identical)"
          : "no (this prompt_version's rendering is NOT guaranteed byte-identical across runs)"
      }`,
    );
  }
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
  if (result.judgment.overall_confidence !== undefined) {
    // reason: additive-only field (SPEC-067 D4) — same rendering precedent as
    // reasoning_clipped above; absent on every pre-SPEC-067 assessment.
    lines.push(
      `- Overall confidence: ${result.judgment.overall_confidence}` +
        (result.judgment.degraded_by_truncation ? " (degraded by truncation)" : ""),
    );
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

  // reason: D2/D3 (spec-judgment-surfaces-must-verify-before-they-certify-machine) — both
  // blocks are additive, guarded by their own optional field, so a legacy AssessmentResult
  // with neither field renders BYTE-IDENTICALLY to before this mechanism existed. Distinct
  // heading from "## Unverifiable Materials" above on purpose — that block is the JUDGE's
  // own self-reported epistemic-limits list; this one is the SERVICE's machine-verified
  // path-check outcome, a different concept entirely.
  if (result.paths_verified) {
    lines.push("");
    lines.push("## Finding Path Verification");
    lines.push("");
    lines.push(`- Checked (confirmed present at the assessed commit): ${result.paths_verified.checked}`);
    lines.push(`- Unverifiable (confirmed absent — finding withdrawn): ${result.paths_verified.unverifiable}`);
    if (result.paths_verified.not_shown !== undefined) {
      lines.push(
        `- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): ${result.paths_verified.not_shown}`,
      );
    }
    lines.push(
      `- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): ${result.paths_verified.unchecked}`,
    );
  }

  if (result.unverifiable_findings && result.unverifiable_findings.length > 0) {
    lines.push("");
    lines.push("## Withdrawn Findings (Path Verification)");
    lines.push("");
    lines.push(
      `${result.unverifiable_findings.length} finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps ` +
        `because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT ` +
        `recomputed to account for their removal.\n`,
    );
    for (const finding of result.unverifiable_findings) {
      const why =
        finding.reason === "not-shown-to-judge"
          ? `"${finding.failing_path}" was never shown to the judge (omitted from the truncated diff)`
          : `"${finding.failing_path}" not found at commit ${finding.checked_against_commit}`;
      lines.push(`- [${finding.severity}] ${finding.statement.replace(/\|/g, "\\|")} — ${why}`);
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
