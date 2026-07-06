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
 *     - assessPlan(bundle, opts?) → Promise<Result<AssessmentResult, LoreError>>  (SPEC-026)
 *     - judgeDoc(bundle, checks, opts?) → Promise<Result<NewReviewJudgment, LoreError>>  (SPEC-034)
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
 *   - judgeDoc gets ONE corrective retry when the judge's JSON is malformed/invalid
 *     (SPEC-034 §4, same protocol as assessPlan/SPEC-026 §3 D2) — a second malformed
 *     response → AI_PROVIDER_ERROR with a ≤500-char raw-output prefix and no judgment is
 *     returned (the caller never calls JudgmentService.record on an err() Result)
 *   - judgeDoc ALWAYS overwrites the model's own (optional) `checks` field with the
 *     deterministic `checks` argument it was called with — the mechanical pre-checks
 *     (computed BEFORE the LLM call, SPEC-034 §4 flow step 2) are the authoritative
 *     record; the model is never trusted to self-report which checks passed
 *
 * Side-effect class: IO (delegates to AIProvider.generate and Telemetry.emit)
 *
 * Source: SPEC-017 §3.6, SPEC-019 §9.1, SPEC-026 §3 D1, D2; SPEC-029 AC-AR-2, AC-AR-3; SPEC-034 §4
 */

import { err, ok } from "@lore/core";
import type { AIProvider, DocRecord, DocType, GenerateInput, GenerateOutput, LinkType, LoreError, Telemetry } from "@lore/core";
import type { AiDefaultSource, CallerSurface, Result } from "@lore/core";
import { linkTypeSchema } from "@lore/core";
import type { AssessmentResult, LlmAssessmentOutput, PlanBundle } from "@lore/core";
import { clipOverlongReasoning, extractAssessmentJson, llmAssessmentOutputSchema } from "@lore/core";
import type { CheckResult, LlmReviewOutput, NewReviewJudgment, ReviewBundle } from "@lore/core";
import { llmReviewOutputSchema } from "@lore/core";
import {
  BUILT_IN_TEMPLATES,
  LINK_INFERENCE_TEMPLATE,
  REFINE_TEMPLATE,
  renderTemplate,
} from "../ai/templates.js";
import {
  ASSESS_PROMPT_VERSION,
  buildAssessPrompt,
  buildAssessRetryPrompt,
  type AssessBudgets,
} from "../ai/assess-template.js";
import {
  REVIEW_PROMPT_VERSION,
  REVIEW_TEMPLATES,
  buildReviewRetryPrompt,
  type ReviewBudgets,
} from "../ai/review-template.js";

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
    const tpl = this.templates[args.doc_type] ?? BUILT_IN_TEMPLATES[args.doc_type];

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

    return result;
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
            `Expected one of: parent, implements, informs, supersedes, relates-to, blocks.`,
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
   * Flow: build the judge prompt (materials truncated per config.ai.assess.* budgets) →
   * invoke the provider → extract JSON from the raw response → validate against
   * llmAssessmentOutputSchema → on failure, ONE corrective retry with the parse error
   * embedded in a follow-up prompt → on a second failure, AI_PROVIDER_ERROR with a
   * ≤500-char raw-output prefix (no document is created — that is the caller's job, and
   * it never runs when this returns an error). Emits ai.generation telemetry
   * (kind="assess") on every terminal outcome exactly once.
   *
   * @param bundle - {plan, spec?, tasks[]} from CorpusService.getPlanBundle
   * @param opts.diffText - Optional diff text (already acquired by the CLI layer)
   * @param opts.source - Caller surface, forwarded to telemetry as caller_surface
   * @returns Result<AssessmentResult, LoreError> — never throws
   *
   * @example
   * const bundleResult = await app.corpusService.getPlanBundle("plan-my-feature");
   * if (!bundleResult.ok) { ... }
   * const assessResult = await svc.assessPlan(bundleResult.value, { source: app.callerSurface });
   * if (!assessResult.ok) { process.exitCode = exitCode(assessResult.error); return; }
   * console.log(assessResult.value.verdict, assessResult.value.overall_score);
   *
   * Source: SPEC-026 §3 D1, D2; §4 AC-ASSESS-1, AC-ASSESS-3, AC-ASSESS-4, AC-ASSESS-5
   */
  async assessPlan(
    bundle: PlanBundle,
    opts?: {
      // reason: explicit `| undefined` required by exactOptionalPropertyTypes.
      diffText?: string | undefined;
      source?: CallerSurface | undefined;
    },
  ): Promise<Result<AssessmentResult, LoreError>> {
    const t0 = performance.now();
    const { prompt, truncated } = buildAssessPrompt(bundle, opts?.diffText, this.assessBudgets);

    // reason: telemetry meta is identical across every terminal branch below (only the
    // provider Result and elapsed duration differ) — factored out to keep each branch
    // a one-line emit call instead of repeating the 5-field meta object four times.
    const emitAssessEvent = (providerResult: Result<GenerateOutput, LoreError>): void => {
      this._emitAiEvent(providerResult, Math.round(performance.now() - t0), {
        doc_type: "knowledge",
        template_source: "built-in",
        kind: "assess",
        target_doc_id: null,
        caller_surface: opts?.source,
      });
    };

    // First attempt.
    const first = await this._attemptJudgeParse(prompt, bundle);
    if (!first.providerResult.ok) {
      emitAssessEvent(first.providerResult);
      return first.providerResult;
    }
    if (first.parsed !== undefined) {
      emitAssessEvent(first.providerResult);
      return ok(
        this._finalizeAssessment(
          first.parsed,
          bundle,
          Math.round(performance.now() - t0),
          false,
          truncated,
          first.clippedAcIds ?? [],
        ),
      );
    }

    // Corrective retry (SPEC-026 §3 D2) — embed the parse error + reminder.
    const retryPrompt = buildAssessRetryPrompt(prompt, first.parseErrorMessage ?? "unknown parse error");
    const second = await this._attemptJudgeParse(retryPrompt, bundle);
    if (!second.providerResult.ok) {
      emitAssessEvent(second.providerResult);
      return second.providerResult;
    }
    if (second.parsed !== undefined) {
      emitAssessEvent(second.providerResult);
      return ok(
        this._finalizeAssessment(
          second.parsed,
          bundle,
          Math.round(performance.now() - t0),
          true,
          truncated,
          second.clippedAcIds ?? [],
        ),
      );
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
    const { prompt, truncated: _truncated } = template(bundle, checks, this.reviewBudgets);

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
      const finalized = this._finalizeJudgment(first.parsed, bundle, checks);
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
      const finalized = this._finalizeJudgment(second.parsed, bundle, checks);
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
   * Assemble the final persisted AssessmentResult from a validated judge output — layers
   * the service-computed `scope` and `judgment` fields on top of what the model produced
   * (the model is never asked to, and never does, produce those two fields itself).
   *
   * @param parsed - Validated judge output (verdict/overall_score/ac_scores/gaps/recommendations)
   * @param bundle - Plan bundle — bundle.plan.id becomes scope.id
   * @param durationMs - Total wall-clock ms for the whole assessPlan call (both attempts)
   * @param retried - Whether the corrective retry was needed
   * @param truncated - Section names truncated while building the prompt (AC-ASSESS-7)
   * @param clippedAcIds - AC ids whose reasoning was clipped before validation (SPEC-029
   *   AC-AR-2); empty when nothing needed clipping — `judgment.reasoning_clipped` is only
   *   set (additive-only field, AC-AR-3) when this is non-empty
   */
  private _finalizeAssessment(
    parsed: LlmAssessmentOutput,
    bundle: PlanBundle,
    durationMs: number,
    retried: boolean,
    truncated: string[],
    clippedAcIds: string[],
  ): AssessmentResult {
    return {
      ...parsed,
      scope: { type: "plan", id: bundle.plan.id },
      judgment: {
        provider: this.active,
        prompt_version: ASSESS_PROMPT_VERSION,
        duration_ms: durationMs,
        retried,
        truncated,
        ...(clippedAcIds.length > 0 ? { reasoning_clipped: clippedAcIds } : {}),
      },
    };
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
   */
  private _finalizeJudgment(
    parsed: LlmReviewOutput,
    bundle: ReviewBundle,
    checks: CheckResult[],
  ): NewReviewJudgment {
    return {
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: parsed.decision,
      confidence: parsed.confidence,
      reasons: parsed.reasons,
      checks,
      blocking_questions: parsed.blocking_questions,
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
      kind: "create" | "regenerate" | "refine" | "infer" | "assess" | "review";
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
