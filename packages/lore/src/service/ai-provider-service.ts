/**
 * AIProviderService — dispatch AI generation, render templates, emit telemetry.
 * Seventh stateless service in the service layer. All state lives in injected dependencies.
 *
 * Public surface:
 *   - AIProviderService class
 *     - activeProviderName: string (getter — read by CLI spinner)
 *     - refineMaxInputChars: number (getter — read by CLI for truncation warning)
 *     - assessMaxDiffChars: number (getter — read by CLI for the AC-AE-1 pre-flight warning)
 *     - generate(args) → Promise<Result<GenerateOutput, LoreError>>  (SPEC-017 create path)
 *     - regenerateContent(doc, opts?) → Promise<Result<GenerateOutput, LoreError>>  (SPEC-019)
 *     - refineContent(doc, userPrompt, opts?) → Promise<Result<GenerateOutput, LoreError>>  (SPEC-019)
 *     - inferLinkType(from, to, opts?) → Promise<Result<{linkType: LinkType}, LoreError>>  (SPEC-019)
 *     - assessPlan(bundle, opts) → Promise<Result<AssessmentResult, LoreError>>  (SPEC-026, v6 SPEC-040;
 *       `opts.commitDerivationUnverifiable` is REQUIRED, not optional — see assessPlan's own JSDoc)
 *     - judgeDoc(bundle, checks, opts?) → Promise<Result<NewReviewJudgment, LoreError>>  (SPEC-034, SPEC-040 D8)
 *   - validateAcIdContainment(output, declaredIds) → Result<void, LoreError>  (SPEC-038 §5 D5)
 *   - computeGroundingWarnings(output, truncatedSections) → string[]  (SPEC-040 §T2 D4, pure, exported for direct testing)
 *   - verifyFindingPaths(typedGaps, diffSource, repoRoot) → Result<FindingPathVerificationOutcome, LoreError>
 *     (D2/D3, spec-judgment-surfaces-must-verify-before-they-certify-machine — IO via
 *     `git cat-file -e`; exported for direct testing, called from `_finalizeAssessment`)
 *
 * Invariants:
 *   - Stateless: every dependency is constructor-injected; no module-level state or globals
 *   - AI provider existence is guaranteed at construction (validated by buildProviderRegistry)
 *   - Telemetry is emitted on BOTH success and failure paths when aiTelemetryEnabled is true
 *   - Never throws — all errors from provider.generate() are forwarded as Result values
 *   - AIProviderService is constructed exclusively by app.ts (AC-AI-14)
 *   - inferLinkType validates the AI response via linkTypeSchema.safeParse; invalid type
 *     → err(AI_PROVIDER_ERROR) — no link is created, caller exits 6 (SPEC-019 AC-LINK-AI-2)
 *   - refineContent truncates doc.content to refineMaxInputChars before building the prompt;
 *     the CLI is responsible for warning the user if truncation occurred (SPEC-019 §9.4)
 *   - assessPlan gets ONE corrective retry when the judge's JSON is malformed/invalid
 *     (orchestrated by a sibling private helper, `_attemptJudgeParse` — `_invokeProvider`
 *     itself is untouched); a second malformed response → AI_PROVIDER_ERROR with a
 *     ≤500-char raw-output prefix and no document is created (SPEC-026 §3 D2)
 *   - assessPlan clips any `ac_scores[].reasoning` over 300 chars BEFORE Zod validation
 *     (`clipOverlongReasoning`, SPEC-029 AC-AR-2) — a verbose-but-otherwise-valid judgment
 *     never burns the corrective retry on reasoning length alone; clipped AC ids surface
 *     as `judgment.reasoning_clipped` (AC-AR-3)
 *   - assessPlan validates `ac_scores[].ac_id` containment against the spec's declared
 *     structured acceptance criteria (`validateAcIdContainment`, SPEC-038 §5 D5) — runs
 *     AFTER `llmAssessmentOutputSchema` parses successfully, ONLY when the linked spec
 *     declared `extra.acceptance_criteria` at all; a violation is `VALIDATION_ERROR`
 *     returned directly (no document created), and it does NOT consume the one corrective
 *     retry — that budget stays reserved for genuine JSON parse/schema failures (SPEC-026
 *     §3 D2's single-axis retry semantics are unchanged by this addition)
 *   - judgeDoc gets ONE corrective retry when the judge's JSON is malformed/invalid
 *     (SPEC-034 §4, same protocol as assessPlan/SPEC-026 §3 D2) — a second malformed
 *     response → AI_PROVIDER_ERROR with a ≤500-char raw-output prefix and no judgment is
 *     returned (the caller never calls JudgmentService.record on an err() Result)
 *   - judgeDoc ALWAYS overwrites the model's own (optional) `checks` field with the
 *     deterministic `checks` argument it was called with — the mechanical pre-checks
 *     (computed BEFORE the LLM call, SPEC-034 §4 flow step 2) are the authoritative
 *     record; the model is never trusted to self-report which checks passed
 *   - judgeDoc ALWAYS stamps `truncated: true` on the returned judgment when the review
 *     template reports `docTruncated` (SPEC-040 D8) — additive-only field, mirrors the
 *     `checks` override precedent (service-computed, model output never consulted for it)
 *   - assessPlan (SPEC-040 §T2) computes `AssessmentFacts` and `source_versions` EXACTLY
 *     ONCE per call, from the full untruncated bundle, BEFORE prompt truncation — the same
 *     objects are handed to the (registry-selected) prompt template AND persisted verbatim
 *     into the returned `AssessmentResult.facts`/`source_versions` (D1, D2); a judge's
 *     output can never overwrite them. `gaps`/`recommendations` are overwritten with
 *     `deriveLegacyFindings`'s projection ONLY when the corresponding typed array
 *     (`typed_gaps`/`typed_recommendations`) is present (D3). `computeGroundingWarnings`
 *     (D4) appends ungrounded absence-based dimension-score warnings to `rubric_warning`,
 *     never fatal. The active prompt template is resolved via `getAssessTemplate`
 *     (SPEC-040 D6) rather than calling `buildAssessPrompt` directly.
 *   - assessPlan (hotfix task-assess-diff-range-scope-mismatch-warning) ALSO computes an
 *     optional `scope_warning` — a deterministic, non-blocking FACTS comparison between the
 *     diff's changed files (`parseDiffFilePaths`) and the plan's declared task
 *     `file_anchors` (`computeScopeMismatchWarning`, `@lore/core`, given THIS file's own
 *     `deriveRepoTestedSourcePath` as its test→source convention — task-
 *     computescopemismatchwarning-cannot-distinguish-a-too-wide) — exactly once, alongside
 *     `facts`/`sourceVersions`, and persisted verbatim by `_finalizeAssessment`. It NEVER
 *     affects `verdict`, `overall_score`, retry behavior, or whether the assessment persists;
 *     absent (no field, not `undefined`) when no task in the plan declares anchors, no diff
 *     was supplied, the intersection is half-or-more, OR `computeScopeMismatchWarning`
 *     returned `ScopeMismatchNotMeasured` (an internal "could not be attempted" signal — see
 *     `assessPlan`'s own `scopeWarning` local for the narrowing that keeps this field's
 *     persisted contract exactly as it was before that task).
 *   - assessPlan (D2/D3, spec-judgment-surfaces-must-verify-before-they-certify-machine)
 *     resolves `repoRoot` (`opts.repoRoot ?? process.cwd()`) ONCE and passes it, plus
 *     `opts.diffSource` verbatim, into `_finalizeAssessment`, which runs `verifyFindingPaths`
 *     on the (grounding-)suppressed `typedGaps` — withdrawing any finding with an absent
 *     declared path into `unverifiable_findings[]`, tallying `paths_verified`, and NEVER
 *     recomputing `overall_score`. `opts.diffSource` is currently supplied by NO production
 *     caller (`commands/assess.ts`/MCP `tools.ts` are outside this task's scope — see
 *     `assessPlan`'s own `@param opts.diffSource` doc) so every live `lore assess` run today
 *     resolves to `paths_verified.unchecked` for any declared path — a real, named,
 *     un-closed gap, not a claim that the mechanism itself is inert.
 *
 * Side-effect class: IO (delegates to AIProvider.generate, Telemetry.emit, and — D2,
 * spec-judgment-surfaces-must-verify-before-they-certify-machine — `git cat-file -e`
 * subprocess calls for finding-path verification)
 *
 * Source: SPEC-017 §3.6, SPEC-019 §9.1, SPEC-026 §3 D1, D2; SPEC-029 AC-AR-2, AC-AR-3; SPEC-034 §4;
 * SPEC-038 §5, §7 D5; SPEC-040 §T2 D1-D6, D8; task-assess-diff-range-scope-mismatch-warning;
 * spec-judgment-surfaces-must-verify-before-they-certify-machine D1, D2, D3, D4
 * (task-verify-assess-finding-paths-against-the-assessed-commit)
 */

import { spawnSync } from "node:child_process";
import { err, ok } from "@lore/core";
import type { AIProvider, DocRecord, DocType, GenerateInput, GenerateOutput, LinkType, LoreError, Telemetry } from "@lore/core";
import type { AiDefaultSource, CallerSurface, Result } from "@lore/core";
import { linkTypeSchema } from "@lore/core";
import type {
  AssessDiffSource,
  AssessmentFacts,
  AssessmentResult,
  DimensionScores,
  LlmAssessmentOutput,
  PathsVerified,
  PlanBundle,
  ScopeMismatchNotMeasured,
  ScopeMismatchWarning,
  SourceVersionRef,
  TypedGap,
  UnverifiableEntry,
  UnverifiableFinding,
} from "@lore/core";
import {
  clipOverlongReasoning,
  computeAssessmentFacts,
  computeScopeMismatchWarning,
  computeTaskTruncationRatio,
  deriveLegacyFindings,
  extractAssessmentJson,
  extractFileAnchors,
  llmAssessmentOutputSchema,
  parseDiffFilePaths,
  resolveAssessedCommit,
  TRUNCATION_DOWNGRADE_THRESHOLDS,
} from "@lore/core";
import type { CheckResult, LlmReviewOutput, NewReviewJudgment, ReviewBundle, ReviewTruncationEntry } from "@lore/core";
import { llmReviewOutputSchema } from "@lore/core";
import type { StalenessBundle, StalenessVerdict } from "@lore/core";
import {
  mapStalenessVerdictDecisionToJudgmentDecision,
  STALENESS_VERDICT_DECISIONS,
  stalenessVerdictSchema,
} from "@lore/core";
import {
  BUILT_IN_TEMPLATES,
  GENERATE_PROMPT_VERSION,
  getGenerateTemplateSet,
  LINK_INFERENCE_TEMPLATE,
  REFINE_TEMPLATE,
  renderTemplate,
} from "../ai/templates.js";
import {
  ASSESS_PROMPT_VERSION,
  buildAssessDiffMeta,
  buildAssessRetryPrompt,
  excludeAssessMirrorFromDiff,
  extractDeclaredAcceptanceCriteria,
  getAssessTemplate,
  getAssessTemplateReproducibility,
  type AssessBudgets,
} from "../ai/assess-template.js";
import {
  REVIEW_PROMPT_VERSION,
  REVIEW_TEMPLATES,
  buildReviewRetryPrompt,
  type ReviewBudgets,
} from "../ai/review-template.js";
import {
  STALENESS_PROMPT_VERSION,
  STALENESS_TEMPLATES,
  buildStalenessRetryPrompt,
  type StalenessBudgets,
} from "../ai/staleness-template.js";

/**
 * Validates that every `ac_scores[].ac_id` the judge emitted belongs to the spec's
 * declared structured acceptance criteria (SPEC-038 §5, §7 D5). `assessPlan` calls this
 * right after `llmAssessmentOutputSchema` parses successfully and BEFORE `scope`/`judgment`
 * are assembled — and ONLY when `declaredIds` is non-empty (a spec with no structured ACs
 * declared has no containment universe to check against; the judge stays free to invent
 * ids from the verbatim prose, exactly as it did before SPEC-038 — D7 storage compat).
 *
 * A containment violation is schema-adjacent but distinct from a malformed/invalid JSON
 * response: it does NOT consume the one corrective retry (SPEC-026 §3 D2's retry budget
 * stays single-axis — JSON parse/schema failures only, per SPEC-038 §7 D5's explicit
 * "err; retry 单轴不动" resolution). `assessPlan` returns this error directly without a
 * second provider call, and never creates a document.
 *
 * @param output - The judge's output, ALREADY validated by llmAssessmentOutputSchema
 * @param declaredIds - The spec's declared acceptance_criteria ids (assumed non-empty —
 *   callers only invoke this when the linked spec has structured ACs at all)
 * @returns ok(undefined) when every ac_scores[].ac_id is a member of declaredIds;
 *   err(VALIDATION_ERROR) naming every offending id plus the full declared set otherwise
 *
 * @example
 * validateAcIdContainment(
 *   { verdict: "met", overall_score: 90, gaps: [], recommendations: [],
 *     ac_scores: [{ ac_id: "AC-X-1", score: 90, reasoning: "ok", evidence_refs: [] }] },
 *   new Set(["AC-X-1", "AC-X-2"]),
 * ); // → { ok: true, value: undefined }
 */
export function validateAcIdContainment(
  output: LlmAssessmentOutput,
  declaredIds: Set<string>,
): Result<void, LoreError> {
  const offending = output.ac_scores.map((score) => score.ac_id).filter((id) => !declaredIds.has(id));
  if (offending.length === 0) return ok(undefined);

  return err({
    code: "VALIDATION_ERROR",
    field: "ac_scores[].ac_id",
    message:
      `AI judge returned ac_id(s) not in the spec's declared acceptance criteria: ` +
      `${offending.join(", ")}. Declared ids: ${Array.from(declaredIds).join(", ")}.`,
  });
}

/**
 * Shared grounding-match computation behind BOTH `computeGroundingWarnings` (SPEC-040 D4,
 * advisory text) and `applyGroundingConfidenceDowngrade` (SPEC-067 D3, mechanical confidence
 * downgrade) — ONE heuristic, never independently re-derived in two places. Identifies every
 * `dimension_scores` key claiming `based_on: "absence"` whose dimension name does not appear
 * (case-insensitive substring) in any `unverifiable[].material` or in `truncatedSections`.
 *
 * @invariant Deliberately a substring-containment heuristic, NOT semantic matching — see
 *   `computeGroundingWarnings`'s JSDoc for the full rationale (unchanged by this extraction).
 * @param dimensionScores - `output.dimension_scores` (may be undefined — no-op, `[]`)
 * @param unverifiableEntries - `output.unverifiable` (may be undefined — treated as `[]`)
 * @param truncatedSections - `judgment.truncated[]`
 * @returns The dimension keys that are ungrounded absence claims; `[]` when none are
 */
function findUngroundedAbsenceDimensions(
  dimensionScores: DimensionScores | undefined,
  unverifiableEntries: UnverifiableEntry[] | undefined,
  truncatedSections: string[],
): string[] {
  if (!dimensionScores) return [];

  const unverifiableMaterials = (unverifiableEntries ?? []).map((u) => u.material.toLowerCase());
  const truncatedLower = truncatedSections.map((t) => t.toLowerCase());
  const ungrounded: string[] = [];

  for (const [dimensionKey, entry] of Object.entries(dimensionScores)) {
    if (entry.based_on !== "absence") continue;
    const key = dimensionKey.toLowerCase();
    const grounded =
      unverifiableMaterials.some((m) => m.includes(key)) || truncatedLower.some((t) => t.includes(key));
    if (!grounded) ungrounded.push(dimensionKey);
  }

  return ungrounded;
}

/**
 * D4 grounding cross-check (SPEC-040 §T2) — pure, zero-NLP, post-parse. Flags a
 * `dimension_scores` entry that claims `based_on: "absence"` without citing WHY the
 * evidence is absent: the dimension key does not appear (case-insensitive substring) in
 * any `unverifiable[].material` or in `judgment.truncated[]`. `ac_scores[]` entries have
 * no `based_on` field at all (only `dimension_scores` does) so this loop naturally never
 * matches them — the function name says "ac_scores[]/dimension_scores" only because the
 * schema MAY grow `based_on` on `ac_scores[]` in a future revision; today it is a no-op
 * pass-through for that half.
 *
 * @invariant Deliberately a substring-containment heuristic, NOT semantic matching — the
 *   judge is expected to reference the dimension by name (in `unverifiable[].material` or
 *   implicitly via a truncated section) when explaining an absence-based score. This is a
 *   documented, coarse heuristic, not a claim of NLP-grade linkage.
 * @invariant Never fails the run — only appends human-readable warning strings.
 *
 * @param output - Validated judge output (post `llmAssessmentOutputSchema` parse)
 * @param truncatedSections - `judgment.truncated[]` — section names truncated for budget
 * @returns One warning string per ungrounded absence-based dimension score; `[]` when
 *   every absence-based score cites a matching subject, or when there is no
 *   `dimension_scores` at all
 *
 * @example
 * computeGroundingWarnings(
 *   { ...output, dimension_scores: { scope_fidelity: { score: 40, confidence: 0.5, based_on: "absence", reasoning: "no data" } } },
 *   [],
 * );
 * // → ['Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.']
 */
export function computeGroundingWarnings(
  output: LlmAssessmentOutput,
  truncatedSections: string[],
): string[] {
  return findUngroundedAbsenceDimensions(output.dimension_scores, output.unverifiable, truncatedSections).map(
    (dimensionKey) =>
      `Dimension "${dimensionKey}" scored based_on="absence" but no matching entry was found in ` +
      `unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.`,
  );
}

/**
 * spec-lore-assess-project-evidence-rows-instead-of-embedding-the D3/D4 — suppress, not
 * merely warn about, EVERY published expression of a `dimension_scores` entry
 * `findUngroundedAbsenceDimensions` flags: the flagged `dimension_scores` entry is
 * REMOVED, its matching `typed_gaps[]` entries (task-t6, joined on `typed_gaps[].dimension
 * === dimensionKey`, exact equality — see @invariant below) are ALSO removed, and a
 * corresponding `unverifiable[]` entry naming the dimension is appended in its place — the
 * assessment still records that the material could not be judged, it just no longer
 * asserts a defect about it anywhere in the persisted record (D3). Reuses
 * `findUngroundedAbsenceDimensions`, the SAME grounding-match computation
 * `computeGroundingWarnings` uses, called EXACTLY ONCE per invocation — never a second,
 * independently-drifting heuristic (D4).
 *
 * Supersedes SPEC-067 D3's `applyGroundingConfidenceDowngrade` (removed by this change):
 * that mechanism downgraded these exact entries' `confidence` to `"low"` but left them in
 * the persisted record — measured 2026-08-01 to ship false findings into the permanent
 * quality record anyway (see this task's governing spec's Overview). A warning/downgrade
 * that does not change what lands in the record is not a mechanism.
 *
 * task-t6 (2026-08-01): the ORIGINAL version of this function removed only the
 * `dimension_scores` row, leaving `typed_gaps[]` (and consequently the legacy `gaps[]`
 * projection `deriveLegacyFindings` derives from it) to still publish the exact finding
 * `unverifiable[]` claims was suppressed — measured on
 * `knowledge-assessment-implementation-evidence-output-tail`. This extension closes that:
 * `typed_gaps[]` is now filtered by the SAME `ungrounded` list, never a second match rule.
 *
 * @invariant Pure — returns the EXACT SAME `dimensionScores`/`unverifiableEntries`/
 *   `typedGaps` references when nothing is ungrounded (mirrors the AC-067-6 healthy-path
 *   identity precedent the superseded function established — `_finalizeAssessment` never
 *   needs to distinguish "unchanged" from "not called").
 * @invariant Every non-flagged `dimension_scores` entry (evidence-based, or absence-based
 *   but grounded) is copied through byte-identical — only ungrounded entries are removed.
 * @invariant `typed_gaps[].dimension` is joined against `ungrounded` by EXACT string
 *   equality, NOT the case-insensitive substring heuristic `findUngroundedAbsenceDimensions`
 *   uses internally — that heuristic exists solely to match a dimension name against
 *   free-text `unverifiable[]`/`truncated[]` strings a judge might phrase loosely;
 *   `typed_gaps[].dimension` is a structured field the judge is expected to set to the
 *   exact `dimension_scores` key it scores (see `typedGapSchema`'s own JSDoc), so exact
 *   equality is the correct — and only — join here (AC-AEP-11/AC-AEP-7's "single match
 *   rule" invariant is about `ungrounded` itself never being re-derived, not about this
 *   join needing the substring heuristic too).
 * @invariant `typed_recommendations[]` is NEVER filtered here (deliberately out of this
 *   function's scope — see `_finalizeAssessment`'s own `// reason:` comment for why: the
 *   schema carries no field linking a recommendation to a specific gap/dimension).
 * @param dimensionScores - `parsed.dimension_scores` (may be undefined — no-op)
 * @param unverifiableEntries - `parsed.unverifiable` (may be undefined — treated as `[]`)
 * @param truncatedSections - `judgment.truncated[]` — same input `computeGroundingWarnings` takes
 * @param typedGaps - `parsed.typed_gaps` (may be undefined — no-op, stays `undefined`)
 * @returns `dimensionScores` with every ungrounded absence entry removed (`undefined` when
 *   none remain), `unverifiable` with one new entry per removed dimension appended
 *   (identical reference to the input when nothing was suppressed), and `typedGaps` with
 *   every entry keyed to a removed dimension filtered out (stays `undefined` when the
 *   input was `undefined`; becomes `[]`, never `undefined`, when the input was a
 *   non-empty array that filtered down to nothing — presence is preserved, only content
 *   changes, mirroring how the legacy `gaps[]` array itself is never omitted)
 *
 * @example
 * suppressUngroundedAbsenceFindings(
 *   { scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" } },
 *   undefined,
 *   [],
 *   [{ dimension: "scope_fidelity", severity: "major", statement: "cannot be inspected" }],
 * );
 * // → { dimensionScores: undefined,
 * //     unverifiable: [{ material: "scope_fidelity dimension score", reason: "..." }],
 * //     typedGaps: [] }
 */
function suppressUngroundedAbsenceFindings(
  dimensionScores: DimensionScores | undefined,
  unverifiableEntries: UnverifiableEntry[] | undefined,
  truncatedSections: string[],
  typedGaps: TypedGap[] | undefined,
): {
  dimensionScores: DimensionScores | undefined;
  unverifiable: UnverifiableEntry[] | undefined;
  typedGaps: TypedGap[] | undefined;
} {
  const ungrounded = findUngroundedAbsenceDimensions(dimensionScores, unverifiableEntries, truncatedSections);
  if (ungrounded.length === 0) {
    return { dimensionScores, unverifiable: unverifiableEntries, typedGaps };
  }

  // reason: findUngroundedAbsenceDimensions only ever returns a non-empty array when
  // dimensionScores is defined (its own first line is `if (!dimensionScores) return [];`)
  // — this non-null assertion cannot miss.
  const remaining: DimensionScores = Object.fromEntries(
    Object.entries(dimensionScores!).filter(([dimensionKey]) => !ungrounded.includes(dimensionKey)),
  );
  const suppressedAsUnverifiable: UnverifiableEntry[] = ungrounded.map((dimensionKey) => ({
    material: `${dimensionKey} dimension score`,
    reason:
      `based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — ` +
      `suppressed as ungrounded rather than published as a finding.`,
  }));

  // reason: task-t6 — same `ungrounded` list as the dimension_scores filter above, joined
  // against typed_gaps[].dimension by exact equality (see this function's own @invariant
  // for why exact-not-substring is correct here). `undefined` input stays `undefined`
  // (nothing to filter); a defined input is always filtered, even down to `[]`.
  const ungroundedSet = new Set(ungrounded);
  const remainingTypedGaps: TypedGap[] | undefined =
    typedGaps === undefined ? undefined : typedGaps.filter((gap) => !ungroundedSet.has(gap.dimension));

  return {
    dimensionScores: Object.keys(remaining).length > 0 ? remaining : undefined,
    unverifiable: [...(unverifiableEntries ?? []), ...suppressedAsUnverifiable],
    typedGaps: remainingTypedGaps,
  };
}

/**
 * task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — forces
 * `scope_fidelity` OUT of the persisted `dimension_scores` (and its `typed_gaps[]`
 * siblings) whenever the CALLER (CLI/MCP) already knows this plan's diff/commit-set
 * derivation landed in the `"unverifiable_convention_mismatch"` state
 * (`assess-commit-derivation.ts::deriveCommitSetForPlan` — every task archived, yet zero
 * commits matched: a contradiction, not evidence of no work). Runs REGARDLESS of the
 * judge's own `based_on` label — unlike `suppressUngroundedAbsenceFindings` (T6, which
 * only acts on a score the JUDGE self-labeled `based_on: "absence"` and only when the
 * judge's OWN citations don't mention the dimension), this is a ground-truth-driven floor:
 * no diff exists in this state, so no `scope_fidelity` claim — evidence-based or not — can
 * be honest. The judge is never trusted to self-report which state it is in (same
 * precedent as `judgeDoc`'s deterministic `checks` override, this file's header).
 *
 * ADR three-question review (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the):
 *   1. Proxy — `commitDerivationUnverifiable` is a proxy for "this plan's commit set could
 *      not be established", not the property itself. A plan whose diff genuinely doesn't
 *      touch anything relevant to scope would ALSO be forced unverifiable here even though
 *      a human might judge "no scope drift" from other evidence (task file_anchors,
 *      declared AC scope) — accepted: forbidding the SCORE, not the underlying judgment
 *      inputs, is the narrowest fix that removes the false-major-finding harm without
 *      inventing a second diff-independent scope heuristic here.
 *   2. Silence — this function's entire existence closes a silence: a forcibly-removed
 *      score is NEVER a bare omission — it is always paired with an explicit
 *      `unverifiable[]` entry naming the dimension and stating in words that it was "not
 *      scored" (AC #3's literal requirement), so a reader of the persisted record can never
 *      mistake "removed" for "never existed" or "clean".
 *   3. Opt-in — CLOSED (task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan):
 *      `commitDerivationUnverifiable` is now a REQUIRED field on `assessPlan`'s `opts`
 *      (no default, no `?`) — there is no longer a compiling call site that omits it.
 *      Both adapters that create an assessment (CLI `commands/assess.ts`, MCP
 *      `../adapters/mcp/tools.ts`) compute `allTasksArchived` from their already-loaded
 *      bundle, pass it to `deriveCommitSetForPlan` (whose own `allTasksArchived` parameter
 *      is likewise now required), and thread the resulting
 *      `status === "unverifiable_convention_mismatch"` boolean straight through — a THIRD
 *      adapter that forgets this step fails `bun run typecheck`, not silently at runtime.
 *      This closes the exact gap that let the MCP surface ship without it: two new
 *      required parameters made optional-and-additive so the original 2-arg call kept
 *      compiling, which is precisely what let the omission go unnoticed by the type
 *      checker (see the task's own "Proxy" analysis).
 *
 * @invariant Pure — returns the SAME `dimensionScores`/`unverifiable`/`typedGaps`
 *   references when `commitDerivationUnverifiable` is not `true`, or `scope_fidelity` is
 *   already absent from `dimensionScores` (mirrors `suppressUngroundedAbsenceFindings`'s
 *   healthy-path identity precedent).
 * @invariant Composes with `suppressUngroundedAbsenceFindings` — callers run this BEFORE
 *   that function, on the RAW judge-parsed values, deliberately: it guarantees the AC #3
 *   "not scored" wording is what a reader sees for `scope_fidelity` in this state, never
 *   T6's differently-worded "ungrounded" message (which would otherwise win the race when
 *   the judge ALSO happened to leave the score ungrounded by its own citations). When this
 *   floor doesn't fire (flag false), the raw values pass through unchanged and T6 governs
 *   exactly as before this function existed.
 * @param commitDerivationUnverifiable - `true` iff the plan's commit derivation reported
 *   `"unverifiable_convention_mismatch"` for this run.
 * @param dimensionScores - The judge's raw, just-parsed `dimension_scores` (may be
 *   `undefined`) — BEFORE `suppressUngroundedAbsenceFindings` runs.
 * @param unverifiableEntries - The judge's raw `unverifiable[]` (may be `undefined`) —
 *   BEFORE `suppressUngroundedAbsenceFindings` runs.
 * @param typedGaps - The judge's raw `typed_gaps[]` (may be `undefined`) — BEFORE
 *   `suppressUngroundedAbsenceFindings` runs.
 * @returns The same three-field shape `suppressUngroundedAbsenceFindings` returns (its
 *   caller feeds this function's output into that one next), with `scope_fidelity` forced
 *   out when the flag is set and present.
 *
 * @example
 * forceScopeFidelityUnverifiable(
 *   true,
 *   { scope_fidelity: { score: 85, confidence: 0.85, based_on: "evidence", reasoning: "looks fine" } },
 *   undefined,
 *   undefined,
 * );
 * // → { dimensionScores: undefined,
 * //     unverifiable: [{ material: "scope_fidelity dimension score", reason: "...not scored..." }],
 * //     typedGaps: undefined }
 */
function forceScopeFidelityUnverifiable(
  commitDerivationUnverifiable: boolean,
  dimensionScores: DimensionScores | undefined,
  unverifiableEntries: UnverifiableEntry[] | undefined,
  typedGaps: TypedGap[] | undefined,
): {
  dimensionScores: DimensionScores | undefined;
  unverifiable: UnverifiableEntry[] | undefined;
  typedGaps: TypedGap[] | undefined;
} {
  if (!commitDerivationUnverifiable || dimensionScores === undefined || !("scope_fidelity" in dimensionScores)) {
    return { dimensionScores, unverifiable: unverifiableEntries, typedGaps };
  }

  const { scope_fidelity: _removed, ...remaining } = dimensionScores;
  void _removed; // reason: destructured only to exclude it from `remaining`.

  const forcedEntry: UnverifiableEntry = {
    material: "scope_fidelity dimension score",
    // reason: unverifiableEntrySchema.reason is capped at 200 chars (assessment.ts) — this
    // wording is deliberately terse to stay under that cap while keeping the AC #3
    // literal requirement ("not scored", asserted verbatim by tests).
    reason:
      "Commit set unverifiable (convention mismatch — plan archived, no commit " +
      "referenced any task slug). scope_fidelity was NOT SCORED, regardless of what " +
      "the judge reported.",
  };

  return {
    dimensionScores: Object.keys(remaining).length > 0 ? remaining : undefined,
    unverifiable: [...(unverifiableEntries ?? []), forcedEntry],
    typedGaps: typedGaps === undefined ? undefined : typedGaps.filter((gap) => gap.dimension !== "scope_fidelity"),
  };
}

// ─── Scope-Mismatch Test-Convention Injection (task-computescopemismatchwarning-cannot-distinguish-a-too-wide) ───

/**
 * This repo's own test-file → source-file convention, injected as `computeScopeMismatchWarning`'s
 * `deriveTestedSourcePath` parameter (`@lore/core` deliberately carries no opinion on any
 * project's test layout — see that function's own JSDoc). Pure string transformation, no
 * filesystem access — the tested source path is a GUESS, never verified to exist on disk;
 * `anchorsOverlap` simply won't match a wrong guess against a real declared anchor, which is
 * why a wrong guess here is harmless rather than a silent mis-classification.
 *
 * Handles the two test-file layouts this repo actually uses (see this repo's CLAUDE.md "Test
 * file convention" section and `bun run test:changed`'s own module header):
 *   1. A co-located sibling in `src/` sharing the source module's basename —
 *      `packages/X/src/foo.test.ts` / `packages/X/src/foo.bun.test.ts` → `packages/X/src/foo.ts`
 *      (the majority convention — dozens of `packages/core/src/*.test.ts` files sit directly
 *      beside their source module).
 *   2. A same-basename file under a mirrored `tests/` tree, optionally further grouped under
 *      one `unit/`/`integration/` segment (this repo's own split, with no `src/` counterpart)
 *      — the `tests` segment is swapped for `src`, and one immediately-following `unit`/
 *      `integration` grouping segment is dropped, e.g.
 *      `packages/lore/tests/unit/service/foo.test.ts` → `packages/lore/src/service/foo.ts`.
 *
 * @invariant KNOWN, ACCEPTED RESIDUAL (documented, not silently dropped): a TOPIC-named test
 *   under a `tests/` tree whose basename does not match its tested source module (e.g. this
 *   very task's own `packages/core/tests/scope-mismatch-warning.test.ts`, which tests
 *   `assessment.ts`) derives a directory-correct but basename-wrong guess — it will overlap a
 *   DIRECTORY-scoped anchor covering that path, but never a specific-FILE anchor for a
 *   different basename. A heuristic that tried to bridge topic-named basenames would risk
 *   sweeping in an unrelated file as in-scope, which the governing task explicitly rejects as
 *   worse than under-classifying (see `isFileInScopeForAnchors`'s own JSDoc, `@lore/core`).
 *
 * @param filePath - One diff file path (repo-relative POSIX, matching `parseDiffFilePaths`'s
 *   output shape).
 * @returns The derived source path, or `undefined` when `filePath` does not end in a
 *   recognized test suffix (`.bun.test.ts` / `.test.ts` / `.test.tsx`) at all.
 *
 * @example
 * deriveRepoTestedSourcePath("packages/core/src/assessment.test.ts");
 * // → "packages/core/src/assessment.ts" (rule 1)
 *
 * @example
 * deriveRepoTestedSourcePath("packages/lore/tests/unit/service/ai-provider-service.bun.test.ts");
 * // → "packages/lore/src/service/ai-provider-service.ts" (rule 2, "unit" grouping dropped)
 *
 * @example
 * deriveRepoTestedSourcePath("docs/readme.md"); // → undefined (not a test file at all)
 */
export function deriveRepoTestedSourcePath(filePath: string): string | undefined {
  const suffixRules: ReadonlyArray<readonly [string, string]> = [
    [".bun.test.ts", ".ts"],
    [".test.tsx", ".tsx"],
    [".test.ts", ".ts"],
  ];
  const rule = suffixRules.find(([suffix]) => filePath.endsWith(suffix));
  if (rule === undefined) return undefined;
  const [suffix, ext] = rule;
  const strippedPath = filePath.slice(0, -suffix.length) + ext;

  const segments = strippedPath.split("/");
  const testsIdx = segments.indexOf("tests");
  if (testsIdx === -1) {
    // Rule 1: co-located sibling — same directory, suffix already stripped above.
    return strippedPath;
  }

  // Rule 2: mirrored `tests/` tree — swap the "tests" segment for "src", dropping one
  // immediately-following "unit"/"integration" grouping segment (no `src/` counterpart).
  const rest = segments.slice(testsIdx + 1);
  const restWithoutGrouping = rest[0] === "unit" || rest[0] === "integration" ? rest.slice(1) : rest;
  return [...segments.slice(0, testsIdx), "src", ...restWithoutGrouping].join("/");
}

// ─── Finding-Path Verification (D2/D3, spec-judgment-surfaces-must-verify-before-they-certify-machine) ───

/**
 * `true` iff `ref` resolves to an existing git object in `repoRoot` — a thin, never-throwing
 * wrapper over `git cat-file -e <ref>`. Used for BOTH of D2's two distinct checks: whether
 * the assessed commit itself resolves (`"<sha>^{commit}"`) and whether a declared path
 * exists in that commit's tree (`"<sha>:<path>"`) — the caller decides which `ref` shape to
 * pass; this function has no opinion on the difference.
 *
 * @invariant Never throws — `spawnSync`'s own `error` (e.g. `git` not on PATH) is treated
 *   the same as a non-zero exit: `false`. A missing/misconfigured `git` binary and a
 *   genuinely absent object are indistinguishable to this ONE check by design; the caller
 *   (`verifyFindingPaths`) tells them apart by checking the COMMIT referent FIRST, before
 *   ever checking a path against it (see that function's own JSDoc).
 * @param repoRoot - Directory to run `git` in (the assessed repo's root)
 * @param ref - A git revision spec, e.g. `"<sha>^{commit}"` or `"<sha>:<path>"`
 * @returns `true` iff `git cat-file -e <ref>` exited 0
 */
function gitObjectExists(repoRoot: string, ref: string): boolean {
  const result = spawnSync("git", ["cat-file", "-e", ref], { cwd: repoRoot, encoding: "utf8" });
  return !result.error && result.status === 0;
}

/**
 * Outcome of {@link verifyFindingPaths} — the SURVIVING `typed_gaps[]` (every finding whose
 * declared paths all exist at the assessed commit, or which declared none at all), the
 * WITHDRAWN findings (D3), and the three-state tally over every path any input finding
 * declared.
 */
export interface FindingPathVerificationOutcome {
  typedGaps: TypedGap[] | undefined;
  unverifiableFindings: UnverifiableFinding[];
  pathsVerified: PathsVerified;
}

/**
 * D2/D3 (spec-judgment-surfaces-must-verify-before-they-certify-machine) — machine-verifies
 * every path a `typedGaps[]` entry declares against the ASSESSED commit
 * {@link resolveAssessedCommit} (pure, `@lore/core`) resolves from `diffSource`, via
 * `git cat-file -e <commit>:<path>` ({@link gitObjectExists}) — never `fs.existsSync` against
 * the caller's own worktree, and never `HEAD` (substituting `HEAD` for the assessed commit IS
 * the defect this mechanism exists to fix; see `resolveAssessedCommit`'s own JSDoc).
 *
 * @invariant When `resolveAssessedCommit(diffSource)` returns `{status: "unchecked"}` (no git
 *   referent — every case enumerated on that function's own JSDoc) OR no finding declares any
 *   path at all, this is a NO-OP: `typedGaps` is returned BY THE SAME REFERENCE, no findings
 *   are withdrawn, and every declared path (if any) is tallied `unchecked` — NEVER silently
 *   counted as verified (D2). No `git` subprocess runs on this branch.
 * @invariant When the resolved commit itself cannot be found (`git cat-file -e
 *   <commit>^{commit}` fails — shallow clone, pruned range, a stale/bogus SHA), this FAILS
 *   LOUD: an `err(VALIDATION_ERROR)` naming the commit, rather than treating every declared
 *   path as absent (which would silently convert an environment problem into false findings —
 *   D2's own "fails LOUD naming the commit" requirement). This check runs ONLY when there is
 *   at least one declared path to verify — nothing declared means nothing to check, and there
 *   is no reason to demand the commit resolve at all in that case.
 * @invariant A finding with >=1 declared path confirmed ABSENT is withdrawn WHOLESALE to
 *   `unverifiableFindings[]` — `failing_path` is the FIRST absent path in encounter order
 *   (mirrors `unverifiableFindingSchema`'s own JSDoc), `checked_against_commit` is the
 *   resolved commit. A finding whose declared paths ALL exist (or which declares none) is
 *   KEPT, unchanged, in the returned `typedGaps`.
 * @invariant `pathsVerified.checked` / `.unverifiable` tally EVERY individual path checked,
 *   not one count per finding — a finding with two declared paths, one present and one
 *   absent, adds 1 to `checked` AND 1 to `unverifiable` even though the finding itself is
 *   withdrawn wholesale (mirrors `pathsVerifiedSchema`'s own JSDoc).
 * @invariant Never mutates `typedGaps` or any entry in it — always builds new arrays/objects.
 * @param typedGaps - `typed_gaps[]` AFTER any prior suppression pass (e.g.
 *   `suppressUngroundedAbsenceFindings`) — the surviving set this verification operates on
 * @param diffSource - The run's diff-source provenance, or `undefined` (same "no referent"
 *   treatment as `explicit_diff_text` — see `resolveAssessedCommit`)
 * @param repoRoot - Directory `git cat-file -e` runs in
 * @returns `ok(outcome)`, or `err(VALIDATION_ERROR)` naming the unresolvable commit
 *
 * @example
 * verifyFindingPaths(
 *   [{ dimension: "outcome", severity: "major", statement: "x", paths: ["src/gone.ts"] }],
 *   { mode: "explicit_diff", range: "abc..def" },
 *   "/repo",
 * );
 * // → ok({ typedGaps: [], unverifiableFindings: [{ ..., failing_path: "src/gone.ts",
 * //        checked_against_commit: "def" }], pathsVerified: { checked: 0, unverifiable: 1, unchecked: 0 } })
 * // — assuming "def:src/gone.ts" does not resolve in "/repo"
 */
/**
 * Moves every finding whose `paths[]` intersects the WHOLLY omitted diff files into
 * `withdrawn` with reason `not-shown-to-judge` (F2, AC-CRIT-3). Pure; never touches git.
 *
 * @param typedGaps - Judge findings after grounding suppression (may be undefined)
 * @param omittedDiffFiles - `BuildAssessPromptResult.omittedDiffFiles` (head-truncated file excluded)
 * @returns the surviving findings (same reference when nothing moved) and the withdrawn ones;
 *   `failing_path` is the first intersecting path in encounter order
 */
export function withdrawFindingsOnUnshownFiles(
  typedGaps: TypedGap[] | undefined,
  omittedDiffFiles: readonly string[],
): { typedGaps: TypedGap[] | undefined; withdrawn: UnverifiableFinding[] } {
  if (typedGaps === undefined || omittedDiffFiles.length === 0) return { typedGaps, withdrawn: [] };
  const omitted = new Set(omittedDiffFiles);
  const kept: TypedGap[] = [];
  const withdrawn: UnverifiableFinding[] = [];
  for (const gap of typedGaps) {
    const unshownPath = gap.paths.find((path) => omitted.has(path));
    if (unshownPath === undefined) kept.push(gap);
    else withdrawn.push({ ...gap, failing_path: unshownPath, reason: "not-shown-to-judge" });
  }
  return { typedGaps: kept, withdrawn };
}

export function verifyFindingPaths(
  typedGaps: TypedGap[] | undefined,
  diffSource: AssessDiffSource | undefined,
  repoRoot: string,
): Result<FindingPathVerificationOutcome, LoreError> {
  const gaps = typedGaps ?? [];
  const totalPaths = gaps.reduce((sum, gap) => sum + gap.paths.length, 0);

  const resolution = resolveAssessedCommit(diffSource);
  if (resolution.status === "unchecked" || totalPaths === 0) {
    return ok({
      typedGaps,
      unverifiableFindings: [],
      pathsVerified: {
        checked: 0,
        unverifiable: 0,
        unchecked: resolution.status === "unchecked" ? totalPaths : 0,
      },
    });
  }

  const { commit } = resolution;
  if (!gitObjectExists(repoRoot, `${commit}^{commit}`)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "diff_source",
      message:
        `Assessed commit "${commit}" could not be resolved in "${repoRoot}" (git cat-file -e ` +
        `"${commit}^{commit}" failed) — cannot verify finding paths against it. This is an ` +
        `environment problem (shallow clone, pruned range, or a stale reference), never an ` +
        `absent path: fix the environment, or supply --diff/--diff-file explicitly.`,
      value: commit,
    });
  }

  const keptGaps: TypedGap[] = [];
  const unverifiableFindings: UnverifiableFinding[] = [];
  let checked = 0;
  let unverifiable = 0;

  for (const gap of gaps) {
    let failingPath: string | undefined;
    for (const path of gap.paths) {
      if (gitObjectExists(repoRoot, `${commit}:${path}`)) {
        checked++;
      } else {
        unverifiable++;
        if (failingPath === undefined) failingPath = path;
      }
    }
    if (failingPath !== undefined) {
      unverifiableFindings.push({
        ...gap,
        failing_path: failingPath,
        checked_against_commit: commit,
        reason: "path-absent",
      });
    } else {
      keptGaps.push(gap);
    }
  }

  return ok({
    typedGaps: keptGaps,
    unverifiableFindings,
    pathsVerified: { checked, unverifiable, unchecked: 0 },
  });
}

// ─── AIProviderService ────────────────────────────────────────────────────────

/**
 * Stateless service that owns AI provider dispatch, template rendering, and telemetry.
 * Constructed once at createApp() time via the injected provider registry.
 *
 * @example
 * const assessBudgets = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };
 * const svc = new AIProviderService(providers, "claude-cli", templates, telemetry, true, 8000, assessBudgets);
 * const result = await svc.generate({ doc_type: "prd", title: "My PRD" });
 */
/**
 * Structural (duck-typed) capability a provider MAY expose: a REAL, resolved model
 * identifier — e.g. `HttpAIProvider`'s configured `ai.http.model`. Deliberately NOT added to
 * `AIProvider` itself (`@lore/core/ai.ts`) — this is a narrow, additive extension point checked
 * via TypeScript structural typing (`"modelId" in provider`-style), not a core interface change,
 * per task-t3-hardening-reachable-override-escape-real-ai-provenance's file-anchor scope. A
 * provider that starts exposing a public `modelId` property satisfies this automatically,
 * with no further change needed here. `HttpAIProvider` implements it (its configured
 * `cfg.model`); `ClaudeCliProvider` deliberately does not — it shells out to `claude -p`
 * and cannot know which model served the call — and `InMemoryAIProvider` is a test double.
 * See {@link AIProviderService._resolveAiProvenance}'s own JSDoc for what that means today.
 */
interface ModelAwareProvider {
  readonly modelId?: string;
}

export class AIProviderService {
  constructor(
    /** Immutable provider map from buildProviderRegistry — keyed by provider name */
    private readonly providers: ReadonlyMap<string, AIProvider>,
    /** Active provider name — validated by registry before construction */
    private readonly active: string,
    /**
     * Template overrides from config.ai.templates (string-keyed).
     * Keys: DocType values override doc-type templates; "refine" / "link_inference" override
     * the corresponding SPEC-019 built-in templates.
     * Absent keys fall back to BUILT_IN_TEMPLATES / REFINE_TEMPLATE / LINK_INFERENCE_TEMPLATE.
     */
    private readonly templates: Record<string, string>,
    /** Telemetry sink — NoOpTelemetry when telemetry is disabled */
    private readonly telemetry: Telemetry,
    /** Whether to emit ai.generation events (config.ai.telemetry — independent kill switch) */
    private readonly aiTelemetryEnabled: boolean,
    /**
     * Maximum characters of doc content to include in the refine prompt.
     * Sourced from config.ai.refine.max_input_chars (default 8000).
     * CLI checks against this value and warns the user before calling refineContent.
     * Source: SPEC-019 §9.4
     */
    private readonly _refineMaxInputChars: number,
    /**
     * Character budgets for each material section in the assess judge prompt.
     * Sourced from config.ai.assess.* (defaults: plan 8000, spec 12000, task 4000, diff 24000).
     * Source: SPEC-026 §3 D7
     */
    private readonly assessBudgets: AssessBudgets,
    /**
     * Character budgets for each material section in the review judge prompt.
     * Sourced from config.ai.review.* (defaults: doc 12000, context 8000).
     * Defaulted here (not required positionally) so pre-SPEC-034 call sites that construct
     * AIProviderService directly (several test fixtures) don't all need updating for a
     * feature they don't exercise.
     * Source: SPEC-034 §6
     */
    private readonly reviewBudgets: ReviewBudgets = { max_doc_chars: 12000, max_context_chars: 8000 },
    /**
     * Character/count budgets for the staleness-probe judge prompt.
     * Sourced from config.ai.staleness.* (defaults: doc 12000, neighbor_limit 20).
     * Defaulted here for the same reason `reviewBudgets` is — pre-SPEC-044 direct
     * AIProviderService constructions (test fixtures) don't need updating.
     * Source: SPEC-044 §Design Decisions D8
     */
    private readonly stalenessBudgets: StalenessBudgets = { max_doc_chars: 12000, neighbor_limit: 20 },
  ) {}

  /**
   * Active provider name. Exposed for CLI spinner ("⏳ Generating via <name>...").
   *
   * @returns Provider name as registered in the registry (e.g. "claude-cli")
   */
  get activeProviderName(): string {
    return this.active;
  }

  /**
   * Maximum characters of doc content sent to the provider in refine operations.
   * Exposed so the CLI can warn the user when truncation will occur (SPEC-019 §9.4).
   *
   * @returns Configured max chars (from config.ai.refine.max_input_chars; default 8000)
   */
  get refineMaxInputChars(): number {
    return this._refineMaxInputChars;
  }

  /**
   * Maximum characters of diff text sent to the assess judge prompt.
   * Exposed so the CLI can print the AC-AE-1 pre-flight budget warning BEFORE invoking
   * the provider, without duplicating `config.ai.assess.max_diff_chars` lookup logic.
   *
   * @returns Configured max chars (from config.ai.assess.max_diff_chars; default 24000)
   * Source: SPEC-028 AC-AE-1
   */
  get assessMaxDiffChars(): number {
    return this.assessBudgets.max_diff_chars;
  }

  // ─── SPEC-017: create path ──────────────────────────────────────────────────

  /**
   * Generate document content for the given doc type and title.
   * Used by `lore create --ai`.
   *
   * Steps:
   *   1. Determine template source (user-override or built-in)
   *   2. Render the template with title + optional parent_title
   *   3. Dispatch to the active provider
   *   4. Emit ai.generation telemetry (kind="create") on both success and failure
   *   5. Return the provider result
   *
   * @param args.doc_type - DocType being created
   * @param args.title - Document title (interpolated into template as {{title}})
   * @param args.parent_title - Optional parent document title (for {{#parent_title}}…{{/parent_title}})
   * @param args.caller_surface - Surface that initiated the call (SPEC-024 AC-NOAI-8; telemetry)
   * @param args.ai_default_source - How the AI decision was resolved (SPEC-024 AC-NOAI-8; telemetry)
   * @returns Result<GenerateOutput, LoreError> — never throws
   *
   * @example
   * const result = await svc.generate({ doc_type: "spec", title: "Auth Flow", parent_title: "Security PRD" });
   * if (!result.ok) { console.error(result.error.message); return; }
   * console.log(result.value.content.slice(0, 80));
   */
  async generate(args: {
    doc_type: DocType;
    title: string;
    parent_title?: string;
    caller_surface?: CallerSurface;
    ai_default_source?: AiDefaultSource;
  }): Promise<Result<GenerateOutput, LoreError>> {
    const userOverride = args.doc_type in this.templates;
    // reason: task-t3-hardening — resolved via getGenerateTemplateSet(GENERATE_PROMPT_VERSION)
    // rather than indexing BUILT_IN_TEMPLATES directly, so the template set actually rendered
    // and the prompt_version stamped into ai_provenance below can never drift apart (SSOT).
    // The lookup is unreachable-in-practice (GENERATE_PROMPT_VERSION always has a registered
    // entry) — same precedent as assessPlan's getAssessTemplate call below.
    const templateSetResult = getGenerateTemplateSet(GENERATE_PROMPT_VERSION);
    if (!templateSetResult.ok) return templateSetResult;
    const tpl = this.templates[args.doc_type] ?? templateSetResult.value[args.doc_type];

    // reason: exactOptionalPropertyTypes=true prohibits assigning undefined to optional prop.
    // Use conditional spread to only include parent_title when it is present.
    const prompt = renderTemplate(tpl, {
      title: args.title,
      ...(args.parent_title !== undefined ? { parent_title: args.parent_title } : {}),
    });

    const { result, duration_ms } = await this._invokeProvider({
      prompt,
      doc_type: args.doc_type,
      title: args.title,
      ...(args.parent_title !== undefined ? { parent_title: args.parent_title } : {}),
    });

    this._emitAiEvent(result, duration_ms, {
      doc_type: args.doc_type,
      template_source: userOverride ? "user-override" : "built-in",
      kind: "create",
      target_doc_id: null,
      caller_surface: args.caller_surface,
      ai_default_source: args.ai_default_source,
    });

    if (!result.ok) return result;

    // reason: SPEC-103 §Mechanisms M1 — ai_provenance recorded at THIS generation seam
    // only (the `lore create --ai` path); regenerateContent/refineContent deliberately
    // do not stamp it (see GenerateOutput.ai_provenance's own JSDoc, @lore/core/ai.ts).
    // task-t3-hardening — sourced via `_resolveAiProvenance()`: a REAL model id when the
    // active provider exposes one, OMITTED entirely otherwise (never a fabricated value —
    // see that method's own JSDoc for the honesty rationale and its current scope limits).
    const aiProvenance = this._resolveAiProvenance();
    return ok({
      ...result.value,
      ...(aiProvenance !== undefined ? { ai_provenance: aiProvenance } : {}),
    });
  }

  // ─── SPEC-019: set --regenerate ─────────────────────────────────────────────

  /**
   * Regenerate a document's content by re-running its type template.
   * Used by `lore set <id> --regenerate`.
   *
   * Picks the same per-type template that `lore create --ai` would use (BUILT_IN_TEMPLATES[doc.type]
   * or the user override). Replaces the doc content in the caller after returning.
   * Emits ai.generation with kind="regenerate" and target_doc_id=doc.id.
   *
   * @param doc - The DocRecord being regenerated (fully fetched by the caller)
   * @param opts.parent_title - Optional parent title for template interpolation
   * @param opts.caller_surface - Surface for telemetry (SPEC-024)
   * @param opts.ai_default_source - AI decision source for telemetry (SPEC-024)
   * @returns Result<GenerateOutput, LoreError> — never throws
   *
   * @example
   * const docResult = await app.corpusService.get(id);
   * if (!docResult.ok) { ... }
   * const aiResult = await svc.regenerateContent(docResult.value.doc, { parent_title: "Root PRD" });
   * if (!aiResult.ok) { process.exitCode = 6; return; }
   * await app.corpusService.set(id, { content: aiResult.value.content }); // demotes approved→draft
   *
   * Source: SPEC-019 AC-SET-AI-1
   */
  async regenerateContent(
    doc: DocRecord,
    opts?: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes — callers may pass
      // variables of type `string | undefined` directly (e.g. after a conditional parent fetch).
      parent_title?: string | undefined;
      caller_surface?: CallerSurface | undefined;
      ai_default_source?: AiDefaultSource | undefined;
    },
  ): Promise<Result<GenerateOutput, LoreError>> {
    const userOverride = doc.type in this.templates;
    const tpl = this.templates[doc.type] ?? BUILT_IN_TEMPLATES[doc.type];

    const prompt = renderTemplate(tpl, {
      title: doc.title,
      ...(opts?.parent_title !== undefined ? { parent_title: opts.parent_title } : {}),
    });

    const { result, duration_ms } = await this._invokeProvider({
      prompt,
      doc_type: doc.type,
      title: doc.title,
      ...(opts?.parent_title !== undefined ? { parent_title: opts.parent_title } : {}),
    });

    this._emitAiEvent(result, duration_ms, {
      doc_type: doc.type,
      template_source: userOverride ? "user-override" : "built-in",
      kind: "regenerate",
      target_doc_id: doc.id,
      caller_surface: opts?.caller_surface,
      ai_default_source: opts?.ai_default_source,
    });

    return result;
  }

  // ─── SPEC-019: set --refine ─────────────────────────────────────────────────

  /**
   * Refine a document's content with a user-supplied prompt.
   * Used by `lore set <id> --refine "<prompt>"` and `lore set <id> --refine-stdin`.
   *
   * Content is truncated to refineMaxInputChars before building the prompt; the CLI
   * is responsible for warning the user about truncation before calling this method.
   * Emits ai.generation with kind="refine" and target_doc_id=doc.id.
   *
   * @param doc - The DocRecord being refined (fully fetched by the caller)
   * @param userPrompt - The refinement instruction from the user (non-empty, validated by caller)
   * @param opts.caller_surface - Surface for telemetry (SPEC-024)
   * @param opts.ai_default_source - AI decision source for telemetry (SPEC-024)
   * @returns Result<GenerateOutput, LoreError> — never throws
   *
   * @example
   * const aiResult = await svc.refineContent(doc, "Tighten section 3, add more examples");
   * if (!aiResult.ok) { process.exitCode = 6; return; }
   * await app.corpusService.set(id, { content: aiResult.value.content }); // demotes approved→draft
   *
   * Source: SPEC-019 AC-SET-AI-2, §9.4
   */
  async refineContent(
    doc: DocRecord,
    userPrompt: string,
    opts?: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes.
      caller_surface?: CallerSurface | undefined;
      ai_default_source?: AiDefaultSource | undefined;
    },
  ): Promise<Result<GenerateOutput, LoreError>> {
    const userOverride = "refine" in this.templates;
    const tpl = this.templates["refine"] ?? REFINE_TEMPLATE;

    // Truncate content to prevent runaway prompt cost (SPEC-019 §9.4)
    // reason: truncation happens here (service), not in the CLI, so the boundary is
    // consistent regardless of which adapter (CLI / future MCP) calls refineContent.
    const truncatedContent = doc.content.length > this._refineMaxInputChars
      ? doc.content.slice(0, this._refineMaxInputChars)
      : doc.content;

    const prompt = renderTemplate(tpl, {
      title: doc.title,
      current_content: truncatedContent,
      user_prompt: userPrompt,
    });

    const { result, duration_ms } = await this._invokeProvider({
      prompt,
      doc_type: doc.type,
      title: doc.title,
    });

    this._emitAiEvent(result, duration_ms, {
      doc_type: doc.type,
      template_source: userOverride ? "user-override" : "built-in",
      kind: "refine",
      target_doc_id: doc.id,
      caller_surface: opts?.caller_surface,
      ai_default_source: opts?.ai_default_source,
    });

    return result;
  }

  // ─── SPEC-019: link --infer ─────────────────────────────────────────────────

  /**
   * Infer the link type between two documents using the AI provider.
   * Used by `lore link <from> <to> --infer`.
   *
   * Sends both document titles and first 500 chars of body to the provider.
   * Parses the response (trim + lowercase + linkTypeSchema.safeParse).
   * Invalid AI response → err(AI_PROVIDER_ERROR); caller exits 6 without creating a link.
   * Emits ai.generation with kind="infer" and target_doc_id=from.id.
   *
   * @param from - The source document (from-side of the link)
   * @param to - The target document (to-side of the link)
   * @param opts.caller_surface - Surface for telemetry (SPEC-024)
   * @returns Result<{linkType: LinkType}, LoreError> — never throws
   *
   * @example
   * const inferResult = await svc.inferLinkType(fromDoc, toDoc);
   * if (!inferResult.ok) { process.exitCode = 6; return; } // exit 6: invalid type or provider error
   * await app.corpusService.link(from.id, to.id, inferResult.value.linkType);
   *
   * Source: SPEC-019 AC-LINK-AI-1, AC-LINK-AI-2
   */
  async inferLinkType(
    from: DocRecord,
    to: DocRecord,
    opts?: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes.
      caller_surface?: CallerSurface | undefined;
    },
  ): Promise<Result<{ linkType: LinkType }, LoreError>> {
    const userOverride = "link_inference" in this.templates;
    const tpl = this.templates["link_inference"] ?? LINK_INFERENCE_TEMPLATE;

    // reason: bodies are truncated to 500 chars per SPEC-019 §9.1 to keep inference
    // prompts short — the model only needs context, not the full document text.
    const BODY_HEAD_CHARS = 500;
    const prompt = renderTemplate(tpl, {
      from_title: from.title,
      from_body_head: from.content.slice(0, BODY_HEAD_CHARS),
      to_title: to.title,
      to_body_head: to.content.slice(0, BODY_HEAD_CHARS),
    });

    // reason: GenerateInput requires a valid doc_type and non-empty title.
    // We use from.type/from.title as the "primary" doc context for the inference call.
    // The provider only uses the prompt; doc_type/title pass through for telemetry only.
    const { result, duration_ms } = await this._invokeProvider({
      prompt,
      doc_type: from.type,
      title: from.title,
    });

    if (!result.ok) {
      this._emitAiEvent(result, duration_ms, {
        doc_type: from.type,
        template_source: userOverride ? "user-override" : "built-in",
        kind: "infer",
        target_doc_id: from.id,
        caller_surface: opts?.caller_surface,
      });
      return result;
    }

    // Parse the provider's response: trim + lowercase + validate against linkTypeSchema
    // reason: AI may return the type with extra whitespace or mixed case (e.g. "Relates-To\n").
    // Normalisation makes the check robust without requiring exact-case model output.
    const rawOutput = result.value.content.trim().toLowerCase();
    const parseResult = linkTypeSchema.safeParse(rawOutput);

    if (!parseResult.success) {
      const validationError: Result<GenerateOutput, LoreError> = {
        ok: false,
        error: {
          code: "AI_PROVIDER_ERROR",
          provider: this.active,
          exit_code: 0,
          message:
            `AI returned invalid link type "${rawOutput}". ` +
            `Expected one of: parent, implements, informs, supersedes, relates-to, blocks, governs.`,
        },
      };
      this._emitAiEvent(validationError, duration_ms, {
        doc_type: from.type,
        template_source: userOverride ? "user-override" : "built-in",
        kind: "infer",
        target_doc_id: from.id,
        caller_surface: opts?.caller_surface,
      });
      return validationError;
    }

    // Success path: emit telemetry with the successful GenerateOutput
    this._emitAiEvent(result, duration_ms, {
      doc_type: from.type,
      template_source: userOverride ? "user-override" : "built-in",
      kind: "infer",
      target_doc_id: from.id,
      caller_surface: opts?.caller_surface,
    });

    return ok({ linkType: parseResult.data });
  }

  // ─── SPEC-026: assess ────────────────────────────────────────────────────────

  /**
   * Judge a plan's outcome against its spec's ACs and its tasks' evidence trails.
   * Used by `lore assess <plan>`.
   *
   * Flow: build the judge prompt (materials truncated per config.ai.assess.* budgets;
   * SPEC-038 §5 — a spec with declared structured ACs gets a deterministic AC table instead
   * of the verbatim prose section) → invoke the provider → extract JSON from the raw
   * response → validate against llmAssessmentOutputSchema → on failure, ONE corrective
   * retry with the parse error embedded in a follow-up prompt → on a second failure,
   * AI_PROVIDER_ERROR with a ≤500-char raw-output prefix (no document is created — that is
   * the caller's job, and it never runs when this returns an error). When the spec declared
   * structured ACs, a schema-valid response is ALSO checked for `ac_id` containment
   * (`validateAcIdContainment`, SPEC-038 §5 D5) — a violation is a VALIDATION_ERROR returned
   * immediately, without spending the corrective retry and without creating a document.
   * Emits ai.generation telemetry (kind="assess") on every terminal outcome exactly once.
   *
   * @param bundle - {plan, spec?, tasks[]} from CorpusService.getPlanBundle
   * @param opts.diffText - Optional diff text (already acquired by the CLI layer). Filtered
   *   through {@link excludeAssessMirrorFromDiff} EXACTLY ONCE, at the top of this method
   *   (D4, spec-judgment-surfaces-must-verify-before-they-certify-machine) — every downstream
   *   use (facts, scope-mismatch, the rendered prompt) sees the mirror-free text, never the
   *   raw caller-supplied one.
   * @param opts.source - Caller surface, forwarded to telemetry as caller_surface
   * @param opts.commitDerivationUnverifiable - REQUIRED (task-the-mcp-assess-adapter-
   *   still-calls-derivecommitsetforplan mechanizes this — no default, every caller must
   *   compute and pass it explicitly). `true` when the caller's commit-set derivation
   *   (`assess-commit-derivation.ts`) reported `"unverifiable_convention_mismatch"` for
   *   this plan. Forces `scope_fidelity` out of the persisted `dimension_scores`
   *   (see `forceScopeFidelityUnverifiable`), regardless of the judge's own output. Pass
   *   `false` for every other path (explicit `--diff`/`diff_text` override, or a
   *   genuinely commit-less plan) — a deliberate value, never an omission.
   * @param opts.diffSource - OPTIONAL (D2, spec-judgment-surfaces-must-verify-before-they-
   *   certify-machine) — the run's `DiffSourceRecord`-shaped diff provenance (mirrored as
   *   {@link AssessDiffSource}; see that type's own JSDoc for why it is not imported
   *   directly from the adapter layer). Resolved via {@link resolveAssessedCommit} to the ONE
   *   commit every `typed_gaps[].paths` entry is checked against, by
   *   {@link verifyFindingPaths} (called from `_finalizeAssessment`, below). ⛔ Still NOT
   *   THREADED by either production caller (`commands/assess.ts`, MCP `tools.ts` — both
   *   outside this task's file anchors, spec-judgment-surfaces-must-verify-before-they-
   *   certify-machine's own declared Scope): a follow-up task must have the CLI/MCP layer
   *   pass its already-resolved `diffSource` local through here. Until then this stays
   *   `undefined` in production, which {@link verifyFindingPaths} treats as "no referent" —
   *   every declared path is recorded `"unchecked"`, NEVER silently "verified" or dropped.
   *   This mechanism itself (the verification pass, its wiring into `_finalizeAssessment`,
   *   and its unit coverage) IS fully live and exercised the moment a caller supplies
   *   `diffSource` — e.g. every test in `assess-path-verification.bun.test.ts` — the gap is
   *   solely "no production caller supplies it yet", never "the mechanism is inert".
   * @param opts.repoRoot - OPTIONAL — directory `git cat-file -e` runs in when verifying
   *   finding paths. Defaults to `process.cwd()`; tests pass a throwaway git fixture.
   * @returns Result<AssessmentResult, LoreError> — never throws. Returns
   *   `err(VALIDATION_ERROR)` naming the commit when `opts.diffSource` resolves to a commit
   *   that `git cat-file -e` cannot find (shallow clone / pruned range) — D2 fails LOUD
   *   rather than silently reading "cannot resolve" as "path absent".
   *
   * @example
   * const bundleResult = await app.corpusService.getPlanBundle("plan-my-feature");
   * if (!bundleResult.ok) { ... }
   * const assessResult = await svc.assessPlan(bundleResult.value, {
   *   source: app.callerSurface,
   *   commitDerivationUnverifiable: false,
   * });
   * if (!assessResult.ok) { process.exitCode = exitCode(assessResult.error); return; }
   * console.log(assessResult.value.verdict, assessResult.value.overall_score);
   *
   * Source: SPEC-026 §3 D1, D2; §4 AC-ASSESS-1, AC-ASSESS-3, AC-ASSESS-4, AC-ASSESS-5;
   * SPEC-038 §5 AC-ACODE-4, AC-ACODE-5; task-lore-assess-derives-a-plan-s-commits-by-
   * grepping-task AC #3; task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan;
   * spec-judgment-surfaces-must-verify-before-they-certify-machine D2, D3, D4
   */
  async assessPlan(
    bundle: PlanBundle,
    opts: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes.
      diffText?: string | undefined;
      source?: CallerSurface | undefined;
      // reason: REQUIRED, not optional — task-the-mcp-assess-adapter-still-calls-
      // derivecommitsetforplan mechanizes the ADR's Q3 (Opt-in) closure: an
      // optional-with-default flag is exactly what let the MCP adapter omit it silently
      // while still compiling. Every caller (CLI, MCP, any future adapter) must compute
      // this fact from its own `allTasksArchived` + `deriveCommitSetForPlan` call and
      // pass it explicitly — there is no longer a default to fall back on.
      commitDerivationUnverifiable: boolean;
      // reason: OPTIONAL — see this method's own @param doc above for the "not yet wired
      // by either production caller" state and why `undefined` is a SAFE default, not a
      // silent capability gap.
      diffSource?: AssessDiffSource | undefined;
      repoRoot?: string | undefined;
    },
  ): Promise<Result<AssessmentResult, LoreError>> {
    const t0 = performance.now();

    // reason: D2 (spec-judgment-surfaces-must-verify-before-they-certify-machine) — resolved
    // ONCE here (never re-derived per finalization branch below) so both the first-attempt
    // and corrective-retry success paths verify finding paths against the SAME root.
    const repoRoot = opts.repoRoot ?? process.cwd();

    // reason: D4 (spec-judgment-surfaces-must-verify-before-they-certify-machine) — the
    // generated docs/requirements/** mirror is stripped EXACTLY ONCE here, before ANY
    // downstream consumer (facts, scope-mismatch, the rendered prompt) ever sees
    // `opts.diffText` — never inside a registry-versioned prompt builder itself (that would
    // retroactively break ASSESS_TEMPLATE_REGISTRY[6]/[7]'s `reproducible: true` guarantee;
    // see `excludeAssessMirrorFromDiff`'s own JSDoc). A no-op (byte-identical) for the
    // overwhelmingly common diff that never touches the mirror at all.
    const diffText = opts.diffText !== undefined ? excludeAssessMirrorFromDiff(opts.diffText) : undefined;

    // reason: SPEC-040 D1/D2 — facts are computed EXACTLY ONCE here, from the full
    // untruncated bundle, BEFORE any prompt-budget truncation happens. The SAME facts
    // object is (a) handed to the template builder for the "# Deterministic Facts"
    // section and (b) persisted verbatim into extra.assessment.facts — a judge's output
    // can never overwrite what facts.ac_coverage/task_evidence/scope/etc. actually say.
    const declaredCriteriaForFacts = extractDeclaredAcceptanceCriteria(bundle.spec);
    const facts = computeAssessmentFacts(bundle, declaredCriteriaForFacts, buildAssessDiffMeta(diffText));
    const sourceVersions = this._buildSourceVersions(bundle);

    // reason: hotfix (task-assess-diff-range-scope-mismatch-warning) — a deterministic,
    // non-blocking FACTS comparison between the diff's changed files and the plan's
    // declared task file_anchors, computed once alongside `facts`/`sourceVersions` and
    // persisted verbatim by `_finalizeAssessment`. `deriveRepoTestedSourcePath` (this file)
    // is THIS repo's own test→source convention (task-computescopemismatchwarning-cannot-
    // distinguish-a-too-wide) — without it, `computeScopeMismatchWarning` would judge every
    // file by direct anchor overlap only and the false-positive fix that task built would
    // never actually run in production, only in its own unit test (the exact inert-mechanism
    // failure the ADR's Q1/Q3 warn about).
    const diffFilesForScope = parseDiffFilePaths(diffText ?? "");
    const taskAnchorsForScope = bundle.tasks.flatMap((task) => extractFileAnchors(task));
    const scopeMismatchOutcome = computeScopeMismatchWarning(
      diffFilesForScope,
      taskAnchorsForScope,
      deriveRepoTestedSourcePath,
    );
    // reason: `ScopeMismatchNotMeasured` (the comparison could not be attempted at all — no
    // task declared anchors, or the diff touched no files) is an INTERNAL signal, never a
    // persisted field — `AssessmentResult.scope_warning` stays reserved for a genuine
    // `ScopeMismatchWarning` (the persisted contract is unchanged, per
    // adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the's Q2: the distinction
    // matters for `computeScopeMismatchWarning`'s OWN callers/tests, not for what this
    // service persists downstream). Both "not measured" and "measured, genuinely fine"
    // degrade to the SAME `undefined` here, exactly matching this function's pre-existing,
    // byte-identical "no field, not a stored false" persisted behaviour.
    const scopeWarning: ScopeMismatchWarning | undefined =
      scopeMismatchOutcome === undefined || "status" in scopeMismatchOutcome ? undefined : scopeMismatchOutcome;

    const templateResult = getAssessTemplate(ASSESS_PROMPT_VERSION);
    if (!templateResult.ok) return templateResult;
    // reason: task-getassesstemplatereproducibility-has-zero-production-callers — resolve
    // `judgment.reproducible` from the EXACT SAME `ASSESS_PROMPT_VERSION` binding already
    // used for `templateResult` and later stamped as `judgment.prompt_version` (see the
    // `_finalizeAssessment` call sites below) — one read of the version, never two
    // independent derivations, which is precisely how the two fields could otherwise drift
    // apart. `getAssessTemplate`/`getAssessTemplateReproducibility` both key off the same
    // `ASSESS_TEMPLATE_REGISTRY` (assess-template.ts), so an unregistered version here is a
    // structural invariant violation, not a reachable per-request outcome — `templateResult`
    // above would already have failed and returned first. It is still handled explicitly and
    // loud (propagated as this call's own `err`, exactly like `templateResult`) rather than
    // defaulted to `false`/omitted: silently coercing an internal registry-consistency defect
    // into "not reproducible" or "not recorded" would recreate the exact proxy/silence
    // conflation this task family exists to close (task's ADR three-question review, Q2).
    const reproducibleResult = getAssessTemplateReproducibility(ASSESS_PROMPT_VERSION);
    if (!reproducibleResult.ok) return reproducibleResult;
    const { prompt, truncated, declaredAcIds, omittedDiffFiles } = templateResult.value(
      bundle,
      diffText,
      this.assessBudgets,
      facts,
    );
    // reason: same extraction the template used to render the AC table — reusing its
    // returned list (rather than re-deriving from bundle.spec here) guarantees the prompt's
    // declared-id universe and the containment check's universe can never drift apart
    // (SPEC-038 §5 D5). Empty when the spec has no structured ACs (verbatim fallback).
    // On v6 with a plan-declared extra.ac_scope (SPEC-040 D5), this is the SCOPE-RESTRICTED
    // subset, not the spec's full declared set — see buildAssessPromptV6's JSDoc.
    const declaredAcIdSet = new Set(declaredAcIds);

    // reason: telemetry meta is identical across every terminal branch below (only the
    // provider Result and elapsed duration differ) — factored out to keep each branch
    // a one-line emit call instead of repeating the 5-field meta object four times.
    const emitAssessEvent = (providerResult: Result<GenerateOutput, LoreError>): void => {
      this._emitAiEvent(providerResult, Math.round(performance.now() - t0), {
        doc_type: "knowledge",
        template_source: "built-in",
        kind: "assess",
        target_doc_id: null,
        caller_surface: opts.source,
      });
    };

    // First attempt.
    const first = await this._attemptJudgeParse(prompt, bundle);
    if (!first.providerResult.ok) {
      emitAssessEvent(first.providerResult);
      return first.providerResult;
    }
    if (first.parsed !== undefined) {
      // reason: containment (SPEC-038 §5 AC-ACODE-5, D5) runs AFTER schema validation but
      // BEFORE scope/judgment assembly, and only when the spec declared structured ACs at
      // all — see validateAcIdContainment's JSDoc for why this does not spend the retry.
      if (declaredAcIdSet.size > 0) {
        const containment = validateAcIdContainment(first.parsed, declaredAcIdSet);
        if (!containment.ok) {
          emitAssessEvent(containment);
          return containment;
        }
      }
      // reason: D2/D3 (spec-judgment-surfaces-must-verify-before-they-certify-machine) —
      // path verification can itself fail LOUD (an unresolvable assessed commit), a THIRD
      // terminal outcome alongside provider failure and containment failure above; `err()`'s
      // `Result<never, LoreError>` is assignable to `Result<GenerateOutput, LoreError>` (never
      // is bottom), the same precedent `doubleFailure` below relies on, so it can be handed to
      // `emitAssessEvent` directly.
      const finalizeResult = this._finalizeAssessment(
        first.parsed,
        bundle,
        Math.round(performance.now() - t0),
        false,
        truncated,
        first.clippedAcIds ?? [],
        facts,
        sourceVersions,
        scopeWarning,
        opts.commitDerivationUnverifiable,
        reproducibleResult.value,
        opts.diffSource,
        repoRoot,
        omittedDiffFiles,
      );
      if (!finalizeResult.ok) {
        emitAssessEvent(finalizeResult);
        return finalizeResult;
      }
      emitAssessEvent(first.providerResult);
      return ok(finalizeResult.value);
    }

    // Corrective retry (SPEC-026 §3 D2) — embed the parse error + reminder.
    const retryPrompt = buildAssessRetryPrompt(prompt, first.parseErrorMessage ?? "unknown parse error");
    const second = await this._attemptJudgeParse(retryPrompt, bundle);
    if (!second.providerResult.ok) {
      emitAssessEvent(second.providerResult);
      return second.providerResult;
    }
    if (second.parsed !== undefined) {
      // reason: same containment gate as the first-attempt success branch above — a
      // corrective retry that comes back schema-valid but still names an undeclared ac_id
      // is still a containment failure, and there is no third attempt to fall back to.
      if (declaredAcIdSet.size > 0) {
        const containment = validateAcIdContainment(second.parsed, declaredAcIdSet);
        if (!containment.ok) {
          emitAssessEvent(containment);
          return containment;
        }
      }
      // reason: same D2/D3 finalize-can-fail-loud precedent as the first-attempt branch above.
      const finalizeResult = this._finalizeAssessment(
        second.parsed,
        bundle,
        Math.round(performance.now() - t0),
        true,
        truncated,
        second.clippedAcIds ?? [],
        facts,
        sourceVersions,
        scopeWarning,
        opts.commitDerivationUnverifiable,
        reproducibleResult.value,
        opts.diffSource,
        repoRoot,
        omittedDiffFiles,
      );
      if (!finalizeResult.ok) {
        emitAssessEvent(finalizeResult);
        return finalizeResult;
      }
      emitAssessEvent(second.providerResult);
      return ok(finalizeResult.value);
    }

    // Both attempts malformed → AI_PROVIDER_ERROR with a raw-output prefix (AC-ASSESS-4).
    // No document is created — the caller (CLI/MCP) only creates one after an ok() return.
    // reason: err()'s Result<never, E> return type is assignable to Result<T, E> for any T
    // (never is bottom), so the same value can be passed to emitAssessEvent (which wants
    // Result<GenerateOutput, LoreError>) and returned as Result<AssessmentResult, LoreError>
    // without a cast.
    const rawPrefix = (second.rawContent ?? "").slice(0, 500);
    const doubleFailure = err({
      code: "AI_PROVIDER_ERROR" as const,
      provider: this.active,
      message:
        `AI judge response could not be parsed as valid assessment JSON after one ` +
        `corrective retry: ${second.parseErrorMessage ?? "unknown error"}. Raw output prefix: ${rawPrefix}`,
    });
    emitAssessEvent(doubleFailure);
    return doubleFailure;
  }

  // ─── SPEC-034: review ────────────────────────────────────────────────────────

  /**
   * Judge a single document against the mechanical pre-checks already computed for it.
   * Used by `lore review <doc>`.
   *
   * Flow: build the judge prompt (materials truncated per config.ai.review.* budgets,
   * deterministic `checks` embedded verbatim) → invoke the provider → extract JSON from the
   * raw response → validate against llmReviewOutputSchema → on failure, ONE corrective
   * retry with the parse error embedded in a follow-up prompt → on a second failure,
   * AI_PROVIDER_ERROR with a ≤500-char raw-output prefix (no judgment is persisted — that
   * is the caller's job via JudgmentService.record, and it never runs when this returns an
   * error). Emits ai.generation telemetry (kind="review") on every terminal outcome exactly
   * once, mirroring assessPlan's telemetry-exactly-once contract.
   *
   * @param bundle - {doc, parent?, links, brokenLinkTargets?, blueprint?} from
   *   CorpusService.getReviewBundle
   * @param checks - Deterministic pre-check results from `runDeterministicChecks(bundle)`,
   *   computed by the caller BEFORE this call — always persisted verbatim onto the returned
   *   judgment's `checks` field, regardless of what (if anything) the model itself reports
   * @param opts.source - Caller surface, forwarded to telemetry as caller_surface
   * @returns Result<NewReviewJudgment, LoreError> — never throws; the caller passes an ok()
   *   value straight into JudgmentService.record to persist it
   *
   * @example
   * const bundleResult = await app.corpusService.getReviewBundle("spec-my-feature", blueprint);
   * if (!bundleResult.ok) { ... }
   * const checks = runDeterministicChecks(bundleResult.value);
   * const judgeResult = await svc.judgeDoc(bundleResult.value, checks, { source: app.callerSurface });
   * if (!judgeResult.ok) { process.exitCode = 6; return; }
   * await app.judgmentService.record(judgeResult.value);
   *
   * Source: SPEC-034 §2, §4
   */
  async judgeDoc(
    bundle: ReviewBundle,
    checks: CheckResult[],
    opts?: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes.
      source?: CallerSurface | undefined;
    },
  ): Promise<Result<NewReviewJudgment, LoreError>> {
    const t0 = performance.now();
    // reason: REVIEW_TEMPLATES always carries an entry for the currently active
    // REVIEW_PROMPT_VERSION — the module co-locates the const with its own registry entry,
    // so this lookup cannot miss in practice; the non-null assertion documents that guarantee
    // rather than silently tolerating an impossible `undefined`.
    const template = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!;
    // reason: SPEC-043 §Design Decisions D9 — nowIso drives the prompt's "# Staleness
    // Notice" section (bundle.doc/bundle.parent invalidated-state check). judgeDoc is
    // the sole production caller of this template — resolving "now" here, once, keeps
    // review-template.ts itself wall-clock-free (its own module invariant).
    const { prompt, docTruncated, cuts } = template(bundle, checks, this.reviewBudgets, new Date().toISOString());

    const emitReviewEvent = (
      providerResult: Result<GenerateOutput, LoreError>,
      decision?: NewReviewJudgment["decision"],
      confidence?: number,
    ): void => {
      this._emitAiEvent(providerResult, Math.round(performance.now() - t0), {
        doc_type: bundle.doc.type,
        template_source: "built-in",
        kind: "review",
        target_doc_id: bundle.doc.id,
        caller_surface: opts?.source,
        ...(decision !== undefined ? { decision } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      });
    };

    // First attempt.
    const first = await this._attemptJudgeDocParse(prompt, bundle);
    if (!first.providerResult.ok) {
      emitReviewEvent(first.providerResult);
      return first.providerResult;
    }
    if (first.parsed !== undefined) {
      const finalized = this._finalizeJudgment(first.parsed, bundle, checks, docTruncated, cuts);
      emitReviewEvent(first.providerResult, finalized.decision, finalized.confidence);
      return ok(finalized);
    }

    // Corrective retry (SPEC-034 §4, mirrors SPEC-026 §3 D2).
    const retryPrompt = buildReviewRetryPrompt(prompt, first.parseErrorMessage ?? "unknown parse error");
    const second = await this._attemptJudgeDocParse(retryPrompt, bundle);
    if (!second.providerResult.ok) {
      emitReviewEvent(second.providerResult);
      return second.providerResult;
    }
    if (second.parsed !== undefined) {
      const finalized = this._finalizeJudgment(second.parsed, bundle, checks, docTruncated, cuts);
      emitReviewEvent(second.providerResult, finalized.decision, finalized.confidence);
      return ok(finalized);
    }

    // Both attempts malformed → AI_PROVIDER_ERROR with a raw-output prefix.
    // No judgment is returned — the caller (CLI/MCP) only calls JudgmentService.record
    // after an ok() return.
    const rawPrefix = (second.rawContent ?? "").slice(0, 500);
    const doubleFailure = err({
      code: "AI_PROVIDER_ERROR" as const,
      provider: this.active,
      message:
        `AI judge response could not be parsed as valid review JSON after one ` +
        `corrective retry: ${second.parseErrorMessage ?? "unknown error"}. Raw output prefix: ${rawPrefix}`,
    });
    emitReviewEvent(doubleFailure);
    return doubleFailure;
  }

  // ─── SPEC-044: staleness probe ───────────────────────────────────────────────

  /**
   * Judge whether a single document still holds true (SPEC-044 §Design Decisions D5).
   * Used by `StalenessProbeService` (never called directly by an adapter — mirrors
   * `judgeDoc`'s role in the review pipeline, but this is invoked per-candidate from
   * `StalenessProbeService`'s batch orchestration, not from the CLI/MCP layer directly).
   *
   * Flow: build the judge prompt (materials truncated per `config.ai.staleness.*`
   * budgets) → invoke the provider → extract JSON from the raw response → validate
   * against `stalenessVerdictSchema` → on failure, ONE corrective retry with the parse
   * error embedded in a follow-up prompt → on a second failure, `AI_PROVIDER_ERROR` with
   * a ≤500-char raw-output prefix (no judgment is returned — the caller never calls
   * `JudgmentService.record` on an `err()` Result, SPEC-026 §3 D2 pattern). An
   * out-of-enum `decision` in the FIRST attempt is a hard error with NO retry (D5) — a
   * response that isn't even loosely shaped as a staleness verdict is treated the same
   * as a JSON parse failure would be (one retry), but `stalenessVerdictSchema`'s enum
   * check on the SECOND attempt (or any attempt beyond) is still fatal, consuming no
   * further retries.
   *
   * `doc_version` on the returned judgment is `bundle.doc.version` — the version read at
   * BUNDLE-ASSEMBLY time (by `StalenessProbeService`), not re-fetched here. A concurrent
   * edit racing this call simply yields a judgment the existing `(stale)` freshness rule
   * already discounts (T8; no lock, no re-read).
   *
   * @param bundle - {doc, age_days, in_degree, neighbors} from `StalenessProbeService`
   * @param opts.source - Caller surface, forwarded to telemetry as caller_surface
   * @returns Result<NewReviewJudgment, LoreError> — `kind: "staleness"` always set;
   *   never throws
   *
   * @example
   * const probeResult = await svc.probeStaleness(bundle, { source: app.callerSurface });
   * if (!probeResult.ok) { ... }
   * await app.judgmentService.record(probeResult.value, { auditAction: "staleness_probe", auditActor: by });
   *
   * Source: SPEC-044 §Design Decisions D5
   */
  async probeStaleness(
    bundle: StalenessBundle,
    opts?: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes.
      source?: CallerSurface | undefined;
    },
  ): Promise<Result<NewReviewJudgment, LoreError>> {
    const t0 = performance.now();
    // reason: STALENESS_TEMPLATES always carries an entry for the currently active
    // STALENESS_PROMPT_VERSION — same non-null-assertion precedent as judgeDoc's
    // REVIEW_TEMPLATES lookup above.
    const template = STALENESS_TEMPLATES[STALENESS_PROMPT_VERSION]!;
    const nowIso = new Date().toISOString();
    const { prompt } = template(bundle, this.stalenessBudgets, nowIso);

    const emitStalenessEvent = (
      providerResult: Result<GenerateOutput, LoreError>,
      decision?: NewReviewJudgment["decision"],
      confidence?: number,
    ): void => {
      this._emitAiEvent(providerResult, Math.round(performance.now() - t0), {
        doc_type: bundle.doc.type,
        template_source: "built-in",
        kind: "staleness",
        target_doc_id: bundle.doc.id,
        caller_surface: opts?.source,
        ...(decision !== undefined ? { decision } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      });
    };

    // First attempt.
    const first = await this._attemptStalenessParse(prompt, bundle);
    if (!first.providerResult.ok) {
      emitStalenessEvent(first.providerResult);
      return first.providerResult;
    }
    if (first.parsed !== undefined) {
      const finalized = this._finalizeStalenessJudgment(first.parsed, bundle);
      emitStalenessEvent(first.providerResult, finalized.decision, finalized.confidence);
      return ok(finalized);
    }
    // reason: D5 — an out-of-enum `decision` is a HARD error with NO retry, distinct
    // from a genuine malformed/unparseable response (which DOES get the one corrective
    // retry below). A model that returns syntactically valid JSON with a nonsense
    // decision value isn't going to self-correct via a "fix your JSON" retry prompt —
    // burning the retry budget on it only delays the inevitable AI_PROVIDER_ERROR.
    if (first.outOfEnumDecision) {
      const rawPrefix = (first.rawContent ?? "").slice(0, 500);
      const hardFailure = err({
        code: "AI_PROVIDER_ERROR" as const,
        provider: this.active,
        message:
          `AI staleness probe returned an out-of-enum decision (must be "holds" or ` +
          `"stale_candidate"): ${first.parseErrorMessage ?? "invalid decision"}. Raw output prefix: ${rawPrefix}`,
      });
      emitStalenessEvent(hardFailure);
      return hardFailure;
    }

    // Corrective retry (SPEC-026 §3 D2 pattern) — genuine malformed/unparseable JSON only.
    const retryPrompt = buildStalenessRetryPrompt(prompt, first.parseErrorMessage ?? "unknown parse error");
    const second = await this._attemptStalenessParse(retryPrompt, bundle);
    if (!second.providerResult.ok) {
      emitStalenessEvent(second.providerResult);
      return second.providerResult;
    }
    if (second.parsed !== undefined) {
      const finalized = this._finalizeStalenessJudgment(second.parsed, bundle);
      emitStalenessEvent(second.providerResult, finalized.decision, finalized.confidence);
      return ok(finalized);
    }

    // Both attempts malformed → AI_PROVIDER_ERROR with a raw-output prefix. No judgment
    // is returned — the caller only calls JudgmentService.record after an ok() return.
    const rawPrefix = (second.rawContent ?? "").slice(0, 500);
    const doubleFailure = err({
      code: "AI_PROVIDER_ERROR" as const,
      provider: this.active,
      message:
        `AI staleness probe response could not be parsed as valid verdict JSON after one ` +
        `corrective retry: ${second.parseErrorMessage ?? "unknown error"}. Raw output prefix: ${rawPrefix}`,
    });
    emitStalenessEvent(doubleFailure);
    return doubleFailure;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Invoke the active provider and measure wall-clock latency.
   * Provider existence is guaranteed by buildProviderRegistry at construction time.
   *
   * @param input - Validated GenerateInput (doc_type + title are required by schema)
   * @returns { result, duration_ms } — result from provider; duration is total wall-clock ms
   */
  private async _invokeProvider(input: GenerateInput): Promise<{
    result: Result<GenerateOutput, LoreError>;
    duration_ms: number;
  }> {
    // reason: provider existence guaranteed by buildProviderRegistry validation at createApp time;
    // non-null assertion is safe here (AC-AI-14 — service constructed only after registry ok).
    const provider = this.providers.get(this.active)!;
    const t0 = performance.now();
    const result = await provider.generate(input);
    return { result, duration_ms: Math.round(performance.now() - t0) };
  }

  /**
   * Resolve `generate()`'s `ai_provenance` tuple (SPEC-103 I1, task-t3-hardening-reachable-
   * override-escape-real-ai-provenance) — HONESTLY: `model` is the active provider's REAL
   * resolved model id ({@link ModelAwareProvider}), never a copy of `provider` (the registry
   * name). No silent fallback: when the active provider does not expose `modelId` (true of
   * every CURRENT provider — `ClaudeCliProvider` spawns an uninspectable CLI binary,
   * `HttpAIProvider`/`InMemoryAIProvider` have not been wired to expose one within this task's
   * anchor scope), this returns `undefined` — `ai_provenance` is OMITTED from `GenerateOutput`
   * entirely rather than stamped with a value that "looks like data" but isn't (the exact
   * honesty gap this method exists to close). An omitted `ai_provenance` is an ALREADY
   * spec-blessed state (SPEC-103 §Mechanisms M2 I1: "a provenance-less doc passes on
   * judgment-required alone" — the collision check is simply N/A, not a new failure mode).
   *
   * @returns A real `{provider, model, prompt_version}` tuple when the active provider exposes
   *   `modelId`; `undefined` otherwise (never a fabricated value)
   */
  private _resolveAiProvenance(): { provider: string; model: string; prompt_version: string } | undefined {
    const provider = this.providers.get(this.active) as (AIProvider & Partial<ModelAwareProvider>) | undefined;
    const modelId = provider?.modelId;
    if (modelId === undefined || modelId.trim() === "") {
      return undefined;
    }
    return { provider: this.active, model: modelId, prompt_version: GENERATE_PROMPT_VERSION };
  }

  /**
   * One round of the assess judge protocol: invoke the provider with `prompt`, then try to
   * extract + validate assessment JSON from its response. This is the SIBLING retry helper
   * required by SPEC-026 §3 D2 — `_invokeProvider` itself is untouched; `assessPlan` calls
   * this once per attempt (initial + one corrective retry) and inspects the result to decide
   * whether to retry, finalize, or fail.
   *
   * @param prompt - Fully-assembled judge prompt (initial or corrective-retry variant)
   * @param bundle - Plan bundle, used only for the GenerateInput title (telemetry/doc_type shape)
   * @returns providerResult (the raw provider call outcome); when providerResult.ok, exactly
   *   one of `parsed` (validated LlmAssessmentOutput) or `parseErrorMessage` (+ `rawContent`)
   *   is set — never both. `clippedAcIds` is set alongside `parsed` (SPEC-029 AC-AR-2) — empty
   *   when nothing needed clipping.
   */
  private async _attemptJudgeParse(
    prompt: string,
    bundle: PlanBundle,
  ): Promise<{
    providerResult: Result<GenerateOutput, LoreError>;
    parsed?: LlmAssessmentOutput;
    clippedAcIds?: string[];
    parseErrorMessage?: string;
    rawContent?: string;
  }> {
    const { result: providerResult } = await this._invokeProvider({
      prompt,
      doc_type: "knowledge",
      title: bundle.plan.title,
    });

    if (!providerResult.ok) {
      return { providerResult };
    }

    const rawContent = providerResult.value.content;
    const extracted = extractAssessmentJson(rawContent);
    if (!extracted.ok) {
      const message = "message" in extracted.error ? extracted.error.message : extracted.error.code;
      return { providerResult, rawContent, parseErrorMessage: message };
    }

    // reason: clip overlong ac_scores[].reasoning BEFORE Zod validation (SPEC-029 AC-AR-2) —
    // a judgment that is semantically valid but merely verbose must never fail the whole
    // assess run (and burn the one corrective retry) on acScoreSchema's `.max(300)`.
    const { value: clippedJson, clippedAcIds } = clipOverlongReasoning(extracted.value);

    const validated = llmAssessmentOutputSchema.safeParse(clippedJson);
    if (!validated.success) {
      const message = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      return { providerResult, rawContent, parseErrorMessage: message };
    }

    return { providerResult, rawContent, parsed: validated.data, clippedAcIds };
  }

  /**
   * Builds the `source_versions` pins (SPEC-040 §T2 D2) — `{doc_id, version}` for the
   * plan, its spec (when linked), and every task, recorded at assess time so a later
   * reader can tell exactly which doc version the judge saw even after the docs change.
   */
  private _buildSourceVersions(bundle: PlanBundle): SourceVersionRef[] {
    return [
      { doc_id: bundle.plan.id, version: bundle.plan.version },
      ...(bundle.spec !== undefined ? [{ doc_id: bundle.spec.id, version: bundle.spec.version }] : []),
      ...bundle.tasks.map((task) => ({ doc_id: task.id, version: task.version })),
    ];
  }

  /**
   * Assemble the final persisted AssessmentResult from a validated judge output — layers
   * the service-computed `scope` and `judgment` fields on top of what the model produced
   * (the model is never asked to, and never does, produce those two fields itself).
   *
   * SPEC-040 §T2 additions:
   *   - `facts`/`source_versions` are persisted VERBATIM from what was computed/built once
   *     in `assessPlan`, BEFORE this method ever sees the judge's output — the judge
   *     cannot overwrite them (D1, D2).
   *   - `gaps`/`recommendations` are overwritten with `deriveLegacyFindings`'s projection
   *     ONLY when the judge emitted the corresponding typed array (`typed_gaps`/
   *     `typed_recommendations`) — a v6 response carrying ONLY the legacy string arrays
   *     (no typed findings at all) persists those as-is, unmodified (D3).
   *   - `rubric_warning` accumulates the judge's own (optional) warnings plus this
   *     method's D4 grounding cross-check (`computeGroundingWarnings`) — never fatal.
   *
   * SPEC-067 §T2/D4 additions:
   *   - The existing `rubric_warning` text (D4, above) stays as the human-readable trace of
   *     the ungrounded-dimension computation `computeGroundingWarnings` performs.
   *
   * spec-judgment-surfaces-must-verify-before-they-certify-machine D2/D3 additions:
   *   - AFTER grounding suppression (below) produces the surviving `typedGaps`,
   *     {@link verifyFindingPaths} machine-checks every declared `paths[]` entry against the
   *     ASSESSED commit resolved from `diffSource` — a finding with an absent path moves to
   *     `unverifiable_findings[]` (excluded from the scored `typed_gaps`/legacy `gaps[]`
   *     both); `overall_score` is NEVER recomputed from the surviving count. This can fail
   *     this whole method LOUD (an unresolvable assessed commit) — see this method's own
   *     `@returns` doc.
   *
   * spec-lore-assess-project-evidence-rows-instead-of-embedding-the D3/D4 additions
   * (SUPERSEDES SPEC-067 D3's confidence-downgrade-only mechanism, removed):
   *   - `dimension_scores` is passed through `suppressUngroundedAbsenceFindings` — every
   *     ungrounded absence-based entry (the SAME `findUngroundedAbsenceDimensions`
   *     computation, D4) is REMOVED from the persisted findings rather than merely
   *     downgraded, and a corresponding `unverifiable[]` entry naming the dimension is
   *     appended in its place (D3) — the assessment still records that the material could
   *     not be judged, it just no longer asserts a defect about it.
   *   - task-t6: the SAME call ALSO filters `typed_gaps[]` down to the suppressed
   *     dimension set, and `gaps[]` is derived from that FILTERED array (not the raw
   *     `parsed.typed_gaps`) — otherwise the legacy projection would still publish a
   *     finding whose `typed_gaps`/`dimension_scores` siblings were just suppressed
   *     (measured 2026-08-01: the bug this task exists to close). `typed_recommendations`
   *     is deliberately left untouched — see the `// reason:` comment below.
   *   - `judgment.overall_confidence`/`degraded_by_truncation` are set when
   *     `computeTaskTruncationRatio(truncated, bundle.tasks.length)` exceeds
   *     `TRUNCATION_DOWNGRADE_THRESHOLDS.confidenceCapRatio` (D4).
   *   - At `TRUNCATION_DOWNGRADE_THRESHOLDS.inconclusiveRatio` (100% of tasks truncated),
   *     `verdict` is forced to `"inconclusive"` and `overall_score` is OMITTED entirely —
   *     the judge's own `verdict`/`overall_score` are discarded in that case (D4).
   *
   * @param parsed - Validated judge output (verdict/overall_score/ac_scores/gaps/recommendations)
   * @param bundle - Plan bundle — bundle.plan.id becomes scope.id
   * @param durationMs - Total wall-clock ms for the whole assessPlan call (both attempts)
   * @param retried - Whether the corrective retry was needed
   * @param truncated - Section names truncated while building the prompt (AC-ASSESS-7)
   * @param clippedAcIds - AC ids whose reasoning was clipped before validation (SPEC-029
   *   AC-AR-2); empty when nothing needed clipping — `judgment.reasoning_clipped` is only
   *   set (additive-only field, AC-AR-3) when this is non-empty
   * @param facts - Pre-computed AssessmentFacts (SPEC-040 D1) — persisted unchanged
   * @param sourceVersions - Pre-built source-version pins (SPEC-040 D2) — persisted unchanged
   * @param scopeWarning - Pre-computed diff-range scope-mismatch advisory (hotfix
   *   task-assess-diff-range-scope-mismatch-warning) — persisted unchanged when present;
   *   `undefined` omits the field entirely (additive-only, mirrors `facts`/`source_versions`)
   * @param commitDerivationUnverifiable - task-lore-assess-derives-a-plan-s-commits-by-
   *   grepping-task AC #3 — forces `scope_fidelity` out of the persisted `dimension_scores`
   *   (see `forceScopeFidelityUnverifiable`) regardless of the judge's own output, when
   *   the caller's commit-set derivation reported `"unverifiable_convention_mismatch"`.
   * @param reproducible - task-getassesstemplatereproducibility-has-zero-production-callers
   *   — the caller's ALREADY-RESOLVED `getAssessTemplateReproducibility(ASSESS_PROMPT_VERSION)`
   *   value (same `ASSESS_PROMPT_VERSION` binding stamped as `judgment.prompt_version` below —
   *   read once by the caller, never re-derived here). Stamped into `judgment.reproducible`
   *   UNCONDITIONALLY (never spread-conditional like `reasoning_clipped`/`degraded_by_truncation`
   *   above): `false` is an explicit, meaningful three-state value (SPEC per `judgmentSchema`'s
   *   own JSDoc in `packages/core/src/assessment.ts`) that must always render, not a falsy
   *   default that collapses into the LEGAL "absent = not recorded" state reserved for
   *   assessments persisted before this field existed.
   * @param diffSource - D2/D3 (spec-judgment-surfaces-must-verify-before-they-certify-machine)
   *   — the run's diff-source provenance, passed straight through to {@link verifyFindingPaths}.
   * @param repoRoot - Directory `git cat-file -e` runs in, resolved ONCE by the caller
   *   (`assessPlan`) and passed unchanged into {@link verifyFindingPaths}.
   * @returns `Result<AssessmentResult, LoreError>` — was a bare `AssessmentResult` before D2/D3
   *   added a THIRD way finalization can fail (an unresolvable assessed commit, alongside the
   *   pre-existing provider-failure and containment-failure outcomes `assessPlan` already
   *   handled before ever calling this method).
   */
  private _finalizeAssessment(
    parsed: LlmAssessmentOutput,
    bundle: PlanBundle,
    durationMs: number,
    retried: boolean,
    truncated: string[],
    clippedAcIds: string[],
    facts: AssessmentFacts,
    sourceVersions: SourceVersionRef[],
    scopeWarning: ScopeMismatchWarning | undefined,
    commitDerivationUnverifiable: boolean,
    reproducible: boolean,
    diffSource: AssessDiffSource | undefined,
    repoRoot: string,
    omittedDiffFiles: readonly string[],
  ): Result<AssessmentResult, LoreError> {
    // reason: SPEC-040 D4 — grounding cross-check runs on the validated-but-not-yet-final
    // output; warnings are advisory-only and never fail the run.
    const groundingWarnings = computeGroundingWarnings(parsed, truncated);
    const rubricWarning = [...(parsed.rubric_warning ?? []), ...groundingWarnings];

    // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — runs
    // BEFORE the grounding-based suppression below, not after: when the caller already
    // knows this plan's commit derivation is unverifiable, `scope_fidelity` is forced out
    // REGARDLESS of the judge's `based_on`/citations, with a dedicated "not scored"
    // unverifiable[] entry (see `forceScopeFidelityUnverifiable`'s own JSDoc for the full
    // ADR three-question review). Ordering matters: running this FIRST guarantees the
    // AC #3 "not scored" wording is what a reader sees for scope_fidelity in this state,
    // never T6's differently-worded "ungrounded" message (which would otherwise win the
    // race when the judge ALSO happened to leave the score ungrounded by its own
    // citations). A no-op (same references) when `commitDerivationUnverifiable` is false.
    const forced = forceScopeFidelityUnverifiable(
      commitDerivationUnverifiable,
      parsed.dimension_scores,
      parsed.unverifiable,
      parsed.typed_gaps,
    );

    // reason: spec-lore-assess-project-evidence-rows-instead-of-embedding-the D3/D4 —
    // suppress (not merely warn about) every ungrounded absence-based dimension_scores
    // entry, AND (task-t6) every typed_gaps[] entry keyed to that same dimension, over the
    // SAME ungrounded-dimension set groundingWarnings above already identified
    // (findUngroundedAbsenceDimensions is the shared computation both call). Returns
    // parsed.dimension_scores/unverifiable/typed_gaps UNCHANGED (same references) when
    // nothing is ungrounded — mirrors the AC-067-6 healthy-path identity precedent. Runs
    // on `forced`'s OUTPUT (not `parsed` directly) — when the floor above already removed
    // `scope_fidelity`, this pass simply finds nothing left to do for that dimension
    // (no double-processing, no duplicate unverifiable[] entry).
    const { dimensionScores, unverifiable, typedGaps } = suppressUngroundedAbsenceFindings(
      forced.dimensionScores,
      forced.unverifiable,
      truncated,
      forced.typedGaps,
    );

    // reason: D2/D3 (spec-judgment-surfaces-must-verify-before-they-certify-machine) — runs
    // on the ALREADY-SUPPRESSED `typedGaps` (grounding suppression above is an orthogonal
    // concern; a finding removed for being ungrounded is simply gone before this pass ever
    // sees it, so there is no double-processing). A finding surviving THIS pass declaring an
    // absent path is withdrawn to `unverifiableFindings[]`; the scored `typedGaps` set below
    // is the SURVIVOR of both passes. An unresolvable assessed commit fails this whole method
    // LOUD (see `verifyFindingPaths`'s own JSDoc) — propagated as this call's own `err`,
    // exactly like `templateResult`/`reproducibleResult` upstream in `assessPlan`.
    // reason: F2 (AC-CRIT-3) — a finding on a file the judge never saw cannot be a judged
    // finding, whether or not the file exists at the commit, so it is withdrawn BEFORE
    // verifyFindingPaths (which would otherwise keep it: the path exists). Needs no git
    // referent, so it also runs when diffSource is absent. Only WHOLLY omitted files count;
    // the head-truncated file was shown in part and stays scored.
    const unshown = withdrawFindingsOnUnshownFiles(typedGaps, omittedDiffFiles);
    const verification = verifyFindingPaths(unshown.typedGaps, diffSource, repoRoot);
    if (!verification.ok) return verification;
    const verifiedTypedGaps = verification.value.typedGaps;
    const unverifiableFindings = [...unshown.withdrawn, ...verification.value.unverifiableFindings];
    // reason: not_shown follows the present-iff-non-zero convention of unverifiable_findings —
    // a run that withdrew nothing for visibility keeps the exact pre-F2 paths_verified shape.
    const pathsVerified = {
      ...verification.value.pathsVerified,
      ...(unshown.withdrawn.length > 0 ? { not_shown: unshown.withdrawn.length } : {}),
    };

    // reason: SPEC-040 D3 — only substitute the legacy string arrays when the judge
    // actually emitted the corresponding typed array; a typed_gaps-less response leaves
    // parsed.gaps untouched (independently keyed per array, not an all-or-nothing swap).
    // task-t6: `gaps` is derived from the SUPPRESSED `typedGaps` (not the raw
    // `parsed.typed_gaps`) — otherwise the legacy projection would still publish a gap
    // whose typed_gaps sibling was just removed, reintroducing the exact "still
    // publishes, twice" bug this task exists to close. The PRESENCE check stays on the
    // raw `parsed.typed_gaps` — D3's original rule ("did the judge emit the array at
    // all") is unaffected by suppression; only the projected VALUE changes. D2/D3: the
    // legacy projection is built from `verifiedTypedGaps` (post path-verification), not the
    // pre-verification `typedGaps` — a withdrawn finding must not still publish into the
    // legacy `gaps[]` array either, or D3's "excluded from the scored set" would be false for
    // that array specifically even though `typed_gaps`/`unverifiable_findings` agree.
    const legacy = deriveLegacyFindings(verifiedTypedGaps, parsed.typed_recommendations);
    const gaps = parsed.typed_gaps !== undefined ? legacy.gaps : parsed.gaps;
    // reason: task-t6 — typed_recommendations carries NO field linking a recommendation to
    // a specific gap/dimension (typedRecommendationSchema is only target/action/rationale
    // — see assessment.ts). Inferring "this recommendation's ONLY support was the
    // suppressed gap" would require inventing an unstated heuristic (e.g. textual
    // similarity against `rationale`), which is exactly the second,
    // independently-drifting matcher D4 forbids for the dimension join above. Decision:
    // leave typed_recommendations (and therefore its legacy `recommendations[]`
    // projection) COMPLETELY untouched by suppression, always — not an oversight.
    const recommendations =
      parsed.typed_recommendations !== undefined ? legacy.recommendations : parsed.recommendations;

    // reason: SPEC-067 D4 — task-truncation coverage caps overall confidence, and at 100%
    // refuses a numeric overall_score / forces verdict to "inconclusive". Computed from the
    // SAME `truncated` list judgment.truncated persists (task-prefixed entries only, see
    // computeTaskTruncationRatio's JSDoc), against the plan's full task count (not just the
    // truncated subset).
    const taskTruncationRatio = computeTaskTruncationRatio(truncated, bundle.tasks.length);
    const degradedByTruncation = taskTruncationRatio > TRUNCATION_DOWNGRADE_THRESHOLDS.confidenceCapRatio;
    const fullyTruncated = taskTruncationRatio >= TRUNCATION_DOWNGRADE_THRESHOLDS.inconclusiveRatio;

    // reason: destructure OUT verdict/overall_score/dimension_scores/unverifiable/
    // typed_gaps so the object below can OMIT overall_score entirely at 100% truncation (a
    // `key: undefined` spread would leave an own-property, which JSON.stringify drops but
    // Zod's optional() still treats as present-with-undefined under
    // exactOptionalPropertyTypes) and override the other four with the
    // suppression-augmented values computed above — every other field on `parsed`
    // (ac_scores, typed_recommendations, rubric_warning) passes through via ...restParsed
    // exactly as `...parsed` did before.
    const {
      verdict: judgeVerdict,
      overall_score: judgeOverallScore,
      dimension_scores: _unusedRawDimensionScores,
      unverifiable: _unusedRawUnverifiable,
      typed_gaps: _unusedRawTypedGaps,
      ...restParsed
    } = parsed;
    void _unusedRawDimensionScores; // reason: destructured only to exclude it from restParsed; suppressed value re-added below.
    void _unusedRawUnverifiable; // reason: destructured only to exclude it from restParsed; suppressed value re-added below.
    void _unusedRawTypedGaps; // reason: destructured only to exclude it from restParsed; suppressed value re-added below.

    return ok({
      ...restParsed,
      // reason: D2/D3 — `overall_score`/`verdict` come straight from `judgeOverallScore`/
      // `judgeVerdict` (destructured verbatim from `parsed`, the RAW judge output) —
      // path-withdrawal NEVER touches either. `overall_score` stays byte-identical to what
      // the judge emitted even when `unverifiableFindings` is non-empty (see
      // `unverifiableFindingSchema`'s own JSDoc for why re-deriving it would be inventing
      // arithmetic this corpus has never used).
      verdict: fullyTruncated ? "inconclusive" : judgeVerdict,
      ...(fullyTruncated ? {} : { overall_score: judgeOverallScore }),
      ...(dimensionScores !== undefined ? { dimension_scores: dimensionScores } : {}),
      ...(unverifiable !== undefined ? { unverifiable } : {}),
      ...(verifiedTypedGaps !== undefined ? { typed_gaps: verifiedTypedGaps } : {}),
      gaps,
      recommendations,
      ...(rubricWarning.length > 0 ? { rubric_warning: rubricWarning } : {}),
      scope: { type: "plan", id: bundle.plan.id },
      judgment: {
        provider: this.active,
        prompt_version: ASSESS_PROMPT_VERSION,
        duration_ms: durationMs,
        retried,
        truncated,
        ...(clippedAcIds.length > 0 ? { reasoning_clipped: clippedAcIds } : {}),
        ...(degradedByTruncation ? { overall_confidence: "low" as const, degraded_by_truncation: true as const } : {}),
        // reason: task-getassesstemplatereproducibility-has-zero-production-callers —
        // UNCONDITIONAL stamp (unlike the two spreads above): `reproducible` is a genuine
        // three-state field (true / false / absent-means-"not recorded", see judgmentSchema's
        // JSDoc) and `false` must render exactly as visibly as `true`. A conditional spread
        // keyed on truthiness would silently drop every `false` back into the "absent" bucket
        // reserved for pre-existing legacy records — precisely the conflation this task exists
        // to close.
        reproducible,
      },
      facts,
      source_versions: sourceVersions,
      ...(scopeWarning !== undefined ? { scope_warning: scopeWarning } : {}),
      // reason: D3 — `unverifiable_findings` follows the SAME present-iff-non-empty
      // convention as `rubric_warning` above (never an empty array; the field is simply
      // omitted when nothing was withdrawn). `paths_verified` is UNCONDITIONAL — even
      // {checked:0, unverifiable:0, unchecked:0} is meaningful information ("this pass ran
      // and found nothing to verify"), unlike an omitted key which (pre-D2/D3 historical
      // assessments) means "this mechanism did not exist yet".
      ...(unverifiableFindings.length > 0 ? { unverifiable_findings: unverifiableFindings } : {}),
      paths_verified: pathsVerified,
    });
  }

  /**
   * One round of the review judge protocol: invoke the provider with `prompt`, then try to
   * extract + validate review JSON from its response. Sibling of `_attemptJudgeParse` for
   * the SPEC-034 judgeDoc protocol — same shape, different schema (llmReviewOutputSchema
   * instead of llmAssessmentOutputSchema), no reasoning-length clipping (reviewReasonSchema
   * has no length cap, unlike acScoreSchema's `.max(300)`).
   *
   * @param prompt - Fully-assembled judge prompt (initial or corrective-retry variant)
   * @param bundle - Review bundle, used only for the GenerateInput doc_type/title
   * @returns providerResult (the raw provider call outcome); when providerResult.ok, exactly
   *   one of `parsed` (validated LlmReviewOutput) or `parseErrorMessage` (+ `rawContent`)
   *   is set — never both.
   */
  private async _attemptJudgeDocParse(
    prompt: string,
    bundle: ReviewBundle,
  ): Promise<{
    providerResult: Result<GenerateOutput, LoreError>;
    parsed?: LlmReviewOutput;
    parseErrorMessage?: string;
    rawContent?: string;
  }> {
    const { result: providerResult } = await this._invokeProvider({
      prompt,
      doc_type: bundle.doc.type,
      title: bundle.doc.title,
    });

    if (!providerResult.ok) {
      return { providerResult };
    }

    const rawContent = providerResult.value.content;
    const extracted = extractAssessmentJson(rawContent);
    if (!extracted.ok) {
      const message = "message" in extracted.error ? extracted.error.message : extracted.error.code;
      return { providerResult, rawContent, parseErrorMessage: message };
    }

    const validated = llmReviewOutputSchema.safeParse(extracted.value);
    if (!validated.success) {
      const message = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      return { providerResult, rawContent, parseErrorMessage: message };
    }

    return { providerResult, rawContent, parsed: validated.data };
  }

  /**
   * Assemble the final NewReviewJudgment from a validated judge output — layers the
   * service-computed `judge` identity on top of what the model produced (the model is
   * never asked to, and never does, produce its own identity), and OVERWRITES whatever
   * `checks` the model may have echoed back with the deterministic `checks` this call was
   * invoked with (SPEC-034 §4 — mechanical pre-checks are authoritative, never model-derived).
   *
   * @param parsed - Validated judge output (decision/confidence/reasons/blocking_questions)
   * @param bundle - Review bundle — bundle.doc.id/version become doc_id/doc_version
   * @param checks - Deterministic pre-check results, passed in by the caller of judgeDoc
   * @param docTruncated - SPEC-040 D8: whether the document body was truncated for the
   *   prompt budget (`BuildReviewPromptResult.docTruncated`) — set additive-only (only
   *   `truncated: true` when true; omitted, never `false`, otherwise), mirroring
   *   `judgment.reasoning_clipped`'s additive-only convention in assessment.ts
   * @param cuts - F1: every cut prompt section with real shown/total chars
   *   (`BuildReviewPromptResult.cuts`) — stored as `truncation`; key omitted when empty
   */
  private _finalizeJudgment(
    parsed: LlmReviewOutput,
    bundle: ReviewBundle,
    checks: CheckResult[],
    docTruncated: boolean,
    cuts: readonly ReviewTruncationEntry[],
  ): NewReviewJudgment {
    return {
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: parsed.decision,
      confidence: parsed.confidence,
      reasons: parsed.reasons,
      checks,
      blocking_questions: parsed.blocking_questions,
      // reason: explicit (not relying on reviewJudgmentSchema's optional-defaults-to-
      // "review" behavior, SPEC-044 D3) — production code states its intent plainly.
      kind: "review",
      ...(docTruncated ? { truncated: true } : {}),
      ...(cuts.length > 0 ? { truncation: [...cuts] } : {}),
      // reason: SPEC-044 D11 byproduct — a review judge MAY emit this nomination
      // alongside its normal verdict; passed through verbatim, never re-derived here.
      ...(parsed.superseded_candidate !== undefined ? { superseded_candidate: parsed.superseded_candidate } : {}),
      // reason: SPEC-053 — the v2 judge MAY emit non-blocking AC-quantifiability advisory
      // findings; passed through verbatim (never re-derived, never allowed to alter the
      // decision here — the prompt already forbids the judge from rejecting on them).
      ...(parsed.advisory !== undefined ? { advisory: parsed.advisory } : {}),
      judge: {
        provider: this.active,
        // reason: the AIProvider interface (packages/core/src/ai.ts) exposes no resolved
        // model id — ClaudeCliProvider spawns a CLI binary whose active model is not
        // introspectable from this layer, and HttpAIProvider's model lives in per-provider
        // config this service doesn't currently thread through. Until a provider-level
        // model accessor exists, judge.model mirrors judge.provider — both satisfy
        // judgeIdentitySchema's `.min(1)`, and this keeps the field honest (a real,
        // non-empty identifier) rather than fabricating an unverified model string.
        model: this.active,
        prompt_version: REVIEW_PROMPT_VERSION,
      },
    };
  }

  /**
   * One round of the staleness-probe judge protocol: invoke the provider with `prompt`,
   * then try to extract + validate staleness-verdict JSON from its response. Sibling of
   * `_attemptJudgeDocParse` for the SPEC-044 `probeStaleness` protocol — same shape,
   * different schema (`stalenessVerdictSchema` instead of `llmReviewOutputSchema`).
   *
   * @param prompt - Fully-assembled judge prompt (initial or corrective-retry variant)
   * @param bundle - Staleness bundle, used only for the GenerateInput doc_type/title
   * @returns providerResult (the raw provider call outcome); when providerResult.ok, exactly
   *   one of `parsed` (validated StalenessVerdict) or `parseErrorMessage` (+ `rawContent`)
   *   is set — never both. `outOfEnumDecision` is a SEPARATE, additive signal (D5) —
   *   true iff the response was syntactically valid JSON carrying a `decision` string
   *   that is NOT `"holds"`/`"stale_candidate"`; `probeStaleness` checks this flag on the
   *   FIRST attempt to short-circuit straight to a hard failure, skipping the corrective
   *   retry entirely (a nonsense-but-well-formed decision won't be fixed by a "your JSON
   *   was malformed" retry prompt).
   */
  private async _attemptStalenessParse(
    prompt: string,
    bundle: StalenessBundle,
  ): Promise<{
    providerResult: Result<GenerateOutput, LoreError>;
    parsed?: StalenessVerdict;
    parseErrorMessage?: string;
    rawContent?: string;
    outOfEnumDecision?: boolean;
  }> {
    const { result: providerResult } = await this._invokeProvider({
      prompt,
      doc_type: bundle.doc.type,
      title: bundle.doc.title,
    });

    if (!providerResult.ok) {
      return { providerResult };
    }

    const rawContent = providerResult.value.content;
    const extracted = extractAssessmentJson(rawContent);
    if (!extracted.ok) {
      const message = "message" in extracted.error ? extracted.error.message : extracted.error.code;
      return { providerResult, rawContent, parseErrorMessage: message };
    }

    // reason: D5 — detect an out-of-enum `decision` BEFORE full schema validation, so
    // the caller can distinguish "syntactically valid JSON, nonsense decision value"
    // (hard error, no retry) from every other schema violation (missing/malformed
    // fields — genuine "malformed", gets the one corrective retry).
    const rawDecision =
      typeof extracted.value === "object" && extracted.value !== null && !Array.isArray(extracted.value)
        ? (extracted.value as Record<string, unknown>)["decision"]
        : undefined;
    const outOfEnumDecision =
      typeof rawDecision === "string" && !STALENESS_VERDICT_DECISIONS.includes(rawDecision as never);

    const validated = stalenessVerdictSchema.safeParse(extracted.value);
    if (!validated.success) {
      const message = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      return { providerResult, rawContent, parseErrorMessage: message, ...(outOfEnumDecision ? { outOfEnumDecision: true } : {}) };
    }

    return { providerResult, rawContent, parsed: validated.data };
  }

  /**
   * Assemble the final NewReviewJudgment from a validated staleness verdict — maps the
   * verdict's `decision` ("holds"/"stale_candidate") onto the shared `ReviewDecision`
   * enum ("approve"/"escalate", D3) via `mapStalenessVerdictDecisionToJudgmentDecision`,
   * stamps `kind: "staleness"`, and sets `checks: []` (D9 — deterministic pre-checks do
   * NOT run for staleness, a different pipeline, stated explicitly).
   *
   * @param parsed - Validated staleness verdict
   * @param bundle - Staleness bundle — `bundle.doc.id`/`bundle.doc.version` become
   *   `doc_id`/`doc_version` (the version read at BUNDLE-ASSEMBLY time, T8)
   */
  private _finalizeStalenessJudgment(parsed: StalenessVerdict, bundle: StalenessBundle): NewReviewJudgment {
    return {
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: mapStalenessVerdictDecisionToJudgmentDecision(parsed.decision),
      confidence: parsed.confidence,
      reasons: parsed.reasons.map((reason) => ({ dimension: "staleness", finding: reason })),
      checks: [],
      blocking_questions: parsed.blocking_questions,
      kind: "staleness",
      ...(parsed.superseded_candidate !== undefined ? { superseded_candidate: parsed.superseded_candidate } : {}),
      judge: {
        provider: this.active,
        // reason: same "no provider-level model accessor exists yet" honesty precedent
        // as `_finalizeJudgment` — see its own comment above.
        model: this.active,
        prompt_version: STALENESS_PROMPT_VERSION,
      },
    };
  }

  /**
   * Emit an ai.generation telemetry event on both success and failure paths.
   * No-op when aiTelemetryEnabled is false (AC-AI-21).
   *
   * @param result - Provider result (ok or err)
   * @param duration_ms - Wall-clock milliseconds for the full round-trip
   * @param meta - Event metadata: doc_type, template_source, kind, target_doc_id, surfaces,
   *   and (kind="review" only) decision/confidence
   */
  private _emitAiEvent(
    result: Result<GenerateOutput, LoreError>,
    duration_ms: number,
    meta: {
      doc_type: DocType;
      template_source: "built-in" | "user-override";
      kind: "create" | "regenerate" | "refine" | "infer" | "assess" | "review" | "staleness";
      target_doc_id?: string | null | undefined;
      // reason: exactOptionalPropertyTypes=true requires explicit `| undefined` when callers pass
      // `opts?.field` (type `T | undefined`). Without it, TS rejects `prop: T | undefined`
      // assigned to `prop?: T` because the source always has the property present.
      caller_surface?: CallerSurface | undefined;
      ai_default_source?: AiDefaultSource | undefined;
      /** SPEC-034: the judge's decision, kind="review" only, present iff a judgment was reached. */
      decision?: NewReviewJudgment["decision"] | undefined;
      /** SPEC-034: the judge's confidence, kind="review" only, present iff a judgment was reached. */
      confidence?: number | undefined;
    },
  ): void {
    if (!this.aiTelemetryEnabled) return;

    this.telemetry.emit({
      event: "ai.generation",
      ts: new Date().toISOString(),
      provider: this.active,
      doc_type: meta.doc_type,
      template_source: meta.template_source,
      kind: meta.kind,
      duration_ms,
      output_chars: result.ok ? result.value.content.length : 0,
      exit_code: result.ok
        ? 0
        : result.error.code === "AI_PROVIDER_ERROR"
          ? (result.error.exit_code ?? -1)
          : -1,
      ...(meta.decision !== undefined ? { decision: meta.decision } : {}),
      ...(meta.confidence !== undefined ? { confidence: meta.confidence } : {}),
      // reason: LoreError is a discriminated union — not all variants have a `message` field.
      // Only AI_PROVIDER_ERROR, STORE_ERROR, and VALIDATION_ERROR do. Use presence check to
      // extract a display string that works for any error code.
      ...(result.ok
        ? {}
        : {
            error:
              "message" in result.error
                ? result.error.message
                : result.error.code,
          }),
      ...(meta.target_doc_id !== undefined ? { target_doc_id: meta.target_doc_id } : {}),
      // SPEC-024 AC-NOAI-8: optional surface + source for AI default traceability
      ...(meta.caller_surface !== undefined ? { caller_surface: meta.caller_surface } : {}),
      ...(meta.ai_default_source !== undefined ? { ai_default_source: meta.ai_default_source } : {}),
      // SPEC-020 AC-HTTP-TEL-1: populate usage when the provider returns token counts.
      // HttpAIProvider always populates usage on success; ClaudeCliProvider never does.
      // reason: usage is omitted from the spread when absent (not set to undefined) to
      // keep the strict aiGenerationEventSchema happy — undefined optional fields are
      // valid in Zod, but omitting them produces cleaner JSONL output for downstream consumers.
      ...(result.ok && result.value.usage !== undefined
        ? { usage: result.value.usage }
        : {}),
    });
  }
}
