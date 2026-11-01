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
 *   - judgeDoc stamps `truncated: true` on the returned judgment when the review template reports
 *     `docTruncated` (SPEC-040 D8) — additive-only field, mirrors the `checks` override precedent
 *     (service-computed, model output never consulted for it). The active template (v6, BR-268 D9) never cuts the
 *     document under review, so a v6 judgment is never marked; the frozen v1-v5 still do. The approval gate refuses
 *     a stored `truncated` approve of ANY version (BR-269)
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
 *     resolves `repoRoot` (`opts.repoRoot`, required) ONCE and passes it, plus
 *     `opts.diffSource` verbatim, into `_finalizeAssessment`, which runs `verifyFindingPaths`
 *     on the (grounding-)suppressed `typedGaps` — withdrawing any finding with an absent
 *     declared path into `unverifiable_findings[]`, tallying `paths_verified`, and NEVER
 *     recomputing `overall_score`. `opts.diffSource` is supplied by its production caller,
 *     `adapters/cli/commands/assess.ts` (which passes its
 *     resolved `diffSource` local into `assessPlan`; closed by
 *     task-thread-diff-source-through-the-cli-and-mcp-assess-adapters), so a live
 *     `lore assess` run verifies declared paths against the assessed commit.
 *     A caller that omits it still gets `paths_verified.unchecked`, never a silent pass.
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

import { err, ok } from "@lore/core";
import type { AIProvider, DocRecord, DocType, GenerateInput, GenerateOutput, LinkType, LoreError, Telemetry } from "@lore/core";
import type { AiDefaultSource, CallerSurface, Result } from "@lore/core";
import type { JudgeIdentity } from "./judge-unit-keys.js";
import { extractAssessmentJson, linkTypeSchema } from "@lore/core";
import type { CheckResult, LlmReviewOutput, NewReviewJudgment, ReviewBundle, ReviewTruncationEntry } from "@lore/core";
import { completeDimensionVerdicts, llmReviewOutputSchema } from "@lore/core";
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
  REVIEW_PROMPT_VERSION,
  REVIEW_TEMPLATES,
  TEMPLATED_REVIEW_PROMPT_VERSION,
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
 * The size budgets of the AI judge's input (`config.ai.assess.*`). Only `max_diff_chars` exists: the milestone
 * review's diff cut reads it as `assessMaxDiffChars`. The plan/spec/task budgets belonged to the retired
 * plan-outcome prompt and are removed (`lore migrate config-keys` strips them from config files).
 */
export interface AssessBudgets {
  readonly max_diff_chars: number;
  /** `ai.assess.model`: the model the milestone judge is invoked with (BR-1535); absent = the answering model is unknown. */
  readonly model?: string | undefined;
}

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
  /** True when a call's `model` decides the model that answers (`claude -p --model`, the HTTP request body). */
  readonly acceptsModelOverride?: boolean;
  /** The configured arguments that are the same for every call (the model-behaviour settings of a verdict key). */
  readonly fixedArgs?: readonly string[];
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
     * Character budgets for the review judge prompt. `max_context_chars` bounds the parent context; `max_doc_chars` is
     * read only by the frozen v1-v5 templates (the active v6 never cuts the document under review, BR-268).
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
   * @returns Configured max chars (from config.ai.assess.max_diff_chars; default 80000)
   * Source: SPEC-028 AC-AE-1
   */
  get assessMaxDiffChars(): number {
    return this.assessBudgets.max_diff_chars;
  }

  /**
   * Sends one drafting prompt (`lore convert`) to the active provider and returns its raw text. The prompt, the parse
   * and the validation belong to `ConversionService`; this is only the provider call, through the same registry and
   * hermetic spawn as every other judge.
   *
   * @param prompt - the rendered drafting prompt
   * @param docType - the converted document's type (the provider input's required `doc_type`)
   * @param title - the document's title
   * @returns `ok(text)` or the provider's own `AI_PROVIDER_ERROR`; never throws
   */
  async draftText(prompt: string, docType: GenerateInput["doc_type"], title: string): Promise<Result<string, LoreError>> {
    const { result } = await this._invokeProvider({ prompt, doc_type: docType, title });
    return result.ok ? ok(result.value.content) : result;
  }

  /**
   * Sends one milestone-review prompt (BR-1372) to the active provider and returns its raw text. The prompt, the
   * parse and the retry belong to `MilestoneReviewService`; this is only the provider call, so the review judge runs
   * through the same provider registry and hermetic spawn as every other judge.
   *
   * @param prompt - the rendered review prompt
   * @param title - the plan's title (the provider input's required `title`)
   * @returns `ok(text)` or the provider's own `AI_PROVIDER_ERROR`; never throws
   */
  async judgeMilestone(prompt: string, title: string): Promise<Result<string, LoreError>> {
    const { result } = await this._invokeProvider({ prompt, doc_type: "knowledge", title, ...this._milestoneModel() });
    return result.ok ? ok(result.value.content) : result;
  }

  /**
   * `judgeMilestone` that keeps what the call cost: wall-clock duration and, when the provider reports it, token usage
   * (the CLI provider reports none, so tokens stay absent rather than 0).
   *
   * @param prompt - the rendered review prompt
   * @param title - the plan's title
   * @returns `ok({text, duration_ms, tokens_in?, tokens_out?})` or the provider's own `AI_PROVIDER_ERROR`; never throws
   */
  async judgeMilestoneMeasured(
    prompt: string,
    title: string,
  ): Promise<Result<{ text: string; duration_ms: number; tokens_in?: number; tokens_out?: number; model?: string }, LoreError>> {
    const { result, duration_ms } = await this._invokeProvider({ prompt, doc_type: "knowledge", title, ...this._milestoneModel() });
    if (!result.ok) return result;
    const usage = result.value.usage;
    const model = result.value.model;
    return ok({
      text: result.value.content,
      duration_ms,
      ...(usage !== undefined ? { tokens_in: usage.input_tokens, tokens_out: usage.output_tokens } : {}),
      // reason: BR-1535 S5 — the model is whatever the provider's REPLY named (claude JSON `modelUsage`, HTTP `model`), never the requested name.
      ...(model !== undefined ? { model } : {}),
    });
  }

  /**
   * The explicit model a milestone call is invoked with: `ai.assess.model`, only when the active provider can take one
   * (`claude -p --model`, the HTTP request body). Empty when none is configured or the provider cannot take it, so a custom
   * judge command is never handed a model it did not ask for.
   */
  private _milestoneModel(): { model?: string } {
    const provider = this.providers.get(this.active) as (AIProvider & Partial<ModelAwareProvider>) | undefined;
    const configured = this.assessBudgets.model;
    return configured !== undefined && provider?.acceptsModelOverride === true ? { model: configured } : {};
  }

  /**
   * Which judge answers milestone reviews (BR-1535 S2, S5). `model` is the CONFIGURED `ai.assess.model` (what lookups match; an
   * alias such as `sonnet` finds nothing because verdicts are stored under the model id the reply names). `reportsAnsweringModel`
   * is true for a provider whose reply names its model: the `claude` binary (JSON output, `modelUsage`) and the HTTP provider
   * (`model` field); a custom judge command does not. `settings` are the provider arguments that are the same for every call.
   *
   * @returns the identity; never throws
   */
  judgeIdentity(): JudgeIdentity {
    const provider = this.providers.get(this.active) as (AIProvider & Partial<ModelAwareProvider>) | undefined;
    const reports = provider?.acceptsModelOverride === true;
    const fixed = provider?.fixedArgs ?? [];
    const settings: Record<string, string | number> = fixed.length > 0 ? { args: fixed.join(" ") } : {};
    const configured = this.assessBudgets.model;
    const hint = reports
      ? "set ai.assess.model to the full id of the model the judge should answer with (the judge is then invoked with it explicitly)"
      : `use the claude-cli provider with the claude binary, or the http provider, and set ai.assess.model; provider "${this.active}" does not report the model that answered`;
    return { provider: this.active, model: configured, reportsAnsweringModel: reports, settings, modelHint: hint };
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
    // consistent regardless of which adapter calls refineContent.
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
          rule: "BR-762",
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
    // reason: a templated document (bundle.template) is judged per template dimension with v9; every legacy document keeps
    // the frozen active v8 (BR-268). The choice is made once here and passed to _finalizeJudgment so the stored
    // `judge.prompt_version` always names the prompt that was actually sent.
    const promptVersion = bundle.template !== undefined ? TEMPLATED_REVIEW_PROMPT_VERSION : REVIEW_PROMPT_VERSION;
    const template = REVIEW_TEMPLATES[promptVersion]!;
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
      const finalized = this._finalizeJudgment(first.parsed, bundle, checks, docTruncated, cuts, promptVersion);
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
      const finalized = this._finalizeJudgment(second.parsed, bundle, checks, docTruncated, cuts, promptVersion);
      emitReviewEvent(second.providerResult, finalized.decision, finalized.confidence);
      return ok(finalized);
    }

    // Both attempts malformed → AI_PROVIDER_ERROR with a raw-output prefix.
    // No judgment is returned — the caller (CLI) only calls JudgmentService.record
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
   * `StalenessProbeService`'s batch orchestration, not from the CLI layer directly).
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
        rule: "BR-471",
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
      rule: "BR-471",
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
   *   prompt budget (`BuildReviewPromptResult.docTruncated`; never true under v6) — set additive-only (only
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
    promptVersion: string,
  ): NewReviewJudgment {
    const templated = bundle.template;
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
      // reason: v9 — the service COMPLETES the judge's verdicts against the pinned template (a dimension the judge left out is
      // `unclear`, never `pass`; unknown/repeated ids are dropped) and stamps the template ref itself; the model is never trusted
      // to say which template it judged against.
      ...(templated !== undefined
        ? {
            template_ref: templated.ref,
            dimension_verdicts: completeDimensionVerdicts(templated.template, templated.kind, parsed.dimension_verdicts),
            ...(parsed.missing_dimensions !== undefined && parsed.missing_dimensions.length > 0
              ? { missing_dimensions: parsed.missing_dimensions }
              : {}),
          }
        : {}),
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
        prompt_version: promptVersion,
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
